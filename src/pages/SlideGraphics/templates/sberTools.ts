import { fmt, font, pc, rgba, roundRect, wrap } from "../core/draw";
import type { Control, Frame, Template } from "../core/types";
import { heading, label, reveal, title } from "./moduleLayout";
import { SBER, SBER_GREENS } from "./sber";

const whiteSlide = { kind: "white", color: "#ffffff" } as const;
const unit: Control = { key: "unit", label: "Единица измерения", type: "text" };
const numberField = (key: string, name: string, step = 1): Control =>
  ({ key, label: name, type: "number", min: 0, step, data: true });

function hint(f: Frame, text: string) {
  label(f, text, f.w / 2, f.h * .54, f.w * .84, 38 * f.s, f.muted, "center");
}

const sankey: Template = {
  id: "sb-flows", name: "Потоки Санкея", group: "charts", input: "flows", duration: 4, loop: false,
  about: "Проследите, как бюджет распределяется между направлениями. Ширина каждой ленты соответствует сумме.",
  controls: [title, unit],
  defaults: {
    background: whiteSlide, palette: SBER, params: { title: "Распределение инвестиций", unit: "млн ₽" },
    rows: [
      { label: "Розница", note: "Цифровые сервисы", value: 45 },
      { label: "Розница", note: "Инфраструктура", value: 18 },
      { label: "Бизнес", note: "Цифровые сервисы", value: 12 },
      { label: "Бизнес", note: "Обучение", value: 25 },
    ],
  },
  draw(f) {
    heading(f);
    const { w, h, s, ctx } = f;
    const sources = new Map<string, number>(), targets = new Map<string, number>();
    const links = f.rows.filter(row => row.value !== 0);
    for (const row of links) {
      const from = row.label.trim(), to = row.note?.trim();
      if (!(row.value > 0) || !from || !to) return hint(f, "Укажите источник, получателя и положительный объём");
      sources.set(from, (sources.get(from) ?? 0) + row.value);
      targets.set(to, (targets.get(to) ?? 0) + row.value);
    }
    const total = links.reduce((sum, r) => sum + r.value, 0);
    if (!total) return hint(f, "Добавьте поток с положительным объёмом");
    if (!Number.isFinite(total)) return hint(f, "Уменьшите масштаб чисел");
    const height = h * .56;
    const gap = Math.min(64 * s, height / (2 * Math.max(sources.size, targets.size)));
    const scale = (height - Math.max(sources.size, targets.size) * gap) / total;
    function layout(totals: Map<string, number>) {
      const gapY = (height - total * scale) / totals.size;
      let y = h * .28 + gapY / 2;
      return new Map([...totals].map(([name, value], i) => {
        const node = { y, cursor: y, height: value * scale, color: pc(f, i), value };
        y += node.height + gapY;
        return [name, node] as const;
      }));
    }
    const left = layout(sources), right = layout(targets);
    const x1 = w * .28, x2 = w * .72, cx = w / 2;
    for (const row of links) {
      const a = left.get(row.label.trim())!, b = right.get(row.note!.trim())!;
      const thickness = row.value * scale;
      const gradient = ctx.createLinearGradient(x1, 0, x2, 0);
      gradient.addColorStop(0, rgba(a.color, .65));
      gradient.addColorStop(1, rgba(b.color, .48));
      ctx.fillStyle = gradient;
      ctx.globalAlpha = reveal(f, 0);
      ctx.beginPath();
      ctx.moveTo(x1, a.cursor);
      ctx.bezierCurveTo(cx, a.cursor, cx, b.cursor, x2, b.cursor);
      ctx.lineTo(x2, b.cursor + thickness);
      ctx.bezierCurveTo(cx, b.cursor + thickness, cx, a.cursor + thickness, x1, a.cursor + thickness);
      ctx.closePath();
      ctx.fill();
      a.cursor += thickness;
      b.cursor += thickness;
    }
    ctx.globalAlpha = 1;
    const digits = Math.min(32 * s, gap * .43);
    for (const [nodes, x, side] of [[left, x1, -1], [right, x2, 1]] as const) {
      for (const [name, node] of nodes) {
        ctx.fillStyle = node.color;
        ctx.fillRect(x - 4 * s, node.y, 8 * s, node.height);
        const mid = node.y + node.height / 2, tx = x + side * 16 * s;
        const align = side < 0 ? "right" : "left";
        label(f, name, tx, mid - digits * .6, w * .235, digits, f.ink, align);
        label(f, node.value.toLocaleString("ru-RU") + " " + f.p.unit, tx, mid + digits * .6, w * .235, digits * .87, f.muted, align);
      }
    }
  },
};

