import type { ExcelSheet, ParseResponse } from "../types/sheet.types";

/** Разбирает .xlsx в Web Worker. Буфер передаётся без копирования. */
export const parseExcelInWorker = (buffer: ArrayBuffer): Promise<ExcelSheet[]> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/sheetParseWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.sheets);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "не удалось прочитать файл"));
    };
    worker.postMessage({ buffer }, [buffer]);
  });
