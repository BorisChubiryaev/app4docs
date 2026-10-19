// Типы генератора графиков.

export type CellValue = string | number | boolean | null;
export type Row = Record<string, CellValue>;

export interface ParsedData {
  headers: string[];
  rows: Row[];
  fileName: string;
  sheetName: string;
  /** Все листы книги — чтобы переключаться между ними. */
  sheetNames?: string[];
  totalRows: number;
}

export type ColumnType = "numeric" | "category" | "date" | "unknown";

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  sampleValues: CellValue[];
  uniqueCount: number;
  nullCount: number;
  /** Сколько непустых значений (для подсказки «значения повторяются»). */
  filledCount: number;
  min?: number;
  max?: number;
}

export type ChartType =
  | "bar"
  | "barH"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "radar"
  | "scatter"
  | "composed";

/** Как складывать несколько рядов: рядом, стопкой, стопкой до 100 %. */
export type StackMode = "none" | "stacked" | "percent";

/** Что делать со строками, у которых одинаковое значение по оси X. */
export type Aggregation = "none" | "sum" | "avg" | "count" | "min" | "max";

export type SortMode = "none" | "valueDesc" | "valueAsc" | "labelAsc";
export type LegendPosition = "top" | "bottom" | "left" | "right";
export type ValueLabels = "none" | "all" | "last" | "extremes";
export type NumberUnit = "auto" | "none" | "thousands" | "millions" | "billions";
export type ChartTheme = "light" | "dark";
export type ReferenceLineMode = "none" | "average" | "value";

export interface ChartConfig {
  chartType: ChartType;
  /** Тип выбран автоматически — его можно менять при смене столбцов. */
  autoType: boolean;
  xColumn: string;
  yColumns: string[];

  // ── данные ──
  aggregation: Aggregation;
  sort: SortMode;
  /** Оставить N крупнейших категорий (0 — все). */
  topN: number;
  /** Остальное свести в «Другое» (иначе — отбросить). */
  otherBucket: boolean;
  /** Выделить одну категорию цветом, остальные — серым (один ряд). */
  highlight: string | null;

  // ── вид ──
  title: string;
  subtitle: string;
  theme: ChartTheme;
  backgroundColor: string;
  /** Свои цвета рядов по индексу; пустая строка — цвет палитры. */
  colors: string[];
  stack: StackMode;
  smooth: boolean;
  showDots: boolean;
  showTrend: boolean;
  showLegend: boolean;
  legendPosition: LegendPosition;
  showGrid: boolean;
  showTooltip: boolean;
  valueLabels: ValueLabels;
  showBrush: boolean;
  borderRadius: number;
  barSize: number;
  strokeWidth: number;
  fontSize: number;

  // ── оси и числа ──
  xAxisLabel: string;
  yAxisLabel: string;
  yMin: number | null;
  yMax: number | null;
  unit: NumberUnit;
  /** Знаков после запятой; -1 — автоматически. */
  decimals: number;
  prefix: string;
  suffix: string;
  referenceLine: ReferenceLineMode;
  referenceValue: number | null;
  referenceLabel: string;
}

export interface ChartInstance {
  id: string;
  config: ChartConfig;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  isLocked: boolean;
}

export type CanvasBackground = "dots" | "grid" | "lines" | "none";

export interface CanvasSettings {
  backgroundColor: string;
  backgroundPattern: CanvasBackground;
  patternColor: string;
  patternSize: number;
  canvasWidth: number;
  canvasHeight: number;
  presetName: string;
}

export interface CanvasPreset {
  name: string;
  label: string;
  width: number;
  height: number;
  icon: string;
}

export type CanvasTool = "select" | "draw" | "arrow" | "rect" | "text" | "eraser";

export interface Point {
  x: number;
  y: number;
}

export interface DrawingPath {
  id: string;
  type: "freehand" | "arrow" | "rect";
  points: Point[];
  color: string;
  width: number;
  opacity: number;
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  color: string;
  backgroundColor: string;
  rotation: number;
  width: number;
}

/** Снимок холста для отмены/повтора. Объекты неизменяемые — копировать не нужно. */
export interface Snapshot {
  charts: ChartInstance[];
  drawings: DrawingPath[];
  texts: TextAnnotation[];
}

// ── Готовые к отрисовке данные (результат buildChartData) ──

export interface SeriesInfo {
  /** Безопасный ключ: имена столбцов с точкой Recharts читает как путь. */
  key: string;
  name: string;
  color: string;
}

export interface CategoryPoint {
  name: string;
  /** Метка «Другое» (свод хвоста) — красится нейтральным серым. */
  isOther?: boolean;
  [seriesKey: string]: string | number | boolean | null | undefined;
}

export interface ScatterPoint {
  x: number;
  y: number;
  row: number;
}

export type ChartData =
  | {
      kind: "category";
      points: CategoryPoint[];
      series: SeriesInfo[];
      /** Сколько категорий ушло в «Другое» или отброшено. */
      hiddenCount: number;
      /** Сколько значений пропущено круговой (≤ 0). */
      skippedNonPositive: number;
    }
  | {
      kind: "scatter";
      series: (SeriesInfo & { points: ScatterPoint[] })[];
      trends: ({ slope: number; intercept: number; r2: number } | null)[];
    }
  | { kind: "empty"; reason: string };
