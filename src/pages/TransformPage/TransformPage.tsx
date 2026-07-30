import React, { useState, useRef } from "react";
import * as ExcelJS from "exceljs";
import { Link } from "react-router-dom";

import "./TransformPage.css";

const TransformPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Настройки трансформации
  const [settings, setSettings] = useState({
    removeEmptyRows: true,
    trimWhitespace: true,
    capitalizeHeaders: true,
    formatDates: true,
    removeDuplicates: false,
    outputFormat: "xlsx" as "xlsx" | "csv",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const processFile = async (selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls|csv)$/)) {
      setError("Пожалуйста, выберите файл Excel или CSV");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = new ExcelJS.Workbook();

      if (selectedFile.name.endsWith(".csv")) {
        await workbook.csv.read(arrayBuffer);
      } else {
        await workbook.xlsx.load(arrayBuffer);
      }

      // Предпросмотр первых 10 строк
      const worksheet = workbook.worksheets[0];
      const jsonData: any[][] = [];

      worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (rowNumber <= 10) {
          // Ограничиваем предпросмотр 10 строками
          const rowData: any[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            rowData.push(cell.value);
          });
          jsonData.push(rowData);
        }
      });

      setPreviewData(jsonData);
      setLoading(false);
    } catch (err) {
      setError("Ошибка при чтении файла");
      setLoading(false);
    }
  };

  const handleTransform = async () => {
    if (!file) {
      setError("Пожалуйста, выберите файл");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();

      if (file.name.endsWith(".csv")) {
        await workbook.csv.read(arrayBuffer);
      } else {
        await workbook.xlsx.load(arrayBuffer);
      }

      const worksheet = workbook.worksheets[0];
      const data: any[][] = [];

      // Собираем все данные из листа
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const rowData: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          rowData.push(cell.value);
        });
        data.push(rowData);
      });

      let processedData = [...data];

      // Применяем трансформации
      if (settings.removeEmptyRows) {
        processedData = processedData.filter((row) =>
          row.some((cell) => cell !== null && cell !== undefined && cell !== "")
        );
      }

      if (settings.trimWhitespace) {
        processedData = processedData.map((row) =>
          row.map((cell) => (typeof cell === "string" ? cell.trim() : cell))
        );
      }

      if (settings.capitalizeHeaders && processedData.length > 0) {
        processedData[0] = processedData[0].map((header) =>
          typeof header === "string"
            ? header.charAt(0).toUpperCase() + header.slice(1)
            : header
        );
      }

      if (settings.removeDuplicates && processedData.length > 1) {
        const headers = processedData[0];
        const rows = processedData.slice(1);
        const seen = new Set();
        const uniqueRows = rows.filter((row) => {
          const key = row.join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        processedData = [headers, ...uniqueRows];
      }

      // Создаем новый workbook с преобразованными данными
      const newWorkbook = new ExcelJS.Workbook();
      const newWorksheet = newWorkbook.addWorksheet("Преобразованные данные");

      // Добавляем данные в новый лист
      processedData.forEach((rowData, rowIndex) => {
        const row = newWorksheet.getRow(rowIndex + 1);
        row.values = rowData;

        // Форматируем заголовки
        if (rowIndex === 0) {
          row.font = { bold: true };
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE6E6E6" },
          };
        }
      });

      // Настраиваем ширину колонок
      newWorksheet.columns = processedData[0]?.map((_, index) => ({
        width: 15,
      }));

      // Добавляем границы
      newWorksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      });

      // Сохраняем файл
      const fileName = `преобразованный_${file.name.replace(/\.[^/.]+$/, "")}.${
        settings.outputFormat
      }`;

      if (settings.outputFormat === "csv") {
        const csvBuffer = await newWorkbook.csv.writeBuffer();
        const blob = new Blob([csvBuffer], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const xlsxBuffer = await newWorkbook.xlsx.writeBuffer();
        const blob = new Blob([xlsxBuffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }

      setSuccess(`Файл успешно преобразован и скачан как ${fileName}`);
      setLoading(false);
    } catch (err) {
      setError("Ошибка при преобразовании файла");
      setLoading(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const clearAll = () => {
    setFile(null);
    setError(null);
    setSuccess(null);
    setPreviewData([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="transform-page">
      <div className="transform-container">
        <div className="transform-header">
          <div className="header-content">
            <Link to="/" className="home-button">
              🏠 На главную
            </Link>
            <h1>Трансформация Excel-файлов</h1>
            <p>Очистка и преобразование данных с предпросмотром</p>
          </div>
        </div>

        <div className="transform-content">
          {/* Область загрузки файла */}
          <div
            className={`upload-area ${dragOver ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-icon">📤</div>
            <h3>Загрузите Excel или CSV файл</h3>
            <p>Перетащите файл сюда или нажмите кнопку ниже</p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="file-input"
              id="file-input"
            />

            <label htmlFor="file-input" className="btn btn-primary btn-upload">
              📎 Выбрать файл
            </label>
          </div>

          {/* Информация о файле */}
          {file && (
            <div className="file-info-panel">
              <div className="file-info-header">
                <div className="section-icon">📋</div>
                <h3>Информация о файле</h3>
              </div>
              <div className="file-info-details">
                <div className="file-info-item">
                  <div className="file-info-label">Имя файла</div>
                  <div className="file-info-value">{file.name}</div>
                </div>
                <div className="file-info-item">
                  <div className="file-info-label">Размер</div>
                  <div className="file-info-value">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <div className="file-info-item">
                  <div className="file-info-label">Тип</div>
                  <div className="file-info-value">
                    {file.type || "Не определен"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Настройки трансформации */}
          <div className="settings-panel">
            <div className="settings-header">
              <div className="settings-icon">⚙️</div>
              <h2>Настройки преобразования</h2>
            </div>

            <div className="settings-grid">
              <div className="setting-group">
                <h3>🔄 Очистка данных</h3>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.removeEmptyRows}
                      onChange={(e) =>
                        handleSettingChange("removeEmptyRows", e.target.checked)
                      }
                    />
                    <span className="checkbox-text">Удалить пустые строки</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.trimWhitespace}
                      onChange={(e) =>
                        handleSettingChange("trimWhitespace", e.target.checked)
                      }
                    />
                    <span className="checkbox-text">Обрезать пробелы</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.capitalizeHeaders}
                      onChange={(e) =>
                        handleSettingChange(
                          "capitalizeHeaders",
                          e.target.checked
                        )
                      }
                    />
                    <span className="checkbox-text">
                      Капитализировать заголовки
                    </span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.removeDuplicates}
                      onChange={(e) =>
                        handleSettingChange(
                          "removeDuplicates",
                          e.target.checked
                        )
                      }
                    />
                    <span className="checkbox-text">Удалить дубликаты</span>
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <h3>📤 Формат вывода</h3>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="outputFormat"
                      value="xlsx"
                      checked={settings.outputFormat === "xlsx"}
                      onChange={(e) =>
                        handleSettingChange("outputFormat", e.target.value)
                      }
                    />
                    <span className="checkbox-text">Excel (.xlsx)</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="outputFormat"
                      value="csv"
                      checked={settings.outputFormat === "csv"}
                      onChange={(e) =>
                        handleSettingChange("outputFormat", e.target.value)
                      }
                    />
                    <span className="checkbox-text">CSV (.csv)</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Предпросмотр */}
          {previewData.length > 0 && (
            <div className="preview-section">
              <div className="preview-header">
                <h2>
                  <span className="section-icon">👁️</span>
                  Предпросмотр данных
                </h2>
                <div className="preview-actions">
                  <button
                    onClick={handleTransform}
                    disabled={loading}
                    className="btn btn-primary"
                  >
                    {loading
                      ? "⏳ Преобразование..."
                      : "✨ Преобразовать и скачать"}
                  </button>
                  <button onClick={clearAll} className="btn btn-secondary">
                    🗑️ Очистить
                  </button>
                </div>
              </div>

              <div className="preview-content">
                <table className="preview-table">
                  <thead>
                    <tr>
                      {previewData[0]?.map((header: any, index: number) => (
                        <th key={index}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData
                      .slice(1)
                      .map((row: any[], rowIndex: number) => (
                        <tr key={rowIndex}>
                          {row.map((cell: any, cellIndex: number) => (
                            <td key={cellIndex}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Сообщения */}
          {error && (
            <div className="alert alert-error">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <strong>Ошибка:</strong> {error}
              </div>
            </div>
          )}

          {success && (
            <div className="alert alert-success">
              <div className="alert-icon">✅</div>
              <div className="alert-content">
                <strong>Успешно!</strong> {success}
              </div>
            </div>
          )}

          {!file && (
            <div className="alert alert-warning">
              <div className="alert-icon">💡</div>
              <div className="alert-content">
                <strong>Как использовать:</strong> Загрузите Excel или CSV файл,
                настройте параметры преобразования и скачайте результат.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransformPage;
