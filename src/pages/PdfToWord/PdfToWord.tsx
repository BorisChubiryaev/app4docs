// pages/PdfToWord/PdfToWord.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { saveAs } from "file-saver";

import { PdfToWordInstructionsModal } from "./components/PdfToWordInstructionsModal";
import { convertPdfToDocx, PdfPasswordError } from "./engine";
import { convertDocxToPdf } from "./word2pdf";

import PageShell from "../../components/PageShell";
import "./PdfToWord.css";
import "./DocConverter.css";

import { pdfWorkerUrl } from "../../utils/pdfWorker";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();

// Конвертер документов: перетащили файлы — они сразу обрабатываются по
// очереди, каждый по своему направлению (PDF → Word, Word → PDF), и у
// каждого появляется кнопка «Скачать». PDF всегда переносится потоком текста
// («Текстом») — его удобнее всего править.

// ==================== ТИПЫ ====================

type Kind = "pdf" | "docx";
type FileStatus = "pending" | "converting" | "done" | "error";

interface FileItem {
  id: string;
  file: File;
  kind: Kind;
  status: FileStatus;
  progress: number;
  stage: string;
  resultBlob: Blob | null;
  resultSize: number;
  errorMessage: string;
  pageCount: number;
  extraInfo: string;
}

// ==================== УТИЛИТЫ ====================

const genId = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

const kindOf = (name: string): Kind | null => (/\.pdf$/i.test(name) ? "pdf" : /\.docx$/i.test(name) ? "docx" : null);
const resultName = (item: FileItem) =>
  item.kind === "pdf" ? item.file.name.replace(/\.pdf$/i, ".docx") : item.file.name.replace(/\.docx$/i, ".pdf");

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ==================== КОМПОНЕНТ ====================

