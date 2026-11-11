// Шаблоны без графиков: фразы, фоны для слайдов, раскладки и карточки с фото.

import { blob, captionOf, clamp, drawCover, pickImage, easeBack, easeInOut, easeOut, fitFont, font, grain, isDark, lerp, mix, pc, prog, rgba, rng, roundRect, wrap } from "../core/draw";
import type { Frame, Template } from "../core/types";

const TAU = Math.PI * 2;

// ── Фразы ──

const phrases: Template = {
  id: "phrases",
  name: "Фразы",
  group: "text",
  about: "Короткие фразы по одной, как в ролике: первая часть появляется, вторая — печатается акцентным цветом, кадр медленно приближается.",
  input: "phrases",
  duration: 9,
  loop: false,
  controls: [
    { key: "size", label: "Размер текста", type: "range", min: 40, max: 160, step: 1 },
    { key: "align", label: "Выравнивание", type: "select", options: [["center", "По центру"], ["left", "Слева"]] },
    { key: "zoom", label: "Приближение кадра", type: "toggle" },
  ],
  defaults: {
    params: { size: 96, align: "center", zoom: true },
    phrases: ["Меньше рутины —|больше времени на главное", "Отчёт за минуту|вместо вечера", "Всё в браузере|и без интернета"],
  },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    const list = f.phrases.filter((x) => x.trim());
    if (!list.length) return;
    const per = dur / list.length;
    const i = clamp(Math.floor(t / per), 0, list.length - 1);
    const lt = t - i * per;
    const [first, second = ""] = list[i].split("|").map((x) => x.trim());
    const kIn = easeOut(prog(lt, 0, 0.5));
    const kOut = i === list.length - 1 ? 0 : easeInOut(prog(lt, per - 0.45, 0.4));
    const typed = Math.round(second.length * prog(lt, 0.45, Math.max(0.3, per * 0.35)));
    const left = f.p.align === "left";
    const px = Number(f.p.size ?? 96) * s;
    const maxW = w * 0.82;
    ctx.save();
    if (f.p.zoom !== false) {
      const z = 1 + 0.05 * (lt / per);
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate(-w / 2, -h / 2);
    }
    ctx.globalAlpha = kIn * (1 - kOut);
    ctx.translate(0, (1 - kIn) * 30 * s - kOut * 30 * s);
    ctx.font = font(px, 800);
    const l1 = wrap(ctx, first, maxW);
    const l2 = second ? wrap(ctx, second, maxW) : [];
    const lh = px * 1.12;
    const total = (l1.length + l2.length) * lh;
    let y = h / 2 - total / 2 + px * 0.85;
    const x = left ? w * 0.09 : w / 2;
    ctx.textAlign = left ? "left" : "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = f.ink;
    for (const l of l1) {
      ctx.fillText(l, x, y);
      y += lh;
    }
    let shown = typed;
    ctx.fillStyle = pc(f, 0);
    for (const l of l2) {
      const part = l.slice(0, Math.max(0, shown));
      shown -= l.length + 1;
      ctx.fillText(part, x - (left ? 0 : (ctx.measureText(l).width - ctx.measureText(part).width) / 2), y);
      y += lh;
    }
    // Курсор печати
    if (second && typed < second.length && Math.floor(t * 2.5) % 2 === 0) {
      ctx.fillRect(left ? x + ctx.measureText(l2[0]?.slice(0, typed) ?? "").width + 6 * s : w / 2, y - lh - px * 0.75, 6 * s, px * 0.9);
    }
    ctx.restore();
  },
};

// ── Фоны ──

