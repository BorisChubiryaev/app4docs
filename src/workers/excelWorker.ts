// src/workers/excelWorker.ts
import * as ExcelJS from "exceljs";
import type { MergeRange } from "../types/excel.types";

interface ParseFileMessage {
  type: "PARSE_FILE";
  payload: {
    buffer: ArrayBuffer;
    fileName: string;
    fileIndex: number;
    totalFiles: number;
  };
}

type Range = { s: { r: number; c: number }; e: { r: number; c: number } };

/** Значение ячейки в виде строки (число/дата/rich-text/формула → форматированный текст) */
const getCellValue = (cell: ExcelJS.Cell | undefined): string => {
  if (!cell) return "";
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("ru-RU");
  // cell.text даёт форматированное отображаемое значение (аналог SheetJS .w)
  const t = cell.text;
  return t != null && t !== "" ? String(t) : String(v);
};

/** Буквенный адрес колонки → 1-based номер (A→1, Z→26, AA→27) */
const colToNum = (letters: string): number =>
  letters
    .toUpperCase()
    .split("")
    .reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

/** "A1:B2" → 0-based диапазон {s,e} */
const parseMergeRef = (ref: string): Range | null => {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  return {
    s: { r: parseInt(m[2], 10) - 1, c: colToNum(m[1]) - 1 },
    e: { r: parseInt(m[4], 10) - 1, c: colToNum(m[3]) - 1 },
  };
};

/**
 * Карта "row_col" (0-based) -> значение для всех объединённых ячеек.
 * Каждая ячейка диапазона получает значение мастер-ячейки (верхней-левой).
 */
const buildMergeValueMap = (
  worksheet: ExcelJS.Worksheet,
  merges: Range[],
): Map<string, string> => {
  const map = new Map<string, string>();

  for (const merge of merges) {
    // ExcelJS: 1-based (row, col)
    const masterValue = getCellValue(
      worksheet.getCell(merge.s.r + 1, merge.s.c + 1),
    );
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        map.set(`${r}_${c}`, masterValue);
      }
    }
  }

  return map;
};

const getCell = (
  worksheet: ExcelJS.Worksheet,
  mergeMap: Map<string, string>,
  row: number,
  col: number,
): string => {
  const key = `${row}_${col}`;
  if (mergeMap.has(key)) return mergeMap.get(key)!;
  return getCellValue(worksheet.getCell(row + 1, col + 1));
};

self.onmessage = async (e: MessageEvent<ParseFileMessage>) => {
  if (e.data.type !== "PARSE_FILE") return;

  const { buffer, fileName, fileIndex, totalFiles } = e.data.payload;

  try {
    self.postMessage({
      type: "PROGRESS",
      payload: {
        fileName,
        status: `Загрузка файла ${fileIndex + 1} из ${totalFiles}...`,
        progress: 0,
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error(`Файл "${fileName}" не содержит листов`);
    }

    const maxRow = worksheet.rowCount - 1; // 0-based индекс последней строки
    const maxCol = worksheet.columnCount - 1; // 0-based индекс последней колонки
    if (maxRow < 0 || maxCol < 0) {
      throw new Error(`Первый лист файла "${fileName}" пуст`);
    }

    // ── Объединения ───────────────────────────────────────────────────────────
    const mergeStrings: string[] =
      (worksheet.model?.merges as string[] | undefined) ?? [];
    const rawMerges: Range[] = mergeStrings
      .map(parseMergeRef)
      .filter((r): r is Range => r !== null);

    const mergeMap = buildMergeValueMap(worksheet, rawMerges);

    // Метаданные объединений для экспорта (0-based, как раньше)
    const mergeRanges: MergeRange[] = rawMerges.map((m) => ({
      startRow: m.s.r,
      endRow: m.e.r,
      startCol: m.s.c,
      endCol: m.e.c,
    }));

    // ── Заголовки (строка 0) ──────────────────────────────────────────────────
    const headers: string[] = [];
    for (let col = 0; col <= maxCol; col++) {
      const value = getCell(worksheet, mergeMap, 0, col).trim();
      headers.push(value || `Column ${col + 1}`);
    }

    // ── Строки данных ─────────────────────────────────────────────────────────
    const rows: string[][] = [];
    const BATCH_SIZE = 500;

    for (let row = 1; row <= maxRow; row++) {
      const rowData: string[] = [];
      let hasData = false;

      for (let col = 0; col <= maxCol; col++) {
        const value = getCell(worksheet, mergeMap, row, col);
        rowData.push(value);
        if (value.trim() !== "") hasData = true;
      }

      if (hasData) rows.push(rowData);

      if (row % BATCH_SIZE === 0) {
        self.postMessage({
          type: "PROGRESS",
          payload: {
            fileName,
            status: `Обработка: ${rows.length} строк...`,
            progress: Math.round((row / maxRow) * 100),
          },
        });
      }
    }

    self.postMessage({
      type: "SUCCESS",
      payload: {
        fileName,
        headers,
        rows,
        mergeRanges,
        originalColCount: maxCol + 1,
      },
    });
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      payload: {
        fileName,
        message: err instanceof Error ? err.message : "Неизвестная ошибка",
      },
    });
  }
};
