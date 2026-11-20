import { clamp, fmt, pc, rgba, roundRect } from "../core/draw";
import type { Template } from "../core/types";
import { heading, label, reveal, title } from "./moduleLayout";
import { PRESENTATION_MODULES } from "./presentationModules";

const palette = ["#2549db", "#a94d29", "#176c57", "#7357be", "#a34276"];

const waterfall: Template = {
  id: "impact-bridge", name: "Каскад изменений", group: "modules", input: "rows", duration: 4, loop: false,
  about: "Покажите, как отдельные изменения складываются в итог.",
  controls: [title, { key: "value", label: "Начальное значение", type: "number" }],
  defaults: {
    palette, params: { title: "Из чего сложился результат", value: 120 },
    rows: [{ label: "Продажи", value: 52 }, { label: "Расходы", value: -28 }, { label: "Новые рынки", value: 36 }, { label: "Обменный курс", value: -10 }],
  },
  draw(f) {
    heading(f);
    const start = Number(f.p.value) || 0;
    let total = start;
    const bars = [{ label: "Старт", from: 0, to: start, color: pc(f, 0), value: start }];
    for (const row of f.rows) {
      const from = total;
      total += row.value;
      bars.push({ label: row.label, from, to: total, color: pc(f, row.value < 0 ? 1 : 2), value: row.value });
    }
    bars.push({ label: "Итог", from: 0, to: total, color: pc(f, 0), value: total });
    const values = bars.flatMap(bar => [bar.from, bar.to]);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const y = (v: number) => f.h * (0.76 - 0.48 * (v - lo) / (hi - lo || 1));
    const step = f.w * 0.84 / bars.length;
    bars.forEach((bar, i) => {
      const x = f.w * 0.08 + step * i;
      const end = y(bar.from + (bar.to - bar.from) * reveal(f, i));
      f.ctx.fillStyle = bar.color;
      f.ctx.fillRect(x + step * .15, Math.min(end, y(bar.from)), step * .7, Math.max(f.s, Math.abs(end - y(bar.from))));
      if (i < bars.length - 1) {
        f.ctx.fillStyle = f.muted;
        f.ctx.fillRect(x + step * .85, end, step * .3, 1.5 * f.s);
      }
      label(f, (i && i < bars.length - 1 && bar.value > 0 ? "+" : "") + fmt(bar.value, 1), x + step / 2, Math.min(end, y(bar.from)) - 20 * f.s, step * .95, 33 * f.s, f.ink, "center");
      label(f, bar.label, x + step / 2, f.h * .84, step * .95, 26 * f.s, f.muted, "center");
    });
  },
};

const roadmap: Template = {
  id: "launch-roadmap", name: "План-график", group: "modules", input: "pairs", duration: 4, loop: false,
  about: "Разложите этапы проекта по срокам и покажите пересечения.",
  controls: [title, { key: "caption", label: "Единица времени", type: "text" }],
  defaults: {
    palette, params: { title: "План запуска", caption: "Неделя", s1: "Начало", s2: "Конец" },
    rows: [{ label: "Исследование", value: 1, value2: 3 }, { label: "Прототип", value: 2, value2: 5 }, { label: "Пилот", value: 5, value2: 8 }, { label: "Запуск", value: 8, value2: 10 }],
  },
  draw(f) {
    heading(f);
    const endpoints = f.rows.flatMap(row => [row.value, row.value2 ?? row.value]);
    const lo = endpoints.length ? Math.min(...endpoints) : 1;
    const hi = Math.max(...endpoints, lo + 1);
    const x = (v: number) => f.w * (.34 + .57 * clamp((v - lo) / (hi - lo)));
    const rowH = f.h * .52 / Math.max(1, f.rows.length);
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4;
      f.ctx.fillStyle = f.muted;
      f.ctx.globalAlpha = .25;
      f.ctx.fillRect(x(v), f.h * .28, f.s, f.h * .55);
      f.ctx.globalAlpha = 1;
      label(f, fmt(v, 1), x(v), f.h * .87, f.w * .12, 25 * f.s, f.muted, "center");
    }
    f.rows.forEach((row, i) => {
      const y = f.h * .29 + rowH * (i + .5);
      const end = row.value2 ?? row.value;
      const a = x(Math.min(row.value, end));
      const b = x(Math.max(row.value, end));
      const height = Math.min(rowH * .55, 60 * f.s);
      label(f, row.label, f.w * .08, y, f.w * .23, Math.min(34 * f.s, rowH * .58));
      f.ctx.fillStyle = pc(f, i);
      roundRect(f.ctx, a, y - height / 2, Math.max(4 * f.s, (b - a) * reveal(f, i)), height, height / 4);
      f.ctx.fill();
    });
    label(f, String(f.p.caption), f.w * .08, f.h * .87, f.w * .22, 25 * f.s, f.muted);
  },
};

const matrix: Template = {
  id: "priority-matrix", name: "Матрица приоритетов", group: "modules", input: "pairs", duration: 4, loop: false,
  about: "Сопоставьте усилия и эффект по шкале от 0 до 100.",
  controls: [title, { key: "s1", label: "Горизонтальная ось", type: "text" }, { key: "s2", label: "Вертикальная ось", type: "text" }],
  defaults: {
    palette, params: { title: "Что делать в первую очередь", s1: "Усилия", s2: "Эффект" },
    rows: [{ label: "Автоматизация", value: 22, value2: 83 }, { label: "Новая платформа", value: 72, value2: 74 }, { label: "База знаний", value: 31, value2: 34 }, { label: "Миграция", value: 77, value2: 32 }],
  },
  draw(f) {
    heading(f);
    const { ctx, w, h, s } = f;
    const left = w * .15, top = h * .27, width = w * .71, height = h * .55;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = rgba(pc(f, i), f.dark ? .24 : .12);
      ctx.fillRect(left + (i % 2) * width / 2, top + Math.floor(i / 2) * height / 2, width / 2 - 2 * s, height / 2 - 2 * s);
    }
    label(f, String(f.p.s2), left, top - 22 * s, width / 2, 26 * s, f.muted);
    label(f, String(f.p.s1), left + width, top + height + 27 * s, width / 2, 26 * s, f.muted, "right");
    f.rows.forEach((row, i) => {
      ctx.globalAlpha = reveal(f, i);
      const x = left + width * clamp(row.value / 100);
      const y = top + height * (1 - clamp((row.value2 ?? 0) / 100));
      ctx.fillStyle = pc(f, i);
      ctx.beginPath();
      ctx.arc(x, y, 10 * s, 0, Math.PI * 2);
      ctx.fill();
      label(f, row.label, x, y - 26 * s, width * .37, 29 * s, f.ink, "center");
    });
    ctx.globalAlpha = 1;
  },
};

export const MODULES: Template[] = [...PRESENTATION_MODULES, waterfall, roadmap, matrix];
