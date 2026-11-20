import { clamp, fmt, luminance, pc, rgba, roundRect } from "../core/draw";
import { CONVERTIX } from "../core/render";
import type { Frame, Template } from "../core/types";
import { heading, label, reveal, title } from "./moduleLayout";

function message(f: Frame, text: string) {
  label(f, text, f.w / 2, f.h * .55, f.w * .82, 36 * f.s, f.muted, "center");
}

/** Отрицательная величина не задаёт долю целого. Нулевые категории занимают нулевую площадь. */
function shares(f: Frame) {
  if (f.rows.some(row => row.value < 0)) {
    message(f, "Для расчёта долей нужны неотрицательные значения");
    return [];
  }
  const sorted = f.rows.filter(row => row.value > 0).sort((a, b) => b.value - a.value);
  if (!sorted.length) {
    message(f, "Добавьте хотя бы одно положительное значение");
    return [];
  }
  const max = sorted[0].value;
  const total = sorted.reduce((sum, row) => sum + row.value / max, 0);
  return sorted.map(row => ({ ...row, share: (row.value / max) / total }));
}

const pareto: Template = {
  id: "pareto", name: "Диаграмма Парето", group: "modules", input: "rows", duration: 4, loop: false,
  about: "Расположите причины по вкладу и проследите, где их суммарная доля достигает порога.",
  controls: [title, { key: "unit", label: "Подпись столбцов", type: "text" },
    { key: "threshold", label: "Порог доли", type: "range", min: 10, max: 100, step: 5, unit: "%" }],
  defaults: {
    palette: CONVERTIX, params: { title: "Почему клиенты обращаются в поддержку", unit: "Обращения", threshold: 80 },
    rows: [{ label: "Доставка", value: 42 }, { label: "Оплата", value: 27 }, { label: "Возврат", value: 16 }, { label: "Наличие", value: 10 }, { label: "Прочее", value: 5 }],
  },
  draw(f) {
    const { ctx, w, h, s } = f;
    heading(f);
    const rows = shares(f);
    if (!rows.length) return;

    const left = .08 * w, right = .86 * w, top = .33 * h, bottom = .79 * h;
    const height = bottom - top;
    const step = (right - left) / rows.length;
    const bar = pc(f, 0), curve = pc(f, 1);
    const threshold = Number(f.p.threshold) / 100;
    label(f, String(f.p.unit), left, h * .24, w * .38, 30 * s, bar);
    label(f, "Накопленная доля", right, h * .24, w * .38, 30 * s, curve, "right");
    ctx.fillStyle = f.muted;
    ctx.fillRect(left, bottom, right - left, s);

    const pointY = (fraction: number) => bottom - fraction * height;
    const thresholdY = pointY(threshold);
    ctx.strokeStyle = f.muted;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([9 * s, 7 * s]);
    ctx.beginPath();
    ctx.moveTo(left, thresholdY);
    ctx.lineTo(right, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);
    label(f, fmt(threshold * 100) + "%", right + 8 * s, thresholdY, w * .12, 28 * s, f.muted);

    let cumulative = 0;
    const points = rows.map((row, i) => {
      const x = left + (i + .5) * step;
      const progress = reveal(f, i);
      const barHeight = row.value / rows[0].value * height * progress;
      ctx.fillStyle = rgba(bar, cumulative < threshold - 1e-10 ? .84 : .35);
      roundRect(ctx, x - step * .32, bottom - barHeight, step * .64, barHeight, [8 * s, 8 * s, 0, 0]);
      ctx.fill();
      label(f, row.value.toLocaleString("ru-RU"), x, bottom - barHeight - 18 * s, step * .92, 28 * s, f.ink, "center");
      label(f, row.label, x, h * .85, step * .94, 32 * s, f.ink, "center");
      cumulative += row.share;
      return { x, y: pointY(cumulative * reveal(f, 0)) };
    });
    ctx.lineWidth = 5 * s;
    ctx.lineJoin = "round";
    ctx.strokeStyle = curve;
    ctx.beginPath();
    points.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
    ctx.fillStyle = curve;
    points.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, Math.min(8 * s, step * .23), 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const treemap: Template = {
  id: "treemap", name: "Карта долей", group: "modules", input: "rows", duration: 4, loop: false,
  about: "Сравните статьи бюджета по площади прямоугольников. Доли рассчитываются из ваших чисел.",
  controls: [title, { key: "labels", label: "Показывать проценты", type: "toggle" }],
  defaults: {
    palette: CONVERTIX, params: { title: "Структура бюджета", labels: true },
    rows: [{ label: "Разработка", value: 44 }, { label: "Маркетинг", value: 23 }, { label: "Продажи", value: 16 }, { label: "Поддержка", value: 11 }, { label: "Прочее", value: 6 }],
  },
  draw(f) {
    const { ctx, s, w, h } = f;
    heading(f);
    const rows = shares(f);
    if (!rows.length) return;

    // Делим длинную сторону прямоугольника между двумя группами близкой суммарной площади.
    function partition(start: number, end: number, x: number, y: number, width: number, height: number) {
      if (width < 1 || height < 1) return;
      if (end - start === 1) {
        const row = rows[start];
        const color = pc(f, start);
        const gap = Math.min(3 * s, width / 12, height / 12);
        ctx.globalAlpha = reveal(f, start);
        ctx.fillStyle = color;
        roundRect(ctx, x + gap, y + gap, width - 2 * gap, height - 2 * gap, 12 * s);
        ctx.fill();
        const size = Math.min(62 * s, height * .26, width * .24);
        if (size < 13 * s) return;
        const ink = luminance(color) > .18 ? "#14151b" : "#ffffff";
        const inset = Math.min(25 * s, width * .09);
        const textWidth = width - 2 * inset;
        const mid = y + height / 2;
        label(f, row.label, x + inset, f.p.labels ? mid - size * .62 : mid, textWidth, size * .78, ink);
        if (f.p.labels) {
          label(f, fmt(row.share * 100, 1) + "%", x + inset, mid + size * .54, textWidth, size, ink);
        }
        return;
      }

      let sum = 0;
      for (let i = start; i < end; i++) sum += rows[i].share;
      let split = start + 1, first = rows[start].share;
      while (split < end - 1 && Math.abs(first + rows[split].share - sum / 2) < Math.abs(first - sum / 2)) {
        first += rows[split].share;
        split++;
      }
      const ratio = first / sum;
      if (width >= height) {
        const dx = width * ratio;
        partition(start, split, x, y, dx, height);
        partition(split, end, x + dx, y, width - dx, height);
      } else {
        const dy = height * ratio;
        partition(start, split, x, y, width, dy);
        partition(split, end, x, y + dy, width, height - dy);
      }
    }
    partition(0, rows.length, .08 * w, .24 * h, .84 * w, .65 * h);
    ctx.globalAlpha = 1;
  },
};

const radar: Template = {
  id: "skills-radar", name: "Профиль компетенций", group: "modules", input: "pairs", duration: 4, loop: false,
  about: "Сравните два профиля по трём и более критериям на общей шкале от 0 до 100.",
  controls: [title, { key: "s1", label: "Первый профиль", type: "text" }, { key: "s2", label: "Второй профиль", type: "text" }],
  defaults: {
    palette: CONVERTIX, params: { title: "Компетенции команды", s1: "Сейчас", s2: "Цель" },
    rows: [{ label: "Аналитика", value: 85, value2: 95 }, { label: "Дизайн", value: 60, value2: 85 }, { label: "Разработка", value: 90, value2: 80 }, { label: "Продукт", value: 70, value2: 95 }, { label: "Коммуникация", value: 55, value2: 75 }],
  },
  draw(f) {
    const { ctx, w, h, s, rows } = f;
    heading(f);
    if (rows.length < 3) return message(f, "Для сравнения нужны хотя бы три критерия");
    if (rows.some(row => row.value !== clamp(row.value, 0, 100) || (row.value2 ?? 0) !== clamp(row.value2 ?? 0, 0, 100))) {
      return message(f, "Оценки должны быть в диапазоне от 0 до 100");
    }
    const cx = w * .5, cy = h * .57, radius = Math.min(w * .29, h * .25);
    const axes = rows.map((_, i) => {
      const angle = Math.PI * (2 * i / rows.length - .5);
      return { dx: Math.cos(angle), dy: Math.sin(angle) };
    });
    function polygon(lengths: number[]) {
      ctx.beginPath();
      axes.forEach(({ dx, dy }, i) => {
        const x = cx + dx * lengths[i], y = cy + dy * lengths[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = rgba(f.ink, .18);
    for (const step of [.25, .5, .75, 1]) {
      polygon(axes.map(() => step * radius));
      ctx.stroke();
    }
    axes.forEach(({ dx, dy }, i) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * radius, cy + dy * radius);
      ctx.stroke();
      const align = Math.abs(dx) < .08 ? "center" : dx < 0 ? "right" : "left";
      const x = cx + dx * (radius + 14 * s);
      const space = align === "center" ? w * .45 : (dx < 0 ? x : w - x) - w * .03;
      label(f, rows[i].label, x, cy + dy * (radius + 24 * s), space, Math.min(32 * s, radius * 1.7 / axes.length), f.ink, align);
    });
    for (const series of [1, 0]) {
      const color = pc(f, series);
      const progress = reveal(f, series);
      polygon(rows.map(row => radius * (series === 0 ? row.value : row.value2 ?? 0) / 100 * progress));
      ctx.fillStyle = rgba(color, series === 0 ? .22 : .08);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 5 * s;
      ctx.setLineDash(series ? [12 * s, 6 * s] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const tick of [50, 100]) {
      label(f, String(tick), cx + 8 * s, cy - radius * tick / 100 + 10 * s, radius * .3, 20 * s, f.ink);
    }
    for (let i = 0; i < 2; i++) {
      const x = w * (.08 + i * .46);
      ctx.strokeStyle = pc(f, i);
      ctx.setLineDash(i === 1 ? [9 * s, 5 * s] : []);
      ctx.beginPath();
      ctx.moveTo(x, h * .925);
      ctx.lineTo(x + 42 * s, h * .925);
      ctx.stroke();
      label(f, String(i === 0 ? f.p.s1 : f.p.s2), x + 54 * s, h * .925, w * .34, 30 * s);
    }
  },
};

const pyramid: Template = {
  id: "levels-pyramid", name: "Пирамида уровней", group: "modules", input: "phrases", duration: 4, loop: false,
  phrasesLabel: "Уровни от вершины к основанию, по одному в строке. Пояснение — после «|».",
  about: "Соберите иерархию от вершины к основанию и подпишите каждый уровень.",
  controls: [title],
  defaults: {
    palette: CONVERTIX, params: { title: "От стратегии к действиям" },
    phrases: ["Стратегия | Задаёт направление", "Цели | Описывают результат", "Инициативы | Объединяют проекты", "Задачи | Определяют следующий шаг"],
  },
  draw(f) {
    const { ctx, w, h, s } = f;
    heading(f);
    const levels = f.phrases.map(line => line.trim()).filter(Boolean);
    if (!levels.length) return message(f, "Добавьте названия уровней");
    const cx = w * .28, top = h * .25, height = h * .61;
    const rowH = height / levels.length;
    const halfWidth = (y: number) => (y - top) / height * w * .2;
    levels.forEach((line, i) => {
      const [name, ...notes] = line.split("|");
      const note = notes.join("|").trim();
      const y = top + rowH * i;
      const bottom = y + rowH - Math.min(5 * s, rowH * .06);
      const mid = y + rowH / 2;
      ctx.globalAlpha = reveal(f, i);
      ctx.fillStyle = pc(f, i);
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth(y), y);
      ctx.lineTo(cx + halfWidth(y), y);
      ctx.lineTo(cx + halfWidth(bottom), bottom);
      ctx.lineTo(cx - halfWidth(bottom), bottom);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(pc(f, i), .5);
      const start = cx + halfWidth(mid) + 5 * s;
      ctx.fillRect(start, mid, w * .51 - start, 2 * s);
      label(f, name.trim(), w * .53, note ? mid - rowH * .13 : mid, w * .4, Math.min(49 * s, rowH * .35));
      if (note) label(f, note, w * .53, mid + rowH * .18, w * .4, Math.min(32 * s, rowH * .23), f.muted);
    });
    ctx.globalAlpha = 1;
  },
};

export const PRESENTATION_MODULES = [pareto, treemap, radar, pyramid];
