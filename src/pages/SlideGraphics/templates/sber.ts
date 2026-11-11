// Шаблоны в фирменном стиле СБ: зелёный акцент, мягкие градиенты, скругления,
// много воздуха. Цвета берутся из палитры сцены, по умолчанию — «Сбер»
// (проверена валидатором на светлом и тёмном фоне), поэтому любой шаблон можно
// перекрасить. Логотипов и фирменного шрифта здесь нет — только цвета и манера.

import { clamp, easeBack, easeInOut, easeOut, fitFont, fmtUnit, font, grain, header, isDark, lerp, mix, pc, prog, rgb, rgba, roundRect, wrap } from "../core/draw";
import type { Control, Frame, Row, Template } from "../core/types";

const TAU = Math.PI * 2;

/** Категориальная палитра «Сбер»: зелёный, синий, янтарный, фиолетовый */
export const SBER = ["#21a038", "#1971c2", "#e8a317", "#7048e8"];
/** Она же для тёмного фона: те же тона, светлота подогнана под тёмную подложку */
export const SBER_DARK = ["#21a038", "#3d8be0", "#b77c00", "#8a6cf0"];
/** Зелёные для одного ряда и градиентов */
export const SBER_GREENS = ["#21a038", "#0b7a4b", "#42e3b4", "#a0e720"];

const TITLE: Control[] = [
  { key: "title", label: "Заголовок", type: "text" },
  { key: "subtitle", label: "Подзаголовок", type: "text" },
];
const NUMBERS: Control[] = [
  { key: "prefix", label: "Перед числом", type: "text", placeholder: "+, $" },
  { key: "unit", label: "Единица", type: "text", placeholder: "%, ₽, млн" },
  { key: "decimals", label: "Знаков после запятой", type: "number", min: 0, max: 3, step: 1 },
];

// ── Цвет ──

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
/** Соседний оттенок: сдвиг тона и светлоты — вторая точка фирменного градиента */
export function shift(hex: string, deg: number, dl: number) {
  const [h, s, l] = toHsl(hex);
  return fromHsl((h + deg + 360) % 360, s, clamp(l + dl, 0.05, 0.95));
}
/** Фирменный градиент из первого цвета палитры: зелёный → бирюза */
const duo = (c: string, deg = 38): [string, string] => [c, shift(c, deg, 0.1)];

const trackOf = (f: Frame) => (f.dark ? "rgba(255,255,255,0.09)" : "rgba(20,22,28,0.07)");
const surfaceOf = (f: Frame) => f.base ?? (f.dark ? "#0e1016" : "#ffffff");

/** Раздвинуть подписи по вертикали, чтобы не налезали */
function spread(ys: number[], gap: number, lo: number, hi: number) {
  const idx = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const out = idx.map(([y]) => y);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const d = out[i] - out[i - 1];
      if (d < gap) {
        const push = (gap - d) / 2;
        out[i - 1] -= push;
        out[i] += push;
        moved = true;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], lo, hi);
    if (!moved) break;
  }
  const res = new Array<number>(ys.length);
  idx.forEach(([, i], j) => (res[i] = out[j]));
  return res;
}

// ── Кольца целей ──

