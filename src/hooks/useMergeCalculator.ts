// src/hooks/useMergeCalculator.ts
import { useMemo } from "react";
import type { ColumnConfig } from "../types/excel.types";

export interface OutputMerge {
  startRow: number; // 0-indexed, без заголовка
  endRow: number;
  col: number;      // 0-indexed
}

/**
 * Для ключевых колонок находим диапазоны подряд идущих
 * одинаковых значений — они будут объединены в Excel.
 */
export const useMergeCalculator = (
  groupedData: string[][],
  columnConfigs: ColumnConfig[],
): OutputMerge[] => {
  return useMemo(() => {
    if (groupedData.length < 2) return [];

    const merges: OutputMerge[] = [];
    const keyIndices = columnConfigs
      .filter((c) => c.keepUnchanged)
      .map((c) => c.index);

    keyIndices.forEach((colIdx) => {
      let startRow = 0;

      for (let row = 1; row <= groupedData.length; row++) {
        const prev = groupedData[row - 1]?.[colIdx] ?? "";
        const curr = groupedData[row]?.[colIdx] ?? null;

        // Значение изменилось или мы дошли до конца
        if (curr !== prev || row === groupedData.length) {
          if (row - 1 > startRow) {
            merges.push({ startRow, endRow: row - 1, col: colIdx });
          }
          startRow = row;
        }
      }
    });

    return merges;
  }, [groupedData, columnConfigs]);
};
