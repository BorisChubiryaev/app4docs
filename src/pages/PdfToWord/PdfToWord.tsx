// pages/PdfToWord/PdfToWord.tsx
import React, { useState, useRef, useCallback } from "react";
import * as pdfjs from "pdfjs-dist";
import { saveAs } from "file-saver";

import { PdfToWordInstructionsModal } from "./components/PdfToWordInstructionsModal";
import { convertPdfToDocx, PdfPasswordError, type LayoutMode } from "./engine";
import { convertDocxToPdf } from "./word2pdf";

import PageShell from "../../components/PageShell";
import "./PdfToWord.css";

import { pdfWorkerUrl } from "../../utils/pdfWorker";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();

// ==================== ТИПЫ ====================

type ConvertMode = "pdf-to-word" | "word-to-pdf";
type FileStatus = "pending" | "converting" | "done" | "error";

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  stage: string;
  resultBlob: Blob | null;
  resultSize: number;
  errorMessage: string;
  pageCount: number;
  extraInfo: string;
}

// ==================== ОБЩИЕ УТИЛИТЫ ====================

const genId = () =>
  Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pluralFiles(n: number): string {
  if (n === 1) return "файл";
  if (n >= 2 && n <= 4) return "файла";
  return "файлов";
}

// ==================== КОМПОНЕНТ ====================

