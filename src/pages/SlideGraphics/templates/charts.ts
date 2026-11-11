// Шаблоны графиков: столбцы, полосы, план/факт, линия, карточка-показатель,
// кольцо, процент, полярная роза, воронка, большое число.

import {
  badge,
  blob,
  clamp,
  easeInOut,
  easeOut,
  fitFont,
  fmt,
  fmtUnit,
  font,
  header,
  isDark,
  lerp,
  mix,
  pc,
  prog,
  ramp,
  rgba,
  roundRect,
  smoothPath,
} from "../core/draw";
import { drawHeat, HEAT_THEMES } from "../core/heat";
import type { Control, Frame, Row, Template } from "../core/types";

const TITLE: Control[] = [
  { key: "title", label: "Заголовок", type: "text" },
  { key: "subtitle", label: "Подзаголовок", type: "text" },
];
const NUMBERS: Control[] = [
  { key: "prefix", label: "Перед числом", type: "text", placeholder: "+, $" },
  { key: "unit", label: "Единица", type: "text", placeholder: "%, ₽, млн" },
  { key: "decimals", label: "Знаков после запятой", type: "number", min: 0, max: 3, step: 1 },
];

const MONTHS: Row[] = [
  { label: "Янв", value: 3.2 },
  { label: "Фев", value: 3.6 },
  { label: "Мар", value: 4.1 },
  { label: "Апр", value: 3.9 },
  { label: "Май", value: 4.8 },
  { label: "Июн", value: 5.6 },
];

const muteOf = (f: Frame) => (f.dark ? "#3a3f4d" : "#d5d8e0");
const gridOf = (f: Frame) => (f.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)");

/** Цвет столбца: один цвет, палитра или выделенный столбец */
function barColor(f: Frame, i: number) {
  const hl = Number(f.p.highlight ?? 0);
  if (hl > 0) return i === hl - 1 ? pc(f, 0) : muteOf(f);
  return f.p.colors === "palette" ? pc(f, i) : pc(f, 0);
}

/** Подпись под столбцом с подгонкой по ширине */
function label(f: Frame, text: string, x: number, y: number, maxW: number, px: number, align: CanvasTextAlign = "center") {
  const { ctx } = f;
  fitFont(ctx, text, maxW, px, 500);
  ctx.fillStyle = f.muted;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function fillBar(f: Frame, x: number, y: number, w: number, h: number, color: string, horizontal = false) {
  const { ctx, s } = f;
  if (f.p.glow) {
    ctx.save();
    ctx.shadowColor = rgba(color, 0.65);
    ctx.shadowBlur = 36 * s;
    fillBarBody(f, x, y, w, h, color, horizontal);
    ctx.restore();
    return;
  }
  fillBarBody(f, x, y, w, h, color, horizontal);
}

function fillBarBody(f: Frame, x: number, y: number, w: number, h: number, color: string, horizontal: boolean) {
  const { ctx, s } = f;
  const style = String(f.p.style ?? "solid");
  const r = Number(f.p.radius ?? 12) * s;
  const radii = horizontal ? [0, r, r, 0] : [r, r, 0, 0];
  roundRect(ctx, x, y, w, h, radii);
  if (style === "fade") {
    const g = horizontal ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, rgba(color, 1));
    g.addColorStop(1, rgba(color, 0.12));
    ctx.fillStyle = g;
    ctx.fill();
  } else if (style === "cap") {
    // Светлое тело и плотная «крышка»
    const g = horizontal ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, rgba(color, 0.08));
    g.addColorStop(1, rgba(color, 0.4));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = color;
    const cap = Math.max(4 * s, Math.min(10 * s, (horizontal ? w : h) * 0.5));
    if (horizontal) {
      roundRect(ctx, x + w - cap, y, cap, h, [0, r, r, 0]);
    } else roundRect(ctx, x, y, w, cap, [r, r, 0, 0]);
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

const BAR_STYLE: Control = {
  key: "style",
  label: "Вид столбцов",
  type: "select",
  options: [
    ["solid", "Заливка"],
    ["fade", "Растворение к вершине"],
    ["cap", "Светлые с крышкой"],
  ],
};
const GLOW: Control = { key: "glow", label: "Свечение", type: "toggle" };
const COLORS: Control = {
  key: "colors",
  label: "Цвета",
  type: "select",
  options: [
    ["one", "Один цвет"],
    ["palette", "По палитре"],
  ],
};

// ── Столбцы ──

const bars: Template = {
  id: "bars",
  name: "Столбцы",
  group: "charts",
  about: "Столбцы вырастают по очереди, значения досчитывают до своих чисел. Можно выделить один столбец.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    BAR_STYLE,
    COLORS,
    GLOW,
    { key: "highlight", label: "Выделить столбец №", type: "number", min: 0, max: 50, step: 1 },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 40, step: 1 },
    { key: "gap", label: "Промежуток", type: "range", min: 5, max: 70, step: 1, unit: "%" },
    { key: "values", label: "Подписывать значения", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "dark", color: "#0e1016" },
    params: { title: "Выручка по месяцам", subtitle: "млн ₽", style: "fade", colors: "one", glow: true, highlight: 0, radius: 14, gap: 32, values: true, unit: "", decimals: 1 },
    rows: MONTHS,
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2) + 40 * s;
    const n = rows.length;
    if (!n) return;
    const vals = rows.map((r) => r.value || 0);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals) || 1;
    const x0 = pad;
    const x1 = w - pad;
    const y1 = h - pad * 0.8 - 44 * s;
    const yOf = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - top);
    const base = yOf(0);
    const slot = (x1 - x0) / n;
    const bw = slot * (1 - Number(f.p.gap ?? 30) / 100);
    for (let i = 0; i < n; i++) {
      const k = easeOut(prog(t, 0.25 + i * 0.09, 1));
      const v = vals[i] * k;
      const x = x0 + slot * i + (slot - bw) / 2;
      const y = yOf(v);
      const color = barColor(f, i);
      if (v >= 0) fillBar(f, x, y, bw, base - y, color);
      else {
        ctx.save();
        ctx.translate(0, base * 2);
        ctx.scale(1, -1);
        fillBar(f, x, base * 2 - y, bw, y - base, color);
        ctx.restore();
      }
      if (f.p.values !== false && k > 0.02) {
        ctx.globalAlpha = clamp(k * 1.5);
        fitFont(ctx, fmtUnit(v, f), slot * 0.96, 32 * s, 700);
        ctx.fillStyle = Number(f.p.highlight) > 0 && Number(f.p.highlight) - 1 !== i ? f.muted : f.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = v >= 0 ? "bottom" : "top";
        ctx.fillText(fmtUnit(v, f), x + bw / 2, v >= 0 ? y - 12 * s : y + 12 * s);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = clamp(prog(t, 0.1 + i * 0.05, 0.5));
      label(f, rows[i].label, x + bw / 2, y1 + 16 * s, slot * 0.98, 26 * s);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = gridOf(f);
    ctx.fillRect(x0, base, (x1 - x0) * easeOut(prog(t, 0, 0.6)), Math.max(1, 2 * s));
  },
};

