// Живые шаблоны: лента-змейка и магнитное поле следуют за курсором (без
// курсора — по своей траектории, так же пишется видео), лента карточек и
// линия со следом.

import { badge, captionOf, clamp, drawCover, pickImage, easeInOut, fitFont, fmtUnit, font, header, lerp, mix, pc, prog, rgba, rng, roundRect, smoothPath, wrap } from "../core/draw";
import type { Frame, Template } from "../core/types";

const TAU = Math.PI * 2;

/** Траектория без курсора: восьмёрка по кадру, период — длительность ролика */
const autoPath = (f: Frame, t: number): [number, number] => {
  const ph = (t / f.dur) * TAU;
  return [0.5 + 0.3 * Math.sin(ph), 0.5 + 0.2 * Math.sin(ph * 2)];
};
/** Цель в момент «ago секунд назад», в пикселях */
const target = (f: Frame, ago: number): [number, number] => {
  const [x, y] = f.follow ? f.follow(ago) : autoPath(f, f.t - ago);
  return [x * f.w, y * f.h];
};

// ── Лента-змейка ──

const ribbon: Template = {
  id: "ribbon",
  name: "Лента-змейка",
  group: "text",
  about: "Надпись на яркой ленте ползёт за курсором, изгибаясь по пути. Без курсора — рисует восьмёрку; клик по кадру закрепляет ленту.",
  input: "none",
  duration: 8,
  loop: true,
  interactive: "Водите мышью по кадру — лента ползёт следом. Клик закрепляет, ещё клик — снова следит.",
  onPalette: (_p, pal) => ({ bandColor: pal[0] }),
  controls: [
    { key: "text", label: "Текст", type: "text" },
    { key: "size", label: "Размер", type: "range", min: 30, max: 200, step: 1 },
    { key: "weight", label: "Насыщенность", type: "range", min: 400, max: 900, step: 100 },
    { key: "spacing", label: "Межбуквенный", type: "range", min: -10, max: 30, step: 1 },
    { key: "ink", label: "Цвет текста", type: "color" },
    { key: "band", label: "Лента под текстом", type: "toggle" },
    { key: "bandColor", label: "Цвет ленты", type: "color" },
    { key: "pad", label: "Поля ленты", type: "range", min: 0, max: 60, step: 1 },
    { key: "speed", label: "Отзывчивость", type: "range", min: 2, max: 14, step: 1 },
  ],
  defaults: {
    params: { text: "Отчёт готов за минуту", size: 84, weight: 800, spacing: 0, ink: "#ffffff", band: true, bandColor: "#ff1c77", pad: 18, speed: 6 },
    background: { kind: "white", color: "#ffffff" },
  },
  draw(f) {
    const { ctx, s } = f;
    const text = String(f.p.text ?? "").trim() || " ";
    const px = Number(f.p.size ?? 84) * s;
    const weight = Number(f.p.weight ?? 700);
    const ls = (Number(f.p.spacing ?? 0) / 100) * px;
    ctx.font = font(px, weight);
    const widths = [...text].map((ch) => ctx.measureText(ch).width + ls);
    const total = widths.reduce((a, b) => a + b, 0);
    // Верёвка из звеньев: голова тянется к цели, остальные держат дистанцию.
    // Состояние не хранится: каждый кадр заново моделирует последние 4 с.
    const seg = Math.max(4 * s, px * 0.18);
    const n = Math.ceil(total / seg) + 2;
    const steps = 240;
    const dt = 4 / steps;
    const k = Number(f.p.speed ?? 6);
    const [sx, sy] = target(f, 4);
    const nodes: [number, number][] = Array.from({ length: n }, (_, i) => [sx - i * seg, sy]);
    for (let st = steps; st >= 0; st--) {
      const [tx, ty] = target(f, st * dt);
      const a = 1 - Math.exp(-k * dt);
      nodes[0][0] += (tx - nodes[0][0]) * a;
      nodes[0][1] += (ty - nodes[0][1]) * a;
      for (let i = 1; i < n; i++) {
        const dx = nodes[i][0] - nodes[i - 1][0];
        const dy = nodes[i][1] - nodes[i - 1][1];
        const d = Math.hypot(dx, dy);
        if (d > seg) {
          nodes[i][0] = nodes[i - 1][0] + (dx / d) * seg;
          nodes[i][1] = nodes[i - 1][1] + (dy / d) * seg;
        }
      }
    }
    // Путь от хвоста к голове: текст читается по ходу движения
    const path = nodes.slice().reverse();
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const len = cum[cum.length - 1];
    const start = Math.max(0, len - total);
    const at = (d: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const k2 = clamp((d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
      return {
        x: lerp(path[i - 1][0], path[i][0], k2),
        y: lerp(path[i - 1][1], path[i][1], k2),
        a: Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]),
      };
    };
    if (f.p.band !== false) {
      ctx.beginPath();
      const steps2 = Math.max(2, Math.ceil(total / (4 * s)));
      for (let i = 0; i <= steps2; i++) {
        const p = at(start + (total * i) / steps2);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = String(f.p.bandColor ?? "#ff1c77");
      ctx.lineWidth = px * 1.05 + Number(f.p.pad ?? 18) * s;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.fillStyle = String(f.p.ink ?? f.ink);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let d = start;
    [...text].forEach((ch, i) => {
      const p = at(d + widths[i] / 2);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillText(ch, 0, px * 0.04);
      ctx.restore();
      d += widths[i];
    });
  },
};

// ── Магнитное поле ──

const magnet: Template = {
  id: "magnet",
  name: "Магнитное поле",
  group: "backgrounds",
  about: "Ровные ряды коротких штрихов разворачиваются к курсору и закручиваются вокруг него. Клик — закрепить узор.",
  input: "none",
  duration: 8,
  loop: true,
  interactive: "Водите мышью по кадру — штрихи тянутся к курсору. Клик закрепляет узор.",
  onPalette: (_p, pal) => ({ hot: pal[0] }),
  controls: [
    { key: "mode", label: "Штрихи", type: "select", options: [["toward", "Смотрят на курсор"], ["around", "Кружат вокруг"]] },
    { key: "step", label: "Шаг сетки", type: "range", min: 14, max: 80, step: 1 },
    { key: "len", label: "Длина штриха", type: "range", min: 20, max: 100, step: 1, unit: "%" },
    { key: "width", label: "Толщина", type: "range", min: 1, max: 10, step: 0.5 },
    { key: "reach", label: "Радиус влияния", type: "range", min: 10, max: 100, step: 1, unit: "%" },
    { key: "color", label: "Цвет штрихов", type: "color" },
    { key: "hot", label: "Цвет у курсора", type: "color" },
  ],
  defaults: {
    params: { mode: "toward", step: 32, len: 62, width: 3, reach: 20, color: "#3a3f52", hot: "#ff4fa3" },
    background: { kind: "dark", color: "#0e1016" },
  },
  draw(f) {
    const { ctx, w, h, s } = f;
    const [tx, ty] = target(f, 0);
    const step = Number(f.p.step ?? 32) * s;
    const len = step * (Number(f.p.len ?? 62) / 100);
    const reach = Math.max(w, h) * (Number(f.p.reach ?? 38) / 100);
    const around = f.p.mode === "around";
    const cold = String(f.p.color ?? "#3a3f52");
    const hot = String(f.p.hot ?? "#ff4fa3");
    ctx.lineCap = "round";
    const cols = Math.ceil(w / step) + 1;
    const rows = Math.ceil(h / step) + 1;
    const ox = (w - (cols - 1) * step) / 2;
    const oy = (h - (rows - 1) * step) / 2;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = ox + c * step;
        const y = oy + r * step;
        const dx = tx - x;
        const dy = ty - y;
        const d = Math.hypot(dx, dy);
        const wgt = Math.exp(-(d * d) / (2 * reach * reach));
        let a = Math.atan2(dy, dx) + (around ? Math.PI / 2 : 0);
        // Вдали — почти горизонтально, вблизи — по полю
        const base = 0;
        const diff = Math.atan2(Math.sin(a - base), Math.cos(a - base));
        a = base + diff * Math.min(1, wgt * 1.6 + 0.08);
        const l = len * (0.55 + 0.75 * wgt);
        // Акцентный цвет — только у курсора, дальше штрихи спокойные
        ctx.strokeStyle = mix(cold, hot, Math.min(1, wgt * wgt * 1.6));
        ctx.lineWidth = Number(f.p.width ?? 3) * s * (0.8 + 0.6 * wgt);
        ctx.beginPath();
        ctx.moveTo(x - (Math.cos(a) * l) / 2, y - (Math.sin(a) * l) / 2);
        ctx.lineTo(x + (Math.cos(a) * l) / 2, y + (Math.sin(a) * l) / 2);
        ctx.stroke();
      }
  },
};

// ── Лента карточек ──

function card(f: Frame, i: number, x: number, y: number, w: number, h: number, r: number) {
  const { ctx, s } = f;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const img = pickImage(f, i);
  if (img) drawCover(ctx, img as HTMLImageElement, x, y, w, h);
  else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, pc(f, i));
    g.addColorStop(1, pc(f, i + 2));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  {
    const text = captionOf(f, i, f.p.captions !== false);
    if (text && img) {
      // Затемнение снизу, чтобы подпись читалась на любом фото
      const sh = ctx.createLinearGradient(0, y + h * 0.45, 0, y + h);
      sh.addColorStop(0, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = sh;
      ctx.fillRect(x, y, w, h);
    }
    if (text) {
      const [main, sub = ""] = text.split("|").map((v) => v.trim());
      const p = w * 0.1;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = font(Math.min(w * 0.12, 60 * s), 800);
      const lines = wrap(ctx, main, w - p * 2).slice(0, 3);
      let yy = y + h - p - (sub ? w * 0.08 : 0) - (lines.length - 1) * w * 0.13;
      for (const l of lines) {
        ctx.fillText(l, x + p, yy);
        yy += w * 0.13;
      }
      if (sub) {
        fitFont(ctx, sub, w - p * 2, Math.min(w * 0.06, 28 * s), 500);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(sub, x + p, y + h - p * 0.75);
      }
    }
  }
  ctx.restore();
}

const flow: Template = {
  id: "flow",
  name: "Лента карточек",
  group: "cards",
  about: "Коллаж из карточек едет рывками: ряды движутся навстречу, карточки покачиваются на ходу и уходят за край. Видео — бесшовная петля.",
  input: "photos",
  duration: 10,
  loop: true,
  controls: [
    { key: "captions", label: "Подписи поверх фото", type: "toggle" },
    { key: "rows", label: "Рядов", type: "range", min: 1, max: 3, step: 1 },
    { key: "size", label: "Размер карточек", type: "range", min: 20, max: 70, step: 1, unit: "%" },
    { key: "gap", label: "Промежуток", type: "range", min: 0, max: 80, step: 1 },
    { key: "radius", label: "Скругление", type: "range", min: 0, max: 60, step: 1 },
    { key: "pause", label: "Пауза между рывками", type: "range", min: 0, max: 80, step: 1, unit: "%" },
    { key: "tilt", label: "Покачивание", type: "range", min: 0, max: 15, step: 1 },
  ],
  defaults: {
    params: { rows: 3, size: 36, gap: 24, radius: 22, pause: 45, tilt: 6, captions: true },
    phrases: ["Команда|наш главный ресурс", "Клиенты|рекомендуют нас", "Качество|в каждой детали", "Скорость|решения за день", "Рост|+18 % за год", "Забота|24/7"],
    palette: ["#5b5bf7", "#ff4fa3", "#ffb547", "#2bd9a6", "#00b4ff", "#9d7bff"],
    background: { kind: "dark", color: "#0e1016" },
  },
  draw(f) {
    const { ctx, w, h, s, t, dur } = f;
    const rowsN = Number(f.p.rows ?? 3);
    const gap = Number(f.p.gap ?? 24) * s;
    // Карточки целиком помещаются в кадр по высоте при любом числе рядов
    const ch = Math.min(h * (Number(f.p.size ?? 36) / 100), (h * 0.9 - gap * (rowsN - 1)) / rowsN);
    const cw = ch * 0.78;
    const pitch = cw + gap;
    const per = Math.max(f.images.length, f.phrases.filter((p) => p.trim()).length, Math.ceil(w / pitch) + 1);
    const stepT = dur / per;
    const pause = Number(f.p.pause ?? 45) / 100;
    const idx = Math.floor(t / stepT);
    const local = (t - idx * stepT) / stepT;
    const frac = easeInOut(clamp((local - pause) / (1 - pause || 1)));
    const vel = Math.sin(clamp((local - pause) / (1 - pause || 1)) * Math.PI);
    const totalH = rowsN * ch + (rowsN - 1) * gap;
    const y0 = (h - totalH) / 2;
    const rad = Number(f.p.radius ?? 22) * s;
    const tilt = (Number(f.p.tilt ?? 6) * Math.PI) / 180;
    const rowW = per * pitch;
    for (let r = 0; r < rowsN; r++) {
      const dir = r % 2 === 0 ? 1 : -1;
      const off = ((idx + frac) * pitch * dir + r * pitch * 0.5) % rowW;
      const y = y0 + r * (ch + gap);
      for (let i = 0; i < per; i++) {
        let x = i * pitch - off;
        x = ((x % rowW) + rowW) % rowW - pitch;
        if (x > w + pitch) continue;
        const cx = x + cw / 2;
        const cy = y + ch / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-dir * vel * tilt * (0.6 + 0.4 * Math.sin(i * 1.7 + r)));
        ctx.shadowColor = "rgba(0,0,0,0.3)";
        ctx.shadowBlur = 24 * s;
        ctx.shadowOffsetY = 8 * s;
        roundRect(ctx, -cw / 2, -ch / 2, cw, ch, rad);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.shadowColor = "transparent";
        card(f, i + r * 2, -cw / 2, -ch / 2, cw, ch, rad);
        ctx.restore();
      }
    }
  },
};

