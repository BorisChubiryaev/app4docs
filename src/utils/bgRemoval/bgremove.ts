// Удаление фона: общая доводка маски и режим «однотонный фон».
//
// Основной режим — нейросеть (aiSegment.ts): она даёт грубую маску 320×320.
// Здесь эта маска (или маска «по цвету») доводится до качества:
//   • мелкие островки удаляются, мелкие дырки заливаются;
//   • край уточняется guided filter по исходной картинке — волосы и мягкие
//     края получают полупрозрачность, а не «лесенку» от увеличения.
// Режим «однотонный фон» — без нейросети: заливка от краёв кадра по цвету,
// похожему на фон (k-средних по полосе вдоль краёв, в пространстве Lab).
//
// Результат — маска (её можно доправить кистью), а не стёртые пиксели.

import { createCanvas, ctx2d, ctxRead } from "./canvas";

export interface BgOptions {
  mode: "ai" | "color";
  /** Для «однотонного фона»: насколько далёкий от фона цвет ещё считается фоном (1…100). */
  tolerance: number;
  /** Смягчение края, пкс. */
  feather: number;
  /** Убирать мелкий мусор и дырки. */
  cleanup: boolean;
}

const ANALYSIS_MAX = 640;
const REFINE_MAX = 1600;

// ── Цвет (для однотонного фона) ──

function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  };
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function kmeans(samples: Float32Array, k: number, iters = 8): Float32Array {
  const n = samples.length / 3;
  const centers = new Float32Array(k * 3);
  if (!n) return centers;
  const dist2 = (i: number, j: number) => {
    const dl = samples[i * 3] - centers[j * 3];
    const da = samples[i * 3 + 1] - centers[j * 3 + 1];
    const db = samples[i * 3 + 2] - centers[j * 3 + 2];
    return dl * dl + da * da + db * db;
  };
  const pick = (i: number, j: number) => centers.set(samples.subarray(i * 3, i * 3 + 3), j * 3);
  pick(Math.floor(n / 2), 0);
  for (let j = 1; j < k; j++) {
    let best = 0,
      bestD = -1;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 2000))) {
      let dmin = Infinity;
      for (let c = 0; c < j; c++) dmin = Math.min(dmin, dist2(i, c));
      if (dmin > bestD) {
        bestD = dmin;
        best = i;
      }
    }
    pick(best, j);
  }
  const sums = new Float64Array(k * 4);
  for (let it = 0; it < iters; it++) {
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      let bc = 0,
        bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(i, c);
        if (d < bd) {
          bd = d;
          bc = c;
        }
      }
      sums[bc * 4] += samples[i * 3];
      sums[bc * 4 + 1] += samples[i * 3 + 1];
      sums[bc * 4 + 2] += samples[i * 3 + 2];
      sums[bc * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const cnt = sums[c * 4 + 3];
      if (cnt) for (let q = 0; q < 3; q++) centers[c * 3 + q] = sums[c * 4 + q] / cnt;
    }
  }
  return centers;
}

// ── Связные области ──

