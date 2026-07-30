import React, { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { SvgInstructionsModal } from "./components/SvgInstructionsModal";
import "./Svg2Png.css";

interface ConversionResult {
  id: string;
  fileName: string;
  originalSize: string;
  convertedSize: string;
  downloadUrl: string;
  timestamp: Date;
  format: "PNG" | "JPEG";
}

interface AnimatedBackgroundProps {
  className?: string;
}

const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  className,
}) => {
  return (
    <div className={`animated-background ${className || ""}`}>
      <div className="bg-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
        <div className="shape shape-4"></div>
        <div className="shape shape-5"></div>
      </div>
      <div className="bg-grid"></div>
    </div>
  );
};

const Svg2Png: React.FC = () => {
  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const [svgCode, setSvgCode] = useState<string>("");
  const [outputUrl, setOutputUrl] = useState<string>("");
  const [conversionResults, setConversionResults] = useState<
    ConversionResult[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pngWidth, setPngWidth] = useState<number>(800);
  const [pngHeight, setPngHeight] = useState<number>(600);
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [maintainAspectRatio, setMaintainAspectRatio] = useState<boolean>(true);
  const [outputFormat, setOutputFormat] = useState<"PNG" | "JPEG">("PNG");
  const [jpegQuality, setJpegQuality] = useState<number>(0.92);
  const [activeTab, setActiveTab] = useState<"file" | "code">("file");
  const [showInstructions, setShowInstructions] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !file.type.includes("svg") &&
      !file.name.toLowerCase().endsWith(".svg")
    ) {
      setError("Пожалуйста, выберите SVG файл");
      return;
    }

    setSvgFile(file);
    setError(null);
    setOutputUrl("");

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setSvgContent(content);
      setSvgCode(content);

      try {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(content, "image/svg+xml");
        const svgElement = svgDoc.querySelector("svg");

        if (svgElement) {
          const width = svgElement.getAttribute("width");
          const height = svgElement.getAttribute("height");
          const viewBox = svgElement.getAttribute("viewBox");

          if (width && height) {
            setPngWidth(parseInt(width));
            setPngHeight(parseInt(height));
          } else if (viewBox) {
            const [, , vw, vh] = viewBox.split(" ").map(Number);
            setPngWidth(vw);
            setPngHeight(vh);
          }
        }
      } catch (err) {
        console.log("Не удалось определить размеры SVG");
      }
    };
    reader.readAsText(file);
  };

  const handleSvgCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const code = e.target.value;
    setSvgCode(code);

    if (code.trim()) {
      setSvgContent(code);
      setSvgFile(null);
      setError(null);
      setOutputUrl("");
    }
  };

  const validateSvgCode = (code: string): boolean => {
    if (!code.trim()) return false;

    try {
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(code, "image/svg+xml");
      const svgElement = svgDoc.querySelector("svg");
      return svgElement !== null;
    } catch (err) {
      return false;
    }
  };

  const convertSvgToImage = async () => {
    const contentToUse = svgContent || svgCode;

    if (!contentToUse) {
      setError("Пожалуйста, загрузите SVG файл или введите SVG код");
      return;
    }

    if (!validateSvgCode(contentToUse)) {
      setError("Неверный SVG код. Пожалуйста, проверьте синтаксис.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Не удалось создать контекст canvas");
      }

      canvas.width = pngWidth;
      canvas.height = pngHeight;

      if (backgroundColor !== "transparent") {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const svgBlob = new Blob([contentToUse], { type: "image/svg+xml" });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();

      img.onload = () => {
        try {
          if (maintainAspectRatio) {
            const scale = Math.min(
              canvas.width / img.width,
              canvas.height / img.height,
            );
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (canvas.width - scaledWidth) / 2;
            const y = (canvas.height - scaledHeight) / 2;

            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          } else {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }

          let dataUrl: string;
          if (outputFormat === "JPEG") {
            dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
          } else {
            dataUrl = canvas.toDataURL("image/png");
          }

          setOutputUrl(dataUrl);

          const result: ConversionResult = {
            id: Date.now().toString(),
            fileName:
              (svgFile?.name.replace(".svg", "") || "converted") +
              (outputFormat === "JPEG" ? ".jpg" : ".png"),
            originalSize: svgFile
              ? formatFileSize(svgFile.size)
              : formatStringSize(contentToUse),
            convertedSize: "Вычисляется...",
            downloadUrl: dataUrl,
            timestamp: new Date(),
            format: outputFormat,
          };

          setTimeout(() => {
            fetch(dataUrl)
              .then((res) => res.blob())
              .then((blob) => {
                result.convertedSize = formatFileSize(blob.size);
                setConversionResults((prev) => [result, ...prev.slice(0, 4)]);
              });
          }, 100);

          URL.revokeObjectURL(svgUrl);
        } catch (err) {
          setError("Ошибка при конвертации SVG: " + (err as Error).message);
        } finally {
          setLoading(false);
        }
      };

      img.onerror = () => {
        setError("Не удалось загрузить SVG изображение");
        setLoading(false);
        URL.revokeObjectURL(svgUrl);
      };

      img.src = svgUrl;
    } catch (err) {
      setError("Ошибка при конвертации: " + (err as Error).message);
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatStringSize = (str: string): string => {
    const bytes = new Blob([str]).size;
    return formatFileSize(bytes);
  };

  const downloadImage = () => {
    if (!outputUrl || !downloadLinkRef.current) return;

    const link = downloadLinkRef.current;
    link.href = outputUrl;
    link.download =
      (svgFile?.name.replace(".svg", "") || "converted") +
      (outputFormat === "JPEG" ? ".jpg" : ".png");
    link.click();
  };

  const clearAll = () => {
    setSvgFile(null);
    setSvgContent("");
    setSvgCode("");
    setOutputUrl("");
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleBackgroundColorChange = (color: string) => {
    setBackgroundColor(color);
    if (outputUrl) {
      setTimeout(convertSvgToImage, 100);
    }
  };

  const handleDimensionChange = (width: number, height: number) => {
    setPngWidth(width);
    setPngHeight(height);
    if (outputUrl) {
      setTimeout(convertSvgToImage, 100);
    }
  };

  const handleFormatChange = (format: "PNG" | "JPEG") => {
    setOutputFormat(format);

    if (format === "JPEG" && backgroundColor === "transparent") {
      setBackgroundColor("#ffffff");
    }

    if (outputUrl) {
      setTimeout(convertSvgToImage, 100);
    }
  };

  const predefinedSizes = [
    { label: "800×600", width: 800, height: 600 },
    { label: "1024×768", width: 1024, height: 768 },
    { label: "1920×1080", width: 1920, height: 1080 },
    { label: "1280×720", width: 1280, height: 720 },
    { label: "2560×1440", width: 2560, height: 1440 },
  ];

  const predefinedColors = [
    { label: "Белый", value: "#ffffff" },
    { label: "Прозрачный", value: "transparent", hideForJPEG: true },
    { label: "Черный", value: "#000000" },
    { label: "Серый", value: "#f3f4f6" },
    { label: "Синий", value: "#3b82f6" },
  ];

  const exampleSvgCode = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="80" fill="#4f46e5" />
  <text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="20">SVG</text>
</svg>`;

  const insertExampleSvg = () => {
    setSvgCode(exampleSvgCode);
    setSvgContent(exampleSvgCode);
  };

  return (
    <>
      <SvgInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
      <div className="svg2png-page">
        <div className="svg2png-container">
          <div className="svg2png-header">
            <div className="header-content">
              <Link to="/" className="home-button">
                🏠 На главную
              </Link>
              <h1>SVG в PNG/JPEG Конвертер</h1>
              <p>
                Быстрая конвертация SVG изображений в PNG и JPEG форматы с
                настройками
              </p>
              <button
                className="instructions-button home-button"
                onClick={() => setShowInstructions(true)}
              >
                📚 Инструкция
              </button>
            </div>
          </div>

          <div className="converter-layout">
            {/* Левая колонка - Ввод */}
            <div className="input-column">
              {/* Вкладки */}
              <div className="input-tabs">
                <button
                  className={`tab-button ${
                    activeTab === "file" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("file")}
                >
                  📁 Загрузить файл
                </button>
                <button
                  className={`tab-button ${
                    activeTab === "code" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("code")}
                >
                  📝 Вставить код SVG
                </button>
              </div>

              {/* Загрузка файла */}
              {activeTab === "file" && (
                <div className="glass-card upload-area">
                  <div className="upload-header">
                    <div>
                      <h3>
                        {svgFile
                          ? "✅ SVG файл загружен"
                          : "Загрузите SVG файл"}
                      </h3>
                      {svgFile && (
                        <div className="file-info-compact">
                          <span className="file-name">{svgFile.name}</span>
                          <span className="file-size">
                            {formatFileSize(svgFile.size)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {!svgFile ? (
                    <div className="file-drop-zone">
                      <div className="file-placeholder">
                        Перетащите SVG файл сюда или нажмите для выбора
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".svg,image/svg+xml"
                        onChange={handleFileChange}
                        className="file-input"
                        id="svgFile"
                      />
                      <label htmlFor="svgFile" className="btn btn-primary">
                        📎 Выбрать файл
                      </label>
                    </div>
                  ) : (
                    <div className="file-actions-compact">
                      {svgContent && (
                        <div className="file-preview-compact">
                          <div
                            className="svg-preview"
                            dangerouslySetInnerHTML={{ __html: svgContent }}
                          />
                        </div>
                      )}
                      <div className="action-buttons">
                        <label htmlFor="svgFile" className="btn btn-secondary">
                          📎 Заменить
                        </label>
                        <button onClick={clearAll} className="btn btn-danger">
                          ✕ Очистить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ввод SVG кода - улучшенная версия */}
              {activeTab === "code" && (
                <div className="glass-card code-input-area-improved">
                  <div className="code-header-improved">
                    <div className="code-title">
                      <div className="code-icon">📝</div>
                      <div>
                        <h3>Введите SVG код</h3>
                        <p>Вставьте или напишите SVG код для конвертации</p>
                      </div>
                    </div>
                    <div className="code-actions">
                      <button
                        onClick={insertExampleSvg}
                        className="btn btn-example"
                        title="Вставить пример SVG кода"
                      >
                        <span className="btn-icon">📋</span>
                        Пример SVG
                      </button>
                      <button
                        onClick={() => setSvgCode("")}
                        disabled={!svgCode}
                        className="btn btn-clear"
                        title="Очистить поле ввода"
                      >
                        <span className="btn-icon">🗑️</span>
                        Очистить
                      </button>
                    </div>
                  </div>

                  <div className="code-input-container">
                    <div className="code-editor-header">
                      <span className="editor-title">SVG Editor</span>
                      <div className="editor-info">
                        {svgCode && (
                          <span className="code-stats">
                            {svgCode.length} chars •{" "}
                            {svgCode.split("\n").length} lines
                          </span>
                        )}
                      </div>
                    </div>

                    <textarea
                      value={svgCode}
                      onChange={handleSvgCodeChange}
                      placeholder={`<!-- Вставьте SVG код здесь -->
<!-- Пример: -->
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="80" fill="#4f46e5" />
  <text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial">SVG</text>
</svg>`}
                      className="svg-code-textarea-improved"
                      rows={8}
                    />

                    <div className="code-footer">
                      <div className="syntax-hints">
                        <span className="hint-tag">✓ Подсветка синтаксиса</span>
                        <span className="hint-tag">✓ Валидация SVG</span>
                        <span className="hint-tag">✓ Live Preview</span>
                      </div>
                    </div>
                  </div>

                  {svgCode && (
                    <div className="code-preview-improved">
                      <div className="preview-header">
                        <h4>🔍 Предпросмотр SVG</h4>
                        <div className="preview-actions">
                          <span className="preview-badge">
                            {validateSvgCode(svgCode)
                              ? "✅ Valid SVG"
                              : "⚠️ Check Syntax"}
                          </span>
                          <button
                            className="btn btn-icon-small"
                            onClick={() => {
                              const preview = document.querySelector(
                                ".svg-preview-improved",
                              );
                              if (preview) {
                                const svgElement = preview.querySelector("svg");
                                if (svgElement) {
                                  svgElement.style.transform =
                                    svgElement.style.transform === "scale(1.2)"
                                      ? "scale(1)"
                                      : "scale(1.2)";
                                }
                              }
                            }}
                            title="Увеличить/уменьшить"
                          >
                            🔍
                          </button>
                        </div>
                      </div>
                      <div className="preview-content">
                        <div className="svg-preview-container">
                          <div
                            className="svg-preview-improved"
                            dangerouslySetInnerHTML={{ __html: svgCode }}
                          />
                          <div className="preview-controls-svg">
                            <div className="preview-info">
                              {(() => {
                                try {
                                  const parser = new DOMParser();
                                  const svgDoc = parser.parseFromString(
                                    svgCode,
                                    "image/svg+xml",
                                  );
                                  const svgElement =
                                    svgDoc.querySelector("svg");
                                  if (svgElement) {
                                    const width =
                                      svgElement.getAttribute("width") ||
                                      "auto";
                                    const height =
                                      svgElement.getAttribute("height") ||
                                      "auto";
                                    const viewBox =
                                      svgElement.getAttribute("viewBox");
                                    return (
                                      <>
                                        <span>
                                          Size: {width} × {height}
                                        </span>
                                        {viewBox && (
                                          <span>ViewBox: {viewBox}</span>
                                        )}
                                      </>
                                    );
                                  }
                                } catch (e) {}
                                return <span>Размер: auto</span>;
                              })()}
                            </div>
                          </div>
                        </div>
                        {!validateSvgCode(svgCode) && (
                          <div className="preview-error">
                            <div className="error-icon">⚠️</div>
                            <div className="error-message">
                              Возможны ошибки в SVG коде. Проверьте синтаксис.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Основные настройки - исправленная версия */}
              <div className="glass-card basic-settings">
                <h3>⚙️ Настройки экспорта</h3>

                <div className="settings-grid-compact">
                  {/* Формат и качество */}
                  <div className="setting-group-improved">
                    <label className="setting-label">Формат вывода</label>
                    <div className="format-selector-improved">
                      <button
                        className={`format-btn-improved ${
                          outputFormat === "PNG" ? "active" : ""
                        }`}
                        onClick={() => handleFormatChange("PNG")}
                      >
                        <span className="format-icon">🖼️</span>
                        PNG
                      </button>
                      <button
                        className={`format-btn-improved ${
                          outputFormat === "JPEG" ? "active" : ""
                        }`}
                        onClick={() => handleFormatChange("JPEG")}
                      >
                        <span className="format-icon">🎨</span>
                        JPEG
                      </button>
                    </div>
                    {outputFormat === "JPEG" && (
                      <div className="quality-setting-improved">
                        <label>
                          Качество: {Math.round(jpegQuality * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0.1"
                          max="1"
                          step="0.05"
                          value={jpegQuality}
                          onChange={(e) =>
                            setJpegQuality(Number(e.target.value))
                          }
                          className="quality-slider"
                        />
                      </div>
                    )}
                  </div>

                  {/* Размеры */}
                  <div className="setting-group-improved">
                    <label className="setting-label">Размер изображения</label>
                    <div className="dimension-controls">
                      <div className="dimension-inputs-improved">
                        <div className="input-wrapper">
                          <input
                            type="number"
                            value={pngWidth}
                            onChange={(e) =>
                              handleDimensionChange(
                                Number(e.target.value),
                                pngHeight,
                              )
                            }
                            min="1"
                            max="5000"
                            className="dimension-input-improved"
                          />
                          <span className="input-label">ширина</span>
                        </div>
                        <div className="dimension-separator">×</div>
                        <div className="input-wrapper">
                          <input
                            type="number"
                            value={pngHeight}
                            onChange={(e) =>
                              handleDimensionChange(
                                pngWidth,
                                Number(e.target.value),
                              )
                            }
                            min="1"
                            max="5000"
                            className="dimension-input-improved"
                          />
                          <span className="input-label">высота</span>
                        </div>
                      </div>

                      <div className="quick-sizes">
                        <label>Быстрые размеры:</label>
                        <div className="predefined-sizes-improved">
                          {predefinedSizes.map((size, index) => (
                            <button
                              key={index}
                              className="size-btn-improved"
                              onClick={() =>
                                handleDimensionChange(size.width, size.height)
                              }
                            >
                              {size.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Фон */}
                  <div className="setting-group-improved">
                    <label className="setting-label">Фон</label>
                    <div className="background-controls">
                      <div className="color-presets">
                        {predefinedColors
                          .filter(
                            (color) =>
                              !(outputFormat === "JPEG" && color.hideForJPEG),
                          ) // Скрываем прозрачный для JPEG
                          .map((color, index) => (
                            <button
                              key={index}
                              className={`color-btn-improved ${
                                backgroundColor === color.value ? "active" : ""
                              }`}
                              style={{
                                backgroundColor:
                                  color.value === "transparent"
                                    ? "transparent"
                                    : color.value,
                                backgroundImage:
                                  color.value === "transparent"
                                    ? `linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
                 linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
                 linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
                 linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)`
                                    : "none",
                                backgroundSize:
                                  color.value === "transparent"
                                    ? "8px 8px"
                                    : "auto",
                                backgroundPosition:
                                  color.value === "transparent"
                                    ? "0 0, 0 4px, 4px -4px, -4px 0px"
                                    : "0 0",
                              }}
                              onClick={() =>
                                handleBackgroundColorChange(color.value)
                              }
                              title={color.label}
                            />
                          ))}
                      </div>

                      <div className="custom-color">
                        <input
                          type="color"
                          value={
                            backgroundColor === "transparent"
                              ? "#ffffff"
                              : backgroundColor
                          }
                          onChange={(e) =>
                            handleBackgroundColorChange(e.target.value)
                          }
                          disabled={backgroundColor === "transparent"}
                          className="color-picker-input"
                        />
                        <input
                          type="text"
                          value={backgroundColor}
                          onChange={(e) =>
                            handleBackgroundColorChange(e.target.value)
                          }
                          placeholder="#ffffff или transparent"
                          className="color-text-input"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Дополнительные опции */}
                  <div className="setting-group-improved">
                    <label className="setting-label">Дополнительно</label>
                    <div className="additional-options">
                      <label className="checkbox-label-improved">
                        <input
                          type="checkbox"
                          checked={maintainAspectRatio}
                          onChange={(e) =>
                            setMaintainAspectRatio(e.target.checked)
                          }
                        />
                        <span className="checkmark"></span>
                        Сохранять пропорции оригинала
                      </label>
                    </div>
                  </div>
                </div>

                {/* Кнопка конвертации - исправленная */}
                <button
                  onClick={convertSvgToImage}
                  disabled={loading || (!svgFile && !svgCode.trim())}
                  className={`btn-convert-improved ${loading ? "loading" : ""}`}
                >
                  <span className="btn-icon">{loading ? "⏳" : "🔄"}</span>
                  <span className="btn-text">
                    {loading
                      ? "Конвертация..."
                      : `Конвертировать в ${outputFormat}`}
                  </span>
                  {!loading && <span className="btn-arrow">→</span>}
                </button>
              </div>
            </div>

            {/* Правая колонка - Результат и история */}
            <div className="output-column">
              {/* Анимированный фон для пустого состояния */}
              {!outputUrl && (
                <div className="glass-card result-placeholder">
                  <div className="placeholder-content">
                    <div className="placeholder-icon">
                      <div className="icon-container">
                        <div className="svg-icon">🖼️</div>
                        <div className="arrow-icon">➡️</div>
                        <div className="png-icon">🖼️</div>
                      </div>
                    </div>
                    <h3>Готов к конвертации</h3>
                    <p>
                      Загрузите SVG файл или вставьте код, чтобы увидеть
                      результат здесь
                    </p>
                  </div>
                </div>
              )}

              {/* Результат конвертации */}
              {outputUrl && (
                <div className="glass-card conversion-result">
                  <div className="result-header">
                    <h3>✅ Результат конвертации</h3>
                    <div className="result-badge">{outputFormat}</div>
                  </div>
                  <div className="result-content-compact">
                    <div className="image-preview-compact">
                      <img src={outputUrl} alt={`Converted ${outputFormat}`} />
                      <div className="preview-overlay">
                        <button
                          onClick={downloadImage}
                          className="btn btn-download-overlay"
                        >
                          📥 Скачать
                        </button>
                      </div>
                    </div>
                    <div className="preview-info-compact">
                      <div className="info-item">
                        <span>Размер:</span>
                        <span>
                          {pngWidth}×{pngHeight}px
                        </span>
                      </div>
                      <div className="info-item">
                        <span>Фон:</span>
                        <span className="color-preview">
                          preview-info-compact:
                          <span
                            className="color-dot"
                            style={{
                              backgroundImage:
                                backgroundColor === "transparent"
                                  ? `linear-gradient(45deg, #ccc 25%, transparent 25%),
           linear-gradient(-45deg, #ccc 25%, transparent 25%),
           linear-gradient(45deg, transparent 75%, #ccc 75%),
           linear-gradient(-45deg, transparent 75%, #ccc 75%)`
                                  : "none",
                              backgroundSize:
                                backgroundColor === "transparent"
                                  ? "8px 8px"
                                  : "auto",
                              backgroundPosition:
                                backgroundColor === "transparent"
                                  ? "0 0, 0 4px, 4px -4px, -4px 0px"
                                  : "0 0",
                              backgroundColor:
                                backgroundColor === "transparent"
                                  ? "white"
                                  : backgroundColor,
                            }}
                          />
                          {backgroundColor === "transparent"
                            ? "Прозрачный"
                            : backgroundColor}
                        </span>
                      </div>
                      <div className="info-item">
                        <span>Формат:</span>
                        <span className="format-badge">{outputFormat}</span>
                      </div>
                      {outputFormat === "JPEG" && (
                        <div className="info-item">
                          <span>Качество:</span>
                          <span>{Math.round(jpegQuality * 100)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="result-actions">
                      <button
                        onClick={downloadImage}
                        className="btn btn-download"
                      >
                        📥 Скачать {outputFormat}
                      </button>
                      <button
                        onClick={convertSvgToImage}
                        className="btn btn-secondary"
                      >
                        🔄 Обновить
                      </button>
                    </div>
                  </div>
                  {/* Скрытая ссылка для скачивания */}
                  <a ref={downloadLinkRef} style={{ display: "none" }} />
                </div>
              )}
              {/* История конвертаций */}
              {conversionResults.length > 0 && (
                <div className="glass-card conversion-history">
                  <div className="history-header">
                    <h3>📋 История конвертаций</h3>
                    <span className="history-count">
                      {conversionResults.length}
                    </span>
                  </div>
                  <div className="history-list-compact">
                    {conversionResults.map((result) => (
                      <div key={result.id} className="history-item-compact">
                        <div className="history-info-compact">
                          <div className="file-name">{result.fileName}</div>
                          <div className="file-sizes">
                            <span className="size-badge">
                              {result.originalSize}
                            </span>
                            <span className="arrow">→</span>
                            <span className="size-badge">
                              {result.convertedSize}
                            </span>
                          </div>
                        </div>
                        <div className="history-actions">
                          <a
                            href={result.downloadUrl}
                            download={result.fileName}
                            className="btn btn-icon"
                            title="Скачать"
                          >
                            📥
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="alert alert-error">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <strong>Ошибка:</strong> {error}
              </div>
            </div>
          )}
        </div>
      </div>
      <AnimatedBackground className="placeholder-bg" />
    </>
  );
};

export default Svg2Png;
