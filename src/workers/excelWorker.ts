// src/workers/excelWorker.ts
import * as XLSX from "xlsx";
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

const getCellValue = (cell: XLSX.CellObject | undefined): string => {
  if (!cell || cell.v === null || cell.v === undefined) return "";

  if (cell.t === "d" && cell.v instanceof Date) {
    return cell.v.toLocaleDateString("ru-RU");
  }

  if (cell.t === "n") {
    // Числа — берём форматированное значение если есть
    return cell.w ?? String(cell.v);
  }

  if (cell.w) return cell.w;
  return String(cell.v);
};

/**
 * Строим карту "row_col" -> значение для всех объединённых ячеек.
 * Каждая ячейка в диапазоне получает значение мастер-ячейки.
 */
const buildMergeValueMap = (
  worksheet: XLSX.WorkSheet,
  merges: XLSX.Range[],
): Map<string, string> => {
  const map = new Map<string, string>();

  for (const merge of merges) {
    const masterAddr = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const masterValue = getCellValue(worksheet[masterAddr]);

    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        map.set(`${r}_${c}`, masterValue);
      }
    }
  }

  return map;
};

const getCell = (
  worksheet: XLSX.WorkSheet,
  mergeMap: Map<string, string>,
  row: number,
  col: number,
): string => {
  const key = `${row}_${col}`;
  if (mergeMap.has(key)) return mergeMap.get(key)!;

  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  return getCellValue(worksheet[addr]);
};

self.onmessage = (e: MessageEvent<ParseFileMessage>) => {
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

    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: true,
      bookVBA: false,
      // Не читаем стили — экономим ~40% памяти
      cellStyles: false,
    });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error(`Файл "${fileName}" не содержит листов`);
    }

    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet["!ref"];
    if (!ref) {
      throw new Error(`Первый лист файла "${fileName}" пуст`);
    }

    const range = XLSX.utils.decode_range(ref);
    const maxRow = range.e.r;
    const maxCol = range.e.c;

    // Обрабатываем объединения
    const rawMerges: XLSX.Range[] = worksheet["!merges"] ?? [];
    const mergeMap = buildMergeValueMap(worksheet, rawMerges);

    // Сохраняем метаданные объединений для экспорта
    const mergeRanges: MergeRange[] = rawMerges.map((m) => ({
      startRow: m.s.r,
      endRow: m.e.r,
      startCol: m.s.c,
      endCol: m.e.c,
    }));

    // Читаем заголовки (строка 0)
    const headers: string[] = [];
    for (let col = 0; col <= maxCol; col++) {
      const value = getCell(worksheet, mergeMap, 0, col).trim();
      headers.push(value || `Column ${col + 1}`);
    }

    // Читаем строки данных
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

      // Прогресс каждые BATCH_SIZE строк
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