// ── Горизонтальные полосы ──

const hbars: Template = {
  id: "hbars",
  name: "Полосы",
  group: "charts",
  about: "Горизонтальные полосы с подписями слева и числами на концах — удобно вместо круговой для долей и рейтингов.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    BAR_STYLE,
    COLORS,
    GLOW,
    { key: "highlight", label: "Выделить полосу №", type: "number", min: 0, max: 50, step: 1 },
    { key: "sort", label: "Сортировать по убыванию", type: "toggle" },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 40, step: 1 },
    { key: "gap", label: "Промежуток", type: "range", min: 5, max: 70, step: 1, unit: "%" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    params: { title: "Каналы привлечения", subtitle: "доля новых клиентов", style: "solid", colors: "one", highlight: 1, sort: true, radius: 10, gap: 38, unit: "%", decimals: 0 },
    rows: [
      { label: "Рекомендации", value: 34 },
      { label: "Поиск", value: 27 },
      { label: "Соцсети", value: 18 },
      { label: "Партнёры", value: 13 },
      { label: "Реклама", value: 8 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const rows = f.p.sort ? [...f.rows].sort((a, b) => b.value - a.value) : f.rows;
    const n = rows.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const y1 = h - pad * 0.8;
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    ctx.font = font(28 * s, 500);
    const labW = Math.min(w * 0.3, Math.max(...rows.map((r) => ctx.measureText(r.label).width)) + 24 * s);
    ctx.font = font(30 * s, 700);
    const valW = Math.max(...rows.map((r) => ctx.measureText(fmtUnit(r.value, f)).width)) + 24 * s;
    const x0 = pad + labW;
    const x1 = w - pad - valW;
    const slot = (y1 - top) / n;
    const bh = Math.min(slot * (1 - Number(f.p.gap ?? 35) / 100), 120 * s);
    rows.forEach((r, i) => {
      const k = easeOut(prog(t, 0.25 + i * 0.1, 1));
      const y = top + slot * i + (slot - bh) / 2;
      const bw = Math.max(0, (r.value / max) * (x1 - x0) * k);
      ctx.globalAlpha = clamp(prog(t, 0.1 + i * 0.06, 0.5));
      fitFont(ctx, r.label, labW - 20 * s, 28 * s, 500);
      ctx.fillStyle = f.ink;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, x0 - 20 * s, y + bh / 2);
      ctx.globalAlpha = 1;
      // Подложка-дорожка
      roundRect(ctx, x0, y, x1 - x0, bh, Number(f.p.radius ?? 10) * s);
      ctx.fillStyle = f.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      ctx.fill();
      fillBar(f, x0, y, bw, bh, barColor(f, i), true);
      ctx.globalAlpha = clamp(k * 1.5);
      ctx.font = font(30 * s, 700);
      ctx.fillStyle = f.ink;
      ctx.textAlign = "left";
      ctx.fillText(fmtUnit(r.value * k, f), x0 + bw + 14 * s, y + bh / 2);
      ctx.globalAlpha = 1;
    });
  },
};

// ── План и факт ──