/** Цветные пятна, плавающие по замкнутым траекториям (видео — бесшовная петля) */
function meshBackground(f: Frame, seed: number, count: number, size: number, speed: number) {
  const { ctx, w, h, t, dur } = f;
  const r = rng(seed);
  ctx.fillStyle = String(f.p.base ?? "#0c0d12");
  ctx.fillRect(0, 0, w, h);
  const ph = (t / dur) * TAU;
  for (let i = 0; i < count; i++) {
    const cx = r() * w;
    const cy = r() * h;
    const ax = (0.12 + r() * 0.2) * w;
    const ay = (0.12 + r() * 0.2) * h;
    const k1 = Math.max(1, Math.round(speed * (1 + Math.floor(r() * 2))));
    const k2 = Math.max(1, Math.round(speed * (1 + Math.floor(r() * 2))));
    const o1 = r() * TAU;
    const o2 = r() * TAU;
    const rad = (0.35 + r() * 0.3) * Math.max(w, h) * size;
    blob(ctx, cx + Math.sin(ph * k1 + o1) * ax, cy + Math.cos(ph * k2 + o2) * ay, rad, pc(f, i), 0.9);
  }
}

const PRESETS: [string, string, string[]][] = [
  ["Ночь", "#0b0c14", ["#6d5dfc", "#ff4fa3", "#00c2ff", "#3b1d8f"]],
  ["Закат", "#1a0b12", ["#ff6b35", "#ff2e63", "#ffd166", "#8338ec"]],
  ["Море", "#04151f", ["#00b4d8", "#0077b6", "#90e0ef", "#06d6a0"]],
  ["Лес", "#07140c", ["#21a038", "#a3e635", "#0ea5a4", "#14532d"]],
  ["Утро", "#f6f3ee", ["#ffd6a5", "#bde0fe", "#ffc8dd", "#cdb4db"]],
  ["Бумага", "#f4f5f8", ["#c7d2fe", "#fbcfe8", "#a7f3d0", "#fde68a"]],
];
export const BG_PRESETS = PRESETS;

const gradientBg: Template = {
  id: "gradient",
  name: "Градиентный фон",
  group: "backgrounds",
  about: "Мягкие цветные пятна плывут по кругу, сверху — зерно. Готовые наборы цветов, видео — бесшовная петля.",
  input: "none",
  duration: 8,
  loop: true,
  ownBackground: true,
  shuffle: true,
  controls: [
    { key: "base", label: "Цвет основы", type: "color" },
    { key: "count", label: "Пятен", type: "range", min: 2, max: 8, step: 1 },
    { key: "size", label: "Размер пятен", type: "range", min: 40, max: 160, step: 1, unit: "%" },
    { key: "speed", label: "Скорость", type: "range", min: 1, max: 3, step: 1 },
    { key: "grain", label: "Зерно", type: "range", min: 0, max: 40, step: 1, unit: "%" },
  ],
  defaults: { params: { base: "#0b0c14", count: 5, size: 100, speed: 1, grain: 14, seed: 3 }, palette: PRESETS[0][2] },
  draw(f) {
    meshBackground(f, Number(f.p.seed ?? 1), Number(f.p.count ?? 5), Number(f.p.size ?? 100) / 100, Number(f.p.speed ?? 1));
    grain(f, Number(f.p.grain ?? 0) / 100);
  },
};

// Размытая копия фона для стекла: кадр в малом размере, растянутый обратно
let blurCanvas: HTMLCanvasElement | null = null;
function blurred(f: Frame, paint: (g: Frame) => void, amount: number) {
  const k = Math.max(4, Math.round(amount));
  const bw = Math.max(8, Math.round(f.w / k));
  const bh = Math.max(8, Math.round(f.h / k));
  if (!blurCanvas) blurCanvas = document.createElement("canvas");
  blurCanvas.width = bw;
  blurCanvas.height = bh;
  const ctx = blurCanvas.getContext("2d")!;
  ctx.save();
  ctx.scale(bw / f.w, bh / f.h);
  paint({ ...f, ctx });
  ctx.restore();
  return blurCanvas;
}

