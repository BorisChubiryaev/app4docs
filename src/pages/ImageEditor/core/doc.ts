// Операции над документом: слои, сведение, кадрирование, размеры, поворот.
// Все функции возвращают НОВОЕ состояние и не трогают canvas прежнего.

import type { DocState, Layer, TextProps } from "./types";
import { cloneCanvas, createCanvas, ctx2d, filledCanvas, newId } from "./canvas";

export function makeLayer(canvas: HTMLCanvasElement, name: string, patch: Partial<Layer> = {}): Layer {
  return {
    id: newId(),
    name,
    kind: "raster",
    canvas,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    blend: "source-over",
    locked: false,
    mask: null,
    maskEnabled: true,
    ...patch,
  };
}

export function newDocument(w: number, h: number, background: string | null): DocState {
  const base = background ? filledCanvas(w, h, background) : createCanvas(w, h);
  const layer = makeLayer(base, background ? "Фон" : "Слой 1");
  return { width: w, height: h, layers: [layer], activeId: layer.id, selection: null, editMask: false };
}

export function docFromCanvas(c: HTMLCanvasElement, name = "Фон"): DocState {
  const layer = makeLayer(c, name);
  return { width: c.width, height: c.height, layers: [layer], activeId: layer.id, selection: null, editMask: false };
}

export const activeLayer = (s: DocState): Layer | undefined => s.layers.find((l) => l.id === s.activeId);
export const layerIndex = (s: DocState, id: string) => s.layers.findIndex((l) => l.id === id);

