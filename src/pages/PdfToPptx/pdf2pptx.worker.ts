/// <reference lib="webworker" />
// Фоновый поток конвертера PDF → PPTX.
//
// Внутри — Pyodide (CPython в WebAssembly) и Python-движок pdf2pptx
// (PyMuPDF + python-pptx) без изменений. Файлы среды лежат в
// public/pdf2pptx/ (см. scripts/vendor-pdf2pptx.mjs) и грузятся по
// относительному адресу — работает и на обычном хостинге, и в мэшапе
// Qlik Sense. Движок загружается один раз и переиспользуется.

import type { WorkerRequest, WorkerResponse } from "./pdf2pptx.types";
import { dropOldCaches, loadManifest, makeCachedFetch } from "./engineAssets";

declare const self: DedicatedWorkerGlobalScope;

// Минимальный интерфейс Pyodide, который нам нужен.
interface PyodideAPI {
  loadPackage(
    urls: string | string[],
    options?: { messageCallback?: (msg: string) => void },
  ): Promise<unknown>;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void };
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

// Все запросы Pyodide идут через self.fetch, поэтому подменяем его:
// 1) файлы движка берутся из постоянного кэша (см. engineAssets.ts);
// 2) хостинг (например, Qlik Sense) может отдавать .wasm не как
//    application/wasm — тогда WebAssembly.instantiateStreaming падает, а
//    Pyodide не переходит на запасной путь и зависает. Проставляем тип сами.
const nativeFetch = self.fetch.bind(self);
let engineFetch: typeof fetch = nativeFetch;
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await engineFetch(input, init);
  const url = String(input instanceof Request ? input.url : input);
  if (
    url.split("?")[0].endsWith(".wasm") &&
    res.headers.get("content-type") !== "application/wasm"
  ) {
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: { "content-type": "application/wasm" },
    });
  }
  return res;
};

let pyodide: PyodideAPI | null = null;
let initPromise: Promise<void> | null = null;

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

const init = async (base: string) => {
  const t0 = performance.now();
  const manifest = await loadManifest(base);
  engineFetch = makeCachedFetch(manifest, base, nativeFetch);
  dropOldCaches(manifest).catch(() => {});
  const runtime = base + "runtime/";
  const steps = manifest.wheels.length + 2;

  post({ type: "stage", text: "Запускаем Python (WebAssembly)…", step: 1, steps });
  const { loadPyodide } = await import(/* @vite-ignore */ runtime + "pyodide.mjs");
  const py: PyodideAPI = await loadPyodide({ indexURL: runtime });

  for (let i = 0; i < manifest.wheels.length; i++) {
    const wheel = manifest.wheels[i];
    const name = wheel.split("-")[0];
    post({
      type: "stage",
      text: name === "pymupdf" ? "Загружаем PyMuPDF (самый большой модуль)…" : `Загружаем ${name}…`,
      step: i + 2,
      steps,
    });
    await py.loadPackage(runtime + wheel, { messageCallback: () => {} });
  }

  post({ type: "stage", text: "Загружаем движок pdf2pptx…", step: steps, steps });
  py.FS.mkdirTree("/app/engine");
  await Promise.all(
    manifest.engineFiles.map(async (f) => {
      const res = await fetch(base + "engine/" + f);
      if (!res.ok) throw new Error(`Не удалось загрузить engine/${f}`);
      py.FS.writeFile("/app/engine/" + f, new Uint8Array(await res.arrayBuffer()));
    }),
  );
  py.runPython(`
import sys
sys.path.insert(0, "/app")
from engine.convert import convert, ConversionError
`);

  pyodide = py;
  post({
    type: "ready",
    ms: performance.now() - t0,
    engineCommit: manifest.engineCommit,
    runtimeSize: fmtMb(manifest.runtimeBytes),
  });
};

/** Текст ошибки для пользователя: сообщение ConversionError или общее. */
const describeError = (err: unknown): { message: string; details?: string } => {
  const text = err instanceof Error ? err.message : String(err);
  const known = text.match(/ConversionError: (.+?)\s*$/);
  if (known) return { message: known[1] };
  return {
    message: "Не удалось сконвертировать файл.",
    details: text.split("\n").filter(Boolean).slice(-3).join("\n"),
  };
};

const convertPdf = async (id: number, pdf: ArrayBuffer, mode: string) => {
  const py = pyodide!;
  const t0 = performance.now();
  py.FS.writeFile("/in.pdf", new Uint8Array(pdf));
  py.globals.set("report", (done: number, total: number) =>
    post({ type: "progress", id, done, total }),
  );
  py.globals.set("pdf_mode", mode);
  try {
    await py.runPythonAsync(`
with open("/in.pdf", "rb") as f:
    _data = f.read()
_out = convert(_data, mode=pdf_mode, workers=1, progress=report)
with open("/out.pptx", "wb") as f:
    f.write(_out)
del _data, _out
`);
    const out = py.FS.readFile("/out.pptx");
    // Копия в собственный буфер — его и передаём без копирования.
    const bytes = out.slice().buffer;
    post({ type: "done", id, pptx: bytes, ms: performance.now() - t0 }, [bytes]);
  } finally {
    for (const f of ["/in.pdf", "/out.pptx"]) {
      try {
        py.FS.unlink(f);
      } catch {
        /* файла нет — ничего страшного */
      }
    }
  }
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    initPromise ??= init(msg.base).catch((err) => {
      initPromise = null;
      post({ type: "error", ...describeError(err), fatal: true });
    });
    return;
  }
  if (msg.type === "convert") {
    try {
      if (!initPromise) throw new Error("Движок не инициализирован");
      await initPromise;
      if (!pyodide) return;
      await convertPdf(msg.id, msg.pdf, msg.mode);
    } catch (err) {
      post({ type: "error", id: msg.id, ...describeError(err) });
    }
  }
};
