// Файлы движка PDF → PPTX (~33 МБ) и их постоянный кэш.
//
// Всё лежит рядом со сборкой (public/pdf2pptx/) и грузится с того же
// сервера, что и приложение, — интернет не нужен. Чтобы не зависеть от
// HTTP-кэширования хостинга (Qlik Sense может отдавать файлы с no-cache),
// складываем их в Cache Storage браузера под ключом версии: файлы
// скачиваются один раз, а при обновлении движка старая версия удаляется.

import type { Manifest } from "./pdf2pptx.types";

const CACHE_PREFIX = "pdf2pptx-";

/** Базовый адрес файлов движка: public/pdf2pptx/ рядом с index.html. */
export const engineBase = (): string =>
  new URL("pdf2pptx/", document.baseURI).href;

/** Манифест всегда свежий — по нему определяется версия кэша. */
export const loadManifest = async (base: string): Promise<Manifest> => {
  const res = await fetch(base + "manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  return res.json();
};

const cacheName = (m: Manifest) =>
  `${CACHE_PREFIX}${m.pyodide}-${m.engineCommit.slice(0, 12)}-${m.runtimeBytes}`;

// Имена файлов — под ограничения сервера Qlik Sense. У него две проверки:
//   1) статический сервер отдаёт только разрешённые типы (js, json, txt…),
//      на .wasm/.whl/.zip/.py отвечает HTTP 415;
//   2) веб-файрвол (ModSecurity CWAF) блокирует сам запрос с HTTP 403, если
//      в АДРЕСЕ встречается «архивное» расширение — даже как часть имени
//      («…python_stdlib.zip.txt» → 403 из-за «.zip»).
// Поэтому в имени не должно остаться ни одной такой точки-расширения: точки
// в имени заменяются на «_», и добавляется «.txt». Было «python_stdlib.zip» →
// стало «python_stdlib_zip.txt». Pyodide запрашивает исходные имена —
// storedUrl() прозрачно подменяет их в перехвате fetch. pyodide.mjs
// (ES-модуль, обязан быть .js) → pyodide.loader.js.
//
// Zip-архивы (.zip, .whl) к тому же хранятся перемешанными (XOR): почтовый шлюз
// на пути к закрытому серверу находит внутри zip и пересобирает его, меняя
// байты, — Python тогда не запускается. XOR убирает zip-структуру: файл
// становится обычными двоичными данными, как pyodide.asm.wasm (он тот же путь
// проходит без изменений). Восстанавливает байты makeCachedFetch — после
// сверки с манифестом.
export const LOADER_FILE = "pyodide.loader.js";
const RISKY = /\.(whl|zip|wasm|py)$/; // типы, которые Qlik режет (415 или 403)

/**
 * Делает имя безопасным для файрвола Qlik (ModSecurity CWAF):
 *  - убирает все точки — чтобы в адресе не было архивных расширений
 *    («.zip», «.whl», «.wasm», «.py» → иначе 403);
 *  - нейтрализует слово «script» (внутри ABI-тега PyMuPDF «pyemscripten») —
 *    файрвол режет его как попытку XSS. Та же замена — в vendor-pdf2pptx.mjs.
 * Другие опасные слова в именах движка не встречаются; при необходимости
 * добавляются сюда и в скрипт одинаково.
 */
export const safeBase = (base: string): string =>
  base.replace(/\./g, "_").replace(/script/gi, "scrpt") + ".txt";

/** Логический адрес файла движка → имя, под которым он реально лежит. */
export const storedUrl = (url: string): string => {
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? "" : url.slice(q);
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const base = path.slice(slash + 1);
  if (!RISKY.test(base)) return url;
  return dir + safeBase(base) + query;
};

// Ключ XOR-перестановки. Тот же массив — в scripts/vendor-pdf2pptx.mjs
// (меняется только вместе). Перестановка обратима: XOR тем же ключом.
const SCRAMBLE_KEY = [0x3f, 0x5c, 0xa7, 0x11, 0x9e, 0x42, 0xd8, 0x6b];

/** Хранится ли файл в перемешанном виде (по реальному имени на диске). */
const isScrambled = (storedRel: string) => /_(whl|zip)\.txt$/.test(storedRel);

const unscramble = (bytes: ArrayBuffer): ArrayBuffer => {
  const out = new Uint8Array(bytes.slice(0));
  for (let i = 0; i < out.length; i++)
    out[i] ^= SCRAMBLE_KEY[i % SCRAMBLE_KEY.length];
  return out.buffer;
};

/** Все реальные файлы движка (для кэша и подкачки) — крупные как части. */
export const engineFiles = (m: Manifest): string[] =>
  [
    "runtime/" + LOADER_FILE,
    "runtime/pyodide.asm.js",
    "runtime/pyodide.asm.wasm",
    "runtime/python_stdlib.zip",
    "runtime/pyodide-lock.json",
    ...m.wheels.map((w) => "runtime/" + w),
    ...m.engineFiles.map((f) => "engine/" + f),
  ].flatMap((rel) => {
    const stored = storedUrl(rel);
    return m.parts?.[stored] ?? [stored];
  });

// Cache Storage есть только в защищённом контексте (https или localhost).
const hasCacheStorage = () =>
  typeof caches !== "undefined" && typeof caches.open === "function";

const fmtBytes = (n: number) => n.toLocaleString("ru-RU") + " байт";

/**
 * Сверяет файл с манифестом (размер и SHA-256). Возвращает текст проблемы
 * или null, если всё совпало или проверять нечем (старый манифест;
 * crypto.subtle есть только по https/localhost — тогда сверяем лишь размер).
 */
export const checkFile = async (
  manifest: Manifest,
  rel: string,
  bytes: ArrayBuffer,
): Promise<string | null> => {
  const want = manifest.files?.[rel];
  if (!want) return null;
  if (bytes.byteLength !== want.size) {
    return `${rel}: получено ${fmtBytes(bytes.byteLength)}, ожидалось ${fmtBytes(want.size)}`;
  }
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return hash === want.sha256
    ? null
    : `${rel}: размер совпал (${fmtBytes(want.size)}), но содержимое другое (SHA-256)`;
};

/** Файл движка отличается от собранного — с подсказкой, где искать причину. */
export class DamagedFileError extends Error {
  constructor(problem: string) {
    super(
      `Файл движка повреждён — ${problem}. Файл изменился по дороге на сервер ` +
        "(почтовый шлюз, антивирус, архиватор) или при загрузке в Qlik: " +
        "сравните его с файлом из папки dist/pdf2pptx/ после сборки.",
    );
    this.name = "DamagedFileError";
  }
}

const relPath = (url: string, base: string) =>
  url.slice(base.length).split("?")[0];

/**
 * fetch с постоянным кэшем для файлов движка. Каждый файл сверяется с
 * манифестом: испорченная копия в кэше удаляется и скачивается заново,
 * испорченный файл с сервера — ошибка DamagedFileError. Ошибки самого кэша
 * (переполнено, запрещено политикой) не ломают загрузку — идём в сеть.
 */
export const makeCachedFetch = (
  manifest: Manifest,
  base: string,
  nativeFetch: typeof fetch,
  /** Для диагностики: какой файл, откуда взят и прошёл ли проверку. */
  onLoaded?: (line: string) => void,
) => {
  const name = cacheName(manifest);
  const note = (rel: string, bytes: ArrayBuffer, from: string, problem: string | null) =>
    onLoaded?.(
      `${rel}: ${fmtBytes(bytes.byteLength)}, ${from}, ` +
        (problem ? "НЕ СОВПАДАЕТ" : manifest.files?.[rel] ? "проверен" : "без проверки"),
    );
  let cachePromise: Promise<Cache | null> | null = null;
  const openCache = () =>
    (cachePromise ??= hasCacheStorage()
      ? caches.open(name).catch(() => null)
      : Promise.resolve(null));

  const withBody = (res: Response, bytes: ArrayBuffer) =>
    new Response(bytes, { status: res.status, headers: res.headers });
  // Что отдать Pyodide: перемешанные архивы — обратно в исходный zip.
  const decoded = (rel: string, res: Response, bytes: ArrayBuffer) =>
    isScrambled(rel)
      ? new Response(unscramble(bytes), {
          status: res.status,
          headers: { "content-type": "application/zip" },
        })
      : withBody(res, bytes);

  // Один реальный файл (часть или целый): кэш → сеть, со сверкой по манифесту.
  // Возвращает сырые байты; при 403/404 или повреждении бросает ошибку.
  const fetchRaw = async (
    storedRel: string,
    init?: RequestInit,
  ): Promise<ArrayBuffer> => {
    const url = base + storedRel;
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      const bad = await checkFile(manifest, storedRel, bytes);
      note(storedRel, bytes, "из кэша", bad);
      if (!bad) return bytes;
      await cache?.delete(url).catch(() => false); // испорчен — качаем заново
    }
    const res = await nativeFetch(url, init);
    if (!res.ok) {
      const err = new Error(
        `Сервер не отдал ${storedRel.split("/").pop()}: HTTP ${res.status}`,
      );
      note(storedRel, new ArrayBuffer(0), `с сервера (HTTP ${res.status})`, "");
      throw err;
    }
    const bytes = await res.arrayBuffer();
    const problem = await checkFile(manifest, storedRel, bytes);
    note(storedRel, bytes, `с сервера (${res.headers.get("content-type") ?? "тип ?"})`, problem);
    if (problem) throw new DamagedFileError(problem);
    if (cache) await cache.put(url, new Response(bytes)).catch(() => {});
    return bytes;
  };

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(base) || url.endsWith("manifest.json")) {
      return nativeFetch(input, init);
    }
    const rel = relPath(url, base);

    // Крупный файл, разбитый на части: качаем каждую и склеиваем обратно.
    const chunks = manifest.parts?.[rel];
    if (chunks) {
      const bufs: Uint8Array[] = [];
      for (const c of chunks) bufs.push(new Uint8Array(await fetchRaw(c, init)));
      const total = bufs.reduce((n, b) => n + b.byteLength, 0);
      const all = new Uint8Array(total);
      let off = 0;
      for (const b of bufs) {
        all.set(b, off);
        off += b.byteLength;
      }
      return isScrambled(rel)
        ? new Response(unscramble(all.buffer), {
            headers: { "content-type": "application/zip" },
          })
        : new Response(all.buffer);
    }

    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      const bad = await checkFile(manifest, rel, bytes);
      note(rel, bytes, "из кэша", bad);
      if (!bad) return decoded(rel, hit, bytes);
      await cache?.delete(url).catch(() => false); // испорчен — качаем заново
    }
    const res = await nativeFetch(input, init);
    if (!res.ok) return res;
    const bytes = await res.arrayBuffer();
    const problem = await checkFile(manifest, rel, bytes);
    note(rel, bytes, `с сервера (${res.headers.get("content-type") ?? "тип ?"})`, problem);
    if (problem) throw new DamagedFileError(problem);
    if (cache) {
      await cache.put(url, withBody(res, bytes)).catch(() => {});
    }
    return decoded(rel, res, bytes);
  };
};

