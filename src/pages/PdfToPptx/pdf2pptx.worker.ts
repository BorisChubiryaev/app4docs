/// <reference lib="webworker" />
// Фоновый поток конвертера PDF → PPTX.
//
// Внутри — Pyodide (CPython в WebAssembly) и Python-движок pdf2pptx
// (PyMuPDF + python-pptx) без изменений. Файлы среды лежат в
// public/pdf2pptx/ (см. scripts/vendor-pdf2pptx.mjs) и грузятся по
// относительному адресу — работает и на обычном хостинге, и в мэшапе
// Qlik Sense. Движок загружается один раз и переиспользуется.

import type { WorkerRequest, WorkerResponse } from "./pdf2pptx.types";
import {
  dropOldCaches,
  loadManifest,
  makeCachedFetch,
  storedUrl,
  LOADER_FILE,
} from "./engineAssets";

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
// 1) файлы с «непривычными» для Qlik типами лежат под именем …<ext>.txt —
//    запрос к исходному имени подменяется на реальный файл (storedUrl);
// 2) файлы движка берутся из постоянного кэша (см. engineAssets.ts);
// 3) хостинг (например, Qlik Sense) может отдавать .wasm не как
//    application/wasm — тогда WebAssembly.instantiateStreaming падает, а
//    Pyodide не переходит на запасной путь и зависает. Проставляем тип сами.
// 4) двоичные файлы проверяются по первым байтам: если сервер вернул вместо
//    файла что-то другое (страницу входа, ошибку прокси), Pyodide зависает
//    без сообщения — поэтому сообщаем об этом сами, с тем, что пришло.
const MAGIC: [RegExp, number[]][] = [
  [/\.wasm$/, [0x00, 0x61, 0x73, 0x6d]], // \0asm
  [/\.(whl|zip)$/, [0x50, 0x4b]], // PK — zip-архив
];

const describeBadFile = (url: string, res: Response, bytes: Uint8Array) => {
  const preview = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 160))
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7eЀ-ӿ]/g, "·");
  return new Error(
    `Сервер вернул не тот файл: ${url.split("/").slice(-2).join("/")} — ` +
      `${bytes.length} байт, тип «${res.headers.get("content-type") ?? "?"}», ` +
      `начало: «${preview}»`,
  );
};

const nativeFetch = self.fetch.bind(self);
let engineFetch: typeof fetch = nativeFetch;
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const stored = storedUrl(url);
  let res: Response;
  try {
    res = await engineFetch(stored === url ? input : stored, init);
  } catch (err) {
    // Pyodide глотает ошибки загрузки некоторых файлов (например,
    // python_stdlib.zip — тогда Python падает с «No module named
    // 'encodings'»), поэтому сообщаем настоящую причину сами.
    reportUnhandled(err);
    throw err;
  }
  const path = url.split("?")[0];
  const magic = MAGIC.find(([re]) => re.test(path))?.[1];
  if (!magic) return res;

  if (!res.ok) {
    reportUnhandled(
      new Error(`Сервер не отдал ${path.split("/").pop()}: HTTP ${res.status}`),
    );
    return res;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!magic.every((b, i) => bytes[i] === b)) {
    const err = describeBadFile(path, res, bytes);
    reportUnhandled(err);
    throw err;
  }
  const isWasm = path.endsWith(".wasm");
  return new Response(bytes, {
    status: res.status,
    headers: {
      "content-type": isWasm
        ? "application/wasm"
        : (res.headers.get("content-type") ?? "application/octet-stream"),
    },
  });
};

// 5) при сбое запуска WebAssembly (например, его запрещает
//    Content-Security-Policy) Pyodide лишь пишет console.warn
//    «wasm instantiation failed!» и следом ошибку — и зависает навсегда.
//    Ловим это предупреждение и показываем настоящую причину.
const nativeWarn = console.warn.bind(console);
let wasmFailed = false;
console.warn = (...args: unknown[]) => {
  nativeWarn(...args);
  const text = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a)))
    .join(" ");
  if (/wasm instantiation failed/i.test(text)) {
    wasmFailed = true;
    return;
  }
  if (wasmFailed) {
    wasmFailed = false;
    const csp = /unsafe-eval|content security policy|csp/i.test(text)
      ? " Похоже, WebAssembly запрещён политикой безопасности (CSP): " +
        "нужно разрешение script-src 'wasm-unsafe-eval'."
      : "";
    reportUnhandled(new Error(`WebAssembly не запустился: ${text}.${csp}`));
  }
};

let pyodide: PyodideAPI | null = null;
let initPromise: Promise<void> | null = null;

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

