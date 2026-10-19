// Форматирование чисел для графиков — по-русски: «1 234,5», «12,3 тыс.».

import type { ChartConfig, NumberUnit } from "../types";

export type NumberFormat = Pick<ChartConfig, "unit" | "decimals" | "prefix" | "suffix">;

const UNITS: { unit: Exclude<NumberUnit, "auto" | "none">; div: number; label: string }[] = [
  { unit: "billions", div: 1e9, label: "млрд" },
  { unit: "millions", div: 1e6, label: "млн" },
  { unit: "thousands", div: 1e3, label: "тыс." },
];

const nf = (decimals: number) =>
  new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: decimals < 0 ? 0 : decimals,
    maximumFractionDigits: decimals < 0 ? 2 : decimals,
  });
const cache = new Map<number, Intl.NumberFormat>();
const fmt = (decimals: number) => {
  let f = cache.get(decimals);
  if (!f) cache.set(decimals, (f = nf(decimals)));
  return f;
};

/** Делитель и подпись единиц: заданные или подобранные по величине. */
const pickUnit = (abs: number, unit: NumberUnit) => {
  if (unit === "none") return null;
  if (unit !== "auto") return UNITS.find((u) => u.unit === unit) ?? null;
  // «Авто»: сокращаем от 10 000, чтобы «2 500» не превращалось в «2,5 тыс.».
  return UNITS.find((u) => abs >= u.div && abs >= 10_000) ?? null;
};

/** Автоматическая точность для сокращённого числа: 12,3 тыс. / 123 тыс. */
const autoDecimals = (scaled: number) => {
  const a = Math.abs(scaled);
  if (a === 0 || a >= 100) return 0;
  if (a >= 10) return 1;
  return a >= 1 ? 1 : 2;
};

/**
 * Число → текст. compact — для подписей осей и значений (с единицами),
 * без него — полная точность для подсказок и таблицы.
 */
export function formatValue(
  value: unknown,
  f: NumberFormat,
  compact = true,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const u = compact ? pickUnit(abs, f.unit) : null;
  const scaled = u ? value / u.div : value;
  const decimals =
    f.decimals >= 0 ? f.decimals : u ? autoDecimals(scaled) : Number.isInteger(scaled) ? 0 : -1;
  // Для «авто» без единиц: целые — без копеек, дробные — до 2 знаков.
  const body = fmt(decimals).format(scaled);
  return `${f.prefix}${body}${u ? ` ${u.label}` : ""}${f.suffix}`;
}

/** Подпись делений оси: тоже сокращённо, но без лишних знаков. */
export function formatTick(value: unknown, f: NumberFormat): string {
  return formatValue(value, f, true);
}

export const formatPercent = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value)
    ? `${fmt(0).format(value * 100)} %`
    : "—";

/** Простое число без настроек — для таблиц и диапазонов. */
export const formatPlain = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? fmt(-1).format(value) : String(value ?? "—");
