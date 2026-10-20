// Загрузка нейросети удаления фона из public/aibg/ (см. scripts/vendor-aibg.mjs).
//
// Файлы лежат рядом со сборкой и приходят с того же сервера, что и
// приложение, — интернет не нужен. Каждый файл: части «xxxxxxxx_N.txt» с
// HEX-текстом gzip-архива (так их пропускает файрвол Qlik). Здесь части
// сверяются с манифестом (размер, SHA-256), склеиваются, декодируются из hex
// и распаковываются. Скачанные части хранятся в Cache Storage — повторно
// модель грузится мгновенно, а при обновлении старая версия удаляется.

export interface AiManifest {
  version: string;
  input: number;
  files: Record<"model" | "wasm", { parts: string[]; size: number; gz: number; sha256: string }>;
  chunks: Record<string, { size: number; sha256: string }>;
}

const CACHE_PREFIX = "aibg-";

export const aiBase = () => new URL("aibg/", document.baseURI).href;

const hasCache = () => typeof caches !== "undefined" && typeof caches.open === "function";

async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null; // только https/localhost
  const buf = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const HEX = new Int16Array(128).fill(-1);
for (let i = 0; i < 16; i++) HEX["0123456789abcdef".charCodeAt(i)] = i;

function decodeHex(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length >> 1);
  let hi = -1;
  let o = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i] < 128 ? HEX[src[i]] : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out[o++] = (hi << 4) | v;
      hi = -1;
    }
  }
  return out.subarray(0, o);
}

async function gunzip(data: Uint8Array): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined")
    throw new Error("Браузер слишком старый для нейросети (нет DecompressionStream). Обновите Chrome/Edge/Firefox или выберите «Однотонный фон».");
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadAiFiles(onProgress: (loaded: number, total: number) => void): Promise<{ model: ArrayBuffer; wasm: ArrayBuffer; manifest: AiManifest }> {
  const base = aiBase();
  const res = await fetch(base + "manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Не найдены файлы нейросети (aibg/manifest.json: HTTP ${res.status}). Проверьте, что папка aibg выложена рядом с приложением.`);
  const manifest = (await res.json()) as AiManifest;
  const cacheName = CACHE_PREFIX + manifest.version;
  let cache: Cache | null = null;
  if (hasCache()) {
    cache = await caches.open(cacheName).catch(() => null);
    // Старые версии модели больше не нужны
    caches
      .keys()
      .then((keys) => keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== cacheName).forEach((k) => caches.delete(k)))
      .catch(() => undefined);
  }

  const total = Object.values(manifest.files).reduce((s, f) => s + f.parts.reduce((a, p) => a + manifest.chunks[p].size, 0), 0);
  let loaded = 0;
  onProgress(0, total);

  const fetchPart = async (name: string): Promise<Uint8Array> => {
    const want = manifest.chunks[name];
    const url = base + name;
    const check = async (bytes: ArrayBuffer) => {
      if (bytes.byteLength !== want.size) return `${name}: ${bytes.byteLength} байт вместо ${want.size}`;
      const h = await sha256(bytes);
      return h && h !== want.sha256 ? `${name}: содержимое отличается (SHA-256)` : null;
    };
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      if (!(await check(bytes))) {
        loaded += bytes.byteLength;
        onProgress(loaded, total);
        return new Uint8Array(bytes);
      }
      await cache?.delete(url).catch(() => false);
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Сервер не отдал файл нейросети ${name}: HTTP ${r.status}`);
    const bytes = await r.arrayBuffer();
    const bad = await check(bytes);
    if (bad)
      throw new Error(
        `Файл нейросети повреждён — ${bad}. Он изменился по дороге на сервер (почтовый шлюз, антивирус) — сравните с dist/aibg после сборки.`,
      );
    await cache?.put(url, new Response(bytes)).catch(() => undefined);
    loaded += bytes.byteLength;
    onProgress(loaded, total);
    return new Uint8Array(bytes);
  };

  const getFile = async (key: "model" | "wasm") => {
    const f = manifest.files[key];
    const parts: Uint8Array[] = [];
    for (const p of f.parts) parts.push(await fetchPart(p));
    const hex = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      hex.set(p, o);
      o += p.length;
    }
    const out = await gunzip(decodeHex(hex));
    if (out.byteLength !== f.size) throw new Error(`Файл нейросети «${key}» собран неверно (${out.byteLength} байт вместо ${f.size}).`);
    return out;
  };

  const wasm = await getFile("wasm");
  const model = await getFile("model");
  return { model, wasm, manifest };
}
