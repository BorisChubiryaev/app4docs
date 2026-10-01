import type { CellPrimitive } from "../utils/excelCell";

/** Лист Excel в компактном виде: только примитивы, без объектов ExcelJS. */
export interface ExcelSheet {
  name: string;
  /** rows[r][c], 0-based. Пустые строки и ячейки — «дыры» (undefined). */
  rows: (CellPrimitive | undefined)[][];
  /** Индексы в numFmts для числовых ячеек с форматом; есть не у всех строк. */
  fmt: (number[] | undefined)[];
  /** Уникальные числовые форматы листа. */
  numFmts: string[];
  /** Номер последней непустой строки / колонки (1-based = количество). */
  rowCount: number;
  colCount: number;
}

export type ParseResponse =
  | { ok: true; sheets: ExcelSheet[] }
  | { ok: false; error: string };
