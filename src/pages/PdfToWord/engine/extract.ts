// Извлечение со страницы PDF всего, что нужно для Word:
//   • текст с настоящими шрифтами (гарнитура, жирный, курсив) и цветом;
//   • линии (границы таблиц, подчёркивания) — и залитые тонкие
//     прямоугольники (так рисуют Word/LibreOffice), и обводки (1С, Excel);
//   • заливки (фон ячеек, плашки), прочие фигуры (графики, схемы);
//   • положения картинок.
// Геометрия берётся из списка операций ДО отрисовки страницы: при отрисовке
// pdf.js заменяет контуры объектами Path2D, и координаты уже не прочитать.

import * as pdfjs from "pdfjs-dist";
import { parseFontName } from "./fonts";
import type { FillRect, ImageRef, Item, PageRaw, Seg, Shape } from "./types";

const OPS = pdfjs.OPS;
const LINE_MAX = 2.5; // пт: толще — уже заливка, а не линия
const LINE_MIN_LEN = 3;

type M = number[];
const mul = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const toHex = (v: unknown): string => {
  if (typeof v === "string") return v.replace("#", "").toLowerCase().padStart(6, "0").slice(0, 6);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = Array.from(v as ArrayLike<number>);
    const c = a.length >= 3 ? a : [a[0], a[0], a[0]];
    return c
      .slice(0, 3)
      .map((n) => Math.round(n <= 1 && a.every((k) => k <= 1) ? n * 255 : n))
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
      .join("");
  }
  return "000000";
};

const isWhite = (hex: string) => {
  const n = parseInt(hex, 16);
  return ((n >> 16) & 255) > 245 && ((n >> 8) & 255) > 245 && (n & 255) > 245;
};

interface SubPath {
  pts: [number, number][];
  curved: boolean;
  closed: boolean;
}

/** Контур pdf.js (DrawOPS) → подконтуры в координатах страницы. */
function parsePath(data: ArrayLike<number>, ctm: M): SubPath[] {
  const out: SubPath[] = [];
  let cur: SubPath | null = null;
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) {
      cur = { pts: [apply(ctm, data[i], data[i + 1])], curved: false, closed: false };
      out.push(cur);
      i += 2;
    } else if (op === 1) {
      cur?.pts.push(apply(ctm, data[i], data[i + 1]));
      i += 2;
    } else if (op === 2) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(apply(ctm, data[i], data[i + 1]), apply(ctm, data[i + 2], data[i + 3]), apply(ctm, data[i + 4], data[i + 5]));
      }
      i += 6;
    } else if (op === 3) {
      if (cur) {
        cur.curved = true;
        cur.pts.push(apply(ctm, data[i], data[i + 1]), apply(ctm, data[i + 2], data[i + 3]));
      }
      i += 4;
    } else if (op === 4) {
      if (cur) cur.closed = true;
    } else break; // неизвестная команда — дальше данные не разобрать
  }
  return out;
}

const bboxOf = (pts: [number, number][]) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};

/** Прямоугольник со сторонами по осям (4–5 точек). */
const isAxisRect = (sp: SubPath) => {
  if (sp.curved) return false;
  const p = sp.pts;
  const n = p.length >= 5 && Math.abs(p[0][0] - p[p.length - 1][0]) < 0.01 && Math.abs(p[0][1] - p[p.length - 1][1]) < 0.01 ? p.length - 1 : p.length;
  if (n !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05) return false;
  }
  return true;
};

interface Geometry {
  hSegs: Seg[];
  vSegs: Seg[];
  fills: FillRect[];
  shapes: Shape[];
  images: ImageRef[];
}

