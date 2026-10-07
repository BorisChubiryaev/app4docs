#!/usr/bin/env node
// Сборка офлайн-движка PDF → PPTX в public/pdf2pptx/.
//
// Движок — Python-проект github.com/BorisChubiryaev/pdf2pptx (PyMuPDF +
// python-pptx). В браузере он работает через Pyodide (CPython в WebAssembly),
// поэтому сервер не нужен: всё, что требуется, лежит рядом со сборкой.
//
//   node scripts/vendor-pdf2pptx.mjs                  # обновить код движка из ../pdf2pptx
//   node scripts/vendor-pdf2pptx.mjs --engine-dir D   # … из другой папки
//   node scripts/vendor-pdf2pptx.mjs --runtime        # (пере)скачать Pyodide и колёса
//   node scripts/vendor-pdf2pptx.mjs --runtime --force
//
// Версии согласованы: колёса wasm32 собраны под ABI pyodide_2025_0
// (Pyodide 0.28, Python 3.13) — менять их нужно вместе.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "pdf2pptx");
const RUNTIME = path.join(OUT, "runtime");
const ENGINE = path.join(OUT, "engine");

const PYODIDE = "0.28.3";
const JSDELIVR = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE}/full`;

// Qlik Sense при импорте расширения отклоняет пакет с «непривычными» типами
// файлов (.wasm/.whl/.zip/.py). Поэтому на диск они пишутся под именем
// «…<ext>.txt», а pyodide.mjs (ES-модуль, обязан быть .js) — как
// pyodide.loader.js. Воркер (engineAssets.storedUrl) восстанавливает исходные
// адреса. В манифесте имена остаются логическими.
const safeName = (name) =>
  name === "pyodide.mjs"
    ? "pyodide.loader.js"
    : /\.(wasm|whl|zip|py)$/.test(name)
      ? name + ".txt"
      : name;

// Файлы ядра Pyodide из npm-пакета pyodide.
const CORE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

// Python-пакеты: [имя файла, URL]. Порядок = порядок загрузки.
const WHEELS = [
  [
    "lxml-6.0.0-cp313-cp313-pyodide_2025_0_wasm32.whl",
    `${JSDELIVR}/lxml-6.0.0-cp313-cp313-pyodide_2025_0_wasm32.whl`,
  ],
  [
    "pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl",
    `${JSDELIVR}/pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl`,
  ],
  ["pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl", "pypi:pymupdf"],
  ["typing_extensions-4.16.0-py3-none-any.whl", "pypi:typing_extensions"],
  ["xlsxwriter-3.2.9-py3-none-any.whl", "pypi:xlsxwriter"],
  ["python_pptx-1.0.2-py3-none-any.whl", "pypi:python-pptx"],
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

/** URL колеса на PyPI по точному имени файла. */
const pypiUrl = async (project, fileName) => {
  const version = fileName.split("-")[1];
  const meta = await (
    await fetch(`https://pypi.org/pypi/${project}/${version}/json`)
  ).json();
  const file = meta.urls.find((u) => u.filename === fileName);
  if (!file) throw new Error(`На PyPI нет файла ${fileName}`);
  return file.url;
};

const vendorRuntime = async (force) => {
  fs.mkdirSync(RUNTIME, { recursive: true });

  const missingCore = CORE_FILES.filter(
    (f) => force || !fs.existsSync(path.join(RUNTIME, safeName(f))),
  );
  if (missingCore.length) {
    console.log(`Pyodide ${PYODIDE} из npm…`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pyodide-"));
    const tgz = path.join(tmp, "pyodide.tgz");
    fs.writeFileSync(
      tgz,
      await download(`https://registry.npmjs.org/pyodide/-/pyodide-${PYODIDE}.tgz`),
    );
    execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
    for (const f of missingCore) {
      fs.copyFileSync(path.join(tmp, "package", f), path.join(RUNTIME, safeName(f)));
      console.log("  ✓", safeName(f));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  for (const [fileName, source] of WHEELS) {
    const target = path.join(RUNTIME, safeName(fileName));
    if (!force && fs.existsSync(target)) continue;
    const url = source.startsWith("pypi:")
      ? await pypiUrl(source.slice(5), fileName)
      : source;
    fs.writeFileSync(target, await download(url));
    console.log("  ✓", safeName(fileName));
  }
};

const vendorEngine = (engineDir) => {
  const src = path.join(engineDir, "engine");
  if (!fs.existsSync(src)) {
    throw new Error(
      `Не найдена папка ${src}. Укажите клон pdf2pptx: --engine-dir <путь>`,
    );
  }
  fs.rmSync(ENGINE, { recursive: true, force: true });
  fs.mkdirSync(ENGINE, { recursive: true });
  // CLI (__main__.py) в браузере не нужен.
  const files = fs
    .readdirSync(src)
    .filter((f) => f.endsWith(".py") && f !== "__main__.py")
    .sort();
  for (const f of files) {
    fs.copyFileSync(path.join(src, f), path.join(ENGINE, safeName(f)));
  }

  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", engineDir, "rev-parse", "HEAD"])
      .toString()
      .trim();
  } catch {
    /* не git-клон — версию не знаем */
  }
  console.log(`Движок: ${files.length} файлов, коммит ${commit.slice(0, 7)}`);
  return { commit, files };
};

const writeManifest = (engine) => {
  const runtimeFiles = fs.readdirSync(RUNTIME);
  const missing = [...CORE_FILES, ...WHEELS.map(([f]) => f)].filter(
    (f) => !runtimeFiles.includes(safeName(f)),
  );
  if (missing.length) {
    throw new Error(
      `Не хватает файлов среды: ${missing.join(", ")}. Запустите с --runtime.`,
    );
  }
  const manifestPath = path.join(OUT, "manifest.json");
  const prev = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};
  const bytes = [...CORE_FILES, ...WHEELS.map(([f]) => f)].reduce(
    (sum, f) => sum + fs.statSync(path.join(RUNTIME, safeName(f))).size,
    0,
  );
  const manifest = {
    pyodide: PYODIDE,
    engineCommit: engine?.commit ?? prev.engineCommit,
    engineFiles: engine?.files ?? prev.engineFiles,
    wheels: WHEELS.map(([f]) => f),
    runtimeBytes: bytes,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `manifest.json: среда ${(bytes / 1024 / 1024).toFixed(1)} МБ, движок ${manifest.engineCommit?.slice(0, 7)}`,
  );
};

const main = async () => {
  if (flag("--runtime")) await vendorRuntime(flag("--force"));
  let engine;
  if (!flag("--runtime") || flag("--engine-dir")) {
    engine = vendorEngine(
      path.resolve(option("--engine-dir", path.join(ROOT, "..", "pdf2pptx"))),
    );
  }
  writeManifest(engine);
};

main().catch((err) => {
  console.error("✗", err.message);
  process.exit(1);
});