const pairs: Template = {
  id: "pairs",
  name: "План и факт",
  group: "charts",
  about: "Два значения на одной позиции: широкий полупрозрачный столбец сзади и яркий узкий спереди.",
  input: "pairs",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "s1", label: "Название ряда 1 (сзади)", type: "text" },
    { key: "s2", label: "Название ряда 2 (спереди)", type: "text" },
    { key: "colorMode", label: "Цвета рядов", type: "select", options: [["palette", "Из палитры"], ["custom", "Свои — ниже"]] },
    { key: "c1", label: "Цвет ряда 1", type: "color" },
    { key: "c2", label: "Цвет ряда 2", type: "color" },
    {
      key: "front",
      label: "Передний столбец",
      type: "select",
      options: [
        ["gradient", "Градиент — светлеет кверху"],
        ["solid", "Сплошной"],
        ["duo", "Два цвета — ряд 2 → ряд 1"],
        ["fade", "Растворяется кверху"],
      ],
    },
    {
      key: "back",
      label: "Задний столбец",
      type: "select",
      options: [
        ["soft", "Полупрозрачный"],
        ["fade", "Растворяется кверху"],
        ["outline", "Пунктирный контур"],
        ["hatch", "Штриховка"],
      ],
    },
    GLOW,
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 40, step: 1 },
    { key: "values", label: "Подписывать значения", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    params: { title: "Продажи по кварталам", subtitle: "млн ₽", s1: "План", s2: "Факт", colorMode: "palette", c1: "#9aa7c7", c2: "#2a78d6", front: "gradient", back: "soft", glow: false, radius: 12, values: true, decimals: 0 },
    rows: [
      { label: "I кв.", value: 120, value2: 112 },
      { label: "II кв.", value: 135, value2: 141 },
      { label: "III кв.", value: 150, value2: 158 },
      { label: "IV кв.", value: 170, value2: 164 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = rows.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2) + 40 * s;
    const x0 = pad;
    const x1 = w - pad;
    const y1 = h - pad * 0.8 - 44 * s;
    const max = Math.max(...rows.flatMap((r) => [r.value, r.value2 ?? 0]), 0) || 1;
    const slot = (x1 - x0) / n;
    const bw = slot * 0.62;
    const fw = bw * 0.55;
    const r = Number(f.p.radius ?? 12) * s;
    const custom = f.p.colorMode === "custom";
    const c1 = custom ? String(f.p.c1 ?? "#9aa7c7") : pc(f, 0);
    const c2 = custom ? String(f.p.c2 ?? "#2a78d6") : pc(f, 1);
    const front = String(f.p.front ?? "gradient");
    const back = String(f.p.back ?? "soft");
    /** Заливка заднего столбца; в легенде — тот же образец */
    const paintBack = (x: number, y: number, bwid: number, bh: number, rr: number | number[]) => {
      roundRect(ctx, x, y, bwid, bh, rr);
      if (back === "outline") {
        ctx.fillStyle = rgba(c1, 0.08);
        ctx.fill();
        ctx.setLineDash([8 * s, 6 * s]);
        ctx.strokeStyle = c1;
        ctx.lineWidth = 2.5 * s;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (back === "hatch") {
        ctx.fillStyle = rgba(c1, 0.12);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = rgba(c1, 0.6);
        ctx.lineWidth = 2.5 * s;
        const step = 12 * s;
        ctx.beginPath();
        for (let d = -bh; d < bwid + bh; d += step) {
          ctx.moveTo(x + d, y + bh);
          ctx.lineTo(x + d + bh, y);
        }
        ctx.stroke();
        ctx.restore();
      } else if (back === "fade") {
        const g = ctx.createLinearGradient(0, y + bh, 0, y);
        g.addColorStop(0, rgba(c1, 0.55));
        g.addColorStop(1, rgba(c1, 0.04));
        ctx.fillStyle = g;
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(c1, 0.3);
        ctx.fill();
      }
    };
    const paintFront = (x: number, y: number, fwid: number, fh: number, rr: number | number[]) => {
      roundRect(ctx, x, y, fwid, fh, rr);
      if (front === "solid") ctx.fillStyle = c2;
      else {
        const g = ctx.createLinearGradient(0, y + fh, 0, y);
        if (front === "duo") {
          g.addColorStop(0, c2);
          g.addColorStop(1, c1);
        } else if (front === "fade") {
          g.addColorStop(0, c2);
          g.addColorStop(1, rgba(c2, 0.15));
        } else {
          g.addColorStop(0, c2);
          g.addColorStop(1, mix(c2, "#ffffff", 0.35));
        }
        ctx.fillStyle = g;
      }
      if (f.p.glow) {
        ctx.save();
        ctx.shadowColor = rgba(c2, 0.6);
        ctx.shadowBlur = 30 * s;
        ctx.fill();
        ctx.restore();
      } else ctx.fill();
    };
    // Легенда
    ctx.font = font(24 * s, 600);
    let lx = x1;
    ctx.textBaseline = "middle";
    for (const [name, isFront] of [
      [String(f.p.s2 ?? ""), true],
      [String(f.p.s1 ?? ""), false],
    ] as [string, boolean][]) {
      if (!name) continue;
      ctx.font = font(24 * s, 600);
      const tw = ctx.measureText(name).width;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = f.ink;
      ctx.fillText(name, lx, pad * 0.8 + 20 * s);
      const sx = lx - tw - 32 * s;
      const sy = pad * 0.8 + 9 * s;
      if (isFront) paintFront(sx, sy, 22 * s, 22 * s, 5 * s);
      else paintBack(sx, sy, 22 * s, 22 * s, 5 * s);
      lx -= tw + 64 * s;
    }
    rows.forEach((row, i) => {
      const k1 = easeOut(prog(t, 0.2 + i * 0.08, 1));
      const k2 = easeOut(prog(t, 0.55 + i * 0.08, 1));
      const cx = x0 + slot * i + slot / 2;
      const h1 = (row.value / max) * (y1 - top) * k1;
      const h2 = ((row.value2 ?? 0) / max) * (y1 - top) * k2;
      if (h1 > 0) paintBack(cx - bw / 2, y1 - h1, bw, h1, [r, r, 0, 0]);
      if (h2 > 0) paintFront(cx - fw / 2, y1 - h2, fw, h2, [r * 0.8, r * 0.8, 0, 0]);
      if (f.p.values !== false) {
        ctx.globalAlpha = clamp(k2 * 1.4);
        ctx.font = font(30 * s, 700);
        ctx.fillStyle = f.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const top2 = Math.min(y1 - h1, y1 - h2);
        ctx.fillText(fmtUnit((row.value2 ?? 0) * k2, f), cx, top2 - 12 * s);
        ctx.globalAlpha = 1;
      }
      label(f, row.label, cx, y1 + 16 * s, slot * 0.98, 26 * s);
    });
  },
};

// ── Линия ──

const line: Template = {
  id: "line",
  name: "Линия",
  group: "charts",
  about: "Плавная линия прорисовывается слева направо, под ней — мягкая заливка. Одну точку можно отметить плашкой.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "smooth", label: "Сглаживать", type: "toggle" },
    { key: "area", label: "Заливка под линией", type: "toggle" },
    { key: "glow", label: "Свечение", type: "toggle" },
    { key: "dots", label: "Точки", type: "toggle" },
    { key: "values", label: "Подписи у всех точек", type: "toggle" },
    { key: "mark", label: "Плашка у точки №", type: "number", min: 0, max: 100, step: 1 },
    { key: "zero", label: "Ось от нуля", type: "toggle" },
    { key: "width", label: "Толщина линии", type: "range", min: 2, max: 16, step: 1 },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "dark", color: "#0e1016" },
    params: { title: "Активные клиенты", subtitle: "тыс. человек", smooth: true, area: true, glow: true, dots: true, values: false, mark: 6, zero: false, width: 6, decimals: 1 },
    rows: MONTHS,
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = rows.length;
    if (n < 2) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2) + 70 * s;
    const x0 = pad + 20 * s;
    const x1 = w - pad - 20 * s;
    const y1 = h - pad * 0.8 - 52 * s;
    const vals = rows.map((r) => r.value || 0);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (f.p.zero) lo = Math.min(0, lo);
    if (hi === lo) hi = lo + 1;
    const span = hi - lo;
    if (!f.p.zero) lo -= span * 0.12;
    const yOf = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - top);
    const pts = vals.map((v, i) => [x0 + ((x1 - x0) * i) / (n - 1), yOf(v)] as [number, number]);
    const color = pc(f, 0);
    const k = easeInOut(prog(t, 0.3, 1.8));
    const reveal = x0 + (x1 - x0) * k;
    // Сетка
    ctx.strokeStyle = gridOf(f);
    ctx.lineWidth = Math.max(1, s);
    for (let i = 0; i <= 3; i++) {
      const y = lerp(top, y1, i / 3);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.globalAlpha = 0.6 * clamp(prog(t, 0, 0.5));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, reveal + 2, h);
    ctx.clip();
    if (f.p.area) {
      ctx.beginPath();
      smoothPath(ctx, pts, !!f.p.smooth);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, y1);
      g.addColorStop(0, rgba(color, 0.35));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.beginPath();
    smoothPath(ctx, pts, !!f.p.smooth);
    ctx.strokeStyle = color;
    ctx.lineWidth = Number(f.p.width ?? 6) * s;
    ctx.lineJoin = ctx.lineCap = "round";
    if (f.p.glow) {
      ctx.shadowColor = rgba(color, 0.7);
      ctx.shadowBlur = 28 * s;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
    // Сияние у кончика линии
    if (f.p.glow && k > 0 && k < 1) {
      let tipY = pts[0][1];
      for (let i = 0; i < n - 1; i++)
        if (reveal >= pts[i][0] && reveal <= pts[i + 1][0]) tipY = lerp(pts[i][1], pts[i + 1][1], (reveal - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1));
      blob(ctx, reveal, tipY, 60 * s, color, 0.8);
    }
    const mark = Number(f.p.mark ?? 0) - 1;
    pts.forEach(([x, y], i) => {
      const a = clamp((reveal - x) / (40 * s) + 1);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      if (f.p.dots || i === mark) {
        ctx.beginPath();
        ctx.arc(x, y, (i === mark ? 11 : 8) * s, 0, Math.PI * 2);
        ctx.fillStyle = f.base ?? (f.dark ? "#111" : "#fff");
        ctx.fill();
        ctx.lineWidth = 4 * s;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      if (f.p.values && i !== mark) {
        ctx.font = font(24 * s, 700);
        ctx.fillStyle = f.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(fmtUnit(vals[i], f), x, y - 18 * s);
      }
      label(f, rows[i].label, x, y1 + 22 * s, ((x1 - x0) / (n - 1)) * 0.95, 24 * s);
      ctx.globalAlpha = 1;
    });
    if (mark >= 0 && mark < n) {
      const [x, y] = pts[mark];
      const a = easeOut(prog(t, 0.3 + 1.8 * ((x - x0) / (x1 - x0)) + 0.2, 0.5));
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.setLineDash([6 * s, 8 * s]);
        ctx.strokeStyle = rgba(color, 0.6);
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(x, y + 14 * s);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        badge(f, fmtUnit(vals[mark], f), x, y - 22 * s - (1 - a) * 10 * s, color, 30 * s);
        ctx.globalAlpha = 1;
      }
    }
  },
};

