// src/hooks/useGroupData.ts
import { useCallback, useState } from "react";
import type { ExcelFileData, ColumnConfig } from "../types/excel.types";

interface GroupedItem {
  value: string;
  fileIndex: number; // 1-based
}

const parseValueString = (value: string, fileIndex: number): GroupedItem[] => {
  if (!value || value.trim() === "") return [];

  let parts: string[] = [value.trim()];

  if (/[；;]/.test(value)) {
    parts = value
      .split(/[；;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (value.includes(",")) {
    const commaParts = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Если после запятой идёт заглавная буква — это разные слова, не разделители
    const hasCapitalAfterComma = commaParts.some((part, idx) => {
      if (idx === 0) return false;
      return /^[А-ЯЁA-Z]/.test(part);
    });

    if (!hasCapitalAfterComma) {
      parts = commaParts;
    }
  }

  return parts
    .filter((p) => p.trim() !== "")
    .map((part) => ({ value: part.trim(), fileIndex }));
};

const formatGroupedValues = (
  items: GroupedItem[],
  totalFiles: number,
): string => {
  if (items.length === 0) return "";

  const byFile = new Map<number, string[]>();

  items.forEach((item) => {
    if (!byFile.has(item.fileIndex)) byFile.set(item.fileIndex, []);
    byFile.get(item.fileIndex)!.push(item.value);
  });

  const parts: string[] = [];

  for (let fi = 1; fi <= totalFiles; fi++) {
    const values = byFile.get(fi);
    if (values && values.length > 0) {
      values.forEach((value, localIdx) => {
        parts.push(`${fi}.${localIdx + 1}. ${value}`);
      });
    }
  }

  return parts.join(", ");
};

interface UseGroupDataReturn {
  groupedData: string[][];
  isGrouping: boolean;
  groupData: (
    excelData: ExcelFileData[],
    columnConfigs: ColumnConfig[],
  ) => Promise<string[][]>;
  clearGroupedData: () => void;
}

export const useGroupData = (): UseGroupDataReturn => {
  const [groupedData, setGroupedData] = useState<string[][]>([]);
  const [isGrouping, setIsGrouping] = useState(false);

  const clearGroupedData = useCallback(() => {
    setGroupedData([]);
  }, []);

  const groupData = useCallback(
    (
      excelData: ExcelFileData[],
      columnConfigs: ColumnConfig[],
    ): Promise<string[][]> => {
      return new Promise((resolve, reject) => {
        setIsGrouping(true);

        // setTimeout(0) — отдаём управление браузеру перед тяжёлой операцией
        setTimeout(() => {
          try {
            const totalFiles = excelData.length;
            const colCount = columnConfigs.length;

            const unchangedIndices = columnConfigs
              .filter((c) => c.keepUnchanged)
              .map((c) => c.index);

            const groupByIndices = columnConfigs
              .filter((c) => c.groupBy)
              .map((c) => c.index);

            // groupKey -> { baseRow, fileData: Map<fileNum, row> }
            const groupMap = new Map<
              string,
              { baseRow: string[]; fileData: Map<number, string[]> }
            >();

            excelData.forEach((fileData, fileIndex) => {
              const fileNum = fileIndex + 1;

              fileData.rows.forEach((rawRow) => {
                // Нормализуем длину строки под количество колонок
                const row: string[] = [];
                for (let i = 0; i < colCount; i++) {
                  row.push(rawRow[i] ?? "");
                }

                const groupKey = unchangedIndices
                  .map((idx) => row[idx].trim())
                  .join("|||");

                if (!groupMap.has(groupKey)) {
                  const baseRow = new Array<string>(colCount).fill("");
                  unchangedIndices.forEach((idx) => {
                    baseRow[idx] = row[idx];
                  });

                  groupMap.set(groupKey, {
                    baseRow,
                    fileData: new Map([[fileNum, row]]),
                  });
                } else {
                  groupMap.get(groupKey)!.fileData.set(fileNum, row);
                }
              });
            });

            const result: string[][] = [];

            groupMap.forEach(({ baseRow, fileData }) => {
              const row = [...baseRow];

              groupByIndices.forEach((colIdx) => {
                const allItems: GroupedItem[] = [];

                for (let fi = 1; fi <= totalFiles; fi++) {
                  const fileRow = fileData.get(fi);
                  if (fileRow) {
                    allItems.push(...parseValueString(fileRow[colIdx] ?? "", fi));
                  }
                }

                row[colIdx] =
                  allItems.length > 0
                    ? formatGroupedValues(allItems, totalFiles)
                    : "";
              });

              result.push(row);
            });

            setGroupedData(result);
            setIsGrouping(false);
            resolve(result);
          } catch (err) {
            setIsGrouping(false);
            reject(err);
          }
        }, 0);
      });
    },
    [],
  );

  return { groupedData, isGrouping, groupData, clearGroupedData };
};
