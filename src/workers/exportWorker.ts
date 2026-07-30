// src/workers/exportWorker.ts
import * as XLSX from "xlsx";
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

self.onmessage = (e: MessageEvent<ExportMessage>) => {
  if (e.data.type !== "EXPORT") return;

  const { groupedData, columnConfigs, merges, fileCount } = e.data.payload;

  try {
    self.postMessage({ type: "PROGRESS", payload: { status: "Создание книги..." } });

    const workbook = XLSX.utils.book_new();

    // ── Данные ───────────────────────────────────────────────────────────────
    // Заголовки + строки
    const sheetData: string[][] = [
      columnConfigs.map((c) => c.name),
      ...groupedData,
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // ── Объединения ячеек ─────────────────────────────────────────────────────
    // В sheetData строка 0 = заголовок, строка 1 = первая дата
    // merge.startRow/endRow — 0-indexed без заголовка
    // => в sheet: row = merge.startRow + 1 (за заголовок)
    if (!worksheet["!merges"]) worksheet["!merges"] = [];

    merges.forEach((merge) => {
      worksheet["!merges"]!.push({
        s: { r: merge.startRow + 1, c: merge.col },
        e: { r: merge.endRow + 1, c: merge.col },
      });
    });

    // ── Ширина колонок ────────────────────────────────────────────────────────
    const SAMPLE = Math.min(groupedData.length, 300);
    const colWidths = columnConfigs.map((config, colIdx) => {
      let max = config.name.length;
      for (let i = 0; i < SAMPLE; i++) {
        const len = groupedData[i]?.[colIdx]?.length ?? 0;
        if (len > max) max = len;
      }
      const isGroup = config.groupBy;
      return { wch: Math.min(max + 4, isGroup ? 80 : 40) };
    });
    worksheet["!cols"] = colWidths;

    // ── Фиксация заголовка (freeze) ────────────────────────────────────────────
    // В SheetJS freeze задаётся через !freeze
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    self.postMessage({ type: "PROGRESS", payload: { status: "Запись файла..." } });

    XLSX.utils.book_append_sheet(workbook, worksheet, "Сгруппированные данные");

    // Записываем в буфер
    const buffer = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
      compression: true,
    });

    // Передаём буфер в main thread без копирования
    self.postMessage(
      {
        type: "SUCCESS",
        payload: { buffer, fileCount },
      },
      // @ts-ignore — transferable
      [buffer.buffer],
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
