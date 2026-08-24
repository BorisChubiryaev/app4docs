// Композиция растра в выходной canvas с учётом размера, фона и пропорций.
// Повторяет поведение прежнего SVG→PNG конвертера (заливка фона,
// сохранение пропорций с центрированием), но применимо к любому источнику.

import type { DecodedRaster } from "./decode";

export interface ComposeOptions {
  /** Целевая ширина в пикселях; если не задана — берётся из растра. */
  targetWidth?: number;
  /** Целевая высота в пикселях; если не задана — берётся из растра. */
  targetHeight?: number;
  /** Цвет фона: hex или "transparent". */
  background: string;
  /** Сохранять пропорции оригинала (вписывание с центрированием). */
  maintainAspectRatio: boolean;
  /** Использовать оригинальный размер растра, игнорируя target*. */
  useOriginalSize: boolean;
}

export function composeImage(
  raster: DecodedRaster,
  opts: ComposeOptions,
): HTMLCanvasElement {
  const srcW = raster.width;
  const srcH = raster.height;

  let outW: number;
  let outH: number;

  if (opts.useOriginalSize) {
    outW = srcW;
    outH = srcH;
  } else {
    outW = Math.max(1, Math.round(opts.targetWidth || srcW));
    outH = Math.max(1, Math.round(opts.targetHeight || srcH));
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (opts.background && opts.background !== "transparent") {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, outW, outH);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (opts.useOriginalSize) {
    ctx.drawImage(raster.canvas, 0, 0);
  } else if (opts.maintainAspectRatio) {
    const scale = Math.min(outW / srcW, outH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    ctx.drawImage(raster.canvas, (outW - w) / 2, (outH - h) / 2, w, h);
  } else {
    ctx.drawImage(raster.canvas, 0, 0, outW, outH);
  }

  return canvas;
}