// ── Линия со следом ──

const trail: Template = {
  id: "trail",
  name: "Линия со следом",
  group: "charts",
  about: "Плавная линия из пучка тонких нитей с неровным следом, у точек — россыпь точек и плашка с числом, внизу — подписи.",
  input: "rows",
  duration: 5,
  loop: false,
  controls: [
    { key: "title", label: "Заголовок", type: "text" },
    { key: "subtitle", label: "Подзаголовок", type: "text" },
    { key: "threads", label: "Нитей в следе", type: "range", min: 2, max: 30, step: 1 },
    { key: "spread", label: "Разброс следа", type: "range", min: 0, max: 100, step: 1 },
    { key: "badges", label: "Плашки у точек", type: "toggle" },
    { key: "prefix", label: "Перед числом", type: "text", placeholder: "+, $" },
    { key: "unit", label: "Единица", type: "text", placeholder: "%, ₽, млн" },
    { key: "decimals", label: "Знаков после запятой", type: "number", min: 0, max: 3, step: 1 },
  ],
  defaults: {
    params: { title: "Конверсия в покупку", subtitle: "по месяцам", threads: 16, spread: 70, badges: true, unit: "%", decimals: 0 },
    rows: [
      { label: "Янв", value: 10 },
      { label: "Фев", value: 14 },
      { label: "Мар", value: 12 },
      { label: "Апр", value: 25 },
      { label: "Май", value: 18 },
      { label: "Июн", value: 22 },
      { label: "Июл", value: 34 },
    ],
    background: { kind: "dark", color: "#0e1016" },
  },
  draw(f) {
    const { ctx, w, h, s, t, rows } = f;
    const n = rows.length;
    if (n < 2) return;
    const pad = 84 * s;
    const top = header(f, pad, pad * 0.8, w - pad * 2) + 80 * s;
    const x0 = pad;
    const x1 = w - pad;
    const y1 = h - pad - 40 * s;
    const vals = rows.map((r) => r.value || 0);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals) || lo + 1;
    const yOf = (v: number) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - top) * 0.92;
    const pts = vals.map((v, i) => [x0 + ((x1 - x0) * i) / (n - 1), yOf(v)] as [number, number]);
    const color = pc(f, 0);
    const k = easeInOut(prog(t, 0.2, 1.8));
    const reveal = x0 + (x1 - x0) * k;
    const threads = Number(f.p.threads ?? 14);
    const spread = (Number(f.p.spread ?? 46) / 100) * 60 * s;
    const r = rng(17);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, reveal + 2, h);
    ctx.clip();
    // Нити: смещения нулевые в точках данных и максимальные между ними
    for (let j = 0; j < threads; j++) {
      const amp = (r() - 0.5) * 2 * spread;
      const ph = r() * TAU;
      const q: [number, number][] = [];
      const N = (n - 1) * 16;
      for (let i = 0; i <= N; i++) {
        const u = i / 16;
        const seg = Math.min(n - 2, Math.floor(u));
        const lt = u - seg;
        const env = Math.sin(lt * Math.PI);
        const x = lerp(pts[seg][0], pts[seg + 1][0], lt);
        const yb = lerp(pts[seg][1], pts[seg + 1][1], (1 - Math.cos(lt * Math.PI)) / 2);
        q.push([x, yb + env * amp * (0.6 + 0.4 * Math.sin(ph + u * 2.1))]);
      }
      ctx.beginPath();
      smoothPath(ctx, q, false);
      ctx.strokeStyle = rgba(color, 0.18 + 0.2 * r());
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.stroke();
    }
    ctx.beginPath();
    smoothPath(ctx, pts, true);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * s;
    ctx.shadowColor = rgba(color, 0.6);
    ctx.shadowBlur = 20 * s;
    ctx.stroke();
    ctx.restore();
    pts.forEach(([x, y], i) => {
      const a = clamp((reveal - x) / (60 * s) + 1);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      // Россыпь точек вокруг точки данных
      for (let ring = 1; ring <= 3; ring++) {
        const cnt = ring * 8;
        for (let d = 0; d < cnt; d++) {
          const ang = (d / cnt) * TAU + ring;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * ring * 9 * s, y + Math.sin(ang) * ring * 9 * s, (3.4 - ring) * s, 0, TAU);
          ctx.fillStyle = rgba(color, 0.55 - ring * 0.13);
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.arc(x, y, 7 * s, 0, TAU);
      ctx.fillStyle = f.base ?? (f.dark ? "#0e1016" : "#ffffff");
      ctx.fill();
      ctx.lineWidth = 3.5 * s;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (f.p.badges !== false) badge(f, fmtUnit(vals[i], f), x, y - 30 * s, f.dark ? "#ffffff" : "#15171c", 24 * s);
      ctx.font = font(24 * s, 500);
      ctx.fillStyle = f.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(rows[i].label, x, y1 + 28 * s);
      ctx.globalAlpha = 1;
    });
  },
};

export const MOTION: Template[] = [ribbon, magnet, flow, trail];
