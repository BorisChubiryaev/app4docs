// Коррекции и фильтры. Работают с ImageData на чистом JS — одинаково во
// всех браузерах (ctx.filter поддерживается не везде).

export type FilterId =
  | "brightness"
  | "hsl"
  | "levels"
  | "temperature"
  | "exposure"
  | "grayscale"
  | "sepia"
  | "invert"
  | "posterize"
  | "threshold"
  | "blur"
  | "sharpen"
  | "noise"
  | "pixelate"
  | "vignette"
  | "autoLevels";

export interface FilterParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
}

export interface FilterDef {
  id: FilterId;
  title: string;
  group: "correct" | "filter";
  params: FilterParam[];
}

export const FILTERS: FilterDef[] = [
  {
    id: "brightness",
    title: "Яркость и контраст",
    group: "correct",
    params: [
      { key: "brightness", label: "Яркость", min: -100, max: 100, value: 0 },
      { key: "contrast", label: "Контраст", min: -100, max: 100, value: 0 },
    ],
  },
  {
    id: "hsl",
    title: "Цветовой тон и насыщенность",
    group: "correct",
    params: [
      { key: "hue", label: "Цветовой тон", min: -180, max: 180, value: 0, unit: "°" },
      { key: "saturation", label: "Насыщенность", min: -100, max: 100, value: 0 },
      { key: "lightness", label: "Яркость", min: -100, max: 100, value: 0 },
    ],
  },
  {
    id: "levels",
    title: "Уровни",
    group: "correct",
    params: [
      { key: "black", label: "Чёрная точка", min: 0, max: 253, value: 0 },
      { key: "white", label: "Белая точка", min: 2, max: 255, value: 255 },
      { key: "gamma", label: "Средние тона (гамма)", min: 0.1, max: 3, step: 0.01, value: 1 },
    ],
  },
  {
    id: "temperature",
    title: "Цветовая температура",
    group: "correct",
    params: [
      { key: "temp", label: "Температура (синий ↔ жёлтый)", min: -100, max: 100, value: 0 },
      { key: "tint", label: "Оттенок (зелёный ↔ пурпурный)", min: -100, max: 100, value: 0 },
    ],
  },
  {
    id: "exposure",
    title: "Экспозиция",
    group: "correct",
    params: [{ key: "ev", label: "Экспозиция", min: -3, max: 3, step: 0.05, value: 0, unit: " EV" }],
  },
  { id: "autoLevels", title: "Автоконтраст", group: "correct", params: [] },
  { id: "grayscale", title: "Чёрно-белое", group: "correct", params: [] },
  { id: "sepia", title: "Сепия", group: "correct", params: [{ key: "amount", label: "Сила", min: 0, max: 100, value: 100 }] },
  { id: "invert", title: "Инверсия", group: "correct", params: [] },
  { id: "posterize", title: "Постеризация", group: "correct", params: [{ key: "levels", label: "Уровней", min: 2, max: 32, value: 6 }] },
  { id: "threshold", title: "Порог", group: "correct", params: [{ key: "level", label: "Порог", min: 1, max: 254, value: 128 }] },
  {
    id: "blur",
    title: "Размытие по Гауссу",
    group: "filter",
    params: [{ key: "radius", label: "Радиус", min: 0.5, max: 60, step: 0.5, value: 4, unit: " пкс" }],
  },
  {
    id: "sharpen",
    title: "Резкость (нерезкая маска)",
    group: "filter",
    params: [
      { key: "amount", label: "Сила", min: 0, max: 300, value: 80, unit: " %" },
      { key: "radius", label: "Радиус", min: 0.5, max: 10, step: 0.5, value: 1.5, unit: " пкс" },
    ],
  },
  { id: "noise", title: "Шум", group: "filter", params: [{ key: "amount", label: "Сила", min: 0, max: 100, value: 15 }] },
  { id: "pixelate", title: "Пикселизация", group: "filter", params: [{ key: "size", label: "Размер клетки", min: 2, max: 100, value: 12, unit: " пкс" }] },
  {
    id: "vignette",
    title: "Виньетка",
    group: "filter",
    params: [
      { key: "amount", label: "Сила", min: -100, max: 100, value: 50 },
      { key: "size", label: "Размер", min: 10, max: 100, value: 60 },
    ],
  },
];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