function floodFromBorder(allowed: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (allowed[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  return seen;
}

function components(m: Uint8Array, w: number, h: number, val: number) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const touchesBorder: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (m[s] !== val || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let border = false;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const visit = (j: number) => {
        if (m[j] === val && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    sizes.push(size);
    touchesBorder.push(border);
  }
  return { label, sizes, touchesBorder };
}

// ── Guided filter ──

function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r),
      y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(w, x + r + 1);
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const meanI = boxMean(I, w, h, r);
  const meanP = boxMean(p, w, h, r);
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const corrIp = boxMean(Ip, w, h, r);
  const corrII = boxMean(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrII[i] - meanI[i] * meanI[i];
    a[i] = (corrIp[i] - meanI[i] * meanP[i]) / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const ma = boxMean(a, w, h, r);
  const mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

function scaled(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  if (k === 1) return src;
  const c = createCanvas(Math.round(src.width * k), Math.round(src.height * k));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * Доводка грубой маски (вероятность объекта 0…1, размер lw×lh) до маски
 * в полном размере картинки src.
 */
export function refineMask(
  src: HTMLCanvasElement,
  prob: Float32Array,
  lw: number,
  lh: number,
  o: Pick<BgOptions, "feather" | "cleanup">,
): HTMLCanvasElement {
  const n = lw * lh;
  const soft = new Float32Array(prob);
  if (o.cleanup) {
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = soft[i] >= 0.5 ? 1 : 0;
    const fg = components(bin, lw, lh, 1);
    const biggest = Math.max(0, ...fg.sizes);
    for (let i = 0; i < n; i++) if (fg.label[i] >= 0 && fg.sizes[fg.label[i]] < biggest * 0.02) soft[i] = 0;
    const holes = components(bin, lw, lh, 0);
    for (let i = 0; i < n; i++) {
      const id = holes.label[i];
      if (id >= 0 && !holes.touchesBorder[id] && holes.sizes[id] < n * 0.001) soft[i] = 1;
    }
  }

  // Грубая маска → разрешение уточнения
  const low = createCanvas(lw, lh);
  const lm = new ImageData(lw, lh);
  for (let i = 0; i < n; i++) lm.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, soft[i])) * 255);
  ctx2d(low).putImageData(lm, 0, 0);
  const refineSrc = scaled(src, REFINE_MAX);
  const rw = refineSrc.width;
  const rh = refineSrc.height;
  const up = createCanvas(rw, rh);
  const upCtx = ctx2d(up);
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(low, 0, 0, rw, rh);
  const upData = ctxRead(up).getImageData(0, 0, rw, rh).data;
  const guide = ctxRead(refineSrc).getImageData(0, 0, rw, rh).data;
  const I = new Float32Array(rw * rh);
  const P = new Float32Array(rw * rh);
  for (let i = 0; i < rw * rh; i++) {
    I[i] = (0.299 * guide[i * 4] + 0.587 * guide[i * 4 + 1] + 0.114 * guide[i * 4 + 2]) / 255;
    P[i] = upData[i * 4 + 3] / 255;
  }
  // Край — по исходной картинке: радиус ~ шаг грубой маски
  const r = Math.max(2, Math.round((Math.max(rw, rh) / Math.max(lw, lh)) * 1.5));
  const q = guidedFilter(I, P, rw, rh, r, 2e-3);
  const out = new ImageData(rw, rh);
  for (let i = 0; i < rw * rh; i++) {
    const v = Math.min(1, Math.max(0, (q[i] - 0.1) / 0.8));
    out.data[i * 4 + 3] = guide[i * 4 + 3] > 0 ? Math.round(v * 255) : 0;
  }
  const refined = createCanvas(rw, rh);
  ctx2d(refined).putImageData(out, 0, 0);

  const mask = createCanvas(src.width, src.height);
  const mctx = ctx2d(mask);
  mctx.imageSmoothingQuality = "high";
  if (o.feather > 0) mctx.filter = `blur(${o.feather}px)`;
  mctx.drawImage(refined, 0, 0, src.width, src.height);
  mctx.filter = "none";
  return mask;
}

/** Режим «однотонный фон»: всё, что связано с краем кадра и похоже на его цвет. */
export function colorMask(src: HTMLCanvasElement, o: BgOptions): HTMLCanvasElement {
  const small = scaled(src, ANALYSIS_MAX);
  const w = small.width;
  const h = small.height;
  const n = w * h;
  const px = ctxRead(small).getImageData(0, 0, w, h).data;
  const lab = new Float32Array(n * 3);
  const transparent = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    lab.set(toLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), i * 3);
    if (px[i * 4 + 3] < 16) transparent[i] = 1;
  }
  // Модель фона — по полосе вдоль краёв
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (!transparent[i] && (x < band || y < band || x >= w - band || y >= h - band)) samples.push(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]);
  }
  const centers = kmeans(new Float32Array(samples), 3);
  const tol = 4 + o.tolerance * 0.45;
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let c = 0; c < centers.length / 3; c++) {
      const dl = lab[i * 3] - centers[c * 3];
      const da = lab[i * 3 + 1] - centers[c * 3 + 1];
      const db = lab[i * 3 + 2] - centers[c * 3 + 2];
      best = Math.min(best, dl * dl + da * da + db * db);
    }
    near[i] = transparent[i] || Math.sqrt(best) < tol ? 1 : 0;
  }
  const bg = floodFromBorder(near, w, h);
  const prob = new Float32Array(n);
  for (let i = 0; i < n; i++) prob[i] = bg[i] ? 0 : 1;
  return refineMask(src, prob, w, h, o);
}
