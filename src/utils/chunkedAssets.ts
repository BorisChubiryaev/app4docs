// Загрузка больших файлов движков (OCR и т.п.), выложенных рядом с приложением.
//
// Сервер Qlik пропускает не всё (типы файлов, слова в адресе, содержимое,
// размер), поэтому двоичные файлы лежат HEX-текстом частями до 6 МБ с
// нейтральными именами «xxxxxxxx_N.txt», а JS-файлы — под именами-хэшами.
// Каждая часть сверяется с манифестом (размер, SHA-256) и сохраняется в
// Cache Storage браузера: второй раз всё берётся мгновенно, а при смене
// версии старый кэш удаляется.

export interface ChunkedManifest {
  version: string;
  /** Двоичные файлы: части HEX-текста. */
  files: Record<string, { parts: string[]; size: number; sha256: string }>;
  chunks: Record<string, { size: number; sha256: string }>;
  /** JS-файлы, которые движок подключает сам по адресу. */
  scripts?: Record<string, { file: string; size: number; sha256: string }>;
}

const hasCache = () => typeof caches !== "undefined" && typeof caches.open === "function";

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null; // только https/localhost
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
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

export interface ChunkedAssets {
  base: string;
  manifest: ChunkedManifest;
  /** Двоичный файл по ключу манифеста. */
  file(key: string): Promise<Uint8Array>;
  /** Адрес JS-файла (проверенного на целостность). */
  script(key: string): Promise<string>;
  /** Общий размер того, что нужно скачать, в байтах. */
  total(keys: string[]): number;
}

/**
 * @param folder папка рядом с index.html («ocr/»)
 * @param prefix префикс имени кэша
 * @param onBytes сколько байт уже получено (для индикатора)
 */
export async function openChunkedAssets(folder: string, prefix: string, onBytes: (n: number) => void): Promise<ChunkedAssets> {
  const base = new URL(folder, document.baseURI).href;
  const res = await fetch(base + "manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Не найдены файлы движка (${folder}manifest.json: HTTP ${res.status}). Проверьте, что папка «${folder.replace(/\/$/, "")}» выложена рядом с приложением.`);
  const manifest = (await res.json()) as ChunkedManifest;
  const cacheName = prefix + manifest.version;
  let cache: Cache | null = null;
  if (hasCache()) {
    cache = await caches.open(cacheName).catch(() => null);
    caches
      .keys()
      .then((keys) => keys.filter((k) => k.startsWith(prefix) && k !== cacheName).forEach((k) => caches.delete(k)))
      .catch(() => undefined);
  }

  const damaged = (what: string) =>
    new Error(`Файл движка повреждён — ${what}. Он изменился по дороге на сервер (почтовый шлюз, антивирус, загрузка в Qlik) — сравните с папкой dist/${folder} после сборки.`);

  const fetchChecked = async (name: string, want: { size: number; sha256: string }): Promise<ArrayBuffer> => {
    const url = base + name;
    const check = async (b: ArrayBuffer) => {
      if (b.byteLength !== want.size) return `${name}: ${b.byteLength} байт вместо ${want.size}`;
      const h = await sha256(b);
      return h && h !== want.sha256 ? `${name}: содержимое отличается (SHA-256)` : null;
    };
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const b = await hit.arrayBuffer();
      if (!(await check(b))) {
        onBytes(b.byteLength);
        return b;
      }
      await cache?.delete(url).catch(() => false);
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Сервер не отдал файл движка ${name}: HTTP ${r.status}`);
    const b = await r.arrayBuffer();
    const bad = await check(b);
    if (bad) throw damaged(bad);
    await cache?.put(url, new Response(b)).catch(() => undefined);
    onBytes(b.byteLength);
    return b;
  };

  return {
    base,
    manifest,
    total: (keys) =>
      keys.reduce((s, k) => {
        const f = manifest.files[k];
        if (f) return s + f.parts.reduce((a, p) => a + manifest.chunks[p].size, 0);
        return s + (manifest.scripts?.[k]?.size ?? 0);
      }, 0),
    async file(key) {
      const f = manifest.files[key];
      if (!f) throw new Error(`В манифесте нет файла «${key}»`);
      const parts: Uint8Array[] = [];
      for (const p of f.parts) parts.push(new Uint8Array(await fetchChecked(p, manifest.chunks[p])));
      const hex = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
      let o = 0;
      for (const p of parts) {
        hex.set(p, o);
        o += p.length;
      }
      const out = decodeHex(hex);
      if (out.byteLength !== f.size) throw damaged(`${key}: ${out.byteLength} байт вместо ${f.size}`);
      return out;
    },
    async script(key) {
      const s = manifest.scripts?.[key];
      if (!s) throw new Error(`В манифесте нет файла «${key}»`);
      // Проверяем заранее и прогреваем кэш HTTP: сам движок возьмёт его по адресу
      await fetchChecked(s.file, s);
      return base + s.file;
    },
  };
}