/** Таблица преобразования яркости канала. */
function applyLut(img: ImageData, lut: Uint8ClampedArray) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

function lut(fn: (v: number) => number) {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) t[v] = fn(v);
  return t;
}

/** Размытие по Гауссу тремя проходами box-blur (точность ±3 %, скорость O(n)). */
export function gaussianBlur(img: ImageData, radius: number): ImageData {
  const { width: w, height: h } = img;
  const sigma = radius;
  // Размеры коробок для трёх проходов
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes = [0, 1, 2].map((i) => (i < m ? wl : wu));
  // Премультипликация альфы — иначе прозрачные края «окрашиваются» чёрным
  const src = new Float32Array(w * h * 4);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    src[i * 4] = d[i * 4] * a;
    src[i * 4 + 1] = d[i * 4 + 1] * a;
    src[i * 4 + 2] = d[i * 4 + 2] * a;
    src[i * 4 + 3] = d[i * 4 + 3];
  }
  const a = src;
  const b = new Float32Array(src.length);
  for (const s of sizes) {
    const r = (s - 1) / 2;
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const al = a[i * 4 + 3];
    const k = al > 0 ? 255 / al : 0;
    out.data[i * 4] = a[i * 4] * k;
    out.data[i * 4 + 1] = a[i * 4 + 1] * k;
    out.data[i * 4 + 2] = a[i * 4 + 2] * k;
    out.data[i * 4 + 3] = al;
  }
  return out;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, Math.floor((w - 1) / 2)));
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      const row = y * w;
      let ti = row,
        li = row,
        ri = row + r;
      const fv = src[row * 4 + c],
        lv = src[(row + w - 1) * 4 + c];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[(row + Math.min(j, w - 1)) * 4 + c];
      for (let j = 0; j <= r; j++) {
        val += (ri < row + w ? src[ri * 4 + c] : lv) - fv;
        dst[ti * 4 + c] = val * iarr;
        ri++;
        ti++;
      }
      for (let j = r + 1; j < w - r; j++) {
        val += src[ri * 4 + c] - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        ri++;
        li++;
        ti++;
      }
      for (let j = Math.max(w - r, r + 1); j < w; j++) {
        val += lv - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        li++;
        ti++;
      }
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, Math.floor((h - 1) / 2)));
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let ti = x,
        li = ti,
        ri = ti + r * w;
      const fv = src[ti * 4 + c],
        lv = src[(ti + w * (h - 1)) * 4 + c];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[(x + Math.min(j, h - 1) * w) * 4 + c];
      for (let j = 0; j <= r; j++) {
        val += (ri < w * h ? src[ri * 4 + c] : lv) - fv;
        dst[ti * 4 + c] = val * iarr;
        ri += w;
        ti += w;
      }
      for (let j = r + 1; j < h - r; j++) {
        val += src[ri * 4 + c] - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        li += w;
        ri += w;
        ti += w;
      }
      for (let j = Math.max(h - r, r + 1); j < h; j++) {
        val += lv - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        li += w;
        ti += w;
      }
    }
  }
}

