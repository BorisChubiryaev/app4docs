// Общие помощники рисования: плавность, цвета, текст, числа, шум.

import type { Frame } from "./types";

export const FONT = `"Inter Variable", Inter, "Segoe UI", Arial, sans-serif`;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Доля пройденного участка анимации [start, start + len] */
export const prog = (t: number, start: number, len: number) => clamp((t - start) / len);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeBack = (x: number) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ── Цвета ──

export function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export function mix(a: string, b: string, k: number) {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(lerp(v, y[i], k)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
/** Цвет по шкале из нескольких опорных цветов, k ∈ [0, 1] */
export function ramp(stops: string[], k: number) {
  if (stops.length === 1) return stops[0];
  const x = clamp(k) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}
export const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const isDark = (hex: string) => luminance(hex) < 0.35;
export const pc = (f: Frame, i: number) => f.pal[((i % f.pal.length) + f.pal.length) % f.pal.length];

// ── Числа ──

export function fmt(v: number, decimals = 0) {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
/** Число с префиксом и единицей: «12,4 млн ₽», «+18 %» */
export function fmtUnit(v: number, f: Frame) {
  const d = Number(f.p.decimals ?? 0);
  const pre = String(f.p.prefix ?? "");
  const unit = String(f.p.unit ?? "");
  const tight = /^[%₽$€]$/.test(unit) ? "\u202f" : unit ? " " : "";
  return `${pre}${fmt(v, d)}${unit ? tight + unit : ""}`;
}

// ── Текст ──

export const font = (px: number, weight = 600) => `${weight} ${Math.max(1, px)}px ${FONT}`;

/** Подобрать размер шрифта, чтобы текст влез в ширину */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number, weight = 600, min = 8) {
  let size = px;
  ctx.font = font(size, weight);
  while (size > min && ctx.measureText(text).width > maxW) {
    size *= 0.92;
    ctx.font = font(size, weight);
  }
  return size;
}

/** Разбить текст на строки по ширине */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  if (w <= 0 || h <= 0) return;
  const rr = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.roundRect(x, y, w, h, rr);
}

/** Заголовок и подзаголовок слева вверху; возвращает нижнюю границу */
export function header(f: Frame, x: number, y: number, maxW: number) {
  const { ctx, s, t } = f;
  const title = String(f.p.title ?? "").trim();
  const sub = String(f.p.subtitle ?? "").trim();
  if (!title && !sub) return y;
  const k = easeOut(prog(t, 0, 0.6));
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(0, (1 - k) * 18 * s);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let yy = y;
  if (title) {
    const px = fitFont(ctx, title, maxW, 54 * s, 700);
    yy += px;
    ctx.fillStyle = f.ink;
    ctx.fillText(title, x, yy);
    yy += px * 0.28;
  }
  if (sub) {
    const px = fitFont(ctx, sub, maxW, 28 * s, 500);
    yy += px * 1.15;
    ctx.fillStyle = f.muted;
    ctx.fillText(sub, x, yy);
    yy += px * 0.3;
  }
  ctx.restore();
  return yy + 36 * s;
}

// ── Случайность и шум ──

/** Детерминированный генератор: одинаковый seed — одинаковый рисунок */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

let grainTile: HTMLCanvasElement | null = null;
/** Зерно поверх кадра (одинаковое во всех кадрах — не мерцает) */
export function grain(f: Frame, amount: number) {
  if (amount <= 0) return;
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 256;
    const g = grainTile.getContext("2d")!;
    const img = g.createImageData(256, 256);
    const r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(r() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const { ctx, w, h } = f;
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = "overlay";
  const scale = Math.max(1, f.s);
  ctx.scale(scale, scale);
  ctx.fillStyle = ctx.createPattern(grainTile, "repeat")!;
  ctx.fillRect(0, 0, w / scale, h / scale);
  ctx.restore();
}

/** Мягкое цветное пятно */
export function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.45, rgba(color, a * 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Картинка «как cover» в прямоугольник */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Сглаженная линия через точки (монотонная кубическая — без «перелётов») */
export function smoothPath(ctx: CanvasRenderingContext2D, pts: [number, number][], smooth: boolean, move = true) {
  if (!pts.length) return;
  if (move) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const tg: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) tg.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tg.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) tg[i] = tg[i + 1] = 0;
    else {
      const a = tg[i] / m[i];
      const b = tg[i + 1] / m[i];
      const q = a * a + b * b;
      if (q > 9) {
        const k = 3 / Math.sqrt(q);
        tg[i] = k * a * m[i];
        tg[i + 1] = k * b * m[i];
      }
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    ctx.bezierCurveTo(pts[i][0] + h, pts[i][1] + tg[i] * h, pts[i + 1][0] - h, pts[i + 1][1] - tg[i + 1] * h, pts[i + 1][0], pts[i + 1][1]);
  }
}

/** Плашка с текстом (подпись точки, значение) */
export function badge(f: Frame, text: string, x: number, y: number, color: string, px: number) {
  const { ctx } = f;
  ctx.font = font(px, 700);
  const tw = ctx.measureText(text).width;
  const padX = px * 0.6;
  const bw = tw + padX * 2;
  const bh = px * 1.75;
  const bx = clamp(x - bw / 2, 4, f.w - bw - 4);
  roundRect(ctx, bx, y - bh, bw, bh, bh / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = isDark(color) ? "#fff" : "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + bw / 2, y - bh / 2 + px * 0.04);
}

// ── Карточки: фото и подписи вместе ──

/** Непустые фразы — подписи карточек */
export const phraseList = (f: Frame) => f.phrases.filter((p) => p.trim());

/**
 * Фото для карточки i. Фото идут по порядку; если подписей больше, чем фото,
 * лишние карточки — цветные (с подписью), иначе фото повторяются по кругу.
 */
export function pickImage(f: Frame, i: number) {
  const n = f.images.length;
  if (!n) return null;
  if (i < n) return f.images[i];
  return phraseList(f).length > n ? null : f.images[i % n];
}

/** Подпись карточки i: на фото — если включены подписи, на цветной — всегда */
export function captionOf(f: Frame, i: number, onPhoto: boolean) {
  const list = phraseList(f);
  if (!list.length) return undefined;
  const text = list[i % list.length];
  if (!pickImage(f, i)) return text;
  return onPhoto && i < list.length ? text : undefined;
}