const glass: Template = {
  id: "glass",
  name: "Стеклянная плитка",
  group: "backgrounds",
  about: "Фон для слайдов: цветные пятна или ваша картинка под матовыми плитками. Число плиток, зазор, скругление и сила стекла настраиваются.",
  input: "photos",
  duration: 8,
  loop: true,
  ownBackground: true,
  shuffle: true,
  controls: [
    { key: "base", label: "Цвет основы", type: "color" },
    { key: "cols", label: "Плиток по горизонтали", type: "range", min: 1, max: 8, step: 1 },
    { key: "rows", label: "Плиток по вертикали", type: "range", min: 1, max: 6, step: 1 },
    { key: "gap", label: "Зазор", type: "range", min: 0, max: 80, step: 1 },
    { key: "margin", label: "Отступ от края", type: "range", min: 0, max: 200, step: 1 },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 80, step: 1 },
    { key: "blur", label: "Сила стекла", type: "range", min: 6, max: 60, step: 1 },
    { key: "frost", label: "Белизна", type: "range", min: 0, max: 60, step: 1, unit: "%" },
    { key: "grain", label: "Зерно", type: "range", min: 0, max: 40, step: 1, unit: "%" },
  ],
  defaults: {
    params: { base: "#0b0c14", cols: 3, rows: 2, gap: 24, margin: 60, radius: 32, blur: 24, frost: 10, grain: 10, seed: 5 },
    palette: PRESETS[0][2],
  },
  draw(f) {
    const { ctx, w, h, s } = f;
    const img = f.images[0];
    const paint = (g: Frame) => {
      if (img) {
        g.ctx.fillStyle = "#000";
        g.ctx.fillRect(0, 0, g.w, g.h);
        drawCover(g.ctx, img as HTMLImageElement, 0, 0, g.w, g.h);
      } else meshBackground(g, Number(f.p.seed ?? 1), 5, 1, 1);
    };
    paint(f);
    const soft = blurred(f, paint, Number(f.p.blur ?? 24));
    const cols = Number(f.p.cols ?? 3);
    const rows = Number(f.p.rows ?? 2);
    const gap = Number(f.p.gap ?? 24) * s;
    const m = Number(f.p.margin ?? 60) * s;
    const tw = (w - m * 2 - gap * (cols - 1)) / cols;
    const th = (h - m * 2 - gap * (rows - 1)) / rows;
    const rad = Number(f.p.radius ?? 32) * s;
    const frost = Number(f.p.frost ?? 10) / 100;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = m + c * (tw + gap);
        const y = m + r * (th + gap);
        ctx.save();
        roundRect(ctx, x, y, tw, th, rad);
        ctx.clip();
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(soft, 0, 0, soft.width, soft.height, 0, 0, w, h);
        ctx.fillStyle = `rgba(255,255,255,${frost})`;
        ctx.fillRect(x, y, tw, th);
        const g = ctx.createLinearGradient(x, y, x + tw, y + th);
        g.addColorStop(0, "rgba(255,255,255,0.22)");
        g.addColorStop(0.5, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, tw, th);
        ctx.restore();
        roundRect(ctx, x + 0.5, y + 0.5, tw - 1, th - 1, rad);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = Math.max(1, 1.5 * s);
        ctx.stroke();
      }
    grain(f, Number(f.p.grain ?? 0) / 100);
  },
};