export function updateLayer(s: DocState, id: string, patch: Partial<Layer>): DocState {
  return { ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

/** Добавить слой над активным и сделать его активным. */
export function addLayer(s: DocState, layer: Layer): DocState {
  const i = layerIndex(s, s.activeId);
  const layers = [...s.layers];
  layers.splice(i + 1, 0, layer);
  return { ...s, layers, activeId: layer.id, editMask: false };
}

export function newLayerName(s: DocState, base = "Слой"): string {
  // Следующий номер после самого большого у слоёв с тем же началом имени
  let max = 0;
  for (const l of s.layers) {
    const m = l.name.startsWith(base + " ") ? /^\d+$/.exec(l.name.slice(base.length + 1)) : null;
    if (m) max = Math.max(max, Number(m[0]));
  }
  return `${base} ${max + 1}`;
}

export function addEmptyLayer(s: DocState): DocState {
  return addLayer(s, makeLayer(createCanvas(s.width, s.height), newLayerName(s)));
}

export function removeLayer(s: DocState, id: string): DocState {
  if (s.layers.length <= 1) return s;
  const i = layerIndex(s, id);
  const layers = s.layers.filter((l) => l.id !== id);
  const next = layers[Math.max(0, i - 1)] ?? layers[0];
  return { ...s, layers, activeId: s.activeId === id ? next.id : s.activeId, editMask: false };
}

export function duplicateLayer(s: DocState, id: string): DocState {
  const l = s.layers.find((x) => x.id === id);
  if (!l) return s;
  const copy: Layer = {
    ...l,
    id: newId(),
    name: `${l.name} копия`,
    canvas: cloneCanvas(l.canvas),
    mask: l.mask ? cloneCanvas(l.mask) : null,
    text: l.text ? { ...l.text } : undefined,
  };
  const i = layerIndex(s, id);
  const layers = [...s.layers];
  layers.splice(i + 1, 0, copy);
  return { ...s, layers, activeId: copy.id };
}

export function moveLayer(s: DocState, id: string, toIndex: number): DocState {
  const i = layerIndex(s, id);
  if (i < 0) return s;
  const layers = [...s.layers];
  const [l] = layers.splice(i, 1);
  layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
  return { ...s, layers };
}

// ── Отрисовка ──

const maskedCache = new WeakMap<HTMLCanvasElement, { mask: HTMLCanvasElement; out: HTMLCanvasElement }>();

/** Пиксели слоя с применённой маской (кэшируется, пока canvas и маска те же). */
export function layerPixels(l: Layer): HTMLCanvasElement {
  if (!l.mask || !l.maskEnabled) return l.canvas;
  const hit = maskedCache.get(l.canvas);
  if (hit && hit.mask === l.mask) return hit.out;
  const out = cloneCanvas(l.canvas);
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(l.mask, 0, 0);
  maskedCache.set(l.canvas, { mask: l.mask, out });
  return out;
}

/**
 * Сведённое изображение. `override` подменяет canvas отдельных слоёв
 * (живой мазок кисти, предпросмотр фильтра) без создания нового состояния.
 */
export function composite(
  s: DocState,
  override?: Map<string, HTMLCanvasElement>,
  target?: HTMLCanvasElement,
): HTMLCanvasElement {
  const out = target && target.width === s.width && target.height === s.height ? target : createCanvas(s.width, s.height);
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, s.width, s.height);
  for (const l of s.layers) {
    if (!l.visible || l.opacity <= 0) continue;
    const src = override?.get(l.id);
    const pixels = src ? layerPixels({ ...l, canvas: src }) : layerPixels(l);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(pixels, l.x, l.y);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** Слить активный слой с нижним. */
export function mergeDown(s: DocState, id: string): DocState {
  const i = layerIndex(s, id);
  if (i <= 0) return s;
  const top = s.layers[i];
  const bottom = s.layers[i - 1];
  // Объединённый холст покрывает оба слоя
  const x0 = Math.min(top.x, bottom.x);
  const y0 = Math.min(top.y, bottom.y);
  const x1 = Math.max(top.x + top.canvas.width, bottom.x + bottom.canvas.width);
  const y1 = Math.max(top.y + top.canvas.height, bottom.y + bottom.canvas.height);
  const c = createCanvas(x1 - x0, y1 - y0);
  const ctx = ctx2d(c);
  ctx.globalAlpha = bottom.opacity;
  ctx.drawImage(layerPixels(bottom), bottom.x - x0, bottom.y - y0);
  ctx.globalAlpha = top.opacity;
  ctx.globalCompositeOperation = top.blend;
  if (top.visible) ctx.drawImage(layerPixels(top), top.x - x0, top.y - y0);
  const merged: Layer = { ...bottom, kind: "raster", text: undefined, canvas: c, x: x0, y: y0, opacity: 1, mask: null };
  const layers = [...s.layers];
  layers.splice(i - 1, 2, merged);
  return { ...s, layers, activeId: merged.id, editMask: false };
}

export function flatten(s: DocState): DocState {
  const c = composite(s);
  const layer = makeLayer(c, "Фон");
  return { ...s, layers: [layer], activeId: layer.id, editMask: false };
}

// ── Текстовые слои ──

export function fontString(t: TextProps) {
  return `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.size}px ${t.font}`;
}

export function renderText(t: TextProps): HTMLCanvasElement {
  const lines = (t.text || " ").split("\n");
  const probe = ctx2d(createCanvas(1, 1));
  probe.font = fontString(t);
  const widths = lines.map((ln) => probe.measureText(ln || " ").width);
  const w = Math.ceil(Math.max(...widths, 1) + t.size * 0.2);
  const lh = t.size * t.lineHeight;
  const h = Math.ceil(lh * lines.length + t.size * 0.3);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.font = fontString(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  lines.forEach((ln, i) => {
    const x = t.align === "center" ? (w - widths[i]) / 2 : t.align === "right" ? w - widths[i] - t.size * 0.1 : t.size * 0.1;
    ctx.fillText(ln, x, i * lh + t.size * 0.1);
  });
  return c;
}

// ── Геометрия документа ──

/** Кадрирование: все слои сдвигаются, размер документа — как у рамки. */
export function cropDoc(s: DocState, r: { x: number; y: number; w: number; h: number }): DocState {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  return {
    ...s,
    width: w,
    height: h,
    layers: s.layers.map((l) => ({ ...l, x: l.x - x, y: l.y - y })),
    selection: null,
  };
}

/** Размер холста с привязкой (0..1 по каждой оси: 0 — левый/верхний край). */
export function canvasSize(s: DocState, w: number, h: number, ax: number, ay: number): DocState {
  const dx = Math.round((w - s.width) * ax);
  const dy = Math.round((h - s.height) * ay);
  return {
    ...s,
    width: w,
    height: h,
    layers: s.layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    selection: null,
  };
}

function scaleCanvas(c: HTMLCanvasElement, sx: number, sy: number): HTMLCanvasElement {
  // Пошаговое уменьшение (по половине) даёт заметно чище результат, чем один шаг
  let src = c;
  let cw = c.width;
  let ch = c.height;
  const tw = Math.max(1, Math.round(c.width * sx));
  const th = Math.max(1, Math.round(c.height * sy));
  while (cw / 2 > tw && ch / 2 > th) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    const half = createCanvas(cw, ch);
    const hctx = ctx2d(half);
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(src, 0, 0, cw, ch);
    src = half;
  }
  const out = createCanvas(tw, th);
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, tw, th);
  return out;
}

export function resizeDoc(s: DocState, w: number, h: number): DocState {
  const sx = w / s.width;
  const sy = h / s.height;
  return {
    ...s,
    width: w,
    height: h,
    selection: null,
    layers: s.layers.map((l) => ({
      ...l,
      canvas: scaleCanvas(l.canvas, sx, sy),
      mask: l.mask ? scaleCanvas(l.mask, sx, sy) : null,
      x: Math.round(l.x * sx),
      y: Math.round(l.y * sy),
      kind: "raster",
      text: undefined,
    })),
  };
}

/** Поворот/отражение canvas: deg ∈ {90, 180, 270}, flip h/v. */
export function transformCanvas(c: HTMLCanvasElement, deg: number, flipH = false, flipV = false): HTMLCanvasElement {
  const swap = deg === 90 || deg === 270;
  const out = createCanvas(swap ? c.height : c.width, swap ? c.width : c.height);
  const ctx = ctx2d(out);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

/** Повернуть / отразить весь документ. */
export function rotateDoc(s: DocState, deg: 0 | 90 | 180 | 270, flipH = false, flipV = false): DocState {
  const W = s.width;
  const H = s.height;
  const swap = deg === 90 || deg === 270;
  const nw = swap ? H : W;
  const nh = swap ? W : H;
  const layers = s.layers.map((l) => {
    const canvas = transformCanvas(l.canvas, deg, flipH, flipV);
    const mask = l.mask ? transformCanvas(l.mask, deg, flipH, flipV) : null;
    // Новое положение: преобразуем центр слоя
    let cx = l.x + l.canvas.width / 2 - W / 2;
    let cy = l.y + l.canvas.height / 2 - H / 2;
    if (flipH) cx = -cx;
    if (flipV) cy = -cy;
    const rad = (deg * Math.PI) / 180;
    const rx = Math.round(cx * Math.cos(rad) - cy * Math.sin(rad));
    const ry = Math.round(cx * Math.sin(rad) + cy * Math.cos(rad));
    return {
      ...l,
      canvas,
      mask,
      x: Math.round(nw / 2 + rx - canvas.width / 2),
      y: Math.round(nh / 2 + ry - canvas.height / 2),
      kind: "raster" as const,
      text: undefined,
    };
  });
  return { ...s, width: nw, height: nh, layers, selection: null };
}

/** Свободное трансформирование слоя: масштаб и поворот вокруг центра. */
export function transformLayer(
  l: Layer,
  t: { cx: number; cy: number; sx: number; sy: number; angle: number },
): Layer {
  const w = l.canvas.width * Math.abs(t.sx);
  const h = l.canvas.height * Math.abs(t.sy);
  const cos = Math.abs(Math.cos(t.angle));
  const sin = Math.abs(Math.sin(t.angle));
  const bw = Math.ceil(w * cos + h * sin) + 2;
  const bh = Math.ceil(w * sin + h * cos) + 2;
  const draw = (src: HTMLCanvasElement) => {
    const out = createCanvas(bw, bh);
    const ctx = ctx2d(out);
    ctx.imageSmoothingQuality = "high";
    ctx.translate(bw / 2, bh / 2);
    ctx.rotate(t.angle);
    ctx.scale(t.sx, t.sy);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  };
  return {
    ...l,
    canvas: draw(l.canvas),
    mask: l.mask ? draw(l.mask) : null,
    x: Math.round(t.cx - bw / 2),
    y: Math.round(t.cy - bh / 2),
    kind: "raster",
    text: undefined,
  };
}

/** Цвет пикселя (по активному слою или по сведённому изображению). */
export function sampleColor(s: DocState, x: number, y: number, all: boolean): [number, number, number, number] | null {
  const src = all ? composite(s) : null;
  const l = activeLayer(s);
  const c = src ?? (l ? layerPixels(l) : null);
  if (!c) return null;
  const px = all ? x : x - (l?.x ?? 0);
  const py = all ? y : y - (l?.y ?? 0);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
  const d = c.getContext("2d")!.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/** Растрировать текстовый слой (перед рисованием по нему). */
export function rasterize(l: Layer): Layer {
  return l.kind === "text" ? { ...l, kind: "raster", text: undefined, canvas: cloneCanvas(l.canvas) } : l;
}

/** Слой, расширенный до размеров документа (чтобы рисовать за его прежними краями). */
export function expandToDoc(s: DocState, l: Layer): Layer {
  const x0 = Math.min(0, l.x);
  const y0 = Math.min(0, l.y);
  const x1 = Math.max(s.width, l.x + l.canvas.width);
  const y1 = Math.max(s.height, l.y + l.canvas.height);
  if (x0 === l.x && y0 === l.y && x1 - x0 === l.canvas.width && y1 - y0 === l.canvas.height) return l;
  const c = createCanvas(x1 - x0, y1 - y0);
  ctx2d(c).drawImage(l.canvas, l.x - x0, l.y - y0);
  let mask: HTMLCanvasElement | null = null;
  if (l.mask) {
    mask = createCanvas(x1 - x0, y1 - y0);
    const m = ctx2d(mask);
    // Расширенная область маски видима (белая), как у «показать всё»
    m.fillStyle = "#fff";
    m.fillRect(0, 0, mask.width, mask.height);
    m.clearRect(l.x - x0, l.y - y0, l.canvas.width, l.canvas.height);
    m.drawImage(l.mask, l.x - x0, l.y - y0);
  }
  return { ...l, canvas: c, mask, x: x0, y: y0 };
}
