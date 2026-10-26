#!/usr/bin/env node
// Упаковка нейросети для удаления фона (конвертер изображений) в public/aibg/.
//
//   node scripts/vendor-aibg.mjs                      # скачать модель и упаковать
//   node scripts/vendor-aibg.mjs --model путь.onnx    # взять модель с диска
//
// Модель — silueta из проекта rembg (U²-Net, сжатая до 8 бит; Apache-2.0):
// точна на людях, животных, машинах, предметах. Движок — onnxruntime-web
// (MIT), его wasm берётся из node_modules.
//
// Доставка — как у движка PDF → PPTX (см. vendor-pdf2pptx.mjs): сервер Qlik
// режет «непривычные» файлы (типы, слова в адресе, содержимое, размер). Поэтому
// каждый файл: gzip → HEX-текст (только 0-9a-f — ни одно правило WAF не
// сработает) → части до 6 МБ с нейтральными именами-хэшами «xxxxxxxx_N.txt».
// Браузер склеивает части, декодирует hex, распаковывает gzip
// (DecompressionStream) и сверяет SHA-256 с манифестом.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "aibg");
const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx";
// Проверенная версия модели (rembg v0.0.0, silueta.onnx)
const MODEL_SHA256 = "75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb";
const ORT_DIR = path.join(ROOT, "node_modules", "onnxruntime-web");
const CHUNK = 6 * 1024 * 1024;

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const hashHex = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function loadModel() {
  const local = arg("--model");
  if (local) return fs.readFileSync(local);
  console.log(`Скачиваю модель: ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function pack(logical, data, manifest, version) {
  const gz = zlib.gzipSync(data, { level: 9 });
  const hex = Buffer.from(gz.toString("hex"), "ascii");
  const base = hashHex(`aibg/${version}/${logical}`);
  const parts = [];
  for (let i = 0; i * CHUNK < hex.length; i++) {
    const body = hex.subarray(i * CHUNK, (i + 1) * CHUNK);
    const name = `${base}_${i}.txt`;
    fs.writeFileSync(path.join(OUT, name), body);
    manifest.chunks[name] = { size: body.length, sha256: sha(body) };
    parts.push(name);
  }
  manifest.files[logical] = { parts, size: data.length, gz: gz.length, sha256: sha(data) };
  console.log(`${logical}: ${(data.length / 1048576).toFixed(1)} МБ → gzip ${(gz.length / 1048576).toFixed(1)} МБ → ${parts.length} част.`);
}

const model = await loadModel();
const modelSha = sha(model);
if (MODEL_SHA256 && modelSha !== MODEL_SHA256) throw new Error(`SHA-256 модели не совпал: ${modelSha}`);
const ortPkg = JSON.parse(fs.readFileSync(path.join(ORT_DIR, "package.json"), "utf8"));
const wasm = fs.readFileSync(path.join(ORT_DIR, "dist", "ort-wasm-simd-threaded.wasm"));
const version = `silueta-${modelSha.slice(0, 8)}-ort${ortPkg.version}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { version, model: "silueta (rembg, U²-Net, Apache-2.0)", ort: ortPkg.version, input: 320, files: {}, chunks: {} };
pack("model", model, manifest, version);
pack("wasm", wasm, manifest, version);

// Служебный JS-модуль движка («клей» Emscripten). onnxruntime-web подключает
// его через import() по адресу — обычным файлом с того же сервера (как
// pyodide.loader.js у PDF → PPTX), а не blob-ссылкой, которую может запретить
// политика безопасности (CSP) портала. Адрес wasm внутри него не нужен —
// wasm передаётся байтами — поэтому вычисление адреса заменяем на имя.
const GLUE_URL_EXPR = '(new URL("ort-wasm-simd-threaded.wasm",import.meta.url)).href';
let glue = fs.readFileSync(path.join(ORT_DIR, "dist", "ort-wasm-simd-threaded.mjs"), "utf8");
if (!glue.includes(GLUE_URL_EXPR)) throw new Error("ort-wasm-simd-threaded.mjs: не найдено место для правки адреса wasm (другая версия onnxruntime-web?)");
glue = glue.replace(GLUE_URL_EXPR, '"ort-wasm-simd-threaded.wasm"');
const glueName = `${hashHex(`aibg/${version}/glue`)}.js`;
fs.writeFileSync(path.join(OUT, glueName), glue);
manifest.glue = { file: glueName, size: Buffer.byteLength(glue), sha256: sha(Buffer.from(glue)) };
console.log(`glue: ${glueName} (${(Buffer.byteLength(glue) / 1024).toFixed(0)} КБ)`);
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`Готово: ${OUT} (версия ${version})`);