const PdfToWord: React.FC = () => {
  const [mode, setMode] = useState<ConvertMode>("pdf-to-word");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("auto");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptExt = files.length > 0 ? (mode === "pdf-to-word" ? ".pdf" : ".docx") : ".pdf,.docx";
  const acceptLabel = mode === "pdf-to-word" ? "PDF" : "Word (.docx)";

  // ========== Файлы ==========
  // Режим определяется автоматически по расширению первого загруженного
  // файла — ручной переключатель PDF↔Word только путал пользователей.

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const arr = Array.from(newFiles);
      let curMode = mode;
      if (files.length === 0) {
        const first = arr.find((f) => /\.(pdf|docx)$/i.test(f.name));
        if (first) {
          curMode = first.name.toLowerCase().endsWith(".pdf")
            ? "pdf-to-word"
            : "word-to-pdf";
          if (curMode !== mode) setMode(curMode);
        }
      }
      const ext = curMode === "pdf-to-word" ? "pdf" : "docx";
      const valid: FileItem[] = [];
      arr.forEach((f) => {
        if (!f.name.toLowerCase().endsWith(`.${ext}`)) return;
        if (
          files.some((ef) => ef.file.name === f.name && ef.file.size === f.size)
        )
          return;
        valid.push({
          id: genId(),
          file: f,
          status: "pending",
          progress: 0,
          stage: "",
          resultBlob: null,
          resultSize: 0,
          errorMessage: "",
          pageCount: 0,
          extraInfo: "",
        });
      });
      if (valid.length) setFiles((prev) => [...prev, ...valid]);
      else if (arr.length > 0)
        setError(
          `Выберите ${curMode === "pdf-to-word" ? "PDF" : "Word (.docx)"} файлы`,
        );
    },
    [files, mode],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));
  const clearAll = () => {
    setFiles([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ========== Конвертация ==========

  const updateFile = (id: string, updates: Partial<FileItem>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  };

  const convertSingle = async (item: FileItem) => {
    updateFile(item.id, {
      status: "converting",
      progress: 0,
      stage: "Запуск...",
    });

    try {
      if (mode === "pdf-to-word") {
        const data = await item.file.arrayBuffer();
        const run = (password?: string) =>
          convertPdfToDocx(data.slice(0), item.file.name.replace(/\.pdf$/i, ""), {
            layout: layoutMode,
            password,
            onProgress: (cur, total, stage) => {
              updateFile(item.id, { progress: (cur / total) * 100, stage });
            },
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
        const parts = [`${result.paragraphs} абз.`];
        if (result.tables) parts.push(`${result.tables} табл.`);
        if (result.images) parts.push(`${result.images} изобр.`);
        if (result.scannedPages)
          parts.push(
            result.ocrError
              ? `${result.scannedPages} стр. — скан картинкой (распознавание недоступно: ${result.ocrError})`
              : `${result.scannedPages} стр. распознано`,
          );
        if (result.designPages) parts.push(`${result.designPages} стр. — макетом`);
        updateFile(item.id, {
          status: "done",
          progress: 100,
          stage: "Готово",
          resultBlob: result.blob,
          resultSize: result.blob.size,
          pageCount: result.pages,
          extraInfo: parts.join(", "),
        });
      } else {
        const result = await convertDocxToPdf(item.file, (p, stage) => {
          updateFile(item.id, { progress: p, stage });
        });
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
      updateFile(item.id, {
        status: "error",
        progress: 0,
        errorMessage: (err instanceof Error && err.message) || "Ошибка",
      });
    }
  };

  const convertAll = async () => {
    setIsConverting(true);
    setError("");
    const pending = files.filter(
      (f) => f.status === "pending" || f.status === "error",
    );
    for (const item of pending) {
      await convertSingle(item);
      await new Promise((r) => setTimeout(r, 200));
    }
    setIsConverting(false);
  };

  const retryFile = async (id: string) => {
    const item = files.find((f) => f.id === id);
    if (!item) return;
    updateFile(id, {
      status: "pending",
      progress: 0,
      errorMessage: "",
      stage: "",
    });
    setIsConverting(true);
    await convertSingle({
      ...item,
      status: "pending",
      progress: 0,
      errorMessage: "",
    });
    setIsConverting(false);
  };

  // ========== Скачивание ==========

  const downloadOne = (item: FileItem) => {
    if (!item.resultBlob) return;
    const ext = mode === "pdf-to-word" ? ".docx" : ".pdf";
    const removeExt = mode === "pdf-to-word" ? /\.pdf$/i : /\.docx?$/i;
    const name = item.file.name.replace(removeExt, ext);
    saveAs(item.resultBlob, name);
  };

  const downloadAll = async () => {
    const done = files.filter((f) => f.status === "done" && f.resultBlob);
    for (let i = 0; i < done.length; i++) {
      downloadOne(done[i]);
      if (i < done.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
  };

  // ========== Статистика ==========
  const total = files.length;
  const done = files.filter((f) => f.status === "done").length;
  const errors = files.filter((f) => f.status === "error").length;
  const pending = files.filter(
    (f) => f.status === "pending" || f.status === "converting",
  ).length;
  const hasPending = files.some(
    (f) => f.status === "pending" || f.status === "error",
  );

  return (
    <PageShell
      title="Конвертер документов"
      subtitle="PDF ↔ Word — конвертируйте в обе стороны, прямо в браузере"
      onShowInstructions={() => setIsInstructionsOpen(true)}
    >

        <div className="converter-content">
          <div className="input-column">
            {/* Зона загрузки */}
            <div
              className={`glass-card upload-card ${isDragging ? "dragging" : ""}`}
            >
              <div className="upload-header">
                <div className="upload-icon">
                  <div className="icon-wrapper">
                    <span className="icon">
                      {total === 0 ? "📄" : mode === "pdf-to-word" ? "📄" : "📘"}
                    </span>
                    {total > 0 && <span className="status-icon">{total}</span>}
                  </div>
                </div>
                <div className="upload-info">
                  <h3>
                    {total === 0
                      ? "Загрузите PDF или Word файлы"
                      : `${total} ${pluralFiles(total)}`}
                  </h3>
                  {total > 0 && (
                    <span className="file-details">
                      {formatSize(files.reduce((s, f) => s + f.file.size, 0))}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="upload-zone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <div className="upload-placeholder">
                  <span className="placeholder-icon">📂</span>
                  <p className="placeholder-text">
                    {total === 0
                      ? "Перетащите PDF или Word файлы или"
                      : `Перетащите ещё ${acceptLabel} файлы или`}
                  </p>
                  <p className="placeholder-subtext">
                    PDF → Word, Word → PDF — определяется автоматически
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptExt}
                  multiple
                  onChange={handleFileInput}
                  className="file-input"
                  id="convFile"
                />
                <label htmlFor="convFile" className="glass-button primary">
                  Выбрать файлы
                </label>
              </div>
            </div>

            {/* Список файлов */}
            {files.length > 0 && (
              <div className="glass-card files-list-card">
                <div className="files-list-header">
                  <h3>📋 Файлы ({files.length})</h3>
                  <div className="files-list-actions">
                    {done > 0 && (
                      <button
                        onClick={downloadAll}
                        className="glass-button small primary"
                      >
                        📥 Скачать все
                      </button>
                    )}
                    <button
                      onClick={clearAll}
                      className="glass-button small secondary"
                    >
                      🗑️ Очистить
                    </button>
                  </div>
                </div>

                <div className="files-list">
                  {files.map((item) => (
                    <div key={item.id} className={`file-row ${item.status}`}>
                      <div className="file-row-icon">
                        {item.status === "pending" &&
                          (mode === "pdf-to-word" ? "📄" : "📘")}
                        {item.status === "converting" && (
                          <span className="file-spinner">⏳</span>
                        )}
                        {item.status === "done" && "✅"}
                        {item.status === "error" && "❌"}
                      </div>
                      <div className="file-row-info">
                        <span className="file-row-name">{item.file.name}</span>
                        <div className="file-row-details">
                          <span className="file-row-size">
                            {formatSize(item.file.size)}
                          </span>
                          {item.status === "done" && (
                            <>
                              <span className="file-row-arrow">→</span>
                              <span className="file-row-result-size">
                                {formatSize(item.resultSize)}
                              </span>
                              <span className="file-row-pages">
                                {item.pageCount} стр.
                              </span>
                              {item.extraInfo && (
                                <span className="file-row-extra">
                                  {item.extraInfo}
                                </span>
                              )}
                            </>
                          )}
                          {item.status === "converting" && (
                            <span className="file-row-progress">
                              {Math.round(item.progress)}% — {item.stage}
                            </span>
                          )}
                          {item.status === "error" && (
                            <span className="file-row-error">
                              {item.errorMessage}
                            </span>
                          )}
                        </div>
                        {item.status === "converting" && (
                          <div className="file-row-progress-bar">
                            <div
                              className="file-row-progress-fill"
                              style={{ width: `${item.progress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                      <div className="file-row-actions">
                        {item.status === "done" && (
                          <button
                            onClick={() => downloadOne(item)}
                            className="file-action-btn download"
                            title="Скачать"
                          >
                            📥
                          </button>
                        )}
                        {item.status === "error" && (
                          <button
                            onClick={() => retryFile(item.id)}
                            className="file-action-btn retry"
                            title="Повторить"
                            disabled={isConverting}
                          >
                            🔄
                          </button>
                        )}
                        <button
                          onClick={() => removeFile(item.id)}
                          className="file-action-btn remove"
                          title="Удалить"
                          disabled={item.status === "converting"}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {(done > 0 || errors > 0) && (
                  <div className="files-summary">
                    {done > 0 && (
                      <span className="summary-done">✅ {done} готово</span>
                    )}
                    {errors > 0 && (
                      <span className="summary-error">❌ {errors} ошибок</span>
                    )}
                    {pending > 0 && (
                      <span className="summary-pending">
                        ⏳ {pending} в очереди
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Кнопка */}
            <button
              onClick={convertAll}
              disabled={!hasPending || isConverting || total === 0}
              className={`glass-button compress-button ${isConverting ? "loading" : ""} ${!hasPending || total === 0 ? "disabled" : "glass-card"}`}
            >
              {isConverting ? (
                <>
                  <span className="spinner"></span>
                  <span className="button-text">
                    Конвертация... {done}/{total}
                  </span>
                </>
              ) : (
                <>
                  <span className="button-icon">🔄</span>
                  <span className="button-text">
                    {total === 0
                      ? `Загрузите ${acceptLabel} файлы`
                      : !hasPending
                        ? "Все обработаны"
                        : `Конвертировать ${files.filter((f) => f.status === "pending" || f.status === "error").length} ${pluralFiles(files.filter((f) => f.status === "pending" || f.status === "error").length)}`}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Правая колонка */}
          <div className="output-column">
            <div className="glass-card info-card">
              <h3>
                {mode === "pdf-to-word" ? "📚 PDF → Word" : "📚 Word → PDF"}
              </h3>
              <div className="info-content">
                {mode === "pdf-to-word" ? (
                  <>
                    <div className="p2w-mode" role="radiogroup" aria-label="Как переносить страницы">
                      <span className="p2w-mode-title">Как переносить страницы</span>
                      {(
                        [
                          ["auto", "Авто", "Документы — редактируемым текстом, презентации и буклеты — как в PDF"],
                          ["flow", "Текстом", "Всё потоком: удобно править, оформление упрощается"],
                          ["exact", "Как в PDF", "Фон страницы и текст в рамках на своих местах"],
                        ] as [LayoutMode, string, string][]
                      ).map(([id, label, hint]) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={layoutMode === id}
                          className={`p2w-mode-btn ${layoutMode === id ? "active" : ""}`}
                          onClick={() => setLayoutMode(id)}
                          disabled={isConverting}
                        >
                          <strong>{label}</strong>
                          <span>{hint}</span>
                        </button>
                      ))}
                    </div>
                    <div className="info-item">
                      <span className="info-icon">✅</span>
                      <div className="info-text">
                        <strong>Оформление как в PDF</strong>
                        <p>Шрифты, жирный, курсив, подчёркивание, цвет, выравнивание, отступы, интервалы, колонтитулы с номерами страниц</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">📊</span>
                      <div className="info-text">
                        <strong>Таблицы, списки, колонки</strong>
                        <p>Объединённые ячейки и заливка, таблицы без рамок, таблица через несколько страниц — одной таблицей; две-три колонки текста</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">🖼️</span>
                      <div className="info-text">
                        <strong>Картинки и графики</strong>
                        <p>Фото и векторные схемы, диаграммы — картинками на своих местах</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="info-item">
                      <span className="info-icon">📘</span>
                      <div className="info-text">
                        <strong>Как в Word</strong>
                        <p>Размер страниц и поля, шрифты, цвета, списки, картинки, колонтитулы с номерами страниц, альбомные разделы</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">📑</span>
                      <div className="info-text">
                        <strong>Аккуратные страницы</strong>
                        <p>Таблицы переносятся по строкам с повтором шапки, абзацы — по строкам, заголовок не остаётся внизу страницы</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">🔎</span>
                      <div className="info-text">
                        <strong>Текст в PDF ищется и копируется</strong>
                        <p>Поверх изображения страницы — невидимый текстовый слой</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="info-item">
                  <span className="info-icon">⚡</span>
                  <div className="info-text">
                    <strong>Локально</strong>
                    <p>Без серверов, без интернета</p>
                  </div>
                </div>
                <div className="security-note">
                  <span className="security-icon">🔒</span>
                  <span>Файлы не покидают ваш компьютер</span>
                </div>
              </div>
            </div>

            <div className="glass-card warning-card">
              <div className="warning-banner">
                <span className="warning-icon">⚠️</span>
                <div className="warning-text">
                  {mode === "pdf-to-word" ? (
                    <>
                      <strong>Ограничения:</strong> сложные формы и нестандартные шрифты переносятся
                      приближённо. Сканы распознаются (русский и английский) — проверьте важные цифры.
                    </>
                  ) : (
                    <>
                      <strong>Поддержка:</strong> .docx (Word 2007+). SmartArt, фигуры и надписи — упрощённо.
                      Страницы PDF — изображения с текстовым слоем: поиск работает, править текст в PDF нельзя.
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="error-alert">
            <div className="alert-content">
              <span className="alert-icon">⚠️</span>
              <div className="alert-text">
                <strong>Ошибка:</strong> {error}
              </div>
              <button onClick={() => setError("")} className="alert-close">
                ✕
              </button>
            </div>
          </div>
        )}
      <PdfToWordInstructionsModal
        isOpen={isInstructionsOpen}
        onClose={() => setIsInstructionsOpen(false)}
      />
    </PageShell>
  );
};

export default PdfToWord;
