// Подготовка данных для графика: группировка повторяющихся категорий,
// порядок (даты — по времени), топ-N со сводом в «Другое», точки для
// точечного графика и линия тренда. Один и тот же результат видят
// превью, карточка на холсте, таблица данных и экспорт.

import type {
  Aggregation,
  CategoryPoint,
  ChartConfig,
  ChartData,
  ColumnInfo,
  ParsedData,
  ScatterPoint,
  SeriesInfo,
} from "../types";
import { dateKey } from "./dataParser";
import { MAX_SCATTER_SERIES, MAX_SERIES, seriesColor } from "./palettes";

export const OTHER_LABEL = "Другое";
export const EMPTY_LABEL = "(пусто)";

/** Круговая: не больше 7 долей + «Другое» — иначе цвета начнут повторяться. */
export const PIE_MAX_SLICES = 7;
export const PIE_DEFAULT_SLICES = 6;

/** Потолок точек: дальше графики нечитаемы и тормозят. */
const MAX_POINTS = { bar: 300, line: 5000 };

const isPie = (t: ChartConfig["chartType"]) => t === "pie" || t === "donut";
const isAdditive = (a: Aggregation) => a === "sum" || a === "count" || a === "none";

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  none: "Не группировать",
  sum: "Сумма",
  avg: "Среднее",
  count: "Количество",
  min: "Минимум",
  max: "Максимум",
};

interface Group {
  label: string;
  order: number;
  time: number | null;
  sum: number[];
  count: number[];
  min: number[];
  max: number[];
}

const groupValue = (g: Group, i: number, agg: Aggregation): number | null => {
  if (!g.count[i]) return agg === "count" ? 0 : null;
  switch (agg) {
    case "avg":
      return g.sum[i] / g.count[i];
    case "count":
      return g.count[i];
    case "min":
      return g.min[i];
    case "max":
      return g.max[i];
    default:
      return g.sum[i];
  }
};

const total = (p: CategoryPoint, series: SeriesInfo[]) =>
  series.reduce((s, ser) => s + (typeof p[ser.key] === "number" ? (p[ser.key] as number) : 0), 0);