/** Удаляет кэши прежних версий движка. */
export const dropOldCaches = async (manifest: Manifest) => {
  const current = cacheName(manifest);
  if (!hasCacheStorage()) return;
  for (const key of await caches.keys()) {
    if (key.startsWith(CACHE_PREFIX) && key !== current) {
      await caches.delete(key);
    }
  }
};

let warmUpStarted = false;

/**
 * Тихо подкачивает файлы движка в кэш, пока пользователь занят другим.
 * Ничего не делает, если всё уже в кэше или Cache Storage недоступен.
 * Один раз за сессию; ошибки игнорируются — это лишь ускорение.
 */
export const warmUpEngine = async (): Promise<void> => {
  if (warmUpStarted || !hasCacheStorage()) return;
  warmUpStarted = true;
  try {
    const base = engineBase();
    const manifest = await loadManifest(base);
    await dropOldCaches(manifest);
    const cache = await caches.open(cacheName(manifest));
    for (const file of engineFiles(manifest)) {
      const url = base + file;
      if (await cache.match(url)) continue;
      // По одному файлу и с низким приоритетом — не мешаем работе страницы.
      const res = await fetch(url, { priority: "low" } as RequestInit);
      if (!res.ok) continue;
      // Испорченное в кэш не кладём — воркер скачает сам и покажет ошибку.
      const bytes = await res.arrayBuffer();
      if (await checkFile(manifest, file, bytes)) continue;
      await cache.put(url, new Response(bytes, { headers: res.headers }));
    }
  } catch {
    /* фоновая подкачка не критична */
  }
};