const cover: Template = {
  id: "cover",
  name: "Обложка",
  group: "backgrounds",
  about: "Обложка презентации: свечение, расходящиеся кольца и заголовок. Без текста — фон для титульного слайда.",
  input: "none",
  duration: 8,
  loop: true,
  ownBackground: true,
  controls: [
    { key: "title", label: "Заголовок", type: "text" },
    { key: "subtitle", label: "Подзаголовок", type: "text" },
    { key: "base", label: "Цвет основы", type: "color" },
    { key: "place", label: "Центр колец", type: "select", options: [["right", "Справа"], ["center", "По центру"], ["left", "Слева"]] },
    { key: "rings", label: "Колец", type: "range", min: 3, max: 20, step: 1 },
    { key: "grain", label: "Зерно", type: "range", min: 0, max: 40, step: 1, unit: "%" },
  ],
  defaults: { params: { title: "Итоги года", subtitle: "Стратегическая сессия · 2026", base: "#07080d", place: "right", rings: 9, grain: 10 }, palette: ["#6d5dfc", "#ff4fa3", "#00c2ff"] },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    ctx.fillStyle = String(f.p.base ?? "#07080d");
    ctx.fillRect(0, 0, w, h);
    const place = String(f.p.place ?? "right");
    const cx = place === "left" ? w * 0.22 : place === "center" ? w / 2 : w * 0.78;
    const cy = h * 0.55;
    const ph = t / dur;
    blob(ctx, cx, cy, Math.max(w, h) * 0.55, pc(f, 0), 0.75);
    blob(ctx, cx + Math.cos(ph * TAU) * w * 0.08, cy + Math.sin(ph * TAU) * h * 0.08, Math.max(w, h) * 0.35, pc(f, 1), 0.6);
    blob(ctx, cx - Math.cos(ph * TAU) * w * 0.1, cy - Math.sin(ph * TAU) * h * 0.06, Math.max(w, h) * 0.28, pc(f, 2), 0.5);
    const n = Number(f.p.rings ?? 9);
    const maxR = Math.hypot(w, h) * 0.6;
    const step = maxR / n;
    for (let i = 0; i < n; i++) {
      const r = ((i + ph) % n) * step + 30 * s;
      const a = (1 - r / maxR) * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.stroke();
    }
    const title = String(f.p.title ?? "").trim();
    const sub = String(f.p.subtitle ?? "").trim();
    const k = easeOut(prog(t, 0.2, 1));
    const textX = place === "left" ? w * 0.48 : place === "center" ? w / 2 : w * 0.08;
    ctx.textAlign = place === "center" ? "center" : "left";
    ctx.globalAlpha = k;
    const maxW = place === "center" ? w * 0.8 : w * 0.46;
    if (title) {
      ctx.font = font(110 * s, 800);
      const lines = wrap(ctx, title, maxW).slice(0, 3);
      const px = fitFont(ctx, lines.reduce((a, b) => (a.length > b.length ? a : b)), maxW, 110 * s, 800);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "alphabetic";
      let y = h / 2 - (lines.length * px * 1.05) / 2 + px * 0.8 + (1 - k) * 30 * s;
      for (const l of lines) {
        ctx.fillText(l, textX, y);
        y += px * 1.05;
      }
      if (sub) {
        fitFont(ctx, sub, maxW, 36 * s, 500);
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.fillText(sub, textX, y + 20 * s);
      }
    }
    ctx.globalAlpha = 1;
    grain(f, Number(f.p.grain ?? 0) / 100);
  },
};

const spiral: Template = {
  id: "spiral",
  name: "Спираль",
  group: "backgrounds",
  about: "Цветные кольца закручиваются в спираль и медленно вращаются — выберите удачный момент для картинки или сохраните петлю видео.",
  input: "none",
  duration: 10,
  loop: true,
  ownBackground: true,
  controls: [
    { key: "base", label: "Цвет основы", type: "color" },
    { key: "count", label: "Колец", type: "range", min: 8, max: 80, step: 1 },
    { key: "twist", label: "Закрутка", type: "range", min: 2, max: 40, step: 1 },
    { key: "width", label: "Толщина", type: "range", min: 2, max: 40, step: 1 },
    { key: "arc", label: "Длина дуги", type: "range", min: 10, max: 100, step: 1, unit: "%" },
    { key: "grain", label: "Зерно", type: "range", min: 0, max: 40, step: 1, unit: "%" },
  ],
  defaults: { params: { base: "#090a10", count: 36, twist: 12, width: 14, arc: 62, grain: 8 }, palette: ["#ff4fa3", "#ffb703", "#06d6a0", "#00c2ff", "#6d5dfc"] },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    ctx.fillStyle = String(f.p.base ?? "#090a10");
    ctx.fillRect(0, 0, w, h);
    const n = Number(f.p.count ?? 36);
    const twist = (Number(f.p.twist ?? 12) / 100) * TAU;
    const R = Math.hypot(w, h) * 0.55;
    const lw = Number(f.p.width ?? 14) * s;
    const arc = (Number(f.p.arc ?? 62) / 100) * TAU;
    const rot = (t / dur) * TAU;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const r = 20 * s + k * R;
      const a0 = rot * (1 - k * 0.5) + i * twist;
      const color = f.pal.length > 1 ? (() => {
        const x = k * (f.pal.length - 1);
        const j = Math.min(f.pal.length - 2, Math.floor(x));
        return mix(f.pal[j], f.pal[j + 1], x - j);
      })() : f.pal[0];
      ctx.strokeStyle = color;
      ctx.lineWidth = lw * (0.5 + k);
      ctx.globalAlpha = 0.35 + 0.65 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, a0, a0 + arc);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    grain(f, Number(f.p.grain ?? 0) / 100);
  },
};

