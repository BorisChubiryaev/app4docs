// Генерация пакета иконок под разные задачи (приложения, ярлыки,
// веб-фавиконки, PWA, Apple, плитки Windows) одним ZIP-архивом.
// Всё офлайн: рендер через canvas, упаковка через jszip.

import JSZip from "jszip";
import type { DecodedRaster } from "./decode";
import { composeExport } from "./render";
import {
  encodeCanvas,
  encodeIcoFromCanvases,
  ICO_DEFAULT_SIZES,
} from "./encode";

export interface IconPackOptions {
  /** Многоразмерный favicon.ico (16–256) — для приложений и ярлыков. */
  windowsIco: boolean;
  /** PNG-фавиконки 16/32/48. */
  webFavicons: boolean;
  /** apple-touch-icon.png (180×180). */
  appleTouch: boolean;
  /** android-chrome 192/512 (PWA). */
  android: boolean;
  /** mstile-150x150.png (плитка Windows). */
  windowsTile: boolean;
  /** Дополнительные произвольные размеры (PNG). */
  customSizes: number[];
  /** Фон: hex или "transparent". */
  background: string;
}

export interface IconPackItem {
  raster: DecodedRaster;
  name: string;
}

/** Описание одного целевого набора для сводки в UI. */
export interface IconTargetInfo {
  id: keyof Omit<IconPackOptions, "customSizes" | "background">;
  label: string;
  hint: string;
  files: string[];
}

export const ICON_TARGETS: IconTargetInfo[] = [
  {
    id: "windowsIco",
    label: "Windows .ico (многоразмерный)",
    hint: "Приложения и ярлыки — favicon.ico со всеми размерами",
    files: [`favicon.ico (${ICO_DEFAULT_SIZES.join("/")})`],
  },
  {
    id: "webFavicons",
    label: "Веб-фавиконки",
    hint: "Иконки сайта для вкладок браузера",
    files: ["favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png"],
  },
  {
    id: "appleTouch",
    label: "Apple Touch",
    hint: "Иконка на домашнем экране iOS",
    files: ["apple-touch-icon.png (180×180)"],
  },
  {
    id: "android",
    label: "Android / PWA",
    hint: "Иконки прогрессивного веб-приложения",
    files: ["android-chrome-192x192.png", "android-chrome-512x512.png"],
  },
  {
    id: "windowsTile",
    label: "Windows Tile",
    hint: "Плитка меню «Пуск»",
    files: ["mstile-150x150.png"],
  },
];

// Рендер источника в квадрат size×size (SVG перерисовывается чётко).
async function square(
  raster: DecodedRaster,
  size: number,
  background: string,
): Promise<HTMLCanvasElement> {
  return composeExport(raster, {
    sizeMode: "custom",
    customWidth: size,
    customHeight: size,
    maintainAspectRatio: true,
    background,
    scalePercent: 100,
  });
}

async function pngBlob(
  raster: DecodedRaster,
  size: number,
  background: string,
): Promise<Blob> {
  const canvas = await square(raster, size, background);
  return encodeCanvas(canvas, "png");
}

/** Собирает все выбранные иконки для одного источника в папку JSZip. */
async function addItemToZip(
  folder: JSZip,
  item: IconPackItem,
  opts: IconPackOptions,
): Promise<number> {
  let count = 0;
  const bg = opts.background;

  if (opts.windowsIco) {
    const squares = await Promise.all(
      ICO_DEFAULT_SIZES.map((s) => square(item.raster, s, bg)),
    );
    const ico = await encodeIcoFromCanvases(squares);
    folder.file("favicon.ico", ico);
    count++;
  }

  if (opts.webFavicons) {
    for (const s of [16, 32, 48]) {
      folder.file(`favicon-${s}x${s}.png`, await pngBlob(item.raster, s, bg));
      count++;
    }
  }

  if (opts.appleTouch) {
    folder.file("apple-touch-icon.png", await pngBlob(item.raster, 180, bg));
    count++;
  }

  if (opts.android) {
    folder.file(
      "android-chrome-192x192.png",
      await pngBlob(item.raster, 192, bg),
    );
    folder.file(
      "android-chrome-512x512.png",
      await pngBlob(item.raster, 512, bg),
    );
    count += 2;
  }

  if (opts.windowsTile) {
    folder.file("mstile-150x150.png", await pngBlob(item.raster, 150, bg));
    count++;
  }

  for (const s of opts.customSizes) {
    if (s > 0) {
      folder.file(`icon-${s}x${s}.png`, await pngBlob(item.raster, s, bg));
      count++;
    }
  }

  return count;
}

export interface IconPackResult {
  blob: Blob;
  fileCount: number;
}

/**
 * Строит ZIP с иконками. При нескольких источниках каждый кладётся
 * в свою подпапку по имени.
 */
export async function buildIconPack(
  items: IconPackItem[],
  opts: IconPackOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<IconPackResult> {
  const zip = new JSZip();
  let fileCount = 0;

  const multiple = items.length > 1;
  const usedNames = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let folder = zip;
    if (multiple) {
      // Уникальное имя подпапки.
      const base = (item.name || `icon_${i + 1}`).replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      let name = base;
      let n = 2;
      while (usedNames.has(name)) name = `${base}_${n++}`;
      usedNames.add(name);
      folder = zip.folder(name) as JSZip;
    }
    fileCount += await addItemToZip(folder, item, opts);
    onProgress?.(i + 1, items.length);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, fileCount };
}

/** Есть ли хотя бы одна выбранная цель. */
export function hasAnyTarget(opts: IconPackOptions): boolean {
  return (
    opts.windowsIco ||
    opts.webFavicons ||
    opts.appleTouch ||
    opts.android ||
    opts.windowsTile ||
    opts.customSizes.some((s) => s > 0)
  );
}