const forecast: Template = {
  id: "sb-forecast", name: "Коридор прогноза", group: "charts", input: "pairs", duration: 4, loop: false,
  about: "Задайте нижнюю и верхнюю оценки по периодам. Полоса покажет, где сценарии сближаются или расходятся.",
  controls: [title, unit],
  defaults: {
    background: whiteSlide, palette: SBER_GREENS, params: { title: "Прогноз спроса", unit: "тыс. заказов", s1: "Нижняя оценка", s2: "Верхняя оценка" },
    rows: [{ label: "Март", value: 41, value2: 43 }, { label: "Апрель", value: 45, value2: 51 }, { label: "Май", value: 43, value2: 59 }, { label: "Июнь", value: 50, value2: 68 }],
  },
  draw(f) {
    const { rows, ctx, w, h, s } = f;
    heading(f);
    if (rows.length < 2) return hint(f, "Добавьте оценки для двух или более периодов");
    if (rows.some(r => r.value2 == null || r.value > r.value2)) return hint(f, "Проверьте нижнюю и верхнюю оценки каждого периода");
    const lo = rows.reduce((n, r) => Math.min(n, r.value), Infinity);
    const hi = rows.reduce((n, r) => Math.max(n, r.value2!), -Infinity);
    if (!Number.isFinite(hi - lo)) return hint(f, "Уменьшите масштаб чисел");
    const x = (i: number) => w * (.15 + .73 * i / (rows.length - 1));
    const y = (v: number) => h * (hi === lo ? .55 : .77 - .44 * ((v - lo) / (hi - lo)));
    label(f, String(f.p.unit), x(0), h * .24, w * .6, 31 * s, f.muted);
    for (let i = 0; i <= (lo === hi ? 0 : 2); i++) {
      const v = lo + (hi - lo) * (i / 2);
      ctx.fillStyle = rgba(f.ink, .12);
      ctx.fillRect(x(0), y(v), w * .73, 2 * s);
      label(f, v.toLocaleString("ru-RU"), x(0) - 10 * s, y(v), w * .12, 28 * s, f.muted, "right");
    }
    const slot = w * .73 / (rows.length - 1);
    rows.forEach((row, i) => label(f, row.label, x(i), h * .85, Math.min(slot * .93, w * .21), 31 * s, f.ink, "center"));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x(0) - 4 * s, h * .29, (w * .73 + 8 * s) * reveal(f, 0), h * .53);
    ctx.clip();
    ctx.beginPath();
    rows.forEach((r, i) => i ? ctx.lineTo(x(i), y(r.value2!)) : ctx.moveTo(x(i), y(r.value2!)));
    for (let i = rows.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(rows[i].value));
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, h * .33, 0, h * .77);
    fill.addColorStop(0, rgba(pc(f, 0), .52));
    fill.addColorStop(1, rgba(pc(f, 2), .14));
    ctx.fillStyle = fill;
    ctx.fill();
    for (const upper of [false, true]) {
      ctx.beginPath();
      ctx.strokeStyle = pc(f, upper ? 0 : 1);
      ctx.lineWidth = 5 * s;
      ctx.setLineDash(upper ? [] : [12 * s, 8 * s]);
      rows.forEach((r, i) => {
        const yy = y(upper ? r.value2! : r.value);
        if (i === 0) ctx.moveTo(x(i), yy);
        else ctx.lineTo(x(i), yy);
      });
      ctx.stroke();
    }
    ctx.restore();
  },
};