// ── Раскладки и карточки ──

function gradientCard(f: Frame, x: number, y: number, w: number, h: number, i: number) {
  const { ctx } = f;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, pc(f, i));
  g.addColorStop(1, pc(f, i + 1));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

const bento: Template = {
  id: "bento",
  name: "Бенто-сетка",
  group: "cards",
  about: "Макет из больших и малых плиток — светлых, тёмных и цветных — с вашими фразами. «Перемешать» даёт новую раскладку.",
  input: "phrases",
  duration: 5,
  loop: false,
  shuffle: true,
  controls: [
    { key: "count", label: "Плиток", type: "range", min: 3, max: 9, step: 1 },
    { key: "gap", label: "Зазор", type: "range", min: 4, max: 60, step: 1 },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 60, step: 1 },
    { key: "mode", label: "Плитки", type: "select", options: [["mixed", "Светлые, тёмные и цветные"], ["light", "Только светлые"], ["dark", "Только тёмные"], ["color", "Только цветные"]] },
  ],
  defaults: {
    params: { count: 6, gap: 20, radius: 28, mode: "mixed", seed: 11 },
    phrases: ["12,4 млн ₽|выручка", "+18 %|к прошлому году", "1 240|новых клиентов", "4,1 %|отток", "92 %|довольных", "24/7|поддержка", "3 региона|в работе", "×2|скорость", "0|жалоб"],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const r = rng(Number(f.p.seed ?? 1));
    const gap = Number(f.p.gap ?? 20) * s;
    const n = Number(f.p.count ?? 6);
    let tiles = [{ x: gap, y: gap, w: w - gap * 2, h: h - gap * 2 }];
    while (tiles.length < n) {
      tiles.sort((a, b) => b.w * b.h - a.w * a.h);
      const big = tiles.shift()!;
      const k = 0.38 + r() * 0.24;
      if (big.w / w > big.h / h) {
        const cw = big.w * k - gap / 2;
        tiles.push({ ...big, w: cw }, { ...big, x: big.x + cw + gap, w: big.w - cw - gap });
      } else {
        const ch = big.h * k - gap / 2;
        tiles.push({ ...big, h: ch }, { ...big, y: big.y + ch + gap, h: big.h - ch - gap });
      }
    }
    tiles = tiles.sort((a, b) => a.y - b.y || a.x - b.x);
    const mode = String(f.p.mode ?? "mixed");
    const rad = Number(f.p.radius ?? 28) * s;
    tiles.forEach((tile, i) => {
      const k = easeBack(prog(t, 0.1 + i * 0.1, 0.7));
      if (k <= 0) return;
      const kind = mode === "mixed" ? ["light", "dark", "color"][Math.floor(r() * 3)] : mode;
      ctx.save();
      ctx.globalAlpha = clamp(k);
      const cx = tile.x + tile.w / 2;
      const cy = tile.y + tile.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
      ctx.translate(-cx, -cy);
      roundRect(ctx, tile.x, tile.y, tile.w, tile.h, rad);
      ctx.save();
      ctx.clip();
      if (kind === "color") gradientCard(f, tile.x, tile.y, tile.w, tile.h, i);
      else {
        ctx.fillStyle = kind === "dark" ? "#15171e" : f.dark ? "#f3f4f7" : "#ffffff";
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        if (kind === "light" && !f.dark) {
          ctx.strokeStyle = "rgba(0,0,0,0.08)";
          ctx.lineWidth = 2 * s;
          ctx.strokeRect(tile.x, tile.y, tile.w, tile.h);
        }
      }
      ctx.restore();
      const bg = kind === "color" ? pc(f, i) : kind === "dark" ? "#15171e" : "#ffffff";
      const ink = isDark(bg) || kind === "color" ? "#ffffff" : "#15171c";
      const text = f.phrases[i] ?? "";
      const [main, sub = ""] = text.split("|").map((x) => x.trim());
      const p = Math.min(tile.w, tile.h) * 0.12;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if (main) {
        const px = fitFont(ctx, main, tile.w - p * 2, Math.min(tile.h * 0.32, 120 * s), 800);
        ctx.fillStyle = ink;
        ctx.fillText(main, tile.x + p, tile.y + tile.h - p - (sub ? px * 0.6 : 0));
      }
      if (sub) {
        fitFont(ctx, sub, tile.w - p * 2, Math.min(tile.h * 0.13, 34 * s), 500);
        ctx.fillStyle = rgba(ink === "#ffffff" ? "#ffffff" : "#15171c", 0.7);
        ctx.fillText(sub, tile.x + p, tile.y + tile.h - p * 0.9 + 4 * s);
      }
      ctx.restore();
    });
  },
};