// Диагностика: на каком этапе мы сейчас и что последним печатал Pyodide.
// Без этого ошибки, пришедшие не как Error, видны только как «[object Object]».
let stage = "подготовка";
const pyLog: string[] = [];
const remember = (line: string) => {
  pyLog.push(line);
  if (pyLog.length > 12) pyLog.shift();
};

// Pyodide пишет часть ошибок только в console.error (например, «Error
// occurred while installing the standard library») — сохраняем их в лог.
const nativeError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  nativeError(...args);
  remember(
    "console: " +
      args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "),
  );
};

const setStage = (text: string, step: number, steps: number) => {
  stage = text;
  post({ type: "stage", text, step, steps });
};

const init = async (base: string) => {
  const t0 = performance.now();
  const manifest = await loadManifest(base);
  engineFetch = makeCachedFetch(manifest, base, nativeFetch);
  dropOldCaches(manifest).catch(() => {});
  const runtime = base + "runtime/";
  const steps = manifest.wheels.length + 2;

  setStage("Запускаем Python (WebAssembly)…", 1, steps);
  const { loadPyodide } = await import(/* @vite-ignore */ runtime + LOADER_FILE);
  const py: PyodideAPI = await loadPyodide({
    indexURL: runtime,
    stdout: (line: string) => remember(line),
    stderr: (line: string) => remember("stderr: " + line),
  });

  for (let i = 0; i < manifest.wheels.length; i++) {
    const wheel = manifest.wheels[i];
    const name = wheel.split("-")[0];
    setStage(
      name === "pymupdf" ? "Загружаем PyMuPDF (самый большой модуль)…" : `Загружаем ${name}…`,
      i + 2,
      steps,
    );
    await py.loadPackage(runtime + wheel, {
      messageCallback: () => {},
      errorCallback: (msg: string) => remember("loadPackage: " + msg),
    } as { messageCallback: (m: string) => void });
  }

  setStage("Загружаем движок pdf2pptx…", steps, steps);
  py.FS.mkdirTree("/app/engine");
  await Promise.all(
    manifest.engineFiles.map(async (f) => {
      // self.fetch подменит «engine/x.py» на реальный «engine/x.py.txt».
      const res = await self.fetch(base + "engine/" + f);
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
  stage = "конвертация";
  post({
    type: "ready",
    ms: performance.now() - t0,
    engineCommit: manifest.engineCommit,
    runtimeSize: fmtMb(manifest.runtimeBytes),
  });
};

/** Любая ошибка → читаемый текст (Error, строка, событие или просто объект). */
const errorText = (err: unknown): string => {
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    // В Chrome стек уже начинается с «Имя: сообщение» — не повторяем его.
    if (!err.stack) return head;
    return err.stack.includes(err.message) ? err.stack : `${head}\n${err.stack}`;
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") {
      return `${String(o.name ?? o.type ?? "Error")}: ${o.message}`;
    }
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err));
    } catch {
      /* циклические ссылки — ниже String() */
    }
  }
  return String(err);
};

/** Текст ошибки для пользователя: сообщение ConversionError или общее. */
const describeError = (err: unknown): { message: string; details?: string } => {
  // Исходный объект — в консоль DevTools, его можно раскрыть и изучить.
  nativeError("[pdf2pptx] этап:", stage, err);
  const text = errorText(err);
  const known = text.match(/ConversionError: (.+?)\s*$/m);
  if (known) return { message: known[1] };
  const lines = text.split("\n").filter(Boolean);
  const details = [
    `Этап: ${stage}`,
    ...lines.slice(0, 2),
    ...lines.slice(2).slice(-4),
    ...(pyLog.length ? ["— вывод Python:", ...pyLog.slice(-6)] : []),
  ].join("\n");
  return {
    message:
      stage === "конвертация"
        ? "Не удалось сконвертировать файл."
        : "Не удалось запустить движок конвертации.",
    details,
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

// Ошибки, выброшенные вне наших await (например, падение WebAssembly внутри
// колбэка Emscripten): иначе запуск движка зависал бы без сообщения.
let fatalReported = false;
const reportUnhandled = (err: unknown) => {
  if (pyodide || fatalReported) return; // после запуска ошибки ловит convertPdf
  fatalReported = true;
  initPromise = null;
  post({ type: "error", ...describeError(err), fatal: true });
};
self.addEventListener("unhandledrejection", (e) => reportUnhandled(e.reason));
self.addEventListener("error", (e) => reportUnhandled(e.error ?? e.message));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    // reportUnhandled сообщает об ошибке запуска один раз, даже если её уже
    // поймали проверка файлов или перехват console.warn.
    initPromise ??= init(msg.base).catch(reportUnhandled);
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
