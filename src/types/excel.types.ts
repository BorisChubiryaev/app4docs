// src/types/excel.types.ts

export interface ColumnConfig {
  id: string;
  name: string;
  keepUnchanged: boolean;
  groupBy: boolean;
  index: number;
}

export interface MergeRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface ExcelFileData {
  fileName: string;
  headers: string[];
  rows: string[][];
  mergeRanges: MergeRange[];
  originalColCount: number;
}
