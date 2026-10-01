import type { CellPrimitive } from "../../../utils/excelCell";
import type { ExcelSheet } from "../../../types/sheet.types";

export type DiffKind = "modified" | "added" | "removed";

export interface CompareOptions {
  ignoreCase: boolean;
  /** Обрезать пробелы по краям и схлопывать повторные пробелы. */
  ignoreSpaces: boolean;
}

/** Различие в ячейке; координаты 0-based. */
export interface CellDiff {
  r: number;
  c: number;
  kind: DiffKind;
}

export interface DiffResult {
  diffs: CellDiff[];
  rowCount: number;
  colCount: number;
  counts: Record<DiffKind, number>;
}

const comparable = (
  v: CellPrimitive | undefined,
  opts: CompareOptions,
): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (opts.ignoreSpaces) s = s.replace(/\s+/g, " ").trim();
  if (opts.ignoreCase) s = s.toLowerCase();
  return s;
};

/**
 * Поячеечное сравнение двух листов. Различия упорядочены по строкам,
 * затем по колонкам — на этом держится построение списка строк в UI.
 */
export const compareSheets = (
  a: ExcelSheet,
  b: ExcelSheet,
  opts: CompareOptions,
): DiffResult => {
  const rowCount = Math.max(a.rowCount, b.rowCount);
  const colCount = Math.max(a.colCount, b.colCount);
  const diffs: CellDiff[] = [];
  const counts: Record<DiffKind, number> = { modified: 0, added: 0, removed: 0 };

  for (let r = 0; r < rowCount; r++) {
    const rowA = a.rows[r];
    const rowB = b.rows[r];
    if (!rowA && !rowB) continue;
    const cols = Math.max(rowA?.length ?? 0, rowB?.length ?? 0);
    for (let c = 0; c < cols; c++) {
      const va = comparable(rowA?.[c], opts);
      const vb = comparable(rowB?.[c], opts);
      if (va === vb) continue;
      const kind: DiffKind = va === "" ? "added" : vb === "" ? "removed" : "modified";
      diffs.push({ r, c, kind });
      counts[kind]++;
    }
  }

  return { diffs, rowCount, colCount, counts };
};
