// Композиция источника в выходной canvas с учётом размера, фона,
// пропорций и масштаба (сжатия по разрешению).
//
// Ключевой момент: если источник векторный (SVG), он рендерится сразу
// в целевом размере отрисовки — без потери чёткости. Растровые источники
// масштабируются билинейно с высоким качеством.

import { loadSvgImage, type DecodedRaster } from "./decode";

export interface ComposeOptions {
  /** Режим размера: оригинал источника или заданный размер. */
  sizeMode: "original" | "custom";
  /** Целевая ширина (для custom). */
  customWidth: number;
  /** Целевая высота (для custom). */
  customHeight: number;
  /** Сохранять пропорции (для custom — вписывание с центрированием). */
  maintainAspectRatio: boolean;
  /** Цвет фона: hex или "transparent". */
  background: string;
  /** Масштаб выходного разрешения в процентах (10..100). Сжатие по размеру. */
  scalePercent: number;
}

/** Итоговый размер «холста» до применения масштаба. */
function baseBox(
  raster: DecodedRaster,
  opts: ComposeOptions,
): { boxW: number; boxH: number } {
  if (opts.sizeMode === "original") {
    return { boxW: raster.width, boxH: raster.height };
  }
  return {
    boxW: Math.max(1, Math.round(opts.customWidth)),
    boxH: Math.max(1, Math.round(opts.customHeight)),
  };
}

/**
 * Собирает выходной canvas. Асинхронно, т.к. векторный источник
 * подгружается как <img> для чёткого рендера в целевом размере.
 */
export async function composeExport(
  raster: DecodedRaster,
  opts: ComposeOptions,
): Promise<HTMLCanvasElement> {
  const { boxW, boxH } = baseBox(raster, opts);
  const k = Math.min(1, Math.max(0.05, opts.scalePercent / 100));

  const outW = Math.max(1, Math.round(boxW * k));
  const outH = Math.max(1, Math.round(boxH * k));

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

  // Куда и какого размера рисуем источник внутри outW×outH.
  let dw = outW;
  let dh = outH;
  let dx = 0;
  let dy = 0;

  const fitCentered =
    opts.sizeMode === "custom" && opts.maintainAspectRatio;

  if (fitCentered) {
    const s = Math.min(outW / raster.width, outH / raster.height);
    dw = raster.width * s;
    dh = raster.height * s;
    dx = (outW - dw) / 2;
    dy = (outH - dh) / 2;
  }
  // sizeMode === "original": заполняем весь холст (dw=outW, dh=outH).
  // custom без сохранения пропорций: растягиваем (dw=outW, dh=outH).

  if (raster.svgCode) {
    // Векторный источник — рендерим в целевом размере (чётко).
    const img = await loadSvgImage(raster.svgCode);
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.drawImage(raster.canvas, dx, dy, dw, dh);
  }

  return canvas;
}
