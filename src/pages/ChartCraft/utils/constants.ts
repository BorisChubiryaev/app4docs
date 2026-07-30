import type {
  ExportFormat,
  ChartConfig,
  CanvasSettings,
  CanvasPreset,
} from "../types";

export const DEFAULT_COLORS = [
  "#3498db",
  "#e74c3c",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#34495e",
  "#e91e63",
  "#00bcd4",
  "#8bc34a",
  "#ff5722",
];

export const CHART_TYPE_INFO = [
  {
    type: "bar" as const,
    label: "Столбчатый",
    icon: "📊",
    description: "Сравнение категорий",
  },
  {
    type: "line" as const,
    label: "Линейный",
    icon: "📈",
    description: "Тренды и динамика",
  },
  {
    type: "area" as const,
    label: "Площадной",
    icon: "📉",
    description: "Объём с трендом",
  },
  {
    type: "pie" as const,
    label: "Круговой",
    icon: "🥧",
    description: "Доли и проценты",
  },
  {
    type: "radar" as const,
    label: "Радарный",
    icon: "🕸️",
    description: "Многомерное сравнение",
  },
  {
    type: "scatter" as const,
    label: "Точечный",
    icon: "🔵",
    description: "Корреляция данных",
  },
  {
    type: "composed" as const,
    label: "Комбинированный",
    icon: "📊📈",
    description: "Линии + столбцы",
  },
];

export const CANVAS_PRESETS: CanvasPreset[] = [
  {
    name: "ppt-16-9",
    label: "PowerPoint 16:9",
    width: 1920,
    height: 1080,
    icon: "🖥️",
  },
  {
    name: "ppt-4-3",
    label: "PowerPoint 4:3",
    width: 1440,
    height: 1080,
    icon: "🖥️",
  },
  {
    name: "a4-landscape",
    label: "A4 альбом",
    width: 1684,
    height: 1190,
    icon: "📄",
  },
  {
    name: "a4-portrait",
    label: "A4 портрет",
    width: 1190,
    height: 1684,
    icon: "📄",
  },
  { name: "hd-1080", label: "Full HD", width: 1920, height: 1080, icon: "📺" },
  { name: "4k", label: "4K", width: 3840, height: 2160, icon: "📺" },
  {
    name: "instagram",
    label: "Instagram",
    width: 1080,
    height: 1080,
    icon: "📱",
  },
  { name: "twitter", label: "Twitter/X", width: 1600, height: 900, icon: "📱" },
  {
    name: "custom",
    label: "Свой размер",
    width: 1400,
    height: 900,
    icon: "✏️",
  },
];

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    type: "png",
    label: "PNG",
    icon: "🖼️",
    description: "Растровое изображение",
  },
  { type: "svg", label: "SVG", icon: "✏️", description: "Векторный формат" },
  {
    type: "html",
    label: "HTML",
    icon: "🌐",
    description: "Интерактивный виджет",
  },
];

export const DRAW_COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
  "#1abc9c",
  "#34495e",
  "#000000",
  "#ffffff",
];

export function createDefaultConfig(): ChartConfig {
  return {
    chartType: "bar",
    xColumn: "",
    yColumns: [],
    title: "",
    subtitle: "",
    colors: [...DEFAULT_COLORS],
    showLegend: true,
    showGrid: true,
    showValues: false,
    showTooltip: true,
    legendPosition: "bottom",
    animationDuration: 800,
    borderRadius: 4,
    fillOpacity: 0.8,
    strokeWidth: 2,
    fontSize: 12,
    backgroundColor: "#ffffff",
  };
}

export function createDefaultCanvasSettings(): CanvasSettings {
  return {
    backgroundColor: "#f5f6fa",
    backgroundPattern: "dots",
    patternColor: "#e0e0e0",
    patternSize: 20,
    canvasWidth: 1920,
    canvasHeight: 1080,
    presetName: "ppt-16-9",
  };
}
