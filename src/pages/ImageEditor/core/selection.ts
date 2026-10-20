// Выделение — маска размером с документ: альфа пикселя = степень выделения.
// Прямоугольник, эллипс, лассо, волшебная палочка; режимы «новое /
// добавить / вычесть / пересечь»; инверсия, растушёвка, контур «муравьи».

import type { SelectMode } from "./types";
import { createCanvas, ctx2d, ctxRead, getImageData } from "./canvas";

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "poly"; points: { x: number; y: number }[] };

export function shapeMask(w: number, h: number, shape: Shape, antialias = true): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = antialias;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  if (shape.kind === "rect") ctx.rect(Math.round(shape.x), Math.round(shape.y), Math.round(shape.w), Math.round(shape.h));
  else if (shape.kind === "ellipse")
    ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.abs(shape.w / 2), Math.abs(shape.h / 2), 0, 0, Math.PI * 2);
  else {
    shape.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.fill();
  return c;
}

/** Совместить новую маску с прежним выделением. */
export function combine(prev: HTMLCanvasElement | null, next: HTMLCanvasElement, mode: SelectMode): HTMLCanvasElement | null {
  if (!prev || mode === "new") return next;
  const out = createCanvas(next.width, next.height);
  const ctx = ctx2d(out);
  ctx.drawImage(prev, 0, 0);
  ctx.globalCompositeOperation =
    mode === "add" ? "source-over" : mode === "subtract" ? "destination-out" : "destination-in";
  ctx.drawImage(next, 0, 0);
  return isEmpty(out) ? null : out;
}

export function selectAll(w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  return c;
}

export function invert(sel: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement | null {
  const out = selectAll(w, h);
  if (!sel) return null;
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(sel, 0, 0);
  return isEmpty(out) ? null : out;
}

/** Растушёвка: размытие альфы маски. */
export function feather(sel: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = createCanvas(sel.width, sel.height);
  const ctx = ctx2d(out);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(sel, 0, 0);
  ctx.filter = "none";
  return out;
}

/** Расширить (+) или сжать (−) выделение на n пикселей. */
export function growShrink(sel: HTMLCanvasElement, n: number): HTMLCanvasElement {
  const img = getImageData(sel);
  const { width: w, height: h, data } = img;
  const src = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  // Расстояние по шахматной метрике двумя проходами (быстро и достаточно ровно)
  const grow = n > 0;
  const r = Math.abs(n);
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = src[i] === (grow ? 1 : 0) ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - w + 1] + 1.414);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.414);
    }
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const inside = grow ? dist[i] <= r : dist[i] > r;
    out.data[i * 4 + 3] = inside ? 255 : 0;
  }
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(out, 0, 0);
  return c;
}

export function isEmpty(sel: HTMLCanvasElement): boolean {
  return bounds(sel) === null;
}

export function bounds(sel: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const { data, width, height } = ctxRead(sel).getImageData(0, 0, sel.width, sel.height);
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    let row = y * width * 4 + 3;
    for (let x = 0; x < width; x++, row += 4) {
      if (data[row] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Контур выделения для «бегущих муравьёв»: отрезки на границе между
 * выделенными и невыделенными пикселями (порог 50 %). Соседние отрезки
 * сливаются в длинные линии — их немного даже для сложных масок.
 */
export function outline(sel: HTMLCanvasElement): Float32Array {
  const { data, width: w, height: h } = ctxRead(sel).getImageData(0, 0, sel.width, sel.height);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128;
  const segs: number[] = [];
  // Горизонтальные границы
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y) !== on(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segs.push(start, y, x, y);
        start = -1;
      }
    }
  }
  // Вертикальные границы
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x, y) !== on(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segs.push(x, start, x, y);
        start = -1;
      }
    }
  }
  return new Float32Array(segs);
}

/**
 * Волшебная палочка / заливка: поле похожих по цвету пикселей.
 * contiguous — только связанные с точкой клика.
 */
export function floodMask(
  img: ImageData,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const i0 = (sy * w + sx) * 4;
  const r0 = data[i0],
    g0 = data[i0 + 1],
    b0 = data[i0 + 2],
    a0 = data[i0 + 3];
  const tol = tolerance * tolerance * 4; // по сумме квадратов RGBA
  const like = (i: number) => {
    const p = i * 4;
    const dr = data[p] - r0,
      dg = data[p + 1] - g0,
      db = data[p + 2] - b0,
      da = data[p + 3] - a0;
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (like(i)) mask[i] = 1;
    return mask;
  }
  // Заливка построчными отрезками — без рекурсии, быстро и на больших картинках
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    while (x >= 0 && !mask[i] && like(i)) {
      x--;
      i--;
    }
    x++;
    i++;
    let up = false;
    let down = false;
    while (x < w && !mask[i] && like(i)) {
      mask[i] = 1;
      if (y > 0) {
        const u = i - w;
        if (!mask[u] && like(u)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const d = i + w;
        if (!mask[d] && like(d)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      i++;
    }
  }
  return mask;
}

/** Маска 0/1 → canvas-выделение (со сглаженным краем в 1 пиксель). */
export function maskToCanvas(mask: Uint8Array, w: number, h: number, antialias = true): HTMLCanvasElement {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = mask[i] ? 255 : 0;
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(img, 0, 0);
  return antialias ? feather(c, 0.6) : c;
}
