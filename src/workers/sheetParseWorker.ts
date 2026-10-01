// Разбор .xlsx в фоновом потоке: на больших файлах ExcelJS работает
// секундами, и в основном потоке это замораживало страницу.
import * as ExcelJS from "exceljs";
import { normalizeCellValue } from "../utils/excelCell";
import type { ExcelSheet, ParseResponse } from "../types/sheet.types";

const parse = async (buffer: ArrayBuffer): Promise<ExcelSheet[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: ExcelSheet[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: ExcelSheet["rows"] = [];
    const fmt: ExcelSheet["fmt"] = [];
    const numFmts: string[] = [];
    const fmtIndex = new Map<string, number>();
    let rowCount = 0;
    let colCount = 0;

    worksheet.eachRow((row, rowNumber) => {
      const out: ExcelSheet["rows"][number] = [];
      let rowFmt: number[] | undefined;

      row.eachCell((cell, colNumber) => {
        const value = normalizeCellValue(cell.value);
        if (value === null || value === "") return;
        out[colNumber - 1] = value;
        if (colNumber > colCount) colCount = colNumber;

        const numFmt = cell.numFmt;
        if (typeof value === "number" && numFmt && numFmt !== "General") {
          let idx = fmtIndex.get(numFmt);
          if (idx === undefined) {
            idx = numFmts.length;
            numFmts.push(numFmt);
            fmtIndex.set(numFmt, idx);
          }
          (rowFmt ??= [])[colNumber - 1] = idx;
        }
      });

      // Кладём по номеру строки: eachRow пропускает пустые строки,
      // и push сдвинул бы нумерацию.
      if (out.length > 0) {
        rows[rowNumber - 1] = out;
        if (rowFmt) fmt[rowNumber - 1] = rowFmt;
        rowCount = rowNumber;
      }
    });

    sheets.push({ name: worksheet.name, rows, fmt, numFmts, rowCount, colCount });
  });

  return sheets;
};

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  let response: ParseResponse;
  try {
    response = { ok: true, sheets: await parse(e.data.buffer) };
  } catch (err) {
    response = { ok: false, error: (err as Error)?.message || String(err) };
  }
  self.postMessage(response);
};