function walkOperators(ol: { fnArray: number[]; argsArray: unknown[] }, pageW: number, pageH: number): Geometry {
  const g: Geometry = { hSegs: [], vSegs: [], fills: [], shapes: [], images: [] };
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let fill = "000000";
  let stroke = "000000";
  let lw = 1;
  const stack: { ctm: M; fill: string; stroke: string; lw: number }[] = [];
  const formStack: M[] = [];

  const addLine = (x0: number, y0: number, x1: number, y1: number, width: number, color: string) => {
    if (isWhite(color)) return;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dy <= LINE_MAX && dx >= LINE_MIN_LEN && dx > dy * 3)
      g.hSegs.push({ pos: (y0 + y1) / 2, a: Math.min(x0, x1), b: Math.max(x0, x1), width: Math.max(width, dy), color });
    else if (dx <= LINE_MAX && dy >= LINE_MIN_LEN && dy > dx * 3)
      g.vSegs.push({ pos: (x0 + x1) / 2, a: Math.min(y0, y1), b: Math.max(y0, y1), width: Math.max(width, dx), color });
    else return false;
    return true;
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ctm, fill, stroke, lw });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, fill, stroke, lw } = s);
        break;
      }
      case OPS.transform:
        ctm = mul(ctm, args as M);
        break;
      case OPS.paintFormXObjectBegin:
        formStack.push(ctm);
        if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>));
        break;
      case OPS.paintFormXObjectEnd:
        ctm = formStack.pop() ?? ctm;
        break;
      case OPS.setLineWidth:
        lw = Number(args[0]) || 0;
        break;
      case OPS.setFillRGBColor:
      case OPS.setFillGray:
      case OPS.setFillCMYKColor:
        fill = toHex(fn === OPS.setFillRGBColor ? args[0] ?? args : args);
        break;
      case OPS.setStrokeRGBColor:
      case OPS.setStrokeGray:
      case OPS.setStrokeCMYKColor:
        stroke = toHex(fn === OPS.setStrokeRGBColor ? args[0] ?? args : args);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat:
      case OPS.paintImageMaskXObject: {
        const b = bboxOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]);
        if (b.x1 - b.x0 < 4 || b.y1 - b.y0 < 4) break;
        const fullPage = (b.x1 - b.x0) * (b.y1 - b.y0) > pageW * pageH * 0.7;
        g.images.push({ ...b, fullPage });
        break;
      }
      case OPS.constructPath: {
        const paint = args[0] as number;
        if (paint === OPS.endPath) break; // только обрезка
        const raw = (args[1] as unknown[])?.[0];
        if (!raw || !(ArrayBuffer.isView(raw) || Array.isArray(raw))) break;
        const sub = parsePath(raw as ArrayLike<number>, ctm);
        const scale = Math.hypot(ctm[0], ctm[1]) || 1;
        const doStroke = paint === OPS.stroke || paint === OPS.closeStroke || paint >= OPS.fillStroke;
        const doFill = paint === OPS.fill || paint === OPS.eoFill || paint >= OPS.fillStroke;
        const width = Math.max(0.25, lw * scale);
        for (const sp of sub) {
          const bb = bboxOf(sp.pts);
          if (!isFinite(bb.x0)) continue;
          if (doFill) {
            if (isAxisRect(sp)) {
              if (!addLine(bb.x0, bb.y0, bb.x1, bb.y1, 0, fill)) {
                const w = bb.x1 - bb.x0;
                const h = bb.y1 - bb.y0;
                // Белые и почти во всю страницу заливки — это фон, не содержимое
                if (!isWhite(fill) && w > 1 && h > 1 && !(w > pageW * 0.9 && h > pageH * 0.9)) g.fills.push({ ...bb, color: fill });
              }
            } else if (!isWhite(fill) && bb.x1 - bb.x0 > 0.5 && bb.y1 - bb.y0 > 0.5) {
              g.shapes.push({ ...bb, kind: "fill", color: fill, curved: sp.curved });
            }
          }
          if (doStroke) {
            if (sp.curved) {
              if (!isWhite(stroke)) g.shapes.push({ ...bb, kind: "stroke", color: stroke, curved: true });
              continue;
            }
            const pts = sp.closed ? [...sp.pts, sp.pts[0]] : sp.pts;
            for (let k = 1; k < pts.length; k++) {
              const [ax, ay] = pts[k - 1];
              const [bx, by] = pts[k];
              if (Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01) continue;
              const axis = Math.abs(ax - bx) < 0.3 || Math.abs(ay - by) < 0.3;
              if (axis && addLine(ax, ay, bx, by, width, stroke)) continue;
              if (!isWhite(stroke)) g.shapes.push({ ...bboxOf([pts[k - 1], pts[k]]), kind: "stroke", color: stroke, curved: false });
            }
          }
        }
        break;
      }
    }
  }
  return g;
}