/** Применить фильтр к копии изображения. */
export function applyFilter(src: ImageData, id: FilterId, p: Record<string, number>): ImageData {
  if (id === "blur") return gaussianBlur(src, p.radius);
  const img = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = img.data;
  const { width: w, height: h } = img;

  switch (id) {
    case "brightness": {
      const b = p.brightness * 1.5;
      const c = p.contrast;
      const f = (259 * (c * 2.55 + 255)) / (255 * (259 - c * 2.55));
      applyLut(img, lut((v) => f * (v + b - 128) + 128));
      break;
    }
    case "exposure": {
      const k = Math.pow(2, p.ev);
      applyLut(img, lut((v) => 255 * Math.pow(Math.pow(v / 255, 2.2) * k, 1 / 2.2)));
      break;
    }
    case "levels": {
      const range = Math.max(1, p.white - p.black);
      applyLut(img, lut((v) => 255 * Math.pow(Math.min(1, Math.max(0, (v - p.black) / range)), 1 / p.gamma)));
      break;
    }
    case "autoLevels": {
      // Отсекаем по 0,5 % самых тёмных и светлых пикселей — по яркости
      const hist = new Uint32Array(256);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
        n++;
      }
      const cut = n * 0.005;
      let lo = 0,
        hi = 255,
        acc = 0;
      while (lo < 254 && acc + hist[lo] < cut) acc += hist[lo++];
      acc = 0;
      while (hi > lo + 1 && acc + hist[hi] < cut) acc += hist[hi--];
      applyLut(img, lut((v) => ((v - lo) * 255) / Math.max(1, hi - lo)));
      break;
    }
    case "hsl": {
      const dh = p.hue / 360;
      const ds = p.saturation / 100;
      const dl = p.lightness / 100;
      for (let i = 0; i < d.length; i += 4) {
        let [hh, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        hh = (hh + dh + 1) % 1;
        s = ds >= 0 ? s + (1 - s) * ds * s : s * (1 + ds);
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        const [r, g, b] = hslToRgb(hh, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)));
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
      break;
    }
    case "temperature": {
      const t = p.temp * 0.6;
      const tn = p.tint * 0.6;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp255(d[i] + t + tn * 0.5);
        d[i + 1] = clamp255(d[i + 1] - tn);
        d[i + 2] = clamp255(d[i + 2] - t + tn * 0.5);
      }
      break;
    }
    case "grayscale":
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = y;
      }
      break;
    case "sepia": {
      const k = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        d[i] = r + (Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b) - r) * k;
        d[i + 1] = g + (Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b) - g) * k;
        d[i + 2] = b + (Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b) - b) * k;
      }
      break;
    }
    case "invert":
      applyLut(img, lut((v) => 255 - v));
      break;
    case "posterize": {
      const n = Math.max(2, Math.round(p.levels));
      applyLut(img, lut((v) => Math.round((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255)));
      break;
    }
    case "threshold":
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = y >= p.level ? 255 : 0;
      }
      break;
    case "sharpen": {
      const blurred = gaussianBlur(src, p.radius).data;
      const k = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp255(d[i] + (d[i] - blurred[i]) * k);
        d[i + 1] = clamp255(d[i + 1] + (d[i + 1] - blurred[i + 1]) * k);
        d[i + 2] = clamp255(d[i + 2] + (d[i + 2] - blurred[i + 2]) * k);
      }
      break;
    }
    case "noise": {
      const a = p.amount * 1.28;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() + Math.random() - 1) * a;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
      }
      break;
    }
    case "pixelate": {
      const s = Math.max(2, Math.round(p.size));
      for (let by = 0; by < h; by += s)
        for (let bx = 0; bx < w; bx += s) {
          let r = 0,
            g = 0,
            b = 0,
            a = 0,
            n = 0;
          for (let y = by; y < Math.min(h, by + s); y++)
            for (let x = bx; x < Math.min(w, bx + s); x++) {
              const i = (y * w + x) * 4;
              r += src.data[i];
              g += src.data[i + 1];
              b += src.data[i + 2];
              a += src.data[i + 3];
              n++;
            }
          for (let y = by; y < Math.min(h, by + s); y++)
            for (let x = bx; x < Math.min(w, bx + s); x++) {
              const i = (y * w + x) * 4;
              d[i] = r / n;
              d[i + 1] = g / n;
              d[i + 2] = b / n;
              d[i + 3] = a / n;
            }
        }
      break;
    }
    case "vignette": {
      const amt = p.amount / 100;
      const size = p.size / 100;
      const cx = w / 2,
        cy = h / 2;
      const maxD = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dist = Math.hypot(x - cx, y - cy) / maxD;
          const t = Math.max(0, (dist - size * 0.7) / (1 - size * 0.7));
          const f = t * t * (3 - 2 * t) * amt;
          const i = (y * w + x) * 4;
          if (f > 0) {
            d[i] *= 1 - f;
            d[i + 1] *= 1 - f;
            d[i + 2] *= 1 - f;
          } else {
            d[i] += (255 - d[i]) * -f;
            d[i + 1] += (255 - d[i + 1]) * -f;
            d[i + 2] += (255 - d[i + 2]) * -f;
          }
        }
      break;
    }
  }
  return img;
}