// ── Карточка-показатель ──

const kpi: Template = {
  id: "kpi",
  name: "Карточка-показатель",
  group: "charts",
  about: "Крупное число с изменением к прошлому периоду и мини-графиком внизу карточки.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "value", label: "Главное число", type: "number", step: 0.1 },
    { key: "delta", label: "Изменение", type: "text", placeholder: "+18 % к прошлому году" },
    { key: "card", label: "Карточка", type: "select", options: [["auto", "По фону"], ["light", "Светлая"], ["dark", "Тёмная"], ["accent", "Цветная"]] },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "light", color: "#0e1016" },
    params: { title: "Выручка за квартал", subtitle: "", value: 12.4, delta: "+18 % к прошлому году", card: "auto", unit: "млн ₽", decimals: 1 },
    rows: MONTHS,
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const m = 70 * s;
    const kIn = easeOut(prog(t, 0, 0.7));
    const cw = w - m * 2;
    const ch = h - m * 2;
    const cardKind = String(f.p.card ?? "auto");
    const accent = pc(f, 0);
    const bg = cardKind === "dark" ? "#151821" : cardKind === "light" ? "#ffffff" : cardKind === "accent" ? accent : f.dark ? "#1b1e28" : "#ffffff";
    const dark = isDark(bg);
    const ink = dark ? "#ffffff" : "#15171c";
    const muted = dark ? "rgba(255,255,255,0.66)" : "rgba(20,22,28,0.6)";
    ctx.save();
    ctx.globalAlpha = kIn;
    ctx.translate(0, (1 - kIn) * 30 * s);
    roundRect(ctx, m, m, cw, ch, 44 * s);
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 50 * s;
    ctx.shadowOffsetY = 16 * s;
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (cardKind === "accent") {
      const g = ctx.createLinearGradient(m, m, m + cw, m + ch);
      g.addColorStop(0, rgba(pc(f, 1), 0.65));
      g.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
    const px = m + 64 * s;
    let y = m + 70 * s;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const title = String(f.p.title ?? "");
    if (title) {
      const sz = fitFont(ctx, title, cw - 128 * s, 40 * s, 600);
      ctx.fillStyle = muted;
      ctx.fillText(title, px, y + sz * 0.8);
      y += sz * 1.4;
    }
    const v = Number(f.p.value ?? 0) * easeOut(prog(t, 0.2, 1.6));
    const big = fitFont(ctx, fmtUnit(Number(f.p.value ?? 0), f), cw - 128 * s, Math.min(200 * s, ch * 0.3), 800);
    ctx.font = font(big, 800);
    ctx.fillStyle = ink;
    ctx.fillText(fmtUnit(v, f), px, y + big * 0.9);
    y += big * 1.12;
    const delta = String(f.p.delta ?? "").trim();
    if (delta) {
      const sz = 32 * s;
      ctx.font = font(sz, 700);
      const neg = /^[−-]/.test(delta);
      const dc = cardKind === "accent" ? ink : neg ? "#e5484d" : "#21a038";
      const tw = ctx.measureText(delta).width;
      ctx.globalAlpha = kIn * clamp(prog(t, 0.9, 0.5));
      roundRect(ctx, px, y, tw + 36 * s, sz * 1.7, sz * 0.85);
      ctx.fillStyle = cardKind === "accent" ? "rgba(255,255,255,0.2)" : rgba(dc, 0.13);
      ctx.fill();
      ctx.fillStyle = dc;
      ctx.textBaseline = "middle";
      ctx.fillText(delta, px + 18 * s, y + sz * 0.88);
      ctx.globalAlpha = kIn;
      y += sz * 1.7;
    }
    // Мини-график
    const vals = rows.map((r) => r.value);
    if (vals.length > 1) {
      const gx0 = m;
      const gx1 = m + cw;
      const gy0 = Math.max(y + 40 * s, m + ch * 0.55);
      const gy1 = m + ch - 40 * s;
      const lo = Math.min(...vals);
      const hi = Math.max(...vals) || lo + 1;
      const pts = vals.map((vv, i) => [gx0 + 40 * s + ((gx1 - gx0 - 80 * s) * i) / (vals.length - 1), gy1 - ((vv - lo) / (hi - lo || 1)) * (gy1 - gy0)] as [number, number]);
      const k = easeInOut(prog(t, 0.6, 1.6));
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx0, gy0 - 40 * s, (gx1 - gx0) * k, gy1 - gy0 + 80 * s);
      ctx.clip();
      const lineC = cardKind === "accent" ? "#ffffff" : accent;
      ctx.beginPath();
      smoothPath(ctx, pts, true);
      ctx.lineTo(pts[pts.length - 1][0], m + ch);
      ctx.lineTo(pts[0][0], m + ch);
      const g = ctx.createLinearGradient(0, gy0, 0, m + ch);
      g.addColorStop(0, rgba(lineC, 0.3));
      g.addColorStop(1, rgba(lineC, 0));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      smoothPath(ctx, pts, true);
      ctx.strokeStyle = lineC;
      ctx.lineWidth = 6 * s;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
};