/**
 * Отрисовать страницу на белом фоне. `noText` — без текста: pdf.js рисует
 * буквы встроенных шрифтов через fillText/strokeText, их и отключаем.
 */
export async function renderPage(page: pdfjs.PDFPageProxy, scale: number, noText = false): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(vp.width));
  canvas.height = Math.max(1, Math.ceil(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Текст может рисоваться и на вспомогательных холстах (прозрачность,
  // маски), поэтому отключаем вывод букв у всех холстов на время отрисовки
  const protos: { fillText: unknown; strokeText: unknown }[] = [CanvasRenderingContext2D.prototype];
  if (typeof OffscreenCanvasRenderingContext2D !== "undefined") protos.push(OffscreenCanvasRenderingContext2D.prototype);
  const saved = protos.map((p) => ({ p, fill: p.fillText, stroke: p.strokeText }));
  if (noText) for (const p of protos) p.fillText = p.strokeText = () => undefined;
  try {
    await page.render({ canvas, canvasContext: ctx, viewport: vp } as Parameters<typeof page.render>[0]).promise;
  } finally {
    if (noText)
      for (const { p, fill, stroke } of saved) {
        p.fillText = fill;
        p.strokeText = stroke;
      }
  }
  return canvas;
}

/**
 * Цвет текста — по отрисованной странице: в рамке фрагмента берём пиксели,
 * сильнее всего отличающиеся от фона. Надёжнее, чем сопоставлять фрагменты
 * pdf.js с командами смены цвета.
 */
function sampleColors(items: Item[], canvas: HTMLCanvasElement, scale: number, pageH: number) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const W = canvas.width;
  const H = canvas.height;
  const px = ctx.getImageData(0, 0, W, H).data;
  for (const it of items) {
    if (!it.str.trim()) continue;
    const x0 = Math.max(0, Math.floor(it.x * scale));
    const x1 = Math.min(W, Math.ceil((it.x + it.width) * scale));
    const y0 = Math.max(0, Math.floor((pageH - it.y - it.size * 0.75) * scale));
    const y1 = Math.min(H, Math.ceil((pageH - it.y + it.size * 0.1) * scale));
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    // Фон — самый светлый угол рамки
    let bg = [255, 255, 255];
    let bestL = -1;
    for (const [cx, cy] of [
      [x0, y0],
      [x1 - 1, y0],
      [x0, y1 - 1],
      [x1 - 1, y1 - 1],
    ]) {
      const o = (cy * W + cx) * 4;
      const l = px[o] + px[o + 1] + px[o + 2];
      if (l > bestL) {
        bestL = l;
        bg = [px[o], px[o + 1], px[o + 2]];
      }
    }
    let best = 0;
    const acc = [0, 0, 0];
    let n = 0;
    const step = Math.max(1, Math.floor((x1 - x0) / 120));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x += step) {
        const o = (y * W + x) * 4;
        const d = Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]);
        if (d > best + 30) {
          best = d;
          acc[0] = px[o];
          acc[1] = px[o + 1];
          acc[2] = px[o + 2];
          n = 1;
        } else if (d >= best - 30 && d > 120) {
          acc[0] += px[o];
          acc[1] += px[o + 1];
          acc[2] += px[o + 2];
          n++;
        }
      }
    if (!n || best < 120) continue;
    const [r, g, b] = acc.map((v) => Math.round(v / n));
    // Почти чёрный — «авто», без явного цвета
    if (Math.max(r, g, b) < 45 && Math.max(r, g, b) - Math.min(r, g, b) < 25) continue;
    it.color = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  // Замер по отдельным словам немного «гуляет»: близкие цвета сводим к самому
  // частому, иначе в одной строке слова получаются разных оттенков
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const freq = new Map<string, number>();
  for (const it of items) if (it.color) freq.set(it.color, (freq.get(it.color) ?? 0) + it.str.length);
  const palette = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const reps: string[] = [];
  for (const c of palette) {
    const v = rgb(c);
    if (!reps.some((r) => rgb(r).reduce((s, x, i) => s + Math.abs(x - v[i]), 0) < 60)) reps.push(c);
  }
  for (const it of items) {
    if (!it.color) continue;
    const v = rgb(it.color);
    let best = it.color;
    let d = Infinity;
    for (const r of reps) {
      const dd = rgb(r).reduce((s, x, i) => s + Math.abs(x - v[i]), 0);
      if (dd < d) {
        d = dd;
        best = r;
      }
    }
    if (d < 60) it.color = best;
    // Тёмный «почти чёрный», случайно отделившийся от чёрного, — тоже авто
    const [r, g, b] = rgb(it.color);
    if (Math.max(r, g, b) < 45) it.color = null;
  }
}

