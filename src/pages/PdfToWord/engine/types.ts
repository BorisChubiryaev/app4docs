// Модель страницы PDF для сборки Word-документа.
// Координаты — в пунктах PDF, начало внизу слева (Y растёт вверх), как в pdf.js.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  /** Цвет "rrggbb" или null — обычный (чёрный). */
  color: string | null;
  underline?: boolean;
  strike?: boolean;
  /** Надстрочный/подстрочный индекс. */
  script?: "super" | "sub";
}

/** Фрагмент текста pdf.js с распознанным стилем. */
export interface Item extends TextStyle {
  str: string;
  /** Базовая линия. */
  x: number;
  y: number;
  width: number;
  /** Индекс в исходном массиве (для исключения из потока). */
  idx: number;
}

/** Линия сетки/подчёркивания: горизонтальная (pos = y) или вертикальная (pos = x). */
export interface Seg {
  pos: number;
  a: number;
  b: number;
  width: number;
  color: string;
}

export interface FillRect extends Box {
  color: string;
}

/** Векторный элемент, не являющийся линией сетки (кривые, диагонали, фигуры). */
export interface Shape extends Box {
  kind: "fill" | "stroke";
  color: string;
  curved: boolean;
}

export interface ImageRef extends Box {
  /** Картинка во всю страницу (скан под текстовым слоем). */
  fullPage: boolean;
}

export interface PageRaw {
  index: number;
  width: number;
  height: number;
  items: Item[];
  hSegs: Seg[];
  vSegs: Seg[];
  fills: FillRect[];
  shapes: Shape[];
  images: ImageRef[];
  /** Отрисованная страница (белый фон) и её масштаб — для цвета и вырезки картинок. */
  canvas: HTMLCanvasElement;
  scale: number;
}

// ── Результат разбора: блоки документа ──

export interface Run extends TextStyle {
  text: string;
}

export type Align = "left" | "center" | "right" | "justify";

export interface TabStop {
  type: "left" | "right" | "center";
  /** Позиция от левого поля, пт. */
  pos: number;
}

export interface ParaBlock {
  kind: "para";
  runs: Run[];
  align: Align;
  /** Отступы от левого поля колонки, пт. */
  indentLeft: number;
  /** Отступ первой строки (отрицательный — выступ), пт. */
  firstLine: number;
  indentRight: number;
  spaceBefore: number;
  /** Межстрочный интервал как множитель «одинарного». */
  lineSpacing: number;
  heading: 0 | 1 | 2 | 3;
  tabs: TabStop[];
  shading: string | null;
  /** Верх и низ на странице (для порядка и стыковки страниц). */
  top: number;
  bottom: number;
  page: number;
  // Для склейки абзаца, продолжающегося на следующей странице
  lastLineFull: boolean;
  endsSentence: boolean;
  bodyX: number;
  pageBreakBefore?: boolean;
  borderBottom?: boolean;
}

export interface CellBlock {
  rowSpan: number;
  colSpan: number;
  /** Ячейка накрыта объединением (не выводится). */
  covered: boolean;
  paras: ParaBlock[];
  images: ImageBlock[];
  shading: string | null;
  vAlign: "top" | "center" | "bottom";
}

export interface TableBlock {
  kind: "table";
  colWidths: number[];
  rowHeights: number[];
  rows: CellBlock[][];
  borders: boolean;
  borderColor?: string;
  borderWidth?: number;
  spaceBefore?: number;
  headerRows: number;
  x0: number;
  top: number;
  bottom: number;
  page: number;
  pageBreakBefore?: boolean;
}

export interface ImageBlock {
  kind: "image";
  data: Uint8Array;
  type: "png" | "jpg";
  /** Размер на странице, пт. */
  width: number;
  height: number;
  align: Align;
  indentLeft: number;
  spaceBefore?: number;
  top: number;
  bottom: number;
  page: number;
  pageBreakBefore?: boolean;
}

export type Block = ParaBlock | TableBlock | ImageBlock;

export interface Zone {
  /** Колонки: 1 — обычный текст; 2–3 — многоколоночная вёрстка. */
  columns: number;
  gap: number;
  blocks: Block[];
}

/** Текстовый блок макета: рамка Word в заданном месте страницы. */
export interface DesignFrame {
  x: number;
  /** Отступ сверху страницы. */
  y: number;
  width: number;
  height: number;
  paras: ParaBlock[];
}

/**
 * Страница-макет (презентация, буклет): фон — страница без текста,
 * текст — редактируемые рамки на своих местах.
 */
export interface DesignPage {
  background: ImageBlock | null;
  frames: DesignFrame[];
}

export interface PageLayout {
  design?: DesignPage;
  index: number;
  width: number;
  height: number;
  margins: { left: number; right: number; top: number; bottom: number };
  zones: Zone[];
  /** Нижняя граница содержимого — чтобы понять, закончилась ли страница раньше времени. */
  contentBottom: number;
}

export interface HeaderFooter {
  /** Строки колонтитула; `{PAGE}` и `{NUMPAGES}` — поля номера страницы. */
  lines: { runs: Run[]; align: Align }[];
}