const PdfToWord: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [tick, setTick] = useState(0);

  // ========== Файлы ==========

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const arr = Array.from(list);
      const valid: FileItem[] = [];
      let skipped = 0;
      for (const f of arr) {
        const kind = kindOf(f.name);
        if (!kind) {
          skipped++;
          continue;
        }
        if (files.some((ef) => ef.file.name === f.name && ef.file.size === f.size)) continue;
        valid.push({
          id: genId(),
          file: f,
          kind,
          status: "pending",
          progress: 0,
          stage: "В очереди",
          resultBlob: null,
          resultSize: 0,
          errorMessage: "",
          pageCount: 0,
          extraInfo: "",
        });
      }
      if (valid.length) {
        setFiles((prev) => [...prev, ...valid]);
        setError("");
      }
      if (skipped) setError(`Пропущено ${skipped} ${plural(skipped, "файл", "файла", "файлов")}: подходят только PDF и Word (.docx).`);
    },
    [files],
  );

  const openPicker = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const clearAll = () => {
    setFiles((prev) => prev.filter((f) => f.status === "converting"));
    setError("");
  };

  // ========== Конвертация ==========

  const updateFile = (id: string, updates: Partial<FileItem>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));

  const convertSingle = async (item: FileItem) => {
    updateFile(item.id, { status: "converting", progress: 0, stage: "Запуск…" });
    try {
      if (item.kind === "pdf") {
        const data = await item.file.arrayBuffer();
        const run = (password?: string) =>
          convertPdfToDocx(data.slice(0), item.file.name.replace(/\.pdf$/i, ""), {
            layout: "flow",
            password,
            onProgress: (cur, total, stage) => updateFile(item.id, { progress: (cur / total) * 100, stage }),
          });
        let result: Awaited<ReturnType<typeof convertPdfToDocx>> | null = null;
        let password: string | undefined;
        while (!result) {
          try {
            result = await run(password);
          } catch (e) {
            if (!(e instanceof PdfPasswordError)) throw e;
            const p = window.prompt(`${e.message}\nВведите пароль к файлу «${item.file.name}»:`, "");
            if (p === null) throw new Error("PDF защищён паролем — пароль не введён.");
            password = p;
          }
        }
        const parts: string[] = [];
        if (result.tables) parts.push(`${result.tables} ${plural(result.tables, "таблица", "таблицы", "таблиц")}`);
        if (result.images) parts.push(`${result.images} ${plural(result.images, "картинка", "картинки", "картинок")}`);
        if (result.scannedPages)
          parts.push(
            result.ocrError
              ? `скан картинкой — распознавание недоступно: ${result.ocrError}`
              : `${result.scannedPages} ${plural(result.scannedPages, "страница распознана", "страницы распознаны", "страниц распознано")}`,
          );
        updateFile(item.id, {
          status: "done",
          progress: 100,
          stage: "Готово",
          resultBlob: result.blob,
          resultSize: result.blob.size,
          pageCount: result.pages,
          extraInfo: parts.join(" · "),
        });
      } else {
        const result = await convertDocxToPdf(item.file, (p, stage) => updateFile(item.id, { progress: p, stage }));
        updateFile(item.id, {
          status: "done",
          progress: 100,
          stage: "Готово",
          resultBlob: result.blob,
          resultSize: result.blob.size,
          pageCount: result.pageCount,
          extraInfo: "",
        });
      }
    } catch (err) {
      console.error(`Error converting ${item.file.name}:`, err);
      updateFile(item.id, { status: "error", progress: 0, errorMessage: (err instanceof Error && err.message) || "Не удалось сконвертировать" });
    }
  };

  // Очередь: как только есть файл в ожидании и ничего не обрабатывается —
  // берём следующий. Кнопка «Конвертировать» не нужна.
  useEffect(() => {
    if (busy.current) return;
    const next = files.find((f) => f.status === "pending");
    if (!next) return;
    busy.current = true;
    convertSingle(next).finally(() => {
      busy.current = false;
      setTick((t) => t + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, tick]);

  const retryFile = (id: string) => updateFile(id, { status: "pending", progress: 0, errorMessage: "", stage: "В очереди" });

  // ========== Скачивание ==========

  const downloadOne = (item: FileItem) => item.resultBlob && saveAs(item.resultBlob, resultName(item));
  const downloadAll = async () => {
    const ready = files.filter((f) => f.status === "done" && f.resultBlob);
    for (let i = 0; i < ready.length; i++) {
      downloadOne(ready[i]);
      if (i < ready.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
  };

  // ========== Сводка ==========

  const total = files.length;
  const done = files.filter((f) => f.status === "done").length;
  const errors = files.filter((f) => f.status === "error").length;
  const working = files.some((f) => f.status === "converting" || f.status === "pending");
  const hasFiles = total > 0;

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    },
    onDrop: handleDrop,
  };

  return (
    <PageShell
      title="Конвертер документов"
      subtitle="PDF → Word и Word → PDF прямо в браузере"
      onShowInstructions={() => setIsInstructionsOpen(true)}
      width={900}
    >
      <div className="dc">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Зона загрузки: большая, пока файлов нет; компактная полоса — потом */}
        <div
          className={`dc-drop ${hasFiles ? "dc-drop--compact" : ""} ${isDragging ? "is-over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openPicker())}
          {...dropHandlers}
        >
          {hasFiles ? (
            <>
              <span className="dc-drop__plus" aria-hidden="true">
                ＋
              </span>
              <span>
                <b>Добавить ещё файлы</b> — перетащите сюда или щёлкните
              </span>
            </>
          ) : (
            <>
              <div className="dc-drop__art" aria-hidden="true">
                <span className="dc-doc dc-doc--pdf">PDF</span>
                <span className="dc-swap">⇄</span>
                <span className="dc-doc dc-doc--word">W</span>
              </div>
              <h2>Перетащите PDF или Word</h2>
              <p>или щёлкните, чтобы выбрать файлы — конвертация начнётся сразу</p>
              <span className="dc-drop__btn">Выбрать файлы</span>
              <span className="dc-drop__hint">PDF станет документом Word, Word — PDF. Можно несколько файлов сразу.</span>
            </>
          )}
        </div>

        {error && (
          <div className="dc-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Закрыть">
              ✕
            </button>
          </div>
        )}

        {hasFiles && (
          <section className="dc-list" aria-label="Файлы">
            <div className="dc-list__head">
              <span className="dc-list__title">
                {working
                  ? `Обработка… ${done} из ${total}`
                  : errors
                    ? `Готово ${done} из ${total} · ${errors} с ошибкой`
                    : `Готово: ${done} ${plural(done, "файл", "файла", "файлов")}`}
              </span>
              <div className="dc-list__actions">
                {done > 1 && (
                  <button className="dc-btn dc-btn--primary" onClick={downloadAll}>
                    Скачать все ({done})
                  </button>
                )}
                <button className="dc-btn dc-btn--ghost" onClick={clearAll} disabled={files.every((f) => f.status === "converting")}>
                  Очистить
                </button>
              </div>
            </div>

            <ul className="dc-rows">
              {files.map((item) => (
                <li key={item.id} className={`dc-row is-${item.status}`}>
                  <span className={`dc-badge dc-badge--${item.kind}`} aria-hidden="true">
                    {item.kind === "pdf" ? "PDF" : "W"}
                  </span>
                  <div className="dc-row__main">
                    <div className="dc-row__name" title={item.file.name}>
                      {item.file.name}
                    </div>
                    <div className="dc-row__meta">
                      <span className="dc-dir">{item.kind === "pdf" ? "PDF → Word" : "Word → PDF"}</span>
                      {item.status === "pending" && <span>В очереди</span>}
                      {item.status === "converting" && (
                        <span>
                          {Math.round(item.progress)}% · {item.stage}
                        </span>
                      )}
                      {item.status === "done" && (
                        <span>
                          {item.pageCount} {plural(item.pageCount, "страница", "страницы", "страниц")} · {formatSize(item.resultSize)}
                          {item.extraInfo ? ` · ${item.extraInfo}` : ""}
                        </span>
                      )}
                      {item.status === "error" && <span className="dc-err">{item.errorMessage}</span>}
                    </div>
                    {(item.status === "converting" || item.status === "pending") && (
                      <div className="dc-bar">
                        <i style={{ width: `${item.status === "pending" ? 0 : Math.max(3, item.progress)}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="dc-row__actions">
                    {item.status === "done" && (
                      <button className="dc-btn dc-btn--primary" onClick={() => downloadOne(item)}>
                        Скачать {item.kind === "pdf" ? ".docx" : ".pdf"}
                      </button>
                    )}
                    {item.status === "error" && (
                      <button className="dc-btn" onClick={() => retryFile(item.id)}>
                        Повторить
                      </button>
                    )}
                    {item.status === "converting" ? (
                      <span className="dc-spin" aria-label="Обрабатывается" />
                    ) : (
                      <button className="dc-x" onClick={() => removeFile(item.id)} aria-label={`Убрать ${item.file.name}`} title="Убрать из списка">
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!hasFiles && (
          <ul className="dc-features">
            <li>
              <b>Редактируемый текст</b>
              <span>Абзацы, заголовки, списки, жирный и курсив — как в обычном документе Word</span>
            </li>
            <li>
              <b>Таблицы и картинки</b>
              <span>Таблицы с объединёнными ячейками, схемы и фото на своих местах</span>
            </li>
            <li>
              <b>Сканы тоже</b>
              <span>Страницы-картинки распознаются (русский и английский), таблицы — по линиям</span>
            </li>
          </ul>
        )}

        <p className="dc-foot">
          🔒 Файлы не покидают ваш компьютер — всё считается в браузере, без интернета. Сложные формы и необычные шрифты
          переносятся приближённо; после распознавания сканов проверьте важные цифры.
        </p>
      </div>

      <PdfToWordInstructionsModal isOpen={isInstructionsOpen} onClose={() => setIsInstructionsOpen(false)} />
    </PageShell>
  );
};

export default PdfToWord;