/**
 * pdf.js склеивает соседние куски текста одного шрифта в один фрагмент, даже
 * если между ними сменился цвет или есть подчёркивание. Режем фрагменты на
 * слова; положение слова — по ширине текста, измеренной тем же шрифтом и
 * пересчитанной на фактическую ширину фрагмента.
 */
let measureCtx: CanvasRenderingContext2D | null = null;
function splitWords(items: Item[]): Item[] {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  const out: Item[] = [];
  for (const it of items) {
    const words = [...it.str.matchAll(/\S+/g)];
    if (words.length <= 1 || !ctx || it.width <= 0) {
      if (words.length) {
        const lead = it.str.length - it.str.trimStart().length;
        if (lead && ctx) {
          ctx.font = `${it.italic ? "italic " : ""}${it.bold ? "bold " : ""}${it.size}px "${it.font}", serif`;
          const full = ctx.measureText(it.str).width || 1;
          const pre = ctx.measureText(it.str.slice(0, lead)).width;
          const k = it.width / full;
          out.push({ ...it, str: it.str.trim(), x: it.x + pre * k, width: it.width - pre * k - ctx.measureText(it.str.slice(lead + it.str.trim().length)).width * k });
        } else out.push({ ...it, str: it.str.trim() });
      }
      continue;
    }
    ctx.font = `${it.italic ? "italic " : ""}${it.bold ? "bold " : ""}${it.size}px "${it.font}", serif`;
    const full = ctx.measureText(it.str).width || 1;
    const k = it.width / full;
    for (const w of words) {
      const pre = ctx.measureText(it.str.slice(0, w.index)).width;
      const ww = ctx.measureText(w[0]).width;
      out.push({ ...it, str: w[0], x: it.x + pre * k, width: ww * k });
    }
  }
  out.forEach((it, i) => (it.idx = i));
  return out;
}

/**
 * Доля фрагментов текста, которые реально видны: сравниваем отрисовку с
 * текстом и без. У скана с распознанным (невидимым) слоем текста она ≈ 0.
 */
export function visibleTextShare(raw: PageRaw, clean: HTMLCanvasElement): number {
  const a = raw.canvas.getContext("2d", { willReadFrequently: true })!;
  const b = clean.getContext("2d", { willReadFrequently: true })!;
  const sample = raw.items.filter((_, i) => i % Math.max(1, Math.floor(raw.items.length / 60)) === 0);
  if (!sample.length) return 0;
  let visible = 0;
  for (const it of sample) {
    const x = Math.max(0, Math.floor(it.x * raw.scale));
    const y = Math.max(0, Math.floor((raw.height - it.y - it.size * 0.7) * raw.scale));
    const w = Math.max(1, Math.min(raw.canvas.width - x, Math.ceil(it.width * raw.scale)));
    const h = Math.max(1, Math.min(raw.canvas.height - y, Math.ceil(it.size * 0.8 * raw.scale)));
    if (w < 1 || h < 1 || x >= raw.canvas.width || y >= raw.canvas.height) continue;
    const pa = a.getImageData(x, y, w, h).data;
    const pb = b.getImageData(x, y, w, h).data;
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 60) diff++;
    if (diff > (pa.length / 4) * 0.02) visible++;
  }
  return visible / sample.length;
}

