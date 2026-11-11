// Тепловое свечение: фигура рисуется маской, маска размывается, и каждый
// пиксель раскрашивается по плотности — край холодный, сердцевина горячая.
// Работает на любом холсте: если фильтр размытия canvas не поддерживается
// (старый Safari), мягкость даёт уменьшение и обратное увеличение маски.

import { rgb } from "./draw";

export const HEAT_THEMES: [string, string, string[]][] = [
  // id, название, цвета от края к сердцевине
  ["warm", "Тепло", ["#7c3aed", "#22d3ee", "#a3e635", "#fef9c3"]],
  ["ice", "Лёд", ["#4f46e5", "#60a5fa", "#bae6fd", "#ffffff"]],
  ["ocean", "Океан", ["#1e3a8a", "#0284c7", "#2dd4bf", "#ccfbf1"]],
  ["sunset", "Закат", ["#6d28d9", "#e11d48", "#fb923c", "#fde68a"]],
  ["neon", "Неон", ["#c026d3", "#6366f1", "#22d3ee", "#d9f99d"]],
  // Фирменные зелёные Сбера: тёмный, основной #21A038, бирюзовый, светлый
  ["sber", "Сбер", ["#0b5c3b", "#21a038", "#42e3b4", "#dcf7ea"]],
];

const lutCache = new Map<string, Uint8ClampedArray>();
/** Таблица цветов на 256 уровней плотности */
function lut(stops: string[]) {
  const key = stops.join();
  const hit = lutCache.get(key);
  if (hit) return hit;
  const cols = stops.map(rgb);
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    // Ниже порога — пусто; дальше плавно: край → сердцевина
    const k = Math.min(1, Math.max(0, (v - 0.04) / 0.86));
    const x = Math.pow(k, 0.85) * (cols.length - 1);
    const j = Math.min(cols.length - 2, Math.floor(x));
    const f = x - j;
    out[i * 4] = cols[j][0] + (cols[j + 1][0] - cols[j][0]) * f;
    out[i * 4 + 1] = cols[j][1] + (cols[j + 1][1] - cols[j][1]) * f;
    out[i * 4 + 2] = cols[j][2] + (cols[j + 1][2] - cols[j][2]) * f;
    out[i * 4 + 3] = v < 0.04 ? 0 : Math.min(255, (v - 0.04) * 255 * 4);
  }
  lutCache.set(key, out);
  return out;
}

let filterOk: boolean | null = null;
/** Работает ли ctx.filter (размытие) в этом браузере */
function canBlur() {
  if (filterOk !== null) return filterOk;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 9;
    const g = c.getContext("2d")!;
    g.filter = "blur(2px)";
    g.fillStyle = "#000";
    g.fillRect(4, 4, 1, 1);
    filterOk = g.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch {
    filterOk = false;
  }
  return filterOk;
}

let maskCanvas: HTMLCanvasElement | null = null;
let tinyCanvas: HTMLCanvasElement | null = null;

/**
 * Нарисовать тепловое свечение фигуры.
 * @param shape рисует путь фигуры (в координатах кадра) и заливает её
 * @param softness мягкость края в пикселях кадра
 */
export function drawHeat(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  shape: (g: CanvasRenderingContext2D) => void,
  softness: number,
  stops: string[],
  opacity = 1,
) {
  // Маска в половинном размере — свечение мягкое, лишние пиксели не нужны
  const k = 0.5;
  const mw = Math.max(8, Math.round(w * k));
  const mh = Math.max(8, Math.round(h * k));
  if (!maskCanvas) maskCanvas = document.createElement("canvas");
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const m = maskCanvas.getContext("2d", { willReadFrequently: true })!;
  m.clearRect(0, 0, mw, mh);
  const blur = Math.max(1, softness * k);
  if (canBlur()) {
    m.save();
    m.filter = `blur(${blur.toFixed(1)}px)`;
    m.scale(k, k);
    shape(m);
    m.restore();
  } else {
    // Без фильтра: маленькая копия, растянутая обратно, даёт мягкий край
    const d = Math.max(2, blur / 1.5);
    const tw = Math.max(4, Math.round(mw / d));
    const th = Math.max(4, Math.round(mh / d));
    if (!tinyCanvas) tinyCanvas = document.createElement("canvas");
    tinyCanvas.width = tw;
    tinyCanvas.height = th;
    const t = tinyCanvas.getContext("2d")!;
    t.clearRect(0, 0, tw, th);
    t.save();
    t.scale(tw / w, th / h);
    shape(t);
    t.restore();
    m.imageSmoothingEnabled = true;
    m.imageSmoothingQuality = "high";
    m.drawImage(tinyCanvas, 0, 0, mw, mh);
  }
  // Раскраска по плотности
  const img = m.getImageData(0, 0, mw, mh);
  const px = img.data;
  const table = lut(stops);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    const o = a * 4;
    px[i] = table[o];
    px[i + 1] = table[o + 1];
    px[i + 2] = table[o + 2];
    px[i + 3] = table[o + 3] * opacity;
  }
  m.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(maskCanvas, 0, 0, mw, mh, 0, 0, w, h);
  ctx.restore();
}