// ── Кольцевая диаграмма ──

const donut: Template = {
  id: "donut",
  name: "Кольцо долей",
  group: "charts",
  about: "Доли кольцом: сектора прорисовываются по кругу, подписи снаружи, итог в центре. Вид — заливка, линии или стекло.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "style", label: "Вид", type: "select", options: [["solid", "Сплошное кольцо"], ["lines", "Толстые линии"], ["glass", "Матовое стекло"]] },
    { key: "show", label: "Подписи", type: "select", options: [["percent", "Проценты"], ["value", "Значения"], ["both", "Значение и %"]] },
    { key: "center", label: "Подпись в центре", type: "text" },
    { key: "thickness", label: "Толщина", type: "range", min: 10, max: 60, step: 1, unit: "%" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    params: { title: "Структура выручки", subtitle: "", style: "solid", show: "percent", center: "млн ₽ всего", thickness: 30, decimals: 0 },
    rows: [
      { label: "Розница", value: 46 },
      { label: "Корпоративные", value: 28 },
      { label: "Онлайн", value: 17 },
      { label: "Партнёры", value: 9 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
    if (!total) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const cx = w / 2;
    const cy = (top + h - pad * 0.6) / 2;
    const R = Math.min((h - pad * 0.6 - top) / 2 - 40 * s, w * 0.2);
    const style = String(f.p.style ?? "solid");
    const thick = R * (Number(f.p.thickness ?? 30) / 100);
    const rIn = R - thick;
    const sweep = Math.PI * 2 * easeInOut(prog(t, 0.2, 1.6));
    const start = -Math.PI / 2;
    const gapA = style === "lines" ? 0.08 : 0.018;
    if (style === "glass") {
      // Цветное пятно за кольцом
      blob(ctx, cx - R * 0.3, cy - R * 0.2, R * 1.1, pc(f, 0), 0.65);
      blob(ctx, cx + R * 0.35, cy + R * 0.3, R, pc(f, 2), 0.55);
    }
    let a0 = start;
    rows.forEach((r, i) => {
      const frac = Math.max(0, r.value) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const visEnd = Math.min(a1, start + sweep);
      const color = pc(f, i);
      if (visEnd > a0 + gapA / 2) {
        const s0 = a0 + gapA / 2;
        const s1 = Math.max(s0, visEnd - gapA / 2);
        ctx.beginPath();
        if (style === "lines") {
          ctx.arc(cx, cy, R - thick / 2, s0 + 0.04, Math.max(s0 + 0.04, s1 - 0.04));
          ctx.lineWidth = thick * 0.82;
          ctx.lineCap = "round";
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          ctx.arc(cx, cy, R, s0, s1);
          ctx.arc(cx, cy, rIn, s1, s0, true);
          ctx.closePath();
          if (style === "glass") {
            ctx.fillStyle = f.dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.45)";
            ctx.fill();
            ctx.fillStyle = rgba(color, 0.45);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.75)";
            ctx.lineWidth = 2 * s;
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.fill();
          }
        }
      }
      // Подпись снаружи
      const mid = (a0 + a1) / 2;
      const la = clamp((start + sweep - mid) / 0.3);
      if (la > 0) {
        ctx.globalAlpha = la;
        const ex = cx + Math.cos(mid) * (R + 26 * s);
        const ey = cy + Math.sin(mid) * (R + 26 * s);
        const right = Math.cos(mid) >= 0;
        const lx = ex + (right ? 50 : -50) * s;
        ctx.strokeStyle = rgba(color, 0.8);
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(mid) * (R + 6 * s), cy + Math.sin(mid) * (R + 6 * s));
        ctx.lineTo(ex, ey);
        ctx.lineTo(lx, ey);
        ctx.stroke();
        const pct = `${fmt((r.value / total) * 100, 0)}\u202f%`;
        const show = String(f.p.show ?? "percent");
        const main = show === "value" ? fmtUnit(r.value, f) : show === "both" ? `${fmtUnit(r.value, f)} · ${pct}` : pct;
        ctx.textAlign = right ? "left" : "right";
        ctx.textBaseline = "alphabetic";
        ctx.font = font(34 * s, 800);
        ctx.fillStyle = f.ink;
        ctx.fillText(main, lx + (right ? 12 : -12) * s, ey + 2 * s);
        ctx.font = font(24 * s, 500);
        ctx.fillStyle = f.muted;
        ctx.fillText(r.label, lx + (right ? 12 : -12) * s, ey + 32 * s);
        ctx.globalAlpha = 1;
      }
      a0 = a1;
    });
    // Центр
    const kc = easeOut(prog(t, 0.5, 1.4));
    ctx.globalAlpha = clamp(kc * 1.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const big = fitFont(ctx, fmtUnit(total, f), rIn * 1.6, rIn * 0.45, 800);
    ctx.fillStyle = f.ink;
    ctx.fillText(fmtUnit(total * kc, f), cx, cy - (f.p.center ? big * 0.22 : 0));
    if (f.p.center) {
      fitFont(ctx, String(f.p.center), rIn * 1.5, 26 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.fillText(String(f.p.center), cx, cy + big * 0.55);
    }
    ctx.globalAlpha = 1;
  },
};

// ── Процент ──

const percent: Template = {
  id: "percent",
  name: "Процент",
  group: "charts",
  about: "Один процент по кругу: штрихи или дуга заполняются до значения, в центре — число и подпись.",
  input: "none",
  duration: 4,
  loop: false,
  controls: [
    { key: "value", label: "Процент", type: "number", min: 0, max: 100, step: 1 },
    { key: "caption", label: "Подпись", type: "text" },
    { key: "style", label: "Вид", type: "select", options: [["ticks", "Штрихи"], ["arc", "Дуга"]] },
    { key: "ticks", label: "Штрихов", type: "range", min: 24, max: 120, step: 1 },
    { key: "decimals", label: "Знаков после запятой", type: "number", min: 0, max: 2, step: 1 },
  ],
  defaults: { params: { value: 72, caption: "клиентов рекомендуют нас", style: "ticks", ticks: 72, decimals: 0 }, background: { kind: "dark", color: "#0e1016" } },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.38;
    const target = clamp(Number(f.p.value ?? 0) / 100);
    const k = easeOut(prog(t, 0.2, 1.8)) * target;
    const c0 = pc(f, 0);
    const c1 = pc(f, 1);
    if (f.p.style === "arc") {
      const lw = R * 0.16;
      ctx.lineCap = "round";
      ctx.lineWidth = lw;
      ctx.strokeStyle = muteOf(f);
      ctx.beginPath();
      ctx.arc(cx, cy, R - lw / 2, 0, Math.PI * 2);
      ctx.stroke();
      if (k > 0.001) {
        const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
        g.addColorStop(0, c0);
        g.addColorStop(Math.max(0.01, k), c1);
        g.addColorStop(1, c1);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R - lw / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.stroke();
      }
    } else {
      const n = Math.round(Number(f.p.ticks ?? 72));
      const lit = k * n;
      ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const on = i < lit;
        const len = on ? R * 0.26 : R * 0.16;
        ctx.strokeStyle = on ? ramp([c0, c1], i / Math.max(1, n * target)) : muteOf(f);
        ctx.lineWidth = Math.max(3 * s, ((Math.PI * 2 * R) / n) * 0.38);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len));
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }
    }
    const d = Number(f.p.decimals ?? 0);
    const text = `${fmt(k * 100, d)}\u202f%`;
    const big = fitFont(ctx, `${fmt(100, d)}\u202f%`, R * 1.15, R * 0.42, 800);
    ctx.font = font(big, 800);
    ctx.fillStyle = f.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cap = String(f.p.caption ?? "");
    ctx.fillText(text, cx, cy - (cap ? big * 0.2 : 0));
    if (cap) {
      ctx.globalAlpha = clamp(prog(t, 0.6, 0.6));
      const lines = (() => {
        ctx.font = font(26 * s, 500);
        const out: string[] = [];
        let cur = "";
        for (const word of cap.split(/\s+/)) {
          const next = cur ? `${cur} ${word}` : word;
          if (ctx.measureText(next).width > R * 1.2 && cur) {
            out.push(cur);
            cur = word;
          } else cur = next;
        }
        if (cur) out.push(cur);
        return out.slice(0, 3);
      })();
      ctx.fillStyle = f.muted;
      lines.forEach((l, i) => ctx.fillText(l, cx, cy + big * 0.5 + i * 32 * s));
      ctx.globalAlpha = 1;
    }
  },
};

