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

// Qlik Sense при импорте расширения отклоняет пакет с «непривычными» типами
// файлов (.wasm, .whl, .zip, .py). Поэтому на диске такие файлы лежат под именем
// «…<ext>.txt», а здесь восстанавливается реальный адрес. Pyodide запрашивает
// исходные имена — storedUrl() подменяет их на .txt-вариант прозрачно в
// перехвате fetch. pyodide.mjs импортируется как ES-модуль, поэтому обязан
// оставаться .js — переименован в pyodide.loader.js (а .js Qlik принимает).
export const LOADER_FILE = "pyodide.loader.js";
const SAFE_SUFFIX = ".txt";
const RISKY = /\.(wasm|whl|zip|py)$/;

/** Логический адрес файла движка → имя, под которым он реально лежит. */
export const storedUrl = (url: string): string => {
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? "" : url.slice(q);
  return RISKY.test(path) ? path + SAFE_SUFFIX + query : url;
};

/** Все файлы движка под их реальными именами (для кэша и подкачки). */
export const engineFiles = (m: Manifest): string[] =>
  [
    "runtime/" + LOADER_FILE,
    "runtime/pyodide.asm.js",
    "runtime/pyodide.asm.wasm",
    "runtime/python_stdlib.zip",
    "runtime/pyodide-lock.json",
    ...m.wheels.map((w) => "runtime/" + w),
    ...m.engineFiles.map((f) => "engine/" + f),
  ].map(storedUrl);

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
) => {
  const name = cacheName(manifest);
  let cachePromise: Promise<Cache | null> | null = null;
  const openCache = () =>
    (cachePromise ??= hasCacheStorage()
      ? caches.open(name).catch(() => null)
      : Promise.resolve(null));

  const withBody = (res: Response, bytes: ArrayBuffer) =>
    new Response(bytes, { status: res.status, headers: res.headers });

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(base) || url.endsWith("manifest.json")) {
      return nativeFetch(input, init);
    }
    const rel = relPath(url, base);
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      if (!(await checkFile(manifest, rel, bytes))) return withBody(hit, bytes);
      await cache?.delete(url).catch(() => false); // испорчен — качаем заново
    }
    const res = await nativeFetch(input, init);
    if (!res.ok) return res;
    const bytes = await res.arrayBuffer();
    const problem = await checkFile(manifest, rel, bytes);
    if (problem) throw new DamagedFileError(problem);
    if (cache) {
      await cache.put(url, withBody(res, bytes)).catch(() => {});
    }
    return withBody(res, bytes);
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
