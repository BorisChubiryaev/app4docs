import React, { useState, useEffect, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import { PdfCompressorInstructions } from "./components/PdfCompressorInstructions";

import "./PdfCompressor.css";

import PageShell from "../../components/PageShell";

import * as pdfjs from "pdfjs-dist";

// Импортируем воркер как raw текст и создаём Blob
import pdfWorkerContent from "pdfjs-dist/build/pdf.worker.mjs?raw";

const workerBlob = new Blob([pdfWorkerContent], {
  type: "application/javascript",
});
const workerBlobUrl = URL.createObjectURL(workerBlob);
pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl;

interface CompressionResult {
  id: string;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  url: string;
  timestamp: Date;
  pageCount: number;
}

const PdfCompressor: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    message: "",
  });
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  // Убрали сохранение в localStorage, теперь история только для текущей сессии
  const [history, setHistory] = useState<CompressionResult[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      // Очищаем URL при размонтировании компонента
      if (result?.url) URL.revokeObjectURL(result.url);
      history.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
    };
  }, [result, history]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement> | React.DragEvent,
  ) => {
    let selectedFile: File | null = null;

    if ("dataTransfer" in e) {
      e.preventDefault();
      setIsDragging(false);
      selectedFile = e.dataTransfer.files[0];
    } else {
      selectedFile = e.target.files?.[0] || null;
    }

    if (!selectedFile) return;

    const isPdf =
      selectedFile.type === "application/pdf" ||
      selectedFile.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setError("Пожалуйста, выберите PDF файл (.pdf)");
      return;
    }

    setFile(selectedFile);
    setResult(null);
    setError("");
    setProgress({ current: 0, total: 0, message: "" });
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const compressPdf = async () => {
    if (!file) return;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError("");
    setProgress({ current: 0, total: 0, message: "Подготовка..." });
    setResult(null);

    let pdfDoc: any = null;
    let loadingTask: any = null;

    try {
      const buffer = await file.arrayBuffer();

      // Оптимальные настройки для минимальной потери качества
      const config = {
        dpi: 150,
        quality: 0.85,
      };

      setProgress({ current: 0, total: 1, message: "Загружаем PDF..." });
      loadingTask = pdfjs.getDocument({
        data: buffer,
        disableAutoFetch: true,
        verbosity: 0,
      });

      pdfDoc = await loadingTask.promise;
      const totalPages = pdfDoc.numPages;

      const compressedBlob = await compressPdfToImages(pdfDoc, config, signal);

      if (signal.aborted) {
        throw new Error("Сжатие отменено");
      }

      const resultObj: CompressionResult = {
        id: Date.now().toString(),
        fileName: file.name.replace(/\.pdf$/i, "_compressed.pdf"),
        originalSize: file.size,
        compressedSize: compressedBlob.size,
        ratio: Math.round((1 - compressedBlob.size / file.size) * 100),
        url: URL.createObjectURL(compressedBlob),
        timestamp: new Date(),
        pageCount: totalPages,
      };

      setResult(resultObj);
      setProgress({
        current: totalPages,
        total: totalPages,
        message: "Готово!",
      });

      // Добавляем в историю только для текущей сессии (без сохранения в localStorage)
      setHistory((prev) => [resultObj, ...prev.slice(0, 9)]);
    } catch (err: any) {
      if (err.message !== "Сжатие отменено") {
        console.error("Compression error:", err);
        setError(err.message || "Ошибка при сжатии файла");
      }
    } finally {
      if (pdfDoc) pdfDoc.destroy();
      if (loadingTask) loadingTask.destroy();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const compressPdfToImages = async (
    pdf: any,
    config: any,
    signal: AbortSignal,
  ): Promise<Blob> => {
    const totalPages = pdf.numPages;
    const outPdf = await PDFDocument.create();

    setProgress({
      current: 0,
      total: totalPages,
      message: `Обработка 1 из ${totalPages} страниц...`,
    });

    const scale = config.dpi / 72;

    for (let i = 1; i <= totalPages; i++) {
      if (signal.aborted) {
        throw new Error("Сжатие отменено");
      }

      try {
        setProgress({
          current: i,
          total: totalPages,
          message: `Обработка ${i} из ${totalPages} страниц...`,
        });

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });

        const maxDimension = 4096;
        let width = Math.floor(viewport.width);
        let height = Math.floor(viewport.height);

        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });

        if (!ctx) {
          throw new Error("Не удалось создать контекст canvas");
        }

        canvas.width = width;
        canvas.height = height;

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const renderViewport = page.getViewport({
          scale: scale * (width / viewport.width),
        });

        await page.render({
          canvasContext: ctx,
          viewport: renderViewport,
          background: "white",
          intent: "print",
        }).promise;

        const dataUrl = canvas.toDataURL("image/jpeg", config.quality);
        const img = await outPdf.embedJpg(dataUrl);

        const pdfPage = outPdf.addPage([width, height]);
        pdfPage.drawImage(img, {
          x: 0,
          y: 0,
          width: width,
          height: height,
        });

        canvas.width = 0;
        canvas.height = 0;
        page.destroy();

        if (i % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (pageErr) {
        console.warn(`Error processing page ${i}:`, pageErr);
        continue;
      }
    }

    setProgress({
      current: totalPages,
      total: totalPages,
      message: "Формируем PDF...",
    });

    const pdfBytes = await outPdf.save();

    if (signal.aborted) throw new Error("Сжатие отменено");

    return new Blob([pdfBytes], { type: "application/pdf" });
  };

  const cancelCompression = () => {
    if (abortControllerRef.current && loading) {
      abortControllerRef.current.abort();
      setError("Сжатие отменено");
      setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!result?.url) return;

    const link = document.createElement("a");
    link.href = result.url;
    link.download = result.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setProgress({ current: 0, total: 0, message: "" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeFromHistory = (id: string) => {
    const newHistory = history.filter((item) => item.id !== id);
    setHistory(newHistory);
  };

  const clearHistory = () => {
    setHistory([]);
  };

  return (
    <PageShell
      title="PDF компрессор"
      subtitle="Уменьшайте размер PDF с минимальной потерей качества"
      onShowInstructions={() => setShowInstructions(true)}
    >
        <div className="compressor-content">
          <div className="input-column">
            <div
              className={`glass-card upload-card ${isDragging ? "dragging" : ""}`}
            >
              <div className="upload-header">
                <div className="upload-icon">
                  <div className="icon-wrapper">
                    <span className="icon">📄</span>
                    {file && <span className="status-icon">✓</span>}
                  </div>
                </div>
                <div className="upload-info">
                  <h3>{file ? file.name : "Загрузите PDF файл"}</h3>
                  {file && (
                    <div className="file-details">
                      <span>{formatSize(file.size)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`upload-zone ${file ? "has-file" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFileChange}
              >
                {!file ? (
                  <>
                    <div className="upload-placeholder">
                      <span className="placeholder-icon">📂</span>
                      <p className="placeholder-text">
                        Перетащите PDF файл или
                      </p>
                      <p className="placeholder-subtext">
                        Поддерживаются файлы любого размера
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handleFileChange}
                      className="file-input"
                      id="pdfFile"
                    />
                    <label htmlFor="pdfFile" className="glass-button primary">
                      Выбрать файл
                    </label>
                  </>
                ) : (
                  <div className="file-preview">
                    <div className="preview-info">
                      <div className="preview-actions">
                        <label
                          htmlFor="pdfFile"
                          className="glass-button secondary small"
                        >
                          Заменить
                        </label>
                        <button
                          onClick={clearFile}
                          className="glass-button secondary small"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={compressPdf}
              disabled={!file || loading}
              className={`glass-button compress-button ${loading ? "loading" : ""} ${!file ? "disabled" : "glass-card"}`}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  <span className="button-text">
                    Сжатие...{" "}
                    {progress.total > 0
                      ? `${progress.current}/${progress.total}`
                      : ""}
                  </span>
                </>
              ) : (
                <>
                  <span className="button-icon">📉</span>
                  <span className="button-text">
                    {!file ? "Загрузите PDF файл" : "Уменьшить размер PDF"}
                  </span>
                </>
              )}
            </button>

            {loading && (
              <div className="progress-container">
                <div className="progress-header">
                  <span>{progress.message || "Обработка..."}</span>
                  <span>
                    {progress.total > 0
                      ? `${Math.round((progress.current / progress.total) * 100)}%`
                      : "Подготовка..."}
                  </span>
                </div>
                {progress.total > 0 && (
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(progress.current / progress.total) * 100}%`,
                      }}
                    ></div>
                  </div>
                )}
                <button
                  onClick={cancelCompression}
                  className="glass-button cancel-button"
                >
                  Отменить
                </button>
              </div>
            )}
          </div>

          <div className="output-column">
            {result ? (
              <div className="glass-card result-card">
                <div className="result-header">
                  <div className="result-icon">✅</div>
                  <div className="result-title">
                    <h3>Сжатие завершено!</h3>
                    <p className="result-subtitle">
                      {result.pageCount} стр. • Уменьшение размера:{" "}
                      {result.ratio}%
                    </p>
                  </div>
                </div>

                <div className="result-stats">
                  <div className="stat-row">
                    <div className="stat-item">
                      <div className="stat-label">Исходный размер</div>
                      <div className="stat-value original">
                        {formatSize(result.originalSize)}
                      </div>
                    </div>
                    <div className="stat-arrow">→</div>
                    <div className="stat-item">
                      <div className="stat-label">После сжатия</div>
                      <div className="stat-value compressed">
                        {formatSize(result.compressedSize)}
                      </div>
                    </div>
                  </div>
                  <div className="stat-row">
                    <div className="stat-item ratio">
                      <div className="stat-label">Экономия места</div>
                      <div
                        className={`stat-value ${result.ratio > 0 ? "positive" : "negative"}`}
                      >
                        {result.ratio > 0 ? "↓" : "↑"} {Math.abs(result.ratio)}%
                      </div>
                    </div>
                  </div>
                </div>

                <div className="result-actions">
                  <button
                    onClick={downloadResult}
                    className="glass-button primary download-button"
                  >
                    <span className="button-icon">📥</span>
                    Скачать файл
                  </button>
                  <button
                    onClick={clearFile}
                    className="glass-button secondary"
                  >
                    Новый файл
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass-card placeholder-card">
                <div className="placeholder-content">
                  <div className="placeholder-icon">
                    <div className="icon-animation">
                      <span className="icon">📄</span>
                      <span className="arrow">→</span>
                      <span className="icon">📉</span>
                    </div>
                  </div>
                  <h3>Ожидание файла</h3>
                  <p>Загрузите PDF файл для уменьшения размера</p>
                  <div className="placeholder-tips">
                    <div className="tip">
                      <span className="tip-icon">⚡</span>
                      <span>
                        Уменьшение веса с минимальной потерей качества
                      </span>
                    </div>
                    <div className="tip">
                      <span className="tip-icon">🔒</span>
                      <span>Локальная обработка в браузере</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className="glass-card history-card">
                <div className="history-header">
                  <div className="history-title">
                    <h3>История сжатия (текущая сессия)</h3>
                    <span className="history-count">{history.length}</span>
                  </div>
                  <button
                    onClick={clearHistory}
                    className="glass-button secondary small"
                    title="Очистить историю"
                  >
                    Очистить
                  </button>
                </div>

                <div className="history-list">
                  {history.map((item) => (
                    <div key={item.id} className="history-item">
                      <div className="item-info">
                        <div className="item-name" title={item.fileName}>
                          {item.fileName}
                        </div>
                        <div className="item-stats">
                          <span
                            className={`size-diff ${item.ratio > 0 ? "positive" : "negative"}`}
                          >
                            {item.ratio > 0 ? "↓" : "↑"} {Math.abs(item.ratio)}%
                          </span>
                          <span className="item-pages">
                            {item.pageCount} стр.
                          </span>
                        </div>
                      </div>
                      <div className="item-actions">
                        <a
                          href={item.url}
                          download={item.fileName}
                          className="download-link"
                          title="Скачать"
                          onClick={(e) => e.stopPropagation()}
                        >
                          📥
                        </a>
                        <button
                          onClick={() => removeFromHistory(item.id)}
                          className="delete-link"
                          title="Удалить из истории"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Краткое предупреждение */}
            <div className="glass-card warning-card">
              <div className="warning-banner">
                <span className="warning-icon">⚠️</span>
                <div className="warning-text">
                  <strong>Важно:</strong> Компрессор эффективен только для PDF с
                  изображениями (сканы, фото). Для текстовых PDF размер файла
                  может увеличиться.
                </div>
              </div>
            </div>
            <div className="glass-card info-card">
              <h3>📚 Как это работает</h3>
              <div className="info-content">
                <div className="info-item">
                  <span className="info-icon">🎯</span>
                  <div className="info-text">
                    <strong>Автоматическое сжатие</strong>
                    <p>
                      Конвертируем PDF в изображения с оптимальными настройками
                      для минимальной потери качества
                    </p>
                  </div>
                </div>
                <div className="info-item">
                  <span className="info-icon">⚡</span>
                  <div className="info-text">
                    <strong>Быстрая обработка</strong>
                    <p>
                      Сжатие происходит локально в вашем браузере без загрузки
                      на сервер
                    </p>
                  </div>
                </div>
                <div className="security-note">
                  <span className="security-icon">🔒</span>
                  <span>Ваши файлы не покидают ваш компьютер</span>
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
      <PdfCompressorInstructions
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </PageShell>
  );
};

export default PdfCompressor;