// ── Полярная роза ──

const rose: Template = {
  id: "rose",
  name: "Полярная роза",
  group: "charts",
  about: "Длина сектора — значение. Тепловое свечение: мягкое пятно по форме данных, холодное по краю и горячее в сердцевине, дышит.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    {
      key: "colorMode",
      label: "Раскраска",
      type: "select",
      options: [
        ["value", "По значению — два цвета"],
        ["three", "По значению — три цвета"],
        ["one", "Оттенки одного цвета"],
        ["palette", "Переход по палитре"],
      ],
    },
    { key: "cold", label: "Цвет малых", type: "color" },
    { key: "mid", label: "Цвет средних", type: "color" },
    { key: "warm", label: "Цвет больших", type: "color" },
    {
      key: "fill",
      label: "Вид секторов",
      type: "select",
      options: [
        ["heat", "Тепловое свечение"],
        ["radial", "Свечение от центра"],
        ["solid", "Сплошные"],
        ["glow", "Сильное свечение"],
        ["outline", "Контур"],
      ],
    },
    {
      key: "theme",
      label: "Тема теплового свечения",
      type: "select",
      options: HEAT_THEMES.map(([id, name]) => [id, name] as [string, string]),
    },
    { key: "breath", label: "Дыхание", type: "toggle" },
    { key: "centerText", label: "Текст в центре", type: "text", placeholder: "Например, 2025 или итог" },
    { key: "glowAmt", label: "Сила свечения", type: "range", min: 0, max: 100, step: 1, unit: "%" },
    { key: "hole", label: "Отверстие в центре", type: "range", min: 0, max: 50, step: 1, unit: "%" },
    { key: "values", label: "Подписывать значения", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "light", color: "#0e1016" },
    params: { title: "Обращения по месяцам", subtitle: "", colorMode: "value", cold: "#4cc9f0", mid: "#b388ff", warm: "#ffb703", fill: "heat", theme: "warm", breath: true, centerText: "2025", glowAmt: 50, hole: 14, values: true, decimals: 0 },
    rows: [
      { label: "Янв", value: 42 },
      { label: "Фев", value: 38 },
      { label: "Мар", value: 55 },
      { label: "Апр", value: 61 },
      { label: "Май", value: 74 },
      { label: "Июн", value: 92 },
      { label: "Июл", value: 88 },
      { label: "Авг", value: 70 },
      { label: "Сен", value: 63 },
      { label: "Окт", value: 51 },
      { label: "Ноя", value: 44 },
      { label: "Дек", value: 58 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = rows.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const cx = w / 2;
    const cy = (top + h - pad * 0.5) / 2;
    const R = Math.min((h - pad * 0.5 - top) / 2 - 50 * s, w * 0.3);
    const r0 = R * (Number(f.p.hole ?? 14) / 100);
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    const step = (Math.PI * 2) / n;
    const gap = Math.min(0.04, step * 0.12);
    // Направляющие круги
    ctx.strokeStyle = gridOf(f);
    ctx.lineWidth = Math.max(1, s);
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r0 + ((R - r0) * i) / 4, 0, Math.PI * 2);
      ctx.globalAlpha = clamp(prog(t, 0, 0.6)) * 0.7;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (String(f.p.fill ?? "radial") === "heat") {
      drawRoseHeat(f, cx, cy, R, max, step);
      return;
    }
    rows.forEach((r, i) => {
      const k = easeOut(prog(t, 0.2 + i * 0.06, 1.1));
      const q = Math.sqrt(Math.max(0, r.value) / max);
      const rr = r0 + (R - r0) * q * k;
      const a0 = -Math.PI / 2 + i * step + gap / 2;
      const a1 = a0 + step - gap;
      const q2 = Math.max(0, r.value) / max;
      const cold = String(f.p.cold ?? "#4cc9f0");
      const mode = String(f.p.colorMode ?? "value");
      const color =
        mode === "three"
          ? ramp([cold, String(f.p.mid ?? "#b388ff"), String(f.p.warm ?? "#ffb703")], q2)
          : mode === "one"
            ? ramp([mix(cold, f.dark ? "#0e1016" : "#ffffff", 0.72), cold], q2)
            : mode === "palette"
              ? ramp(f.pal, n > 1 ? i / (n - 1) : 0)
              : ramp([cold, String(f.p.warm ?? "#ffb703")], q2);
      const fillKind = String(f.p.fill ?? "radial");
      const glowK = Number(f.p.glowAmt ?? 50) / 100;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.save();
      ctx.shadowColor = rgba(color, fillKind === "glow" ? 0.85 : 0.55);
      ctx.shadowBlur = (fillKind === "glow" ? 70 : 28) * s * glowK * (0.4 + 0.6 * q2);
      if (fillKind === "solid") {
        ctx.fillStyle = color;
        ctx.fill();
      } else if (fillKind === "outline") {
        ctx.fillStyle = rgba(color, 0.14);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * s;
        ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, Math.max(r0 + 1, rr));
        g.addColorStop(0, rgba(color, fillKind === "glow" ? 0.15 : 0.35));
        g.addColorStop(fillKind === "glow" ? 0.7 : 1, color);
        if (fillKind === "glow") g.addColorStop(1, mix(color, "#ffffff", 0.35));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();
      const mid = (a0 + a1) / 2;
      ctx.globalAlpha = clamp(k * 1.4);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lr = R + 34 * s;
      ctx.font = font(22 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.fillText(r.label, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
      if (f.p.values !== false) {
        ctx.font = font(22 * s, 700);
        ctx.fillStyle = isDark(color) ? "#fff" : "#141414";
        const vr = Math.max(r0 + 24 * s, rr - 26 * s);
        if (rr - r0 > 50 * s) ctx.fillText(fmtUnit(r.value, f), cx + Math.cos(mid) * vr, cy + Math.sin(mid) * vr);
      }
      ctx.globalAlpha = 1;
    });
  },
};

/** Роза «тепловое свечение»: одно мягкое пятно, форма — по значениям */
function drawRoseHeat(f: Frame, cx: number, cy: number, R: number, max: number, step: number) {
  const { ctx, w, h, s, t, rows } = f;
  const n = rows.length;
  const theme = HEAT_THEMES.find(([id]) => id === f.p.theme) ?? HEAT_THEMES[0];
  const glowK = Number(f.p.glowAmt ?? 50) / 100;
  const breath = f.p.breath !== false;
  const grow = easeOut(prog(t, 0.15, 1.6));
  // Радиус каждого сектора; минимум, чтобы пятно не рвалось на нулях
  const rad = rows.map((r) => R * (0.18 + 0.82 * Math.pow(Math.max(0, r.value) / max, 1.4)));
  // Плавный замкнутый контур через центры секторов (Катмулл — Ром по кругу)
  const at = (theta: number, scale: number, phase: number) => {
    const x = (((theta + Math.PI / 2) / step - 0.5) % n + n) % n;
    const j = Math.floor(x);
    const u = x - j;
    const p0 = rad[(j - 1 + n) % n];
    const p1 = rad[j];
    const p2 = rad[(j + 1) % n];
    const p3 = rad[(j + 2) % n];
    const v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    // Дыхание: лёгкая волна по контуру и пульс всей фигуры
    const wave = breath ? 1 + 0.025 * Math.sin(theta * 3 + t * 1.7 + phase) + 0.03 * Math.sin(t * 2.4 - phase) : 1;
    return Math.max(R * 0.05, v) * scale * wave;
  };
  const layers = [1, 0.8, 0.6, 0.42, 0.26];
  const shape = (g: CanvasRenderingContext2D) => {
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(0,0,0,0.22)";
    layers.forEach((L, li) => {
      g.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * Math.PI * 2 - Math.PI / 2;
        const rr = at(th, L * grow, li * 0.7);
        const x = cx + Math.cos(th) * rr;
        const y = cy + Math.sin(th) * rr;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
    });
  };
  drawHeat(ctx, w, h, shape, R * (0.06 + 0.12 * glowK), theme[2]);

  // Подписи по кругу, значение — второй строкой
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lr = R + 40 * s;
  rows.forEach((r, i) => {
    const k = easeOut(prog(t, 0.5 + i * 0.05, 0.8));
    const mid = -Math.PI / 2 + (i + 0.5) * step;
    const x = cx + Math.cos(mid) * lr;
    const y = cy + Math.sin(mid) * lr;
    ctx.globalAlpha = clamp(k);
    const two = f.p.values !== false;
    ctx.font = font(20 * s, 500);
    ctx.fillStyle = f.muted;
    ctx.fillText(r.label, x, two ? y - 12 * s : y);
    if (two) {
      ctx.font = font(22 * s, 700);
      ctx.fillStyle = f.ink;
      ctx.fillText(fmtUnit(r.value, f), x, y + 13 * s);
    }
  });
  ctx.globalAlpha = 1;
  // Текст в центре — на горячей сердцевине, поэтому тёмный
  const label = String(f.p.centerText ?? "").trim();
  if (label) {
    ctx.globalAlpha = clamp(prog(t, 0.9, 0.6));
    const size = fitFont(ctx, label, R * 0.7, 54 * s, 800);
    ctx.font = font(size, 800);
    ctx.fillStyle = "#16171d";
    ctx.fillText(label, cx, cy);
    ctx.globalAlpha = 1;
  }
}

// ── Воронка ──

const funnel: Template = {
  id: "funnel",
  name: "Воронка",
  group: "charts",
  about: "Этапы плавной лентой слева направо: толщина — число на этапе, между этапами — конверсия.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [...TITLE, { key: "conv", label: "Показывать конверсию", type: "toggle" }, ...NUMBERS],
  defaults: {
    background: { kind: "dark", color: "#0e1016" },
    params: { title: "Путь клиента", subtitle: "", conv: true, decimals: 0 },
    rows: [
      { label: "Визиты", value: 12000 },
      { label: "Заявки", value: 4800 },
      { label: "Встречи", value: 2100 },
      { label: "Договоры", value: 960 },
      { label: "Оплата", value: 720 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = rows.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2) + 60 * s;
    const x0 = 0;
    const x1 = w;
    const cy = (top + h - pad) / 2 + 20 * s;
    const H = Math.min(h - pad - top - 100 * s, h * 0.55);
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    const seg = (x1 - x0) / n;
    const th = rows.map((r) => Math.max(8 * s, (r.value / max) * H));
    const flat = 0.45;
    const k = easeInOut(prog(t, 0.2, 1.8));
    // Контур ленты
    const edge = (sign: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = x0 + seg * i;
        pts.push([a + (i === 0 ? 0 : seg * ((1 - flat) / 2)), cy + (sign * th[i]) / 2]);
        pts.push([a + seg * (i === n - 1 ? 1 : (1 + flat) / 2), cy + (sign * th[i]) / 2]);
      }
      return pts;
    };
    const topE = edge(-1);
    const botE = edge(1).reverse();
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(topE[0][0], topE[0][1]);
      for (let i = 1; i < topE.length; i++) {
        const [px, py] = topE[i - 1];
        const [qx, qy] = topE[i];
        if (py === qy) ctx.lineTo(qx, qy);
        else ctx.bezierCurveTo((px + qx) / 2, py, (px + qx) / 2, qy, qx, qy);
      }
      ctx.lineTo(botE[0][0], botE[0][1]);
      for (let i = 1; i < botE.length; i++) {
        const [px, py] = botE[i - 1];
        const [qx, qy] = botE[i];
        if (py === qy) ctx.lineTo(qx, qy);
        else ctx.bezierCurveTo((px + qx) / 2, py, (px + qx) / 2, qy, qx, qy);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, (x1 - x0) * k, h);
    ctx.clip();
    path();
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    f.pal.forEach((c, i) => g.addColorStop(f.pal.length === 1 ? 0 : i / (f.pal.length - 1), c));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    rows.forEach((r, i) => {
      const cx = x0 + seg * i + seg / 2;
      const a = clamp(((x1 - x0) * k - (cx - x0)) / (seg * 0.4) + 0.5);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      fitFont(ctx, r.label, seg * 0.9, 28 * s, 600);
      ctx.fillStyle = f.muted;
      ctx.textBaseline = "bottom";
      ctx.fillText(r.label, cx, cy - H / 2 - 30 * s);
      const vt = fmtUnit(r.value, f);
      fitFont(ctx, vt, seg * 0.9, 40 * s, 800);
      ctx.textBaseline = "middle";
      const inside = th[i] > 70 * s;
      ctx.fillStyle = inside ? "#ffffff" : f.ink;
      ctx.fillText(vt, cx, inside ? cy : cy - th[i] / 2 - 32 * s);
      if (f.p.conv !== false && i > 0) {
        const conv = `${fmt((r.value / (rows[i - 1].value || 1)) * 100, 0)}\u202f%`;
        const bx = x0 + seg * i;
        ctx.font = font(24 * s, 700);
        ctx.fillStyle = f.muted;
        ctx.textBaseline = "top";
        ctx.fillText(`→ ${conv}`, bx, cy + H / 2 + 30 * s);
      }
      ctx.globalAlpha = 1;
    });
  },
};

// ── Большое число ──

const bignum: Template = {
  id: "bignum",
  name: "Большое число",
  group: "charts",
  about: "Огромное число досчитывает от нуля на фоне цветного свечения; ниже — пояснение.",
  input: "none",
  duration: 4,
  loop: false,
  controls: [
    { key: "value", label: "Число", type: "number", step: 0.1 },
    { key: "caption", label: "Подпись", type: "text" },
    { key: "fill", label: "Цифры", type: "select", options: [["gradient", "Градиент палитры"], ["ink", "Цвет текста"], ["silhouette", "Силуэт на свечении"]] },
    { key: "glow", label: "Свечение", type: "range", min: 0, max: 100, step: 1, unit: "%" },
    ...NUMBERS,
  ],
  defaults: { params: { value: 1240, caption: "новых клиентов за месяц", fill: "gradient", glow: 70, prefix: "+", unit: "", decimals: 0 }, background: { kind: "dark", color: "#0e1016" } },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const v = Number(f.p.value ?? 0);
    const k = easeOut(prog(t, 0.15, 1.8));
    const final = fmtUnit(v, f);
    const cap = String(f.p.caption ?? "");
    const big = fitFont(ctx, final, w * 0.84, h * 0.42, 800);
    const cy = h / 2 - (cap ? 40 * s : 0);
    const glow = Number(f.p.glow ?? 70) / 100;
    if (glow > 0) {
      const drift = Math.sin(t * 0.8) * 30 * s;
      blob(ctx, w / 2 - big * 1.1 + drift, cy, big * 1.6, pc(f, 0), 0.7 * glow * clamp(k * 2));
      blob(ctx, w / 2 + big * 1.1 - drift, cy + big * 0.1, big * 1.5, pc(f, 1), 0.6 * glow * clamp(k * 2));
    }
    ctx.font = font(big, 800);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = fmtUnit(v * k, f);
    const fill = String(f.p.fill ?? "gradient");
    if (fill === "gradient") {
      const g = ctx.createLinearGradient(w / 2 - big * 2, cy - big / 2, w / 2 + big * 2, cy + big / 2);
      f.pal.forEach((c, i) => g.addColorStop(f.pal.length === 1 ? 0 : i / (f.pal.length - 1), c));
      ctx.fillStyle = g;
    } else if (fill === "silhouette") ctx.fillStyle = f.dark ? "#06070a" : "#14161c";
    else ctx.fillStyle = f.ink;
    ctx.fillText(text, w / 2, cy);
    if (cap) {
      ctx.globalAlpha = clamp(prog(t, 0.8, 0.6));
      fitFont(ctx, cap, w * 0.8, 40 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.fillText(cap, w / 2, cy + big * 0.62 + 20 * s);
      ctx.globalAlpha = 1;
    }
  },
};

export const CHARTS: Template[] = [bars, hbars, pairs, line, kpi, donut, percent, rose, funnel, bignum];
