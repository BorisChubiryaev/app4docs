// src/workers/exportWorker.ts
import * as ExcelJS from "exceljs";
import type { ColumnConfig } from "../types/excel.types";
import type { OutputMerge } from "../hooks/useMergeCalculator";

interface ExportMessage {
  type: "EXPORT";
  payload: {
    groupedData: string[][];
    columnConfigs: ColumnConfig[];
    merges: OutputMerge[];
    fileCount: number;
  };
}

self.onmessage = async (e: MessageEvent<ExportMessage>) => {
  if (e.data.type !== "EXPORT") return;

  const { groupedData, columnConfigs, merges, fileCount } = e.data.payload;

  try {
    self.postMessage({
      type: "PROGRESS",
      payload: { status: "Создание книги..." },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Сгруппированные данные", {
      // Заморозка строки заголовка
      views: [{ state: "frozen", ySplit: 1 }],
    });

    // ── Данные: заголовок + строки ────────────────────────────────────────────
    worksheet.addRow(columnConfigs.map((c) => c.name));
    for (const row of groupedData) {
      worksheet.addRow(row);
    }

    // ── Объединения ячеек ─────────────────────────────────────────────────────
    // merge.startRow/endRow — 0-indexed без заголовка.
    // В книге строка 1 = заголовок, поэтому строка данных (1-based) = startRow + 2.
    merges.forEach((merge) => {
      const top = merge.startRow + 2;
      const bottom = merge.endRow + 2;
      const col = merge.col + 1;
      if (bottom > top) {
        try {
          worksheet.mergeCells(top, col, bottom, col);
        } catch (mergeErr) {
          console.warn("Не удалось объединить ячейки:", mergeErr);
        }
      }
    });

    // ── Ширина колонок ────────────────────────────────────────────────────────
    const SAMPLE = Math.min(groupedData.length, 300);
    columnConfigs.forEach((config, colIdx) => {
      let max = config.name.length;
      for (let i = 0; i < SAMPLE; i++) {
        const len = groupedData[i]?.[colIdx]?.length ?? 0;
        if (len > max) max = len;
      }
      const isGroup = config.groupBy;
      worksheet.getColumn(colIdx + 1).width = Math.min(
        max + 4,
        isGroup ? 80 : 40,
      );
    });

    self.postMessage({
      type: "PROGRESS",
      payload: { status: "Запись файла..." },
    });

    // ExcelJS в браузере возвращает ArrayBuffer
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    self.postMessage(
      {
        type: "SUCCESS",
        payload: { buffer, fileCount },
      },
      // @ts-expect-error — transferable ArrayBuffer в worker-контексте
      [buffer],
    );
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      payload: {
        message: err instanceof Error ? err.message : "Ошибка экспорта",
      },
    });
  }
};
