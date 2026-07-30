// src/hooks/useExcelParser.ts
import { useCallback, useRef, useState } from "react";
import type { ExcelFileData } from "../types/excel.types";

interface FileProgress {
  status: string;
  progress: number;
}

interface UseExcelParserReturn {
  parseFiles: (files: File[]) => Promise<ExcelFileData[]>;
  isLoading: boolean;
  overallProgress: number;
  fileProgresses: Record<string, FileProgress>;
  currentFileIndex: number;
  abort: () => void;
}

export const useExcelParser = (): UseExcelParserReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [fileProgresses, setFileProgresses] = useState<
    Record<string, FileProgress>
  >({});
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  const workersRef = useRef<Worker[]>([]);
  const abortedRef = useRef(false);

  const abort = useCallback(() => {
    abortedRef.current = true;
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
    setIsLoading(false);
    setOverallProgress(0);
    setFileProgresses({});
    setCurrentFileIndex(0);
  }, []);

  const parseOneFile = useCallback(
    (
      file: File,
      fileIndex: number,
      totalFiles: number,
    ): Promise<ExcelFileData> => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/excelWorker.ts", import.meta.url),
          { type: "module" },
        );

        workersRef.current.push(worker);

        const cleanup = () => {
          worker.terminate();
          workersRef.current = workersRef.current.filter((w) => w !== worker);
        };

        worker.onmessage = (e) => {
          const { type, payload } = e.data;

          if (type === "PROGRESS") {
            setCurrentFileIndex(fileIndex);
            setFileProgresses((prev) => ({
              ...prev,
              [payload.fileName]: {
                status: payload.status,
                progress: payload.progress,
              },
            }));
          } else if (type === "SUCCESS") {
            cleanup();
            resolve({
              fileName: payload.fileName,
              headers: payload.headers,
              rows: payload.rows,
              mergeRanges: payload.mergeRanges ?? [],
              originalColCount: payload.originalColCount ?? payload.headers.length,
            });
          } else if (type === "ERROR") {
            cleanup();
            reject(new Error(payload.message));
          }
        };

        worker.onerror = (err) => {
          cleanup();
          reject(new Error(err.message ?? "Ошибка в Web Worker"));
        };

        file
          .arrayBuffer()
          .then((buffer) => {
            if (abortedRef.current) {
              cleanup();
              reject(new Error("Отменено пользователем"));
              return;
            }

            // Transferable — передаём буфер без копирования
            worker.postMessage(
              {
                type: "PARSE_FILE",
                payload: { buffer, fileName: file.name, fileIndex, totalFiles },
              },
              [buffer],
            );
          })
          .catch(reject);
      });
    },
    [],
  );

  const parseFiles = useCallback(
    async (files: File[]): Promise<ExcelFileData[]> => {
      setIsLoading(true);
      setOverallProgress(0);
      setFileProgresses({});
      abortedRef.current = false;

      const results: ExcelFileData[] = [];

      try {
        for (let i = 0; i < files.length; i++) {
          if (abortedRef.current) break;

          const data = await parseOneFile(files[i], i, files.length);
          results.push(data);

          setOverallProgress(Math.round(((i + 1) / files.length) * 100));
          setFileProgresses((prev) => ({
            ...prev,
            [files[i].name]: {
              status: `✓ Готово (${data.rows.length} строк)`,
              progress: 100,
            },
          }));
        }

        return results;
      } finally {
        setIsLoading(false);
        setCurrentFileIndex(0);
      }
    },
    [parseOneFile],
  );

  return {
    parseFiles,
    isLoading,
    overallProgress,
    fileProgresses,
    currentFileIndex,
    abort,
  };
};
