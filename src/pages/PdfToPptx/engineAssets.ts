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

// Загрузчик Pyodide импортируется как ES-модуль (import()), а браузер
// исполняет модуль, только если сервер отдаёт его с JavaScript-типом.
// Qlik Sense не отдаёт .mjs как JavaScript (в отличие от .js) — поэтому
// pyodide.mjs вендорится под именем pyodide.loader.js. Остальные файлы
// грузятся через fetch, где MIME не важен, и переименования не требуют.
export const LOADER_FILE = "pyodide.loader.js";

/** Все файлы движка под их реальными именами (для кэша и подкачки). */
export const engineFiles = (m: Manifest): string[] => [
  "runtime/pyodide.asm.js",
  "runtime/pyodide.asm.wasm",
  "runtime/python_stdlib.zip",
  "runtime/pyodide-lock.json",
  ...m.wheels.map((w) => "runtime/" + w),
  ...m.engineFiles.map((f) => "engine/" + f),
];

// Cache Storage есть только в защищённом контексте (https или localhost).
const hasCacheStorage = () =>
  typeof caches !== "undefined" && typeof caches.open === "function";

/**
 * fetch с постоянным кэшем для файлов движка. Ошибки кэша (переполнено,
 * запрещено политикой) не ломают загрузку — просто идём в сеть.
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

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(base) || url.endsWith("manifest.json")) {
      return nativeFetch(input, init);
    }
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) return hit;
    const res = await nativeFetch(input, init);
    if (res.ok && cache) {
      await cache.put(url, res.clone()).catch(() => {});
    }
    return res;
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
      if (res.ok) await cache.put(url, res);
    }
  } catch {
    /* фоновая подкачка не критична */
  }
};