const rings: Template = {
  id: "sb-rings",
  name: "Кольца целей",
  group: "sber",
  about: "Каждая цель — своё кольцо: дуга закрывается до процента выполнения, справа — факт, план и процент крупно.",
  input: "pairs",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "s1", label: "Название первого числа", type: "text" },
    { key: "s2", label: "Название второго числа", type: "text" },
    { key: "legend", label: "Подписи справа", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER,
    params: { title: "Выполнение плана", subtitle: "I полугодие", s1: "Факт", s2: "План", legend: true, unit: "млрд ₽", decimals: 0 },
    rows: [
      { label: "Кредиты", value: 92, value2: 100 },
      { label: "Вклады", value: 118, value2: 120 },
      { label: "Карты", value: 61, value2: 80 },
      { label: "Страхование", value: 34, value2: 50 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const rows = f.rows.slice(0, 6);
    const n = rows.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const legend = f.p.legend !== false;
    const cy = (top + h - pad * 0.6) / 2;
    const R = Math.max(40 * s, Math.min((h - pad * 0.6 - top) / 2, legend ? w * 0.22 : w * 0.3));
    const cx = legend ? pad + R + 10 * s : w / 2;
    const r0 = R * 0.3;
    const band = (R - r0) / n;
    const th = band * 0.74;
    const ratio = (r: Row) => (r.value2 ? r.value / r.value2 : r.value / 100);
    ctx.lineCap = "round";
    rows.forEach((r, i) => {
      const rr = R - band * (i + 0.5);
      const c = pc(f, i);
      const k = easeOut(prog(t, 0.3 + i * 0.15, 1.6));
      // Дорожка
      ctx.strokeStyle = rgba(c, f.dark ? 0.2 : 0.13);
      ctx.lineWidth = th;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.stroke();
      const p = Math.max(0, ratio(r)) * k;
      if (p <= 0.001) return;
      const a0 = -Math.PI / 2;
      const a1 = a0 + TAU * Math.min(p, 0.9999);
      // Зелёный уходит в бирюзу, остальные цвета только светлеют — тон не меняется
      const [c1, c2] = duo(c, i === 0 ? 38 : 0);
      let stroke: string | CanvasGradient = c;
      if ("createConicGradient" in ctx) {
        // Начинаем чуть раньше дуги, чтобы скруглённое начало не попало на шов
        const cap = th / 2 / rr + 0.02;
        const g = ctx.createConicGradient(a0 - cap, cx, cy);
        g.addColorStop(0, c2);
        g.addColorStop(Math.min(1, (cap + TAU * Math.min(p, 1)) / TAU), c1);
        stroke = g;
      }
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a0, a1);
      ctx.stroke();
      // Перевыполнение — второй виток с тенью у конца
      if (p > 1) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.3)";
        ctx.shadowBlur = th * 0.5;
        ctx.strokeStyle = c1;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, a0, a0 + TAU * Math.min(p - 1, 0.95));
        ctx.stroke();
        ctx.restore();
      }
      // Точка на конце дуги
      const ex = cx + Math.cos(a1) * rr;
      const ey = cy + Math.sin(a1) * rr;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(ex, ey, th * 0.16, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    if (!legend) return;
    // Подписи справа: точка цвета, имя, процент крупно, факт / план мелко
    const x0 = cx + R + 90 * s;
    const maxW = w - pad - x0;
    const rowH = Math.min(150 * s, (h - pad * 0.6 - top) / n);
    const y0 = cy - (rowH * n) / 2;
    ctx.textAlign = "left";
    rows.forEach((r, i) => {
      const k = easeOut(prog(t, 0.45 + i * 0.15, 0.8));
      const y = y0 + rowH * i + rowH / 2;
      ctx.globalAlpha = k;
      ctx.save();
      ctx.translate((1 - k) * 30 * s, 0);
      ctx.fillStyle = pc(f, i);
      ctx.beginPath();
      ctx.arc(x0 + 8 * s, y - rowH * 0.22, 8 * s, 0, TAU);
      ctx.fill();
      ctx.textBaseline = "middle";
      ctx.font = font(fitFont(ctx, r.label, maxW * 0.5, 26 * s, 600), 600);
      ctx.fillStyle = f.muted;
      ctx.fillText(r.label, x0 + 26 * s, y - rowH * 0.22);
      const pct = Math.round(ratio(r) * 100 * easeOut(prog(t, 0.3 + i * 0.15, 1.6)));
      ctx.font = font(Math.min(64 * s, rowH * 0.46), 800);
      ctx.fillStyle = f.ink;
      ctx.textBaseline = "alphabetic";
      const big = `${pct}%`;
      ctx.fillText(big, x0, y + rowH * 0.3);
      const bw = ctx.measureText(big).width;
      ctx.font = font(22 * s, 500);
      ctx.fillStyle = f.muted;
      const s1 = String(f.p.s1 ?? "Факт");
      const s2 = String(f.p.s2 ?? "План");
      const note = r.value2 ? `${s1} ${fmtUnit(r.value, f)} · ${s2} ${fmtUnit(r.value2, f)}` : `${s1} ${fmtUnit(r.value, f)}`;
      ctx.font = font(fitFont(ctx, note, Math.max(60 * s, maxW - bw - 24 * s), 22 * s, 500), 500);
      ctx.fillText(note, x0 + bw + 18 * s, y + rowH * 0.3);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  },
};

// ── Водопад ──

const waterfall: Template = {
  id: "sb-waterfall",
  name: "Водопад",
  group: "sber",
  about: "Из чего сложился итог: первая строка — начальное значение, дальше прирост и снижение, последний столбец считается сам.",
  input: "rows",
  duration: 6,
  loop: false,
  controls: [
    ...TITLE,
    { key: "totalLabel", label: "Подпись итога", type: "text" },
    { key: "links", label: "Соединительные линии", type: "toggle" },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 30, step: 1 },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER_GREENS,
    params: { title: "Чистая прибыль: от плана к факту", subtitle: "млрд ₽", totalLabel: "Факт", links: true, radius: 10, decimals: 0 },
    rows: [
      { label: "План", value: 420 },
      { label: "Процентный доход", value: 64 },
      { label: "Комиссии", value: 38 },
      { label: "Резервы", value: -52 },
      { label: "Расходы", value: -21 },
      { label: "Прочее", value: 9 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const rows = f.rows;
    if (!rows.length) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    // Ступени: [от, до, вид]
    type Step = { label: string; from: number; to: number; kind: "total" | "up" | "down"; v: number };
    const steps: Step[] = [];
    let acc = rows[0].value;
    steps.push({ label: rows[0].label, from: 0, to: acc, kind: "total", v: acc });
    rows.slice(1).forEach((r) => {
      steps.push({ label: r.label, from: acc, to: acc + r.value, kind: r.value >= 0 ? "up" : "down", v: r.value });
      acc += r.value;
    });
    steps.push({ label: String(f.p.totalLabel ?? "Итог") || "Итог", from: 0, to: acc, kind: "total", v: acc });
    const lo = Math.min(0, ...steps.map((st) => Math.min(st.from, st.to)));
    const hi = Math.max(0, ...steps.map((st) => Math.max(st.from, st.to))) || 1;
    const bottom = h - pad - 46 * s;
    const plotTop = top + 46 * s;
    const Y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - plotTop);
    const n = steps.length;
    const slot = (w - pad * 2) / n;
    const bw = Math.min(slot * 0.62, 150 * s);
    const rad = Number(f.p.radius ?? 10) * s;
    const [g1, g2] = duo(pc(f, 0));
    const upC = f.dark ? mix(pc(f, 0), "#ffffff", 0.25) : mix(pc(f, 0), surfaceOf(f), 0.45);
    const downC = f.dark ? "#5a606e" : "#b9bec9";
    // Базовая линия
    ctx.strokeStyle = f.dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.beginPath();
    ctx.moveTo(pad, Y(0));
    ctx.lineTo(w - pad, Y(0));
    ctx.stroke();
    steps.forEach((st, i) => {
      const k = easeOut(prog(t, 0.3 + i * 0.32, 0.7));
      if (k <= 0) return;
      const x = pad + slot * i + (slot - bw) / 2;
      const yFrom = Y(st.from);
      const yTo = Y(lerp(st.from, st.to, k));
      const y = Math.min(yFrom, yTo);
      const hh = Math.max(2 * s, Math.abs(yTo - yFrom));
      // Скругляем только «свободный» конец столбца
      const r = Math.min(rad, hh / 2);
      const rr = st.to >= st.from ? [r, r, 0, 0] : [0, 0, r, r];
      roundRect(ctx, x, y, bw, hh, st.kind === "total" ? [r, r, 0, 0] : rr);
      if (st.kind === "total") {
        const g = ctx.createLinearGradient(0, y + hh, 0, y);
        g.addColorStop(0, g1);
        g.addColorStop(1, g2);
        ctx.fillStyle = g;
      } else ctx.fillStyle = st.kind === "up" ? upC : downC;
      ctx.fill();
      // Связка к следующему столбцу
      if (f.p.links !== false && i < n - 1) {
        const kl = prog(t, 0.3 + i * 0.32 + 0.5, 0.3);
        if (kl > 0) {
          ctx.save();
          ctx.setLineDash([6 * s, 6 * s]);
          ctx.strokeStyle = f.muted;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = Math.max(1, 1.5 * s);
          const ly = Y(st.to);
          ctx.beginPath();
          ctx.moveTo(x + bw, ly);
          ctx.lineTo(x + bw + (slot - bw) * kl, ly);
          ctx.stroke();
          ctx.restore();
        }
      }
      // Значение: над столбцом для роста, под ним — для снижения; знак всегда
      ctx.globalAlpha = clamp(k * 1.5 - 0.3);
      ctx.textAlign = "center";
      const label = st.kind === "total" ? fmtUnit(st.v, f) : `${st.v >= 0 ? "+" : "−"}${fmtUnit(Math.abs(st.v), f).replace(/^[+]/, "")}`;
      ctx.font = font(fitFont(ctx, label, slot * 0.95, 28 * s, 700), 700);
      ctx.fillStyle = f.ink;
      if (st.kind === "down") {
        ctx.textBaseline = "top";
        ctx.fillText(label, x + bw / 2, Y(st.to) + 10 * s);
      } else {
        ctx.textBaseline = "bottom";
        ctx.fillText(label, x + bw / 2, Y(st.to) - 10 * s);
      }
      // Подпись категории под осью — до двух строк
      ctx.font = font(20 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.textBaseline = "top";
      wrap(ctx, st.label, slot * 0.94)
        .slice(0, 2)
        .forEach((line, j) => ctx.fillText(line, x + bw / 2, Math.max(Y(0), Y(lo)) + 14 * s + j * 24 * s));
      ctx.globalAlpha = 1;
    });
  },
};

// ── Спидометр ──

const gauge: Template = {
  id: "sb-gauge",
  name: "Шкала цели",
  group: "sber",
  about: "Полукруглая шкала заполняется до значения с лёгким перелётом, отметка показывает цель, в центре число досчитывает.",
  input: "none",
  duration: 4,
  loop: false,
  controls: [
    ...TITLE,
    { key: "value", label: "Значение", type: "number", step: 0.1 },
    { key: "target", label: "Цель", type: "number", step: 0.1 },
    { key: "max", label: "Максимум шкалы", type: "number", step: 1 },
    { key: "caption", label: "Подпись под числом", type: "text" },
    { key: "ticks", label: "Деления", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER_GREENS,
    params: { title: "Индекс удовлетворённости", subtitle: "", value: 82, target: 75, max: 100, caption: "NPS по итогам квартала", ticks: true, unit: "", decimals: 0 },
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const v = Number(f.p.value ?? 0);
    const max = Number(f.p.max ?? 100) || 100;
    const target = Number(f.p.target ?? 0);
    const cap = String(f.p.caption ?? "").trim();
    const R = Math.max(60 * s, Math.min(w * 0.3, (h - top - pad * 0.6 - (cap ? 60 * s : 0)) * 0.82));
    const cx = w / 2;
    const cy = top + R + 30 * s;
    const th = R * 0.16;
    const A0 = Math.PI;
    const ang = (x: number) => A0 + Math.PI * clamp(x / max);
    ctx.lineCap = "round";
    ctx.lineWidth = th;
    ctx.strokeStyle = trackOf(f);
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, TAU);
    ctx.stroke();
    // Деления
    if (f.p.ticks !== false) {
      ctx.strokeStyle = f.muted;
      ctx.globalAlpha = 0.5 * clamp(prog(t, 0, 0.6));
      ctx.lineWidth = Math.max(1, 2 * s);
      for (let i = 0; i <= 10; i++) {
        const a = A0 + (Math.PI * i) / 10;
        const r1 = R - th / 2 - 14 * s;
        const r2 = r1 - (i % 5 === 0 ? 18 : 9) * s;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Заполнение с перелётом
    const k = easeBack(prog(t, 0.3, 1.8));
    const cur = v * k;
    const [c1, c2] = duo(pc(f, 0));
    const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    g.addColorStop(0, c2);
    g.addColorStop(1, c1);
    if (cur > 0) {
      ctx.lineWidth = th;
      ctx.strokeStyle = g;
      ctx.save();
      ctx.shadowColor = rgba(c1, 0.45);
      ctx.shadowBlur = 30 * s;
      ctx.beginPath();
      ctx.arc(cx, cy, R, A0, ang(cur));
      ctx.stroke();
      ctx.restore();
      const a = ang(cur);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, th * 0.22, 0, TAU);
      ctx.fill();
    }
    // Отметка цели
    if (target > 0) {
      const kt = easeOut(prog(t, 1.2, 0.6));
      const a = ang(target);
      ctx.globalAlpha = kt;
      ctx.strokeStyle = f.ink;
      ctx.lineWidth = Math.max(2, 3 * s);
      ctx.lineCap = "butt";
      const r1 = R + th / 2 + 6 * s;
      const r2 = R - th / 2 - 6 * s;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
      ctx.font = font(22 * s, 600);
      ctx.fillStyle = f.muted;
      ctx.textAlign = Math.cos(a) < -0.2 ? "right" : Math.cos(a) > 0.2 ? "left" : "center";
      ctx.textBaseline = "bottom";
      const lr = r1 + 14 * s;
      ctx.fillText(`цель ${fmtUnit(target, f)}`, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
      ctx.globalAlpha = 1;
    }
    // Минимум и максимум
    ctx.font = font(20 * s, 500);
    ctx.fillStyle = f.muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(fmtUnit(0, f), cx - R, cy + th / 2 + 10 * s);
    ctx.fillText(fmtUnit(max, f), cx + R, cy + th / 2 + 10 * s);
    // Число
    const shown = v * clamp(easeOut(prog(t, 0.3, 1.8)));
    const text = fmtUnit(shown, f);
    ctx.textBaseline = "alphabetic";
    ctx.font = font(fitFont(ctx, fmtUnit(v, f), R * 1.25, R * 0.5, 800), 800);
    ctx.fillStyle = f.ink;
    ctx.fillText(text, cx, cy - R * 0.05);
    if (cap) {
      ctx.globalAlpha = easeOut(prog(t, 0.8, 0.6));
      ctx.font = font(fitFont(ctx, cap, w - pad * 2, 30 * s, 500), 500);
      ctx.fillStyle = f.muted;
      ctx.textBaseline = "top";
      ctx.fillText(cap, cx, cy + th / 2 + 50 * s);
      ctx.globalAlpha = 1;
    }
  },
};

// ── Было → стало ──

const slope: Template = {
  id: "sb-slope",
  name: "Было → стало",
  group: "sber",
  about: "Две колонки и линии между ними: сразу видно, что выросло, что упало и как поменялся порядок.",
  input: "pairs",
  duration: 5,
  loop: false,
  controls: [
    ...TITLE,
    { key: "s1", label: "Слева", type: "text" },
    { key: "s2", label: "Справа", type: "text" },
    { key: "delta", label: "Показывать изменение, %", type: "toggle" },
    ...NUMBERS,
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER_GREENS,
    params: { title: "Доля цифровых продаж", subtitle: "по каналам, %", s1: "2024", s2: "2025", delta: true, unit: "%", decimals: 0 },
    rows: [
      { label: "Мобильное приложение", value: 41, value2: 56 },
      { label: "Веб-версия", value: 22, value2: 19 },
      { label: "Офис", value: 27, value2: 16 },
      { label: "Партнёры", value: 10, value2: 9 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const rows = f.rows.slice(0, 8);
    if (!rows.length) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const x1 = w * 0.36;
    const x2 = w * 0.64;
    const yTop = top + 70 * s;
    const yBot = h - pad;
    const all = rows.flatMap((r) => [r.value, r.value2 ?? r.value]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const Y = (v: number) => (hi === lo ? (yTop + yBot) / 2 : yBot - ((v - lo) / (hi - lo)) * (yBot - yTop));
    // Колонки
    ctx.strokeStyle = trackOf(f);
    ctx.lineWidth = Math.max(1, 2 * s);
    [x1, x2].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, yTop - 20 * s);
      ctx.lineTo(x, yBot + 20 * s);
      ctx.stroke();
    });
    ctx.font = font(26 * s, 700);
    ctx.fillStyle = f.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(f.p.s1 ?? ""), x1, yTop - 32 * s);
    ctx.fillText(String(f.p.s2 ?? ""), x2, yTop - 32 * s);
    const gap = 54 * s;
    const ly = spread(rows.map((r) => Y(r.value)), gap, yTop - 10 * s, yBot + 10 * s);
    const ry = spread(rows.map((r) => Y(r.value2 ?? r.value)), gap, yTop - 10 * s, yBot + 10 * s);
    const up = pc(f, 0);
    const down = f.dark ? "#6b7180" : "#a9aebb";
    const ring = surfaceOf(f);
    rows.forEach((r, i) => {
      const v2 = r.value2 ?? r.value;
      const rising = v2 >= r.value;
      const c = rising ? up : down;
      const k = easeInOut(prog(t, 0.4 + i * 0.12, 1.2));
      const ya = Y(r.value);
      const yb = Y(v2);
      // Левая подпись
      const kl = easeOut(prog(t, 0.2 + i * 0.08, 0.5));
      ctx.globalAlpha = kl;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = font(22 * s, 500);
      ctx.fillStyle = f.muted;
      const nameW = x1 - pad - 120 * s;
      ctx.font = font(fitFont(ctx, r.label, nameW, 22 * s, 500), 500);
      ctx.fillText(r.label, x1 - 110 * s, ly[i]);
      ctx.font = font(28 * s, 700);
      ctx.fillStyle = f.ink;
      ctx.fillText(fmtUnit(r.value, f), x1 - 26 * s, ly[i]);
      ctx.globalAlpha = 1;
      // Линия
      if (k > 0) {
        ctx.strokeStyle = c;
        ctx.lineWidth = (rising ? 5 : 3) * s;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, ya);
        ctx.lineTo(lerp(x1, x2, k), lerp(ya, yb, k));
        ctx.stroke();
      }
      // Точки с кольцом цвета фона
      const dot = (x: number, y: number, a: number) => {
        ctx.globalAlpha = a;
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(x, y, 12 * s, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 9 * s, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      dot(x1, ya, kl);
      if (k > 0.98) dot(x2, yb, 1);
      // Правая подпись
      const kr = easeOut(prog(t, 0.4 + i * 0.12 + 1.0, 0.5));
      if (kr > 0) {
        ctx.globalAlpha = kr;
        ctx.textAlign = "left";
        ctx.font = font(28 * s, 700);
        ctx.fillStyle = f.ink;
        const val = fmtUnit(v2, f);
        ctx.fillText(val, x2 + 26 * s, ry[i]);
        let x = x2 + 26 * s + ctx.measureText(val).width + 14 * s;
        if (f.p.delta !== false && r.value) {
          const d = ((v2 - r.value) / Math.abs(r.value)) * 100;
          const txt = `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%`;
          ctx.font = font(20 * s, 700);
          const tw = ctx.measureText(txt).width;
          roundRect(ctx, x, ry[i] - 15 * s, tw + 20 * s, 30 * s, 15 * s);
          ctx.fillStyle = rgba(rising ? up : down, f.dark ? 0.25 : 0.14);
          ctx.fill();
          ctx.fillStyle = f.ink;
          ctx.fillText(txt, x + 10 * s, ry[i] + 1 * s);
          x += tw + 34 * s;
        }
        ctx.font = font(fitFont(ctx, r.label, Math.max(40 * s, w - pad - x), 22 * s, 500), 500);
        ctx.fillStyle = f.muted;
        ctx.fillText(r.label, x, ry[i]);
        ctx.globalAlpha = 1;
      }
    });
  },
};

// ── Пузыри ──

/** Упаковать круги: крупные в центре, остальные — по спирали без наложений */
function pack(radii: number[]) {
  const order = radii.map((r, i) => [r, i]).sort((a, b) => b[0] - a[0]);
  const placed: { x: number; y: number; r: number; i: number }[] = [];
  const gap = 0.06;
  for (const [r, i] of order) {
    if (!placed.length) {
      placed.push({ x: 0, y: 0, r, i });
      continue;
    }
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    // Кандидаты — касание к каждой паре уже поставленных кругов
    for (const a of placed) {
      for (let k = 0; k < 36; k++) {
        const ang = (k / 36) * TAU;
        const x = a.x + Math.cos(ang) * (a.r + r + gap * r);
        const y = a.y + Math.sin(ang) * (a.r + r + gap * r);
        if (placed.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + r + gap * Math.min(r, b.r) - 1e-6)) continue;
        const d = Math.hypot(x / 1.6, y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    placed.push({ ...(best ?? { x: 0, y: 0 }), r, i });
  }
  return placed;
}

const bubbles: Template = {
  id: "sb-bubbles",
  name: "Пузыри",
  group: "sber",
  about: "Площадь круга — значение. Круги выпрыгивают от крупного к мелкому и мягко покачиваются; оттенок темнее у больших.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [...TITLE, { key: "float", label: "Покачивание", type: "toggle" }, ...NUMBERS],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER_GREENS,
    params: { title: "Клиенты по сегментам", subtitle: "млн человек", float: true, decimals: 1 },
    rows: [
      { label: "Массовый", value: 74.2 },
      { label: "Молодёжь", value: 21.5 },
      { label: "Премиум", value: 9.8 },
      { label: "Пенсионеры", value: 28.4 },
      { label: "Малый бизнес", value: 6.1 },
      { label: "Зарплатные", value: 17.3 },
      { label: "Студенты", value: 4.6 },
    ],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const rows = f.rows.filter((r) => r.value > 0).slice(0, 14);
    if (!rows.length) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const max = Math.max(...rows.map((r) => r.value));
    const placed = pack(rows.map((r) => Math.sqrt(r.value / max)));
    const minX = Math.min(...placed.map((p) => p.x - p.r));
    const maxX = Math.max(...placed.map((p) => p.x + p.r));
    const minY = Math.min(...placed.map((p) => p.y - p.r));
    const maxY = Math.max(...placed.map((p) => p.y + p.r));
    const boxW = w - pad * 2;
    const boxH = h - top - pad * 0.7;
    const k = Math.min(boxW / (maxX - minX), boxH / (maxY - minY));
    const ox = pad + (boxW - (maxX - minX) * k) / 2 - minX * k;
    const oy = top + (boxH - (maxY - minY) * k) / 2 - minY * k;
    const light = mix(pc(f, 0), surfaceOf(f), 0.62);
    placed.forEach((p, j) => {
      const r = rows[p.i];
      const q = r.value / max;
      const kk = easeBack(prog(t, 0.25 + j * 0.14, 0.7));
      if (kk <= 0) return;
      const wob = f.p.float !== false ? Math.sin(t * 1.3 + j * 1.7) * 6 * s : 0;
      const x = ox + p.x * k;
      const y = oy + p.y * k + wob;
      const rad = Math.max(1, p.r * k * kk);
      const c = mix(light, pc(f, 0), Math.sqrt(q));
      const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
      g.addColorStop(0, shift(c, 30, 0.12));
      g.addColorStop(1, c);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
      // Подпись внутри, если помещается
      const kt = clamp(prog(t, 0.45 + j * 0.14, 0.5));
      const R = p.r * k;
      if (R < 34 * s || kt <= 0) return;
      ctx.globalAlpha = kt;
      const ink = isDark(c) ? "#ffffff" : "#14161c";
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const val = fmtUnit(r.value, f);
      const vpx = fitFont(ctx, val, R * 1.5, Math.min(R * 0.45, 64 * s), 800);
      if (R > 70 * s) {
        const lpx = fitFont(ctx, r.label, R * 1.6, Math.min(R * 0.2, 26 * s), 600);
        ctx.font = font(vpx, 800);
        ctx.fillText(val, x, y - lpx * 0.55);
        ctx.font = font(lpx, 600);
        ctx.globalAlpha = kt * 0.85;
        ctx.fillText(r.label, x, y + vpx * 0.55);
      } else {
        ctx.font = font(vpx, 800);
        ctx.fillText(val, x, y);
      }
      ctx.globalAlpha = 1;
    });
    // Подписи маленьких кругов — легендой снизу
    const small = placed.filter((p) => p.r * k < 70 * s);
    if (small.length) {
      ctx.globalAlpha = clamp(prog(t, 1.4, 0.6));
      ctx.font = font(20 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const txt = small
        .map((p) => `${rows[p.i].label} — ${fmtUnit(rows[p.i].value, f)}`)
        .join("   ·   ");
      ctx.font = font(fitFont(ctx, txt, w - pad * 2, 20 * s, 500), 500);
      ctx.fillText(txt, w / 2, h - pad * 0.45);
      ctx.globalAlpha = 1;
    }
  },
};

// ── Аврора ──

let auroraCanvas: HTMLCanvasElement | null = null;
let auroraSoft: HTMLCanvasElement | null = null;
let auroraMid: HTMLCanvasElement | null = null;
let blurOk: boolean | null = null;
/** Есть ли у canvas фильтр размытия (в старом Safari нет) */
function canBlur() {
  if (blurOk !== null) return blurOk;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 9;
    const g = c.getContext("2d")!;
    g.filter = "blur(2px)";
    g.fillRect(4, 4, 1, 1);
    blurOk = g.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch {
    blurOk = false;
  }
  return blurOk;
}

const aurora: Template = {
  id: "sb-aurora",
  name: "Аврора",
  group: "sber",
  about: "Фон-заставка: волны зелёного света переливаются на тёмной основе, поверх — заголовок. Видео — бесшовная петля.",
  input: "none",
  duration: 10,
  loop: true,
  ownBackground: true,
  controls: [
    ...TITLE,
    { key: "base", label: "Цвет основы", type: "color" },
    { key: "waves", label: "Волн", type: "range", min: 2, max: 5, step: 1 },
    { key: "height", label: "Высота сияния", type: "range", min: 30, max: 100, step: 1, unit: "%" },
    { key: "grain", label: "Зерно", type: "range", min: 0, max: 40, step: 1, unit: "%" },
  ],
  defaults: {
    palette: ["#21a038", "#42e3b4", "#a0e720", "#1f8ae0"],
    params: { title: "Стратегия 2030", subtitle: "Технологии для людей", base: "#03140c", waves: 4, height: 70, grain: 10 },
  },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    const base = String(f.p.base ?? "#03140c");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Сияние мягкое, поэтому считаем его в небольшом холсте постоянной ширины,
    // размываем и растягиваем в два шага — без ступенек при любом размере кадра
    const bw = 640;
    const bh = Math.max(16, Math.round((bw * h) / w));
    if (!auroraCanvas) auroraCanvas = document.createElement("canvas");
    auroraCanvas.width = bw;
    auroraCanvas.height = bh;
    const g = auroraCanvas.getContext("2d")!;
    g.clearRect(0, 0, bw, bh);
    g.globalCompositeOperation = "lighter";
    const n = Number(f.p.waves ?? 4);
    const H = (Number(f.p.height ?? 70) / 100) * bh * 0.55;
    const ph = (TAU * t) / dur; // целое число оборотов за ролик — петля без шва
    for (let i = 0; i < n; i++) {
      const c = pc(f, i);
      const yBase = bh * (0.42 + 0.1 * i);
      const amp = bh * (0.08 + 0.03 * (i % 2));
      const fr = 1 + (i % 3) * 0.5;
      const dir = i % 2 ? -1 : 1;
      // Столбики ровно по пикселю: с перекрытием «lighter» дал бы полосы
      const step = 1;
      for (let x = 0; x < bw; x += step) {
        const u = x / bw;
        const y = yBase + amp * Math.sin(u * TAU * fr + ph * dir + i * 1.3) + amp * 0.4 * Math.sin(u * TAU * 2.3 - ph * 2 * dir);
        // Высота занавеса пульсирует вдоль волны
        const hh = H * (0.55 + 0.45 * Math.sin(u * TAU * 3 + ph * (i + 1) * dir + i));
        const lg = g.createLinearGradient(0, y, 0, y - hh);
        lg.addColorStop(0, rgba(c, 0.6));
        lg.addColorStop(0.25, rgba(c, 0.32));
        lg.addColorStop(1, rgba(c, 0));
        g.fillStyle = lg;
        g.fillRect(x, y - hh, step, hh);
        // Отражённое свечение вниз
        const lg2 = g.createLinearGradient(0, y, 0, y + hh * 0.35);
        lg2.addColorStop(0, rgba(c, 0.35));
        lg2.addColorStop(1, rgba(c, 0));
        g.fillStyle = lg2;
        g.fillRect(x, y, step, hh * 0.35);
      }
    }
    // Размытие на малом холсте (дёшево) убирает ступеньки между столбиками
    if (!auroraSoft) auroraSoft = document.createElement("canvas");
    auroraSoft.width = bw;
    auroraSoft.height = bh;
    const sg = auroraSoft.getContext("2d")!;
    sg.clearRect(0, 0, bw, bh);
    if (canBlur()) {
      sg.filter = "blur(3px)";
      sg.drawImage(auroraCanvas, 0, 0);
      sg.filter = "none";
    } else {
      // Без фильтра: уменьшить вдвое и растянуть обратно
      sg.imageSmoothingQuality = "high";
      sg.drawImage(auroraCanvas, 0, 0, bw / 4, bh / 4);
      sg.globalCompositeOperation = "copy";
      sg.drawImage(auroraSoft, 0, 0, bw / 4, bh / 4, 0, 0, bw, bh);
      sg.globalCompositeOperation = "source-over";
    }
    // Растягиваем в два шага: на большом кадре так нет «квадратиков»
    let src: HTMLCanvasElement = auroraSoft;
    if (w > bw * 2) {
      if (!auroraMid) auroraMid = document.createElement("canvas");
      auroraMid.width = Math.round(w / 2);
      auroraMid.height = Math.round(h / 2);
      const mg = auroraMid.getContext("2d")!;
      mg.imageSmoothingEnabled = true;
      mg.imageSmoothingQuality = "high";
      mg.clearRect(0, 0, auroraMid.width, auroraMid.height);
      mg.drawImage(auroraSoft, 0, 0, auroraMid.width, auroraMid.height);
      src = auroraMid;
    }
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
    ctx.restore();
    // Затемнение снизу — место для текста
    const sh = ctx.createLinearGradient(0, h * 0.55, 0, h);
    sh.addColorStop(0, rgba(base, 0));
    sh.addColorStop(1, rgba(base, 0.85));
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, w, h);
    grain(f, Number(f.p.grain ?? 0) / 100);
    // Заголовок по центру внизу
    const title = String(f.p.title ?? "").trim();
    const sub = String(f.p.subtitle ?? "").trim();
    const pad = 96 * s;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let y = h - pad;
    if (sub) {
      ctx.font = font(fitFont(ctx, sub, w - pad * 2, 36 * s, 500), 500);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(sub, pad, y);
      y -= 36 * s * 1.5;
    }
    if (title) {
      const px = fitFont(ctx, title, w - pad * 2, 110 * s, 800);
      ctx.font = font(px, 800);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(title, pad, y);
    }
  },
};

// ── Дорожная карта ──

const roadmap: Template = {
  id: "sb-roadmap",
  name: "Дорожная карта",
  group: "sber",
  about: "Этапы на плавной линии: линия прорисовывается, вехи загораются по очереди. Пройденные — залиты, будущие — контуром.",
  input: "phrases",
  duration: 6,
  loop: false,
  controls: [
    ...TITLE,
    { key: "done", label: "Пройдено этапов", type: "number", min: 0, max: 12, step: 1 },
    { key: "wave", label: "Изгиб линии", type: "range", min: 0, max: 100, step: 1, unit: "%" },
  ],
  defaults: {
    background: { kind: "white", color: "#0e1016" },
    palette: SBER_GREENS,
    params: { title: "Дорожная карта проекта", subtitle: "Срок и результат — через «|»", done: 2, wave: 60 },
    phrases: ["I кв.|Исследование и пилот", "II кв.|Запуск в трёх регионах", "III кв.|Масштабирование на всю страну", "IV кв.|Новые сервисы для бизнеса"],
  },
  draw(f) {
    const { ctx, w, h, s, t } = f;
    const list = f.phrases.filter((x) => x.trim()).slice(0, 8);
    const n = list.length;
    if (!n) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2);
    const cy = (top + h - pad * 0.5) / 2;
    const amp = (Number(f.p.wave ?? 60) / 100) * Math.min(110 * s, (h - top) * 0.16);
    const x0 = pad + 40 * s;
    const x1 = w - pad - 40 * s;
    const Yof = (x: number) => cy + amp * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * (n > 1 ? n - 1 : 1) + Math.PI / 2);
    const kLine = easeInOut(prog(t, 0.3, 0.6 + n * 0.45));
    const xEnd = lerp(x0, x1, kLine);
    const [c1, c2] = duo(pc(f, 0));
    // Дорожка целиком и пройденная часть
    const path = (xa: number, xb: number) => {
      ctx.beginPath();
      for (let x = xa; x <= xb; x += 4 * s) ctx.lineTo(x, Yof(x));
      ctx.lineTo(xb, Yof(xb));
    };
    ctx.lineCap = "round";
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = trackOf(f);
    path(x0, x1);
    ctx.stroke();
    const done = Math.max(0, Math.round(Number(f.p.done ?? 0)));
    const xs = list.map((_, i) => (n === 1 ? (x0 + x1) / 2 : lerp(x0, x1, i / (n - 1))));
    const xDone = done <= 0 ? x0 : done >= n ? x1 : lerp(xs[done - 1], xs[done], 0.5);
    const lg = ctx.createLinearGradient(x0, 0, x1, 0);
    lg.addColorStop(0, c1);
    lg.addColorStop(1, c2);
    ctx.strokeStyle = lg;
    if (xEnd > x0) {
      ctx.lineWidth = 6 * s;
      path(x0, Math.min(xEnd, xDone));
      ctx.stroke();
      // Будущая часть — пунктир
      if (xEnd > xDone) {
        ctx.save();
        ctx.setLineDash([2 * s, 14 * s]);
        ctx.lineWidth = 6 * s;
        ctx.strokeStyle = rgba(c1, 0.8);
        path(xDone, xEnd);
        ctx.stroke();
        ctx.restore();
      }
    }
    // Вехи и карточки, по очереди сверху и снизу
    const cardW = Math.min(360 * s, ((x1 - x0) / Math.max(1, n - 1)) * 1.6, w - pad * 2);
    list.forEach((raw, i) => {
      const x = xs[i];
      const y = Yof(x);
      const reach = n === 1 ? 0 : (x - x0) / (x1 - x0);
      const head = kLine * 1.4;
      const kd = easeBack(clamp((head - reach) * 6));
      if (kd <= 0) return;
      const passed = i < done;
      const r = 16 * s * kd;
      ctx.fillStyle = surfaceOf(f);
      ctx.beginPath();
      ctx.arc(x, y, r + 5 * s, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 5 * s;
      ctx.strokeStyle = c1;
      ctx.fillStyle = passed ? c1 : surfaceOf(f);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (passed && kd > 0.5) {
        // Галочка
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3.5 * s;
        ctx.beginPath();
        ctx.moveTo(x - 6 * s, y + 0.5 * s);
        ctx.lineTo(x - 1.5 * s, y + 5 * s);
        ctx.lineTo(x + 7 * s, y - 5 * s);
        ctx.stroke();
      }
      // Подпись
      const [when, what = ""] = raw.split("|").map((p) => p.trim());
      const above = i % 2 === 0;
      const kt = easeOut(clamp((head - reach) * 4 - 0.2));
      ctx.globalAlpha = kt;
      const align: CanvasTextAlign = n > 1 && i === 0 ? "left" : n > 1 && i === n - 1 ? "right" : "center";
      const tx = align === "left" ? x - 16 * s : align === "right" ? x + 16 * s : x;
      ctx.textAlign = align;
      ctx.font = font(24 * s, 500);
      const lines = what ? wrap(ctx, what, cardW).slice(0, 3) : [];
      const blockH = 40 * s + lines.length * 30 * s;
      const by = above ? y - 44 * s - blockH + (1 - kt) * 14 * s : y + 44 * s - (1 - kt) * 14 * s;
      ctx.textBaseline = "top";
      ctx.font = font(fitFont(ctx, when, cardW, 34 * s, 800), 800);
      ctx.fillStyle = passed ? c1 : f.ink;
      ctx.fillText(when, tx, by);
      ctx.font = font(24 * s, 500);
      ctx.fillStyle = f.muted;
      lines.forEach((line, j) => ctx.fillText(line, tx, by + 44 * s + j * 30 * s));
      ctx.globalAlpha = 1;
    });
  },
};

export const SBER_TEMPLATES: Template[] = [rings, waterfall, gauge, slope, bubbles, roadmap, aurora];