/** Фото или цветная карточка с подписью */
function photoOrCard(f: Frame, i: number, x: number, y: number, w: number, h: number, rad: number, text?: string) {
  const { ctx, s } = f;
  ctx.save();
  roundRect(ctx, x, y, w, h, rad);
  ctx.clip();
  const img = pickImage(f, i);
  if (img) drawCover(ctx, img as HTMLImageElement, x, y, w, h);
  else gradientCard(f, x, y, w, h, i);
  if (text) {
    const [main, sub = ""] = text.split("|").map((v) => v.trim());
    if (img) {
      const g = ctx.createLinearGradient(0, y + h * 0.45, 0, y + h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    const p = w * 0.09;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(Math.min(w * 0.11, 64 * s), 800);
    const lines = wrap(ctx, main, w - p * 2).slice(0, 3);
    let yy = y + h - p - (sub ? w * 0.07 : 0) - (lines.length - 1) * w * 0.12;
    for (const l of lines) {
      ctx.fillText(l, x + p, yy);
      yy += w * 0.12;
    }
    if (sub) {
      fitFont(ctx, sub, w - p * 2, Math.min(w * 0.055, 30 * s), 500);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(sub, x + p, y + h - p * 0.8);
    }
  }
  ctx.restore();
}

const people: Template = {
  id: "people",
  name: "Карточки команды",
  group: "cards",
  about: "Карточки людей по вашим фото: имя и должность на белой подложке или на стекле, до пяти в ряд. Фото не покидают браузер.",
  input: "people",
  duration: 4,
  loop: false,
  controls: [
    { key: "style", label: "Подпись", type: "select", options: [["white", "Белая подложка"], ["glass", "Стекло поверх фото"]] },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 60, step: 1 },
    { key: "gap", label: "Промежуток", type: "range", min: 8, max: 80, step: 1 },
  ],
  defaults: {
    params: { style: "white", radius: 28, gap: 32 },
    rows: [
      { label: "Анна Смирнова", value: 0, note: "Руководитель проекта" },
      { label: "Илья Козлов", value: 0, note: "Аналитик" },
      { label: "Мария Орлова", value: 0, note: "Дизайнер" },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = Math.min(5, Math.max(1, rows.length));
    const gap = Number(f.p.gap ?? 32) * s;
    const m = 80 * s;
    let cw = (w - m * 2 - gap * (n - 1)) / n;
    let ch = cw * 1.35;
    if (ch > h - m * 2) {
      ch = h - m * 2;
      cw = ch / 1.35;
    }
    const x0 = (w - (cw * n + gap * (n - 1))) / 2;
    const y0 = (h - ch) / 2;
    const rad = Number(f.p.radius ?? 28) * s;
    const glassStyle = f.p.style === "glass";
    for (let i = 0; i < n; i++) {
      const k = easeOut(prog(t, 0.15 + i * 0.12, 0.8));
      if (k <= 0) continue;
      const x = x0 + i * (cw + gap);
      const y = y0 + (1 - k) * 60 * s;
      ctx.globalAlpha = k;
      const panelH = ch * 0.24;
      const photoH = glassStyle ? ch : ch - panelH;
      ctx.save();
      roundRect(ctx, x, y, cw, ch, rad);
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 30 * s;
      ctx.shadowOffsetY = 10 * s;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, cw, ch, rad);
      ctx.clip();
      const img = f.images[i];
      if (img) drawCover(ctx, img as HTMLImageElement, x, y, cw, photoH);
      else {
        gradientCard(f, x, y, cw, photoH, i);
        const initials = rows[i].label.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = font(cw * 0.26, 800);
        ctx.fillText(initials, x + cw / 2, y + photoH / 2);
      }
      const py = glassStyle ? y + ch - panelH - 14 * s : y + photoH;
      if (glassStyle) {
        roundRect(ctx, x + 14 * s, py, cw - 28 * s, panelH, rad * 0.7);
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
      }
      const ink = glassStyle ? "#ffffff" : "#15171c";
      const tx = x + (glassStyle ? 34 : 24) * s;
      const tw = cw - (glassStyle ? 68 : 48) * s;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const name = rows[i].label;
      const role = rows[i].note ?? "";
      const npx = fitFont(ctx, name, tw, Math.min(cw * 0.1, 40 * s), 700);
      ctx.fillStyle = ink;
      ctx.fillText(name, tx, py + panelH * 0.45 + npx * 0.3);
      if (role) {
        fitFont(ctx, role, tw, Math.min(cw * 0.065, 26 * s), 500);
        ctx.fillStyle = glassStyle ? "rgba(255,255,255,0.85)" : "rgba(21,23,28,0.6)";
        ctx.fillText(role, tx, py + panelH * 0.78);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  },
};

const carousel: Template = {
  id: "carousel",
  name: "Карусель",
  group: "cards",
  about: "Фото с подписями и цветные карточки с фразами стоят по кругу и поворачиваются шагами: пауза — плавный переезд. Видео — бесшовная петля.",
  input: "photos",
  duration: 12,
  loop: true,
  controls: [
    { key: "captions", label: "Подписи поверх фото", type: "toggle" },
    { key: "visible", label: "Ширина кольца", type: "range", min: 30, max: 100, step: 1, unit: "%" },
    { key: "card", label: "Размер карточки", type: "range", min: 20, max: 60, step: 1, unit: "%" },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 60, step: 1 },
    { key: "pause", label: "Пауза между шагами", type: "range", min: 0, max: 80, step: 1, unit: "%" },
  ],
  defaults: {
    params: { visible: 78, card: 38, radius: 28, pause: 55, captions: true },
    phrases: ["Команда|наш главный ресурс", "Клиенты|рекомендуют нас", "Качество|в каждой детали", "Скорость|решения за день", "Рост|+18 % за год", "Забота|24/7"],
  },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    const n = Math.max(f.images.length, f.phrases.filter((x) => x.trim()).length, 3);
    const stepT = dur / n;
    const idx = Math.floor(t / stepT);
    const local = (t - idx * stepT) / stepT;
    const pause = Number(f.p.pause ?? 55) / 100;
    const move = easeInOut(clamp((local - pause) / (1 - pause || 1)));
    const off = (idx + move) % n;
    const ch = h * (Number(f.p.card ?? 38) / 100) * 1.7;
    const cw = ch * 0.72;
    const Rx = (w / 2) * (Number(f.p.visible ?? 78) / 100);
    const items = Array.from({ length: n }, (_, i) => {
      const a = ((i - off) / n) * TAU;
      return { i, z: Math.cos(a), x: Math.sin(a) };
    }).sort((a, b) => a.z - b.z);
    for (const it of items) {
      const k = (it.z + 1) / 2;
      const sc = lerp(0.5, 1, k);
      const x = w / 2 + it.x * Rx - (cw * sc) / 2;
      const y = h / 2 - (ch * sc) / 2 + (1 - k) * 20 * s;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 40 * s * k;
      ctx.shadowOffsetY = 14 * s * k;
      roundRect(ctx, x, y, cw * sc, ch * sc, Number(f.p.radius ?? 28) * s * sc);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
      photoOrCard(f, it.i, x, y, cw * sc, ch * sc, Number(f.p.radius ?? 28) * s * sc, captionOf(f, it.i, f.p.captions !== false));
      if (k < 0.98) {
        roundRect(ctx, x, y, cw * sc, ch * sc, Number(f.p.radius ?? 28) * s * sc);
        ctx.fillStyle = `rgba(0,0,0,${(1 - k) * 0.45})`;
        ctx.fill();
      }
    }
  },
};

const deck: Template = {
  id: "deck",
  name: "Колода",
  group: "cards",
  about: "Карточки лежат колодой: верхняя отлетает в сторону и уходит под низ, открывая следующую. Фото с подписями или цветные карточки с фразами.",
  input: "photos",
  duration: 10,
  loop: true,
  controls: [
    { key: "captions", label: "Подписи поверх фото", type: "toggle" },
    { key: "frame", label: "Белая рамка, как у снимка", type: "toggle" },
    { key: "card", label: "Размер карточки", type: "range", min: 30, max: 80, step: 1, unit: "%" },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 60, step: 1 },
    { key: "tilt", label: "Разброс углов", type: "range", min: 0, max: 20, step: 1 },
  ],
  defaults: {
    params: { frame: true, card: 62, radius: 18, tilt: 6, captions: true },
    phrases: ["Идея|с чего всё началось", "Команда|кто это делает", "Результат|что получилось", "Дальше|куда идём", "Спасибо|вопросы?"],
  },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    const n = Math.max(f.images.length, f.phrases.filter((x) => x.trim()).length, 2);
    const stepT = dur / n;
    const idx = Math.floor(t / stepT) % n;
    const local = (t % stepT) / stepT;
    const fly = easeInOut(clamp((local - 0.55) / 0.45));
    const ch = h * (Number(f.p.card ?? 62) / 100);
    const cw = ch * 0.8;
    const r = rng(9);
    const tilts = Array.from({ length: n }, () => (r() - 0.5) * 2 * Number(f.p.tilt ?? 6) * (Math.PI / 180));
    const frame = !!f.p.frame;
    const rad = Number(f.p.radius ?? 18) * s;
    const drawCard = (i: number, depth: number, dx: number, rot: number) => {
      ctx.save();
      ctx.translate(w / 2 + dx, h / 2 + depth * 10 * s);
      ctx.rotate(tilts[i] + rot);
      const fw = frame ? cw * 0.06 : 0;
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 30 * s;
      ctx.shadowOffsetY = 10 * s;
      roundRect(ctx, -cw / 2, -ch / 2, cw, ch, rad);
      ctx.fillStyle = frame ? "#ffffff" : "#000";
      ctx.fill();
      ctx.shadowColor = "transparent";
      photoOrCard(f, i, -cw / 2 + fw, -ch / 2 + fw, cw - fw * 2, ch - fw * (frame ? 3.2 : 2), Math.max(0, rad - fw), captionOf(f, i, f.p.captions !== false));
      ctx.restore();
    };
    const dx = Math.sin(fly * Math.PI) * w * 0.42;
    const rot = fly * 0.35;
    // Вторая половина полёта — карточка уже за колодой: рисуем её первой
    const back = fly > 0.5;
    if (back) drawCard(idx, Math.min(n - 1, 4) + 1, dx, rot);
    for (let d = Math.min(n - 1, 4); d >= 1; d--) drawCard((idx + d) % n, d, 0, 0);
    if (!back) drawCard(idx, 0, dx, rot);
  },
};

export const SCENES: Template[] = [phrases, gradientBg, glass, cover, spiral, bento, people, carousel, deck];
