// Цвета графиков.
//
// Категориальная палитра — 8 оттенков в фиксированном порядке, проверена
// validate_palette.js (скилл dataviz) на поверхностях графика:
//   светлая (#ffffff): худшая соседняя пара для дальтоников ΔE 9.1 (≥ 8),
//     обычное зрение ΔE 19.6 (≥ 15); у трёх светлых оттенков контраст < 3:1 —
//     поэтому у графика всегда есть легенда и таблица данных;
//   тёмная (#1a1a19): ΔE 8.4 / 19.3, контраст ≥ 3:1 у всех.
// Порядок — часть защиты для дальтоников, его не перемешиваем.
// Цвета не повторяются по кругу: больше 8 рядов не бывает (выбор ограничен),
// а хвост круговой сводится в «Другое».
// Для точечного графика проверены все пары только первых трёх цветов —
// поэтому там не больше трёх рядов.

import type { ChartTheme } from "../types";

export const PALETTE: Record<ChartTheme, string[]> = {
  light: [
    "#2a78d6", // синий
    "#eb6834", // оранжевый
    "#1baf7a", // бирюзовый
    "#eda100", // жёлтый
    "#e87ba4", // розовый
    "#008300", // зелёный
    "#6250d6", // фиолетовый
    "#e34948", // красный
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};

export const MAX_SERIES = PALETTE.light.length;
export const MAX_SCATTER_SERIES = 3;

/** Оформление графика по теме: поверхность, текст, сетка, оси. */
export interface ChartChrome {
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  /** Нейтральный для «Другое» и невыделенных категорий. */
  neutral: string;
}

export const CHROME: Record<ChartTheme, ChartChrome> = {
  light: {
    surface: "#ffffff",
    ink: "#0b0b0b",
    inkSecondary: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    neutral: "#c3c2b7",
  },
  dark: {
    surface: "#1a1a19",
    ink: "#f0efec",
    inkSecondary: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    axis: "#383835",
    neutral: "#52514e",
  },
};

/** Цвет ряда: свой (если задан) или из палитры по номеру ряда. */
export const seriesColor = (
  theme: ChartTheme,
  custom: string[],
  index: number,
): string => custom[index] || PALETTE[theme][index % PALETTE[theme].length];