const breakEven: Template = {
  id: "sb-break-even", name: "Точка безубыточности", group: "charts", input: "single", duration: 4, loop: false,
  about: "Введите цену и затраты. Линии выручки и расходов покажут минимальный объём продаж для выхода в ноль.",
  controls: [title, numberField("fixed", "Постоянные затраты, ₽", .01), numberField("price", "Цена за единицу, ₽", .01), numberField("variable", "Затраты на единицу, ₽", .01)],
  defaults: { background: whiteSlide, palette: SBER, params: { title: "Когда продажи покроют затраты", fixed: 180000, price: 1500, variable: 900 } },
  draw(f) {
    const { ctx, w, h, s } = f;
    heading(f);
    const [fixed, price, variable] = [f.p.fixed, f.p.price, f.p.variable].map(v => Math.round(Number(v) * 100));
    if ([fixed, price, variable].some(v => !Number.isSafeInteger(v) || v < 0)) return hint(f, "Введите неотрицательные затраты и цену в рублях");
    if (price <= variable) {
      if (fixed === 0 && price === variable) return hint(f, "Выручка равна затратам при любом объёме");
      return hint(f, fixed ? "Выручка не покрывает затраты ни при каком объёме" : "При положительных продажах затраты выше выручки");
    }
    const crossing = fixed / (price - variable);
    const units = Math.ceil(crossing);
    const maxQ = Math.max(10, Math.ceil(crossing * 1.6));
    const maxY = price * maxQ;
    const x = (q: number) => w * (.15 + .72 * q / maxQ);
    const y = (cost: number) => h * (.78 - .41 * cost / maxY);
    label(f, "Порог продаж  ·  " + fmt(units) + " шт.", w * .08, h * .25, w * .84, 46 * s);
    label(f, fmt(maxY / 100) + " ₽", x(0) - 8 * s, y(maxY), w * .135, 25 * s, f.muted, "right");
    ctx.fillStyle = rgba(f.ink, .26);
    ctx.fillRect(x(0), y(maxY), 2 * s, .41 * h);
    ctx.fillRect(x(0), y(0), .72 * w, 2 * s);
    const q = maxQ * reveal(f, 0);
    for (const [i, initial, rate, name] of [[0, 0, price, "Выручка"], [1, fixed, variable, "Затраты"]] as const) {
      ctx.strokeStyle = pc(f, i);
      ctx.lineWidth = 6 * s;
      ctx.setLineDash(i === 1 ? [14 * s, 9 * s] : []);
      ctx.beginPath();
      ctx.moveTo(x(0), y(initial));
      ctx.lineTo(x(q), y(initial + q * rate));
      ctx.stroke();
      label(f, name, x(maxQ) + 7 * s, y(initial + maxQ * rate) + (i === 0 ? -14 : 14) * s, w * .12, 27 * s, f.ink);
    }
    ctx.setLineDash([]);
    label(f, "0", x(0), h * .84, w * .12, 30 * s, f.muted, "center");
    label(f, fmt(maxQ) + " шт.", x(maxQ), h * .84, w * .18, 30 * s, f.muted, "center");
    if (q >= crossing) {
      ctx.fillStyle = pc(f, 0);
      ctx.beginPath();
      ctx.arc(x(crossing), y(crossing * price), 11 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const npsGroups = [
  ["promoters", "Сторонники", "9–10"], ["passives", "Нейтральные", "7–8"], ["detractors", "Критики", "0–6"],
] as const;

const nps: Template = {
  id: "sb-nps", name: "Индекс лояльности NPS", group: "charts", input: "single", duration: 4, loop: false,
  about: "Посчитайте NPS по числу ответов и покажите, из каких трёх групп сложился результат.",
  controls: [title, ...npsGroups.map(([key, name, range]) => numberField(key, name + " (" + range + ")"))],
  defaults: { background: whiteSlide, palette: SBER, params: { title: "Готовность рекомендовать сервис", promoters: 68, passives: 20, detractors: 12 } },
  draw(f) {
    heading(f);
    const counts = npsGroups.map(([key]) => Number(f.p[key]));
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) return hint(f, "Число ответов в каждой группе должно быть целым и неотрицательным");
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (!total) return hint(f, "Введите число ответов хотя бы для одной группы");
    const { ctx, w, h, s } = f;
    if (!Number.isSafeInteger(total)) return hint(f, "Сумма ответов слишком велика для точного расчёта");
    const difference = counts[0] - counts[2];
    const score = Math.sign(difference) * Math.round(Math.abs(difference) / total * 100);
    label(f, (score > 0 ? "+" : "") + String(score), w * .08, h * .35, w * .45, 176 * s, f.ink);
    label(f, "NPS", w * .08, h * .48, w * .22, 42 * s, f.muted);
    label(f, "Ответов: " + fmt(total), w * .92, h * .48, w * .41, 40 * s, f.muted, "right");
    let x = w * .08;
    counts.forEach((n, i) => {
      const width = w * .84 * n / total;
      ctx.fillStyle = pc(f, i);
      ctx.fillRect(x, h * .56, width * reveal(f, 0), h * .09);
      x += width;
      const left = w * (.08 + .29 * i);
      ctx.fillRect(left, h * .72, 30 * s, 5 * s);
      label(f, npsGroups[i][1], left, h * .78, w * .25, 34 * s);
      label(f, fmt(n / total * 100, 1) + "%", left, h * .86, w * .25, 42 * s);
    });
  },
};

const quadrants = [
  ["strengths", "Сильные стороны"], ["weaknesses", "Слабые стороны"],
  ["opportunities", "Возможности"], ["threats", "Угрозы"],
] as const;

const swot: Template = {
  id: "sb-swot", name: "SWOT-анализ", group: "modules", input: "single", duration: 4, loop: false,
  about: "Разберите решение по четырём направлениям. В каждое поле можно вписать несколько тезисов.",
  controls: [title, ...quadrants.map(([key, name]): Control => ({ key, label: name, type: "textarea", data: true }))],
  defaults: {
    background: whiteSlide, palette: SBER, params: { title: "Запуск нового сервиса", strengths: "Своя команда разработки\nОпыт пилотного запуска", weaknesses: "Мало данных об аудитории", opportunities: "Выход в новые регионы", threats: "Рост стоимости привлечения" },
  },
  draw(f) {
    heading(f);
    const { w, h, ctx, s } = f;
    const columns = w >= h ? 2 : 1;
    const gap = 18 * s, rows = 4 / columns;
    const width = (w * .84 - (columns - 1) * gap) / columns;
    const height = (h * .69 - (rows - 1) * gap) / rows;
    quadrants.forEach(([key, name], i) => {
      const x = w * .08 + (i % columns) * (width + gap);
      const y = h * .21 + Math.floor(i / columns) * (height + gap);
      const pad = Math.min(30 * s, height * .09);
      ctx.globalAlpha = reveal(f, i);
      ctx.fillStyle = rgba(pc(f, i), f.dark ? .22 : .1);
      roundRect(ctx, x, y, width, height, 24 * s);
      ctx.fill();
      const tx = x + pad, inner = width - 2 * pad;
      ctx.fillStyle = pc(f, i);
      roundRect(ctx, tx, y + pad, 54 * s, 6 * s, 3 * s);
      ctx.fill();
      label(f, name, tx, y + height * .29, inner, Math.min(44 * s, height * .18));
      const content = String(f.p[key]).trim();
      let size = Math.min(35 * s, height * .17);
      ctx.font = font(size, 500);
      let lines = wrap(ctx, content, inner);
      while (size > s && lines.length * size * 1.3 > height * .48) {
        size *= .86;
        ctx.font = font(size, 500);
        lines = wrap(ctx, content, inner);
      }
      const lineHeight = Math.min(size * 1.3, height * .48 / lines.length);
      lines.forEach((line, j) => label(f, line, tx, y + height * .45 + (j + .5) * lineHeight, inner, Math.min(size, lineHeight), f.ink));
    });
  },
};

function clockLabel(minutes: number) {
  const days = Math.floor(minutes / 1440), within = minutes % 1440;
  const time = [Math.floor(within / 60), within % 60].map(n => String(n).padStart(2, "0")).join(":");
  return days ? time + " (+" + days + " д.)" : time;
}

const agenda: Template = {
  id: "sb-agenda", name: "Повестка встречи", group: "modules", input: "rows", duration: 4, loop: false,
  about: "Укажите начало и длительность тем в минутах. Расписание и время окончания пересчитаются автоматически.",
  controls: [title, { key: "start", label: "Начало встречи", type: "time", data: true }],
  defaults: {
    background: whiteSlide, palette: SBER_GREENS, params: { title: "Проектная встреча", start: "10:00", s1: "Минуты" },
    rows: [{ label: "Итоги недели", value: 10 }, { label: "Демонстрация прототипа", value: 20 }, { label: "Обсуждение", value: 15 }, { label: "Следующие шаги", value: 5 }],
  },
  draw(f) {
    heading(f);
    const { rows, w, h, s, ctx } = f;
    const start = String(f.p.start);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return hint(f, "Укажите время начала встречи");
    if (!rows.length || rows.some(r => !Number.isSafeInteger(r.value) || r.value <= 0)) return hint(f, "Укажите длительность каждой темы в целых минутах");
    const [hours, minutes] = start.split(":").map(Number);
    let current = hours * 60 + minutes;
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const rowHeight = h * .53 / rows.length;
    const textSize = Math.min(44 * s, rowHeight * .44);
    label(f, start + " — " + clockLabel(current + total), w * .08, h * .26, w * .62, 55 * s);
    label(f, fmt(total) + " мин", w * .92, h * .26, w * .23, 42 * s, f.muted, "right");
    rows.forEach((row, i) => {
      const mid = h * .34 + (i + .5) * rowHeight;
      ctx.globalAlpha = reveal(f, i);
      ctx.fillStyle = rgba(pc(f, i), f.dark ? .23 : .09);
      roundRect(ctx, w * .08, mid - rowHeight * .45, w * .84, rowHeight * .9, 16 * s);
      ctx.fill();
      label(f, clockLabel(current), w * .1, mid, w * .18, textSize);
      label(f, row.label, w * .3, mid, w * .43, textSize);
      label(f, fmt(row.value) + " мин", w * .90, mid, w * .15, textSize * .83, f.muted, "right");
      current += row.value;
    });
  },
};

export const NEW_SBER_TOOLS: Template[] = [sankey, forecast, nps, swot, breakEven, agenda];
