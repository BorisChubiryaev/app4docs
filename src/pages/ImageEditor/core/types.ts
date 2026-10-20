// Модель документа графического редактора.
//
// Состояние неизменяемое: любая правка создаёт новый объект DocState, а
// слой, пиксели которого меняются, получает НОВЫЙ canvas (копию). Поэтому
// история отмены — это просто список прошлых состояний: неизменённые
// слои разделяют один и тот же canvas и память не дублируют.

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: [BlendMode, string][] = [
  ["source-over", "Обычный"],
  ["multiply", "Умножение"],
  ["screen", "Экран"],
  ["overlay", "Перекрытие"],
  ["darken", "Затемнение"],
  ["lighten", "Замена светлым"],
  ["color-dodge", "Осветление основы"],
  ["color-burn", "Затемнение основы"],
  ["hard-light", "Жёсткий свет"],
  ["soft-light", "Мягкий свет"],
  ["difference", "Разница"],
  ["exclusion", "Исключение"],
  ["hue", "Цветовой тон"],
  ["saturation", "Насыщенность"],
  ["color", "Цветность"],
  ["luminosity", "Яркость"],
];

export interface TextProps {
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: "raster" | "text";
  canvas: HTMLCanvasElement;
  /** Положение левого верхнего угла слоя в документе. */
  x: number;
  y: number;
  visible: boolean;
  /** 0…1 */
  opacity: number;
  blend: BlendMode;
  locked: boolean;
  /** Маска слоя того же размера: альфа 255 — видно, 0 — скрыто. */
  mask: HTMLCanvasElement | null;
  maskEnabled: boolean;
  text?: TextProps;
}

export interface DocState {
  width: number;
  height: number;
  /** Снизу вверх. */
  layers: Layer[];
  activeId: string;
  /** Маска выделения размером с документ (альфа = степень выделения) или null. */
  selection: HTMLCanvasElement | null;
  /** Кисть рисует по маске активного слоя, а не по пикселям. */
  editMask: boolean;
}

export type ToolId =
  | "move"
  | "marquee"
  | "ellipse"
  | "lasso"
  | "wand"
  | "crop"
  | "brush"
  | "eraser"
  | "stamp"
  | "fill"
  | "gradient"
  | "shape"
  | "text"
  | "eyedropper"
  | "hand"
  | "zoom";

export type SelectMode = "new" | "add" | "subtract" | "intersect";

export interface ToolOptions {
  size: number;
  hardness: number;
  /** 0…1 */
  opacity: number;
  tolerance: number;
  contiguous: boolean;
  sampleAll: boolean;
  antialias: boolean;
  selectMode: SelectMode;
  shape: "rect" | "ellipse" | "line" | "arrow";
  shapeFill: boolean;
  shapeStroke: number;
  gradient: "linear" | "radial";
  font: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  cropRatio: "free" | "1:1" | "4:3" | "3:2" | "16:9" | "original";
}

export const DEFAULT_OPTIONS: ToolOptions = {
  size: 30,
  hardness: 0.8,
  opacity: 1,
  tolerance: 32,
  contiguous: true,
  sampleAll: false,
  antialias: true,
  selectMode: "new",
  shape: "rect",
  shapeFill: true,
  shapeStroke: 4,
  gradient: "linear",
  font: "Inter, Arial, sans-serif",
  fontSize: 64,
  bold: false,
  italic: false,
  align: "left",
  cropRatio: "free",
};