export function buildChartData(
  data: ParsedData,
  config: ChartConfig,
  columns: ColumnInfo[],
): ChartData {
  const xCol = columns.find((c) => c.name === config.xColumn);
  if (!xCol) return { kind: "empty", reason: "Выберите столбец для оси X." };
  const yCols = config.yColumns.filter((y) =>
    columns.some((c) => c.name === y && c.type === "numeric"),
  );
  if (!yCols.length)
    return { kind: "empty", reason: "Выберите хотя бы один числовой столбец для значений." };

  if (config.chartType === "scatter") return buildScatter(data, config, xCol, yCols);

  const limit = isPie(config.chartType) ? 1 : MAX_SERIES;
  const series: SeriesInfo[] = yCols.slice(0, limit).map((name, i) => ({
    key: `s${i}`,
    name,
    color: seriesColor(config.theme, config.colors, i),
  }));

  // 1. Группировка по значению X.
  const agg = config.aggregation;
  const groups = new Map<string, Group>();
  const raw: Group[] = [];
  data.rows.forEach((row, idx) => {
    const xv = row[config.xColumn];
    const label = xv === null || xv === undefined || xv === "" ? EMPTY_LABEL : String(xv);
    let g = agg === "none" ? undefined : groups.get(label);
    if (!g) {
      g = {
        label,
        order: idx,
        time: xCol.type === "date" ? dateKey(xv) : null,
        sum: series.map(() => 0),
        count: series.map(() => 0),
        min: series.map(() => Infinity),
        max: series.map(() => -Infinity),
      };
      if (agg === "none") raw.push(g);
      else groups.set(label, g);
    }
    series.forEach((s, i) => {
      const v = row[s.name];
      if (typeof v !== "number") return;
      g.sum[i] += v;
      g.count[i]++;
      if (v < g.min[i]) g.min[i] = v;
      if (v > g.max[i]) g.max[i] = v;
    });
  });

  const all = agg === "none" ? raw : [...groups.values()];
  let points: CategoryPoint[] = all.map((g) => {
    const p: CategoryPoint = { name: g.label, _order: g.order, _time: g.time };
    series.forEach((s, i) => {
      p[s.key] = groupValue(g, i, agg === "none" ? "sum" : agg);
    });
    return p;
  });

  // 2. Порядок. Даты по умолчанию — по времени, а не в порядке строк файла.
  const byLabel = (a: CategoryPoint, b: CategoryPoint) =>
    a.name.localeCompare(b.name, "ru", { numeric: true });
  if (config.sort === "valueDesc") points.sort((a, b) => total(b, series) - total(a, series));
  else if (config.sort === "valueAsc") points.sort((a, b) => total(a, series) - total(b, series));
  else if (config.sort === "labelAsc") points.sort(byLabel);
  else if (xCol.type === "date")
    points.sort((a, b) => ((a._time as number) ?? Infinity) - ((b._time as number) ?? Infinity));

  // 3. Круговая: доли бывают только положительными.
  let skippedNonPositive = 0;
  if (isPie(config.chartType)) {
    const k = series[0].key;
    const before = points.length;
    points = points.filter((p) => typeof p[k] === "number" && (p[k] as number) > 0);
    skippedNonPositive = before - points.length;
  }

  // 4. Топ-N: оставляем крупнейшие, хвост — в «Другое» (если значения можно складывать).
  let hiddenCount = 0;
  const n = isPie(config.chartType)
    ? Math.min(config.topN > 0 ? config.topN : PIE_DEFAULT_SLICES, PIE_MAX_SLICES)
    : config.topN;
  if (n > 0 && points.length > n) {
    const keep = new Set(
      [...points].sort((a, b) => total(b, series) - total(a, series)).slice(0, n),
    );
    const rest = points.filter((p) => !keep.has(p));
    points = points.filter((p) => keep.has(p));
    hiddenCount = rest.length;
    if ((config.otherBucket || isPie(config.chartType)) && isAdditive(agg)) {
      const other: CategoryPoint = { name: `${OTHER_LABEL} (${rest.length})`, isOther: true };
      series.forEach((s) => {
        const vals = rest.map((p) => p[s.key]).filter((v): v is number => typeof v === "number");
        other[s.key] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
      });
      points.push(other);
    }
  }

  // 5. Потолок числа точек.
  const cap =
    config.chartType === "line" || config.chartType === "area" ? MAX_POINTS.line : MAX_POINTS.bar;
  if (points.length > cap) {
    hiddenCount += points.length - cap;
    points = points.slice(0, cap);
  }

  points.forEach((p) => {
    delete p._order;
    delete p._time;
  });
  return { kind: "category", points, series, hiddenCount, skippedNonPositive };
}

function buildScatter(
  data: ParsedData,
  config: ChartConfig,
  xCol: ColumnInfo,
  yCols: string[],
): ChartData {
  if (xCol.type !== "numeric")
    return {
      kind: "empty",
      reason:
        "Точечный график показывает связь двух чисел: выберите числовой столбец для оси X.",
    };
  const series = yCols.slice(0, MAX_SCATTER_SERIES).map((name, i) => {
    const points: ScatterPoint[] = [];
    data.rows.forEach((row, r) => {
      const x = row[config.xColumn];
      const y = row[name];
      if (typeof x === "number" && typeof y === "number") points.push({ x, y, row: r });
    });
    return { key: `s${i}`, name, color: seriesColor(config.theme, config.colors, i), points };
  });
  const trends = series.map((s) => (config.showTrend ? linearFit(s.points) : null));
  return { kind: "scatter", series, trends };
}

/** Линейная регрессия методом наименьших квадратов + R². */
export function linearFit(pts: ScatterPoint[]) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    syy = 0;
  for (const { x, y } of pts) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const rDen = Math.sqrt(den * (n * syy - sy * sy));
  const r = rDen === 0 ? 0 : (n * sxy - sx * sy) / rDen;
  return { slope, intercept, r2: r * r };
}

/** Среднее первого ряда — для линии «Среднее». */
export function seriesAverage(d: ChartData): number | null {
  if (d.kind !== "category" || !d.series.length) return null;
  const k = d.series[0].key;
  const vals = d.points
    .filter((p) => !p.isOther)
    .map((p) => p[k])
    .filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