/** Всё содержимое страницы. */
export async function extractPage(page: pdfjs.PDFPageProxy, index: number, scale = 2): Promise<PageRaw> {
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width;
  const H = vp.height;
  // Страница может быть сдвинута (MediaBox не от нуля) или повёрнута —
  // переводим всё в систему «0,0 — левый нижний угол видимой страницы»
  const vt = vp.transform as M; // в координаты экрана (Y вниз)
  const toPage: M = mul([1, 0, 0, -1, 0, H], vt);

  const ol = await page.getOperatorList();
  const geo = walkOperators(ol, W, H);
  const fix = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    const p = bboxOf([apply(toPage, b.x0, b.y0), apply(toPage, b.x1, b.y1)]);
    b.x0 = p.x0;
    b.y0 = p.y0;
    b.x1 = p.x1;
    b.y1 = p.y1;
  };
  const identity = Math.abs(toPage[0] - 1) < 1e-6 && Math.abs(toPage[3] - 1) < 1e-6 && Math.abs(toPage[4]) < 1e-6 && Math.abs(toPage[5]) < 1e-6;
  if (!identity) {
    // Повёрнутая/сдвинутая страница: линии пересчитываем через рамки
    const segs = (s: Seg[], horizontal: boolean) =>
      s.map((sg) => {
        const b = horizontal ? { x0: sg.a, y0: sg.pos, x1: sg.b, y1: sg.pos } : { x0: sg.pos, y0: sg.a, x1: sg.pos, y1: sg.b };
        fix(b);
        return { b, sg };
      });
    const all = [...segs(geo.hSegs, true), ...segs(geo.vSegs, false)];
    geo.hSegs = [];
    geo.vSegs = [];
    for (const { b, sg } of all) {
      if (b.y1 - b.y0 < b.x1 - b.x0) geo.hSegs.push({ ...sg, pos: (b.y0 + b.y1) / 2, a: b.x0, b: b.x1 });
      else geo.vSegs.push({ ...sg, pos: (b.x0 + b.x1) / 2, a: b.y0, b: b.y1 });
    }
    geo.fills.forEach(fix);
    geo.shapes.forEach(fix);
    geo.images.forEach(fix);
  }

  const tc = await page.getTextContent();
  const items: Item[] = [];
  (tc.items as unknown[]).forEach((raw, idx) => {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number; fontName?: string };
    if (typeof it.str !== "string" || !it.transform || !it.str) return;
    const t = identity ? it.transform : mul(toPage, it.transform);
    // Повёрнутый текст (подписи осей, вертикальные заголовки) в поток не берём
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.2 + 0.01) return;
    const size = Math.round(Math.hypot(t[2], t[3]) * 2) / 2 || Math.round((it.height || 10) * 2) / 2;
    if (size < 1) return;
    let fontInfo = { family: "Times New Roman", bold: false, italic: false };
    try {
      const f = page.commonObjs.get(it.fontName ?? "") as { name?: string } | undefined;
      const fam = (tc.styles as Record<string, { fontFamily?: string }>)[it.fontName ?? ""]?.fontFamily ?? "";
      fontInfo = parseFontName(f?.name ?? "", fam);
    } catch {
      /* шрифт не загружен — оставляем по умолчанию */
    }
    const scaleX = identity ? 1 : Math.hypot(toPage[0], toPage[1]);
    items.push({
      str: it.str,
      x: t[4],
      y: t[5],
      width: (it.width || 0) * scaleX,
      idx,
      font: fontInfo.family,
      size,
      bold: fontInfo.bold,
      italic: fontInfo.italic,
      color: null,
    });
  });

  const words = splitWords(items);
  // Отрисовка — после чтения геометрии (см. комментарий в начале файла)
  const canvas = await renderPage(page, scale);
  const scan = geo.images.some((im) => im.fullPage);
  if (!scan) sampleColors(words, canvas, scale, H);

  return { index, width: W, height: H, items: words, ...geo, canvas, scale };
}
