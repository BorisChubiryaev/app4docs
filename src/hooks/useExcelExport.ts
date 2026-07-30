// src/hooks/useExcelExport.ts
import { useCallback, useState } from "react";
import type { ColumnConfig } from "../types/excel.types";
import type { OutputMerge } from "./useMergeCalculator";

interface UseExcelExportReturn {
  downloadResult: (
    groupedData: string[][],
    columnConfigs: ColumnConfig[],
    merges: OutputMerge[],
    fileCount: number,
  ) => Promise<void>;
  isExporting: boolean;
}

export const useExcelExport = (): UseExcelExportReturn => {
  const [isExporting, setIsExporting] = useState(false);

  const downloadResult = useCallback(
    async (
      groupedData: string[][],
      columnConfigs: ColumnConfig[],
      merges: OutputMerge[],
      fileCount: number,
    ): Promise<void> => {
      if (groupedData.length === 0) return;

      setIsExporting(true);

      return new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/exportWorker.ts", import.meta.url),
          { type: "module" },
        );

        worker.onmessage = (e) => {
          const { type, payload } = e.data;

          if (type === "PROGRESS") {
            // Можно пробросить статус если нужно
            console.log(payload.status);
          } else if (type === "SUCCESS") {
            worker.terminate();

            try {
              const blob = new Blob([payload.buffer], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              });

              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `grouped_${payload.fileCount}_files_${new Date()
                .toISOString()
                .slice(0, 10)}.xlsx`;

              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);

              setTimeout(() => URL.revokeObjectURL(url), 2000);
            } finally {
              setIsExporting(false);
              resolve();
            }
          } else if (type === "ERROR") {
            worker.terminate();
            setIsExporting(false);
            reject(new Error(payload.message));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          setIsExporting(false);
          reject(new Error(err.message ?? "Ошибка в worker экспорта"));
        };

        // Передаём данные — НЕ transferable т.к. нужны в UI
        worker.postMessage({
          type: "EXPORT",
          payload: {
            groupedData,
            columnConfigs,
            merges,
            fileCount,
          },
        });
      });
    },
    [],
  );

  return { downloadResult, isExporting };
};
