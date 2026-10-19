import type {
  CanvasPreset,
  CanvasSettings,
  ChartConfig,
  ChartType,
  ColumnInfo,
} from "../types";
import { CHROME } from "./palettes";

export interface ChartTypeInfo {
  type: ChartType;
  label: string;
  description: string;
  /** Причина, почему тип сейчас недоступен (или null). */
  unavailable: (x: ColumnInfo | undefined, ySeries: number) => string | null;
}

export const CHART_TYPES: ChartTypeInfo[] = [
  {
    type: "bar",
    label: "Столбцы",
    description: "Сравнение категорий",
    unavailable: () => null,
  },
  {
    type: "barH",
    label: "Полосы",
    description: "Длинные названия, рейтинги",
    unavailable: () => null,
  },
  {
    type: "line",
    label: "Линия",
    description: "Динамика во времени",
    unavailable: () => null,
  },
  {
    type: "area",
    label: "Области",
    description: "Объём и тренд",
    unavailable: () => null,
  },
  {
    type: "pie",
    label: "Круговая",
    description: "Доли целого",
    unavailable: (_x, n) => (n > 1 ? "Круговая показывает один ряд — оставьте одно значение" : null),
  },
  {
    type: "donut",
    label: "Кольцевая",
    description: "Доли + итог в центре",
    unavailable: (_x, n) => (n > 1 ? "Кольцевая показывает один ряд — оставьте одно значение" : null),
  },
  {
    type: "radar",
    label: "Радар",
    description: "Профиль по нескольким осям",
    unavailable: (x) =>
      x && x.uniqueCount < 3 ? "Нужно хотя бы 3 категории по оси X" : null,
  },
  {
    type: "scatter",
    label: "Точечная",
    description: "Связь двух чисел",
    unavailable: (x) =>
      x && x.type !== "numeric" ? "Ось X должна быть числовой (например, «Рост» и «Вес»)" : null,
  },
  {
    type: "composed",
    label: "Столбцы + линия",
    description: "Первый ряд — столбцы, остальные — линии",
    unavailable: (_x, n) => (n < 2 ? "Нужно хотя бы два ряда значений" : null),
  },
];

export const CANVAS_PRESETS: CanvasPreset[] = [
  { name: "ppt-16-9", label: "Слайд 16:9", width: 1920, height: 1080, icon: "🖥️" },
  { name: "ppt-4-3", label: "Слайд 4:3", width: 1440, height: 1080, icon: "🖥️" },
  { name: "a4-landscape", label: "A4 альбом", width: 1684, height: 1190, icon: "📄" },
  { name: "a4-portrait", label: "A4 портрет", width: 1190, height: 1684, icon: "📄" },
  { name: "4k", label: "4K", width: 3840, height: 2160, icon: "📺" },
  { name: "square", label: "Квадрат", width: 1080, height: 1080, icon: "⬛" },
  { name: "custom", label: "Свой размер", width: 1400, height: 900, icon: "✏️" },
];

export const DRAW_COLORS = [
  "#e34948",
  "#eb6834",
  "#eda100",
  "#1baf7a",
  "#2a78d6",
  "#6250d6",
  "#0b0b0b",
  "#ffffff",
];

export function createDefaultConfig(): ChartConfig {
  return {
    chartType: "bar",
    autoType: true,
    xColumn: "",
    yColumns: [],
    aggregation: "sum",
    sort: "none",
    topN: 0,
    otherBucket: true,
    highlight: null,
    title: "",
    subtitle: "",
    theme: "light",
    backgroundColor: CHROME.light.surface,
    colors: [],
    stack: "none",
    smooth: false,
    showDots: true,
    showTrend: false,
    showLegend: true,
    legendPosition: "bottom",
    showGrid: true,
    showTooltip: true,
    valueLabels: "none",
    showBrush: false,
    borderRadius: 4,
    barSize: 32,
    strokeWidth: 2,
    fontSize: 12,
    xAxisLabel: "",
    yAxisLabel: "",
    yMin: null,
    yMax: null,
    unit: "auto",
    decimals: -1,
    prefix: "",
    suffix: "",
    referenceLine: "none",
    referenceValue: null,
    referenceLabel: "",
  };
}

export function createDefaultCanvasSettings(): CanvasSettings {
  return {
    backgroundColor: "#f5f6fa",
    backgroundPattern: "dots",
    patternColor: "#d9dbe3",
    patternSize: 20,
    canvasWidth: 1920,
    canvasHeight: 1080,
    presetName: "ppt-16-9",
  };
}

/** Можно ли сложить ряды стопкой для этого типа. */
export const canStack = (t: ChartType) => t === "bar" || t === "barH" || t === "area";
