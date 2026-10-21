#!/usr/bin/env node
// Упаковка распознавания текста (OCR) для конвертера документов в public/ocr/.
//
//   node scripts/vendor-ocr.mjs
//
// Движок — tesseract.js (Apache-2.0): поток распознавания (worker.min.js) и
// ядро Tesseract в WebAssembly (tesseract.js-core, вариант SIMD+LSTM, wasm
// встроен в .js). Языки — русский и английский из @tesseract.js-data
// (модели LSTM 4.0.0_best_int, Apache-2.0). Всё берётся из node_modules.
//
// Доставка — как у PDF → PPTX (vendor-pdf2pptx.mjs): сервер Qlik режет
// «непривычные» файлы. JS-файлы движка лежат как есть под нейтральными
// именами-хэшами «xxxxxxxx.js» (их подключает сам поток по адресу); модели
// языков (gzip) — HEX-текстом частями до 6 МБ «xxxxxxxx_N.txt». Браузер
// сверяет размер и SHA-256 каждого файла с манифестом.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "ocr");
const NM = path.join(ROOT, "node_modules");
const CHUNK = 6 * 1024 * 1024;
const LANGS = ["rus", "eng"];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const hashHex = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
const pkgVersion = (name) => JSON.parse(fs.readFileSync(path.join(NM, name, "package.json"), "utf8")).version;

const tjs = pkgVersion("tesseract.js");
const core = pkgVersion("tesseract.js-core");
const version = `tesseract${tjs}-core${core}-${LANGS.join("+")}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { version, files: {}, chunks: {}, scripts: {} };

function script(key, src, patch) {
  let body = fs.readFileSync(src);
  if (patch) body = Buffer.from(patch(body.toString("utf8")), "utf8");
  const name = `${hashHex(`ocr/${version}/${key}`)}.js`;
  fs.writeFileSync(path.join(OUT, name), body);
  manifest.scripts[key] = { file: name, size: body.length, sha256: sha(body) };
  console.log(`${key}: ${name} (${(body.length / 1048576).toFixed(1)} МБ)`);
}

function packed(key, src) {
  const gz = fs.readFileSync(src); // уже gzip
  const hex = Buffer.from(gz.toString("hex"), "ascii");
  const base = hashHex(`ocr/${version}/${key}`);
  const parts = [];
  for (let i = 0; i * CHUNK < hex.length; i++) {
    const body = hex.subarray(i * CHUNK, (i + 1) * CHUNK);
    const name = `${base}_${i}.txt`;
    fs.writeFileSync(path.join(OUT, name), body);
    manifest.chunks[name] = { size: body.length, sha256: sha(body) };
    parts.push(name);
  }
  manifest.files[key] = { parts, size: gz.length, sha256: sha(gz) };
  console.log(`${key}: gzip ${(gz.length / 1048576).toFixed(1)} МБ → ${parts.length} част.`);
}

// Ошибка tesseract.js 7: языки, переданные байтами ({code, data}), при
// инициализации называются по полю data вместо code — правим одно место
const LANG_BUG = 'return"string"==typeof t?t:t.data})).join("+")';
script("worker", path.join(NM, "tesseract.js", "dist", "worker.min.js"), (src) => {
  const n = src.split(LANG_BUG).length - 1;
  if (n !== 1) throw new Error(`worker.min.js: место правки найдено ${n} раз (другая версия tesseract.js?)`);
  return src.replace(LANG_BUG, LANG_BUG.replace("t.data", "t.code"));
});
script("core", path.join(NM, "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"));
for (const l of LANGS) packed(l, path.join(NM, "@tesseract.js-data", l, "4.0.0_best_int", `${l}.traineddata.gz`));
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`Готово: ${OUT} (версия ${version})`);
