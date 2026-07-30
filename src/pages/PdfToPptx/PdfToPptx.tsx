// src/apps/PdfToPptx/PdfToPptx.tsx

import React, { useState, useRef, useCallback } from "react";
import { parsePdf } from "./pdfParser";
import { buildPptx } from "./pptxBuilder";
import type { ConversionProgress, ParsedPage } from "./types";
import Header from "../../components/header/Header";
import "./PdfToPptx.css";

const PdfToPptx: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ConversionProgress>({
    stage: "idle",
    currentPage: 0,
    totalPages: 0,
    message: "",
    percent: 0,
  });
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedPages, setParsedPages] = useState<ParsedPage[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setParsedPages(null);
    setError(null);
    setPreviewIdx(0);
    setProgress({
      stage: "idle",
      currentPage: 0,
      totalPages: 0,
      message: "",
      percent: 0,
    });
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const selectFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("Выберите файл формата PDF");
      return;
    }
    setFile(f);
    setParsedPages(null);
    setError(null);
    setPreviewIdx(0);
    setProgress({
      stage: "idle",
      currentPage: 0,
      totalPages: 0,
      message: "",
      percent: 0,
    });
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) selectFile(e.target.files[0]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) selectFile(e.dataTransfer.files[0]);
  };

  const convert = async () => {
    if (!file) return;
    setIsConverting(true);
    setError(null);

    try {
      const buf = await file.arrayBuffer();

      const pages = await parsePdf(buf, setProgress);
      setParsedPages(pages);

      const blob = await buildPptx(pages, setProgress);

      // Скачать
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + ".pptx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setProgress({
        stage: "done",
        currentPage: pages.length,
        totalPages: pages.length,
        message: "Готово! Файл скачан.",
        percent: 100,
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Ошибка конвертации");
      setProgress({
        stage: "error",
        currentPage: 0,
        totalPages: 0,
        message: "Ошибка",
        percent: 0,
      });
    } finally {
      setIsConverting(false);
    }
  };

  const fmtSize = (b: number) =>
    b < 1024
      ? b + " B"
      : b < 1048576
        ? (b / 1024).toFixed(1) + " KB"
        : (b / 1048576).toFixed(1) + " MB";

  const busy = isConverting;

  return (
    <div className="ptp-container">
      <Header
        title="PDF → PPTX"
        description="Конвертация PDF в редактируемый PowerPoint — полностью в браузере"
        onShowInstructions={() => setShowInstructions(true)}
        showHomeButton
        showInstructionsButton
      />

      <div className="ptp-body">
        {/* ---- Upload ---- */}
        <div
          className={`ptp-drop ${isDragging ? "ptp-drop--over" : ""} ${file ? "ptp-drop--has" : ""}`}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setIsDragging(false);
          }}
          onClick={() => !file && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            onChange={onInput}
            className="ptp-drop__input"
            disabled={busy}
          />

          {!file ? (
            <div className="ptp-drop__empty">
              <svg
                className="ptp-drop__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
              <p className="ptp-drop__title">Перетащите PDF сюда</p>
              <p className="ptp-drop__sub">или нажмите для выбора</p>
              <button
                className="ptp-btn ptp-btn--accent"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                Выбрать файл
              </button>
            </div>
          ) : (
            <div className="ptp-drop__file">
              <div className="ptp-drop__file-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#e74c3c"
                  strokeWidth="1.5"
                  width="44"
                  height="44"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="ptp-drop__file-info">
                <span className="ptp-drop__file-name">{file.name}</span>
                <span className="ptp-drop__file-size">
                  {fmtSize(file.size)}
                </span>
              </div>
              <button
                className="ptp-btn-x"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                title="Убрать"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* ---- Error ---- */}
        {error && (
          <div className="ptp-alert ptp-alert--err">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* ---- Convert button ---- */}
        {file && !busy && progress.stage !== "done" && (
          <button className="ptp-btn ptp-btn--go" onClick={convert}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
            </svg>
            Конвертировать в PPTX
          </button>
        )}

        {/* ---- Progress ---- */}
        {busy && (
          <div className="ptp-prog">
            <div className="ptp-prog__head">
              <span>{progress.message}</span>
              <span className="ptp-prog__pct">
                {Math.round(progress.percent)}%
              </span>
            </div>
            <div className="ptp-prog__track">
              <div
                className="ptp-prog__bar"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            {progress.totalPages > 0 && (
              <div className="ptp-prog__detail">
                Страница {progress.currentPage} из {progress.totalPages}
              </div>
            )}
          </div>
        )}

        {/* ---- Done ---- */}
        {progress.stage === "done" && (
          <div className="ptp-done">
            <div className="ptp-done__icon">✅</div>
            <h3>Конвертация завершена!</h3>
            <p>
              PPTX файл скачан. Все текстовые блоки и изображения —
              редактируемые объекты поверх фона страницы.
            </p>
            <div className="ptp-done__actions">
              <button className="ptp-btn ptp-btn--accent" onClick={convert}>
                🔄 Ещё раз
              </button>
              <button className="ptp-btn ptp-btn--ghost" onClick={reset}>
                📄 Другой файл
              </button>
            </div>
          </div>
        )}

        {/* ---- Preview ---- */}
        {parsedPages && parsedPages.length > 0 && (
          <div className="ptp-preview">
            <div className="ptp-preview__head">
              <h3>
                Результат{" "}
                <span className="ptp-badge">{parsedPages.length} слайдов</span>
              </h3>
            </div>

            {/* Nav */}
            <div className="ptp-preview__nav">
              <button
                className="ptp-btn ptp-btn--sm"
                disabled={previewIdx === 0}
                onClick={() => setPreviewIdx(previewIdx - 1)}
              >
                ← Назад
              </button>
              <span className="ptp-preview__cur">
                {previewIdx + 1} / {parsedPages.length}
              </span>
              <button
                className="ptp-btn ptp-btn--sm"
                disabled={previewIdx === parsedPages.length - 1}
                onClick={() => setPreviewIdx(previewIdx + 1)}
              >
                Вперёд →
              </button>
            </div>

            {/* Slide card */}
            <div className="ptp-preview__card">
              {parsedPages[previewIdx].backgroundDataUrl && (
                <img
                  src={parsedPages[previewIdx].backgroundDataUrl}
                  alt={`Стр. ${previewIdx + 1}`}
                  className="ptp-preview__img"
                />
              )}
              <div className="ptp-preview__meta">
                <span>
                  📝 Текст:{" "}
                  <b>
                    {
                      parsedPages[previewIdx].elements.filter(
                        (e) => e.type === "text",
                      ).length
                    }
                  </b>
                </span>
                <span>
                  🖼️ Изобр.:{" "}
                  <b>
                    {
                      parsedPages[previewIdx].elements.filter(
                        (e) => e.type === "image",
                      ).length
                    }
                  </b>
                </span>
                <span>
                  📐 {parsedPages[previewIdx].widthInches.toFixed(1)}″ ×{" "}
                  {parsedPages[previewIdx].heightInches.toFixed(1)}″
                </span>
              </div>
            </div>

            {/* Thumbnails */}
            {parsedPages.length > 1 && (
              <div className="ptp-thumbs">
                {parsedPages.map((p, idx) => (
                  <button
                    key={idx}
                    className={`ptp-thumb ${idx === previewIdx ? "ptp-thumb--on" : ""}`}
                    onClick={() => setPreviewIdx(idx)}
                  >
                    {p.backgroundDataUrl ? (
                      <img src={p.backgroundDataUrl} alt={`${idx + 1}`} />
                    ) : (
                      <span>{idx + 1}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Instructions modal ---- */}
      {showInstructions && (
        <div className="ptp-overlay" onClick={() => setShowInstructions(false)}>
          <div className="ptp-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="ptp-modal__x"
              onClick={() => setShowInstructions(false)}
            >
              ✕
            </button>
            <h2>📖 Как это работает</h2>
            <ol className="ptp-how">
              <li>
                <b>Загрузите PDF</b> — перетащите или выберите файл.
              </li>
              <li>
                <b>Нажмите «Конвертировать»</b> — всё происходит в браузере,
                файл никуда не отправляется.
              </li>
              <li>
                <b>Скачайте PPTX</b> — откройте в PowerPoint / Google Slides /
                LibreOffice.
              </li>
              <li>
                <b>Редактируйте</b> — текстовые блоки и изображения являются
                отдельными объектами, их можно двигать, изменять, удалять.
              </li>
            </ol>
            <div className="ptp-how__note">
              <b>Как устроен результат:</b>
              <br />
              Каждый слайд содержит фоновое изображение страницы (для точной
              визуальной копии) + отдельные текстовые блоки и изображения поверх
              фона. Вы можете удалить фон и работать только с объектами, или
              наоборот.
            </div>
            <div className="ptp-how__warn">
              ⚠️ PDF и PPTX — принципиально разные форматы. Сложная вёрстка
              (таблицы, колонки, формулы) может конвертироваться неидеально.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfToPptx;
