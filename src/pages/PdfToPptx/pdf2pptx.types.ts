// Протокол обмена между страницей и фоновым потоком конвертера.

export type ConvertMode = "editable" | "exact";

/** public/pdf2pptx/manifest.json — пишет scripts/vendor-pdf2pptx.mjs. */
export interface Manifest {
  pyodide: string;
  engineCommit: string;
  engineFiles: string[];
  wheels: string[];
  runtimeBytes: number;
  /** Размер и SHA-256 файлов движка по реальным путям (runtime/…, engine/…). */
  files?: Record<string, { size: number; sha256: string }>;
}

export type WorkerRequest =
  | { type: "init"; base: string }
  | { type: "convert"; id: number; pdf: ArrayBuffer; mode: ConvertMode };

export type WorkerResponse =
  | { type: "stage"; text: string; step: number; steps: number }
  | { type: "ready"; ms: number; engineCommit: string; runtimeSize: string }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "done"; id: number; pptx: ArrayBuffer; ms: number }
  | {
      type: "error";
      id?: number;
      message: string;
      details?: string;
      /** Движок не запустился — конвертация невозможна. */
      fatal?: boolean;
    };
