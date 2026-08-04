import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import * as XLSX from "xlsx";
import PageShell from "../../components/PageShell";
import "./ExcelTableBuilder.css";

// Типы данных
interface ColumnConfig {
  id: string;
  name: string;
  keepUnchanged: boolean;
  groupBy: boolean;
  index: number;
}

interface ExcelFileData {
  fileName: string;
  headers: string[];
  rows: string[][];
  allRows: string[][];
  headerRowIndex: number;
  merges?: XLSX.Range[];
  worksheet?: XLSX.WorkSheet;
}

interface GroupedItem {
  value: string;
  fileIndex: number;
  itemIndex: number;
}

const ExcelTableBuilder: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [excelData, setExcelData] = useState<ExcelFileData[]>([]);
  const [columnConfigs, setColumnConfigs] = useState<ColumnConfig[]>([]);
  const [groupedData, setGroupedData] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState(10);
  const [viewMode, setViewMode] = useState<"compact" | "table">("table");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [showInstructions, setShowInstructions] = useState(false);
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set());
  const [processingStatuses, setProcessingStatuses] = useState<{
    [key: string]: string;
  }>({});
  const [activeTab, setActiveTab] = useState<"upload" | "configure" | "result">(
    "upload",
  );
  const [isDragging, setIsDragging] = useState(false);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [showHeaderSelector, setShowHeaderSelector] = useState(false);
  const [headerSelectorError, setHeaderSelectorError] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    return () => {
      processingRef.current = false;
    };
  }, []);

  const yieldToBrowser = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 16);
      }
    });
  }, []);

  // Чтение Excel файла
  const readExcelFile = useCallback(
    async (file: File, headerRowIdx: number = 0): Promise<ExcelFileData> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);

            const workbook = XLSX.read(data, {
              type: "array",
              cellDates: true,
            });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) {
              reject(new Error(`Файл ${file.name} не содержит листов`));
              return;
            }

            const merges = worksheet["!merges"] || [];
            const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");

            const allRows: string[][] = [];

            for (let R = range.s.r; R <= range.e.r; ++R) {
              const row: string[] = [];

              for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = worksheet[addr];

                let value = "";

                if (cell) {
                  if (cell.v instanceof Date) {
                    value = cell.v.toLocaleDateString();
                  } else {
                    value = String(cell.v ?? "");
                  }
                }

                row.push(value);
              }

              allRows.push(row);

              if (R % 2000 === 0) {
                await yieldToBrowser();
              }
            }

            const headers =
              allRows.length > headerRowIdx
                ? allRows[headerRowIdx].map(
                    (h) => String(h || "").trim() || "Пустая колонка",
                  )
                : [];

            const dataRows = allRows.filter(
              (_, index) => index !== headerRowIdx,
            );

            resolve({
              fileName: file.name,
              headers,
              rows: dataRows,
              allRows,
              headerRowIndex: headerRowIdx,
              merges,
              worksheet,
            });
          } catch (err) {
            reject(err);
          }
        };

        reader.onerror = () => {
          reject(new Error(`Ошибка чтения файла ${file.name}`));
        };

        reader.readAsArrayBuffer(file);
      });
    },
    [yieldToBrowser],
  );

  // Предпросмотр и выбор заголовков
  const previewAndSelectHeader = async () => {
    if (files.length === 0) {
      setError("Пожалуйста, выберите хотя бы один файл Excel");
      return;
    }

    processingRef.current = true;
    setIsLoading(true);
    setError(null);
    setHeaderSelectorError(null);

    try {
      const fileData = await readExcelFile(files[0], 0);

      if (!processingRef.current) return;

      setExcelData([fileData]);
      setShowHeaderSelector(true);
      setHeaderRowIndex(0);
    } catch (err) {
      if (processingRef.current) {
        setError(
          err instanceof Error ? err.message : "Ошибка при чтении файла",
        );
      }
    } finally {
      processingRef.current = false;
      setIsLoading(false);
    }
  };

  // Подтверждение выбора строки заголовков
  const confirmHeaderSelection = async () => {
    if (files.length === 0) return;

    setShowHeaderSelector(false);
    processingRef.current = true;
    setIsLoading(true);
    setError(null);
    setProcessingProgress(0);
    setCurrentFileIndex(0);
    setProcessingStatuses({});

    const parsedData: ExcelFileData[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        if (!processingRef.current) return;

        setCurrentFileIndex(i);

        setProcessingStatuses((prev) => ({
          ...prev,
          [files[i].name]: `Чтение файла...`,
        }));

        const fileData = await readExcelFile(files[i], headerRowIndex);

        if (!processingRef.current) return;

        parsedData.push(fileData);

        const progress = ((i + 1) / files.length) * 100;
        setProcessingProgress(progress);
        setProcessingStatuses((prev) => ({
          ...prev,
          [files[i].name]: `Готово (${fileData.rows.length} строк)`,
        }));

        if (i < files.length - 1) {
          await yieldToBrowser();
        }
      }

      if (!processingRef.current) return;

      if (parsedData.length > 1) {
        const firstHeaders = parsedData[0].headers;
        for (let i = 1; i < parsedData.length; i++) {
          if (parsedData[i].headers.length !== firstHeaders.length) {
            throw new Error(
              `Файл "${files[i].name}" имеет ${parsedData[i].headers.length} колонок, ` +
                `а первый файл - ${firstHeaders.length}`,
            );
          }
        }
      }

      setExcelData(parsedData);

      const initialConfig = parsedData[0].headers.map((header, index) => ({
        id: `col-${index}`,
        name: header,
        keepUnchanged: index < 5,
        groupBy: index === 5,
        index,
      }));
      setColumnConfigs(initialConfig);
      setGroupedData([]);
      setActiveTab("configure");
    } catch (err) {
      if (processingRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Ошибка при обработке файлов Excel",
        );
      }
    } finally {
      processingRef.current = false;
      setIsLoading(false);
      setProcessingProgress(0);
      setCurrentFileIndex(0);
      setTimeout(() => {
        setProcessingStatuses({});
      }, 2000);
    }
  };

  // Запуск обработки
  const parseExcelFiles = async () => {
    if (files.length === 0) {
      setError("Пожалуйста, выберите хотя бы один файл Excel");
      return;
    }

    await previewAndSelectHeader();
  };

  // Drag & drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      file.name.match(/\.(xlsx|xls|xlsm)$/i),
    );

    if (droppedFiles.length > 0) {
      handleNewFiles(droppedFiles);
    }
  }, []);

  const handleNewFiles = useCallback(
    (newFiles: File[]) => {
      const existingFileNames = new Set(files.map((f) => f.name));
      const uniqueNewFiles = newFiles.filter(
        (file) => !existingFileNames.has(file.name),
      );

      if (uniqueNewFiles.length === 0 && newFiles.length > 0) {
        setError("Эти файлы уже были загружены");
        return;
      }

      setFiles((prev) => [...prev, ...uniqueNewFiles]);
      setError(null);
      setShowHeaderSelector(false);
    },
    [files],
  );

  const MAX_FILE_SIZE = 60 * 1024 * 1024;

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const validFiles = Array.from(selectedFiles).filter((file) => {
        if (file.size > MAX_FILE_SIZE) {
          setError(`Файл ${file.name} превышает максимальный размер (60 МБ)`);
          return false;
        }
        return true;
      });

      if (validFiles.length > 0) {
        handleNewFiles(validFiles);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveFile = useCallback(
    (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
      if (excelData.length > 0) {
        setExcelData([]);
        setColumnConfigs([]);
        setGroupedData([]);
        setActiveTab("upload");
        setShowHeaderSelector(false);
      }
    },
    [excelData],
  );

  const handleClearAll = useCallback(() => {
    processingRef.current = false;
    setFiles([]);
    setExcelData([]);
    setColumnConfigs([]);
    setGroupedData([]);
    setActiveTab("upload");
    setError(null);
    setProcessingProgress(0);
    setProcessingStatuses({});
    setIsLoading(false);
    setShowHeaderSelector(false);
    setHeaderRowIndex(0);
    setHeaderSelectorError(null);
  }, []);

  const parseValueString = useCallback(
    (value: string, fileIndex: number): GroupedItem[] => {
      if (!value || value.trim() === "") return [];

      let parts: string[] = [value.trim()];

      if (/[；;]/.test(value)) {
        parts = value
          .split(/[；;]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (value.includes(",")) {
        const commaParts = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const hasCapitalAfterComma = commaParts.some((part, idx) => {
          if (idx === 0) return false;
          return /^[А-ЯA-Z]/.test(part);
        });

        if (!hasCapitalAfterComma) {
          parts = commaParts;
        }
      }

      return parts
        .filter((part) => part !== "")
        .map((part, idx) => ({
          value: part,
          fileIndex,
          itemIndex: idx + 1,
        }));
    },
    [],
  );

  const formatGroupedValues = useCallback(
    (items: GroupedItem[], totalFiles: number): string => {
      if (items.length === 0) return "";

      const groupedByFile: Map<number, string[]> = new Map();

      for (const item of items) {
        const arr = groupedByFile.get(item.fileIndex) || [];
        arr.push(item.value);
        groupedByFile.set(item.fileIndex, arr);
      }

      // Собираем все уникальные значения
      const allValues = new Set<string>();
      for (const [, values] of groupedByFile) {
        for (const v of values) {
          allValues.add(v);
        }
      }

      // Если все значения одинаковые - возвращаем одно значение
      if (allValues.size === 1) {
        return Array.from(allValues)[0];
      }

      // Если есть расхождения - показываем с указанием файлов
      const resultParts: string[] = [];

      for (let fileIndex = 1; fileIndex <= totalFiles; fileIndex++) {
        const values = groupedByFile.get(fileIndex);
        if (values && values.length > 0) {
          for (let i = 0; i < values.length; i++) {
            resultParts.push(`${fileIndex}.${i + 1}. ${values[i]}`);
          }
        }
      }

      return resultParts.join(", ");
    },
    [],
  );

  const groupData = useCallback(() => {
    if (excelData.length === 0 || columnConfigs.length === 0) {
      setError("Нет данных для группировки");
      return;
    }

    try {
      setError(null);
      const totalFiles = excelData.length;

      const unchangedIndices = columnConfigs
        .filter((config) => config.keepUnchanged)
        .map((config) => config.index);

      const groupByIndices = columnConfigs
        .filter((config) => config.groupBy)
        .map((config) => config.index);

      if (unchangedIndices.length === 0) {
        setError(
          "Выберите хотя бы одну колонку для группировки (без изменений)",
        );
        return;
      }

      const groupMap = new Map<
        string,
        {
          row: string[];
          fileData: Map<number, string[]>;
        }
      >();

      for (let fileIndex = 0; fileIndex < excelData.length; fileIndex++) {
        const fileData = excelData[fileIndex];
        const fileNum = fileIndex + 1;

        for (let rowIdx = 0; rowIdx < fileData.rows.length; rowIdx++) {
          const originalRow = fileData.rows[rowIdx];

          const normalizedRow: string[] = new Array(columnConfigs.length).fill(
            "",
          );
          const len = Math.min(originalRow.length, columnConfigs.length);
          for (let i = 0; i < len; i++) {
            normalizedRow[i] = originalRow[i] || "";
          }

          const keyParts: string[] = [];
          for (const idx of unchangedIndices) {
            keyParts.push(normalizedRow[idx]);
          }
          const groupKey = keyParts.join("|||");

          const existing = groupMap.get(groupKey);

          if (!existing) {
            const newRow = new Array(columnConfigs.length).fill("");
            for (const idx of unchangedIndices) {
              newRow[idx] = normalizedRow[idx];
            }

            const fileDataMap = new Map<number, string[]>();
            fileDataMap.set(fileNum, normalizedRow);

            groupMap.set(groupKey, { row: newRow, fileData: fileDataMap });
          } else {
            existing.fileData.set(fileNum, normalizedRow);
          }
        }
      }

      const result: string[][] = [];
      // Добавляем массив для отслеживания измененных ячеек
      const changedCells: Set<string> = new Set();

      for (const [, { row, fileData }] of groupMap) {
        for (const colIdx of groupByIndices) {
          const allItems: GroupedItem[] = [];

          for (let fileIndex = 1; fileIndex <= totalFiles; fileIndex++) {
            const fileRow = fileData.get(fileIndex);
            if (fileRow) {
              const value = fileRow[colIdx] || "";
              const parsedItems = parseValueString(value, fileIndex);
              for (const item of parsedItems) {
                allItems.push(item);
              }
            }
          }

          if (allItems.length > 0) {
            // Проверяем, есть ли расхождения
            const uniqueValues = new Set(allItems.map((item) => item.value));

            const formattedValue = formatGroupedValues(allItems, totalFiles);
            row[colIdx] = formattedValue;

            // Если есть расхождения - отмечаем ячейку как измененную
            if (uniqueValues.size > 1) {
              changedCells.add(`${result.length}-${colIdx}`);
            }
          }
        }

        result.push(row);
      }

      // Сохраняем информацию об измененных ячейках
      setChangedCells(changedCells);
      setGroupedData(result);
      setPreviewRows(10);
      setActiveTab("result");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка при группировке данных",
      );
      console.error("Ошибка группировки:", err);
    }
  }, [excelData, columnConfigs, parseValueString, formatGroupedValues]);
  const downloadResult = async () => {
    if (groupedData.length === 0 || columnConfigs.length === 0) {
      setError("Нет данных для экспорта");
      return;
    }

    try {
      const headers = columnConfigs.map((c) => c.name);
      const data = [headers, ...groupedData];

      const worksheet = XLSX.utils.aoa_to_sheet(data);

      if (excelData.length > 0) {
        worksheet["!merges"] = excelData[0].merges || [];
      }

      if (excelData.length > 0) {
        worksheet["!cols"] = excelData[0].worksheet?.["!cols"];
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Сгруппированные данные",
      );

      const fileName = `grouped_${new Date().toISOString().slice(0, 10)}.xlsx`;

      XLSX.writeFile(workbook, fileName, {
        compression: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при экспорте");
    }
  };

  const handleColumnConfigChange = useCallback(
    (id: string, field: "keepUnchanged" | "groupBy", value: boolean) => {
      setColumnConfigs((prev) =>
        prev.map((config) => {
          if (config.id === id) {
            if (field === "keepUnchanged") {
              return {
                ...config,
                keepUnchanged: value,
                groupBy: value ? false : config.groupBy,
              };
            } else {
              return {
                ...config,
                groupBy: value,
                keepUnchanged: value ? false : config.keepUnchanged,
              };
            }
          }
          return config;
        }),
      );
      setGroupedData([]);
    },
    [],
  );

  const handleBulkAction = useCallback((type: "key" | "group") => {
    setColumnConfigs((prev) =>
      prev.map((config, index) => {
        if (type === "key") {
          return {
            ...config,
            keepUnchanged: index < 5,
            groupBy: index < 5 ? false : config.groupBy,
          };
        } else {
          return {
            ...config,
            groupBy: index === 5,
            keepUnchanged: index === 5 ? false : config.keepUnchanged,
          };
        }
      }),
    );
    setGroupedData([]);
  }, []);

  const stats = useMemo(() => {
    const totalRows = excelData.reduce((sum, d) => sum + d.rows.length, 0);
    const keyColumns = columnConfigs.filter((c) => c.keepUnchanged).length;
    const groupColumns = columnConfigs.filter((c) => c.groupBy).length;

    return { totalRows, keyColumns, groupColumns };
  }, [excelData, columnConfigs]);

  const totalSize = useMemo(() => {
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
  }, [files]);

  const isPotentialHeader = (row: string[]): boolean => {
    if (!row || row.length === 0) return false;
    const nonEmptyCount = row.filter((cell) => cell.trim() !== "").length;
    return nonEmptyCount > row.length * 0.5;
  };

  return (
    <PageShell
      title="Excel группиратор"
      subtitle="Группировка данных из нескольких Excel-файлов с сохранением информации о файлах"
      onShowInstructions={() => setShowInstructions(true)}
    >

      {/* Навигация */}
      <nav className="app-navigation">
        <button
          className={`nav-tab ${activeTab === "upload" ? "active" : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          📁 Загрузка файлов {files.length > 0 && `(${files.length})`}
        </button>
        <button
          className={`nav-tab ${activeTab === "configure" ? "active" : ""}`}
          onClick={() => setActiveTab("configure")}
          disabled={excelData.length === 0}
        >
          ⚙️ Настройка
        </button>
        <button
          className={`nav-tab ${activeTab === "result" ? "active" : ""}`}
          onClick={() => setActiveTab("result")}
          disabled={groupedData.length === 0}
        >
          📊 Результат
        </button>
      </nav>

      {/* Модальное окно выбора строки заголовков */}
      {showHeaderSelector && excelData.length > 0 && (
        <div className="header-selector-overlay">
          <div className="header-selector-modal">
            <div className="header-selector-header">
              <h3>🎯 Выберите строку с заголовками</h3>
              <button
                className="header-selector-close"
                onClick={() => {
                  setShowHeaderSelector(false);
                  setExcelData([]);
                }}
              >
                ×
              </button>
            </div>

            <div className="header-selector-info">
              <p>
                Ваши данные начинаются не с первой строки? Выберите строку,
                которая содержит названия колонок.
              </p>
              <p className="header-selector-hint">
                💡 <strong>Совет:</strong> Обычно заголовки находятся в первой
                строке, но иногда могут быть на 2-й, 3-й или другой строке.
              </p>
            </div>

            {headerSelectorError && (
              <div className="header-selector-error">
                ⚠️ {headerSelectorError}
              </div>
            )}

            <div className="header-selector-table-container">
              <table className="header-selector-table">
                <thead>
                  <tr>
                    <th className="hs-col-select">Выбрать</th>
                    <th className="hs-col-num">№ строки</th>
                    <th className="hs-col-preview">Предпросмотр строки</th>
                    <th className="hs-col-status">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {excelData[0].allRows.slice(0, 20).map((row, index) => (
                    <tr
                      key={index}
                      className={`header-selector-row ${
                        headerRowIndex === index ? "selected" : ""
                      } ${isPotentialHeader(row) ? "potential-header" : ""}`}
                      onClick={() => {
                        setHeaderRowIndex(index);
                        setHeaderSelectorError(null);
                      }}
                    >
                      <td className="hs-col-select">
                        <div
                          className={`hs-radio ${
                            headerRowIndex === index ? "active" : ""
                          }`}
                        >
                          {headerRowIndex === index && (
                            <div className="hs-radio-dot" />
                          )}
                        </div>
                      </td>
                      <td className="hs-col-num">
                        <span className="hs-row-num">{index + 1}</span>
                      </td>
                      <td className="hs-col-preview">
                        <div className="hs-row-content">
                          {row.slice(0, 5).map((cell, cellIdx) => (
                            <span key={cellIdx} className="hs-cell">
                              {cell || "(пусто)"}
                            </span>
                          ))}
                          {row.length > 5 && (
                            <span className="hs-more">
                              +{row.length - 5} ещё
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hs-col-status">
                        {isPotentialHeader(row) ? (
                          <span className="hs-badge hs-badge-header">
                            🔤 Возможно заголовок
                          </span>
                        ) : (
                          <span className="hs-badge hs-badge-data">
                            📊 Данные
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="header-selector-actions">
              <button
                className="btn-outline"
                onClick={() => {
                  setShowHeaderSelector(false);
                  setExcelData([]);
                }}
              >
                Отмена
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (headerRowIndex >= excelData[0].allRows.length) {
                    setHeaderSelectorError("Выберите существующую строку");
                    return;
                  }
                  confirmHeaderSelection();
                }}
              >
                ✅ Использовать строку {headerRowIndex + 1} как заголовок
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Секция загрузки файлов */}
      {activeTab === "upload" && (
        <div className="tab-content">
          <div className="upload-section card">
            <div
              className={`upload-area ${isDragging ? "dragging" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="upload-icon">📁</div>
              <h3>Загрузите Excel файлы</h3>
              <p>Перетащите файлы сюда или нажмите для выбора</p>
              <p className="upload-hint">Поддерживаются .xlsx, .xls, .xlsm</p>
              <input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".xlsx,.xls,.xlsm"
                multiple
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <div className="upload-buttons">
                <button
                  className="btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Выбрать файлы
                </button>
              </div>
            </div>

            {files.length > 0 && (
              <div className="file-summary">
                <div className="section-header">
                  <div>
                    <h3>Загруженные файлы</h3>
                    <p className="file-stats">
                      {files.length} файлов • {totalSize}
                    </p>
                  </div>
                  <div className="file-actions">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-outline"
                    >
                      + Добавить ещё
                    </button>
                    <button
                      onClick={handleClearAll}
                      className="btn-outline danger"
                    >
                      🗑️ Очистить все
                    </button>
                  </div>
                </div>

                <div className="file-list">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="file-item">
                      <div className="file-info">
                        <span className="file-number badge">{index + 1}</span>
                        <div className="file-details">
                          <span className="file-name" title={file.name}>
                            {file.name}
                          </span>
                          <span className="file-size">
                            {(file.size / 1024).toFixed(1)} КБ
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFile(index);
                        }}
                        className="remove-btn"
                        title="Удалить файл"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="process-actions">
                  <button
                    onClick={parseExcelFiles}
                    disabled={isLoading || files.length === 0}
                    className="btn-primary"
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner"></span>
                        Обработка...
                      </>
                    ) : (
                      `📊 Обработать ${files.length} файл${
                        files.length > 1 ? "а" : ""
                      }`
                    )}
                  </button>

                  {files.length > 1 && (
                    <div className="file-order-note">
                      <span className="note-icon">ℹ️</span>
                      <span>
                        Файлы будут пронумерованы в порядке загрузки: 1.{" "}
                        {files[0].name}, 2. {files[1].name} и т.д.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Секция настройки */}
      {activeTab === "configure" && (
        <div className="tab-content">
          <div className="configuration-section card compact-view">
            <div className="section-header compact-header">
              <div>
                <h2>⚙️ Настройка колонок</h2>
                <p className="files-info">
                  Файлы:{" "}
                  <span className="file-names">
                    {files.map((f) => f.name).join(", ")}
                  </span>
                </p>
              </div>
              <div className="view-controls">
                <div className="view-toggle">
                  <button
                    className={`view-btn ${
                      viewMode === "compact" ? "active" : ""
                    }`}
                    onClick={() => setViewMode("compact")}
                    title="Компактный вид"
                  >
                    <span className="view-icon">◼◼◼</span>
                    <span className="view-text">Компактный</span>
                  </button>
                  <button
                    className={`view-btn ${
                      viewMode === "table" ? "active" : ""
                    }`}
                    onClick={() => setViewMode("table")}
                    title="Табличный вид"
                  >
                    <span className="view-icon">📋</span>
                    <span className="view-text">Таблица</span>
                  </button>
                </div>
                <div className="compact-stats">
                  <div className="stat-pill">
                    <span className="stat-icon">📊</span>
                    <span className="stat-value">
                      {files.length} файл{files.length > 1 ? "а" : ""}
                    </span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-icon">📈</span>
                    <span className="stat-value">{stats.totalRows} строк</span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-icon">🏷️</span>
                    <span className="stat-value">
                      {columnConfigs.length} колонок
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="legend-container">
              <div className="legend-row">
                <div className="legend-item">
                  <span className="legend-icon key">🔑</span>
                  <span className="legend-text">
                    Колонки-ключи (неизменяемые)
                  </span>
                </div>
                <div className="legend-item">
                  <span className="legend-icon group">🔗</span>
                  <span className="legend-text">Колонки для группировки</span>
                </div>
                <div className="legend-item">
                  <span className="legend-icon skip">➖</span>
                  <span className="legend-text">Пропущенные колонки</span>
                </div>
              </div>
            </div>

            <div className="quick-actions-bar">
              <button
                onClick={() =>
                  setColumnConfigs((prev) =>
                    prev.map((c) => ({
                      ...c,
                      keepUnchanged: true,
                      groupBy: false,
                    })),
                  )
                }
                className="quick-action-btn"
                title="Сделать все колонки ключевыми"
              >
                <span className="action-icon">🔑</span>
                <span className="action-text">Все ключевые</span>
              </button>
              <button
                onClick={() =>
                  setColumnConfigs((prev) =>
                    prev.map((c) => ({
                      ...c,
                      groupBy: true,
                      keepUnchanged: false,
                    })),
                  )
                }
                className="quick-action-btn"
                title="Сделать все колонки группируемыми"
              >
                <span className="action-icon">🔗</span>
                <span className="action-text">Все группировка</span>
              </button>
              <button
                onClick={() =>
                  setColumnConfigs((prev) =>
                    prev.map((c) => ({
                      ...c,
                      keepUnchanged: false,
                      groupBy: false,
                    })),
                  )
                }
                className="quick-action-btn secondary"
                title="Сбросить все настройки"
              >
                <span className="action-icon">🔄</span>
                <span className="action-text">Сбросить всё</span>
              </button>
            </div>

            {/* Компактный вид */}
            {viewMode === "compact" && (
              <div className="columns-grid compact-grid">
                {columnConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={`column-card ${
                      config.keepUnchanged ? "key" : ""
                    } ${config.groupBy ? "group" : ""} ${
                      !config.keepUnchanged && !config.groupBy ? "skip" : ""
                    }`}
                  >
                    <div className="column-card-header">
                      <span className="column-badge">#{config.index + 1}</span>
                      <span className="column-name" title={config.name}>
                        {config.name.length > 20
                          ? config.name.substring(0, 20) + "..."
                          : config.name}
                      </span>
                    </div>

                    <div className="column-type-selector">
                      <button
                        className={`type-btn key-btn ${
                          config.keepUnchanged ? "active" : ""
                        }`}
                        onClick={() =>
                          handleColumnConfigChange(
                            config.id,
                            "keepUnchanged",
                            !config.keepUnchanged,
                          )
                        }
                        title="Сделать ключевой колонкой"
                      >
                        <span className="btn-icon">🔑</span>
                      </button>
                      <button
                        className={`type-btn group-btn ${
                          config.groupBy ? "active" : ""
                        }`}
                        onClick={() =>
                          handleColumnConfigChange(
                            config.id,
                            "groupBy",
                            !config.groupBy,
                          )
                        }
                        title="Включить в группировку"
                      >
                        <span className="btn-icon">🔗</span>
                      </button>
                      <button
                        className={`type-btn skip-btn ${
                          !config.keepUnchanged && !config.groupBy
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          handleColumnConfigChange(
                            config.id,
                            "keepUnchanged",
                            false,
                          );
                          handleColumnConfigChange(config.id, "groupBy", false);
                        }}
                        title="Пропустить колонку"
                      >
                        <span className="btn-icon">➖</span>
                      </button>
                    </div>

                    <div className="column-status">
                      {config.keepUnchanged && (
                        <span className="status-tag key">
                          <span className="status-icon">🔑</span>
                          Ключ
                        </span>
                      )}
                      {config.groupBy && (
                        <span className="status-tag group">
                          <span className="status-icon">🔗</span>
                          Группа
                        </span>
                      )}
                      {!config.keepUnchanged && !config.groupBy && (
                        <span className="status-tag skip">
                          <span className="status-icon">➖</span>
                          Пропуск
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Табличный вид */}
            {viewMode === "table" && (
              <div className="table-view-container">
                <div className="table-scroll-wrapper">
                  <table className="columns-table">
                    <thead>
                      <tr>
                        <th className="col-number">№</th>
                        <th className="col-name">Название колонки</th>
                        <th className="col-type">Тип обработки</th>
                        <th className="col-actions">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columnConfigs.map((config) => (
                        <tr
                          key={config.id}
                          className={`table-row ${
                            config.keepUnchanged ? "key-row" : ""
                          } ${config.groupBy ? "group-row" : ""} ${
                            !config.keepUnchanged && !config.groupBy
                              ? "skip-row"
                              : ""
                          }`}
                        >
                          <td className="col-number">
                            <span className="row-number">
                              {config.index + 1}
                            </span>
                          </td>
                          <td className="col-name">
                            <span
                              className="column-name-full"
                              title={config.name}
                            >
                              {config.name}
                            </span>
                          </td>
                          <td className="col-type">
                            <div className="type-indicator">
                              {config.keepUnchanged && (
                                <span className="type-badge key">
                                  <span className="badge-icon">🔑</span>
                                  Ключевая колонка
                                </span>
                              )}
                              {config.groupBy && (
                                <span className="type-badge group">
                                  <span className="badge-icon">🔗</span>
                                  Для группировки
                                </span>
                              )}
                              {!config.keepUnchanged && !config.groupBy && (
                                <span className="type-badge skip">
                                  <span className="badge-icon">➖</span>
                                  Пропустить
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="col-actions">
                            <div className="table-actions">
                              <button
                                className={`table-action-btn ${
                                  config.keepUnchanged ? "active" : ""
                                }`}
                                onClick={() =>
                                  handleColumnConfigChange(
                                    config.id,
                                    "keepUnchanged",
                                    !config.keepUnchanged,
                                  )
                                }
                                title="Сделать ключевой колонкой"
                              >
                                <span className="action-icon">🔑</span>
                                <span className="action-text">Ключ</span>
                              </button>
                              <button
                                className={`table-action-btn ${
                                  config.groupBy ? "active" : ""
                                }`}
                                onClick={() =>
                                  handleColumnConfigChange(
                                    config.id,
                                    "groupBy",
                                    !config.groupBy,
                                  )
                                }
                                title="Включить в группировку"
                              >
                                <span className="action-icon">🔗</span>
                                <span className="action-text">Группа</span>
                              </button>
                              <button
                                className={`table-action-btn ${
                                  !config.keepUnchanged && !config.groupBy
                                    ? "active"
                                    : ""
                                }`}
                                onClick={() => {
                                  handleColumnConfigChange(
                                    config.id,
                                    "keepUnchanged",
                                    false,
                                  );
                                  handleColumnConfigChange(
                                    config.id,
                                    "groupBy",
                                    false,
                                  );
                                }}
                                title="Пропустить колонку"
                              >
                                <span className="action-icon">➖</span>
                                <span className="action-text">Пропуск</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="table-footer">
                  <div className="table-stats">
                    Всего колонок: <strong>{columnConfigs.length}</strong>
                  </div>
                  <div className="table-note">
                    <span className="note-icon">💡</span>
                    Нажмите на кнопку в колонке "Действия" чтобы изменить тип
                    обработки
                  </div>
                </div>
              </div>
            )}

            <div className="summary-footer">
              <div className="summary-stats">
                <div className="summary-stat">
                  <span className="summary-label">Ключевые:</span>
                  <span className="summary-value key">{stats.keyColumns}</span>
                </div>
                <div className="summary-stat">
                  <span className="summary-label">Группируемые:</span>
                  <span className="summary-value group">
                    {stats.groupColumns}
                  </span>
                </div>
                <div className="summary-stat">
                  <span className="summary-label">Пропущенные:</span>
                  <span className="summary-value skip">
                    {columnConfigs.length -
                      stats.keyColumns -
                      stats.groupColumns}
                  </span>
                </div>
              </div>

              <button
                onClick={groupData}
                className="process-btn primary"
                disabled={stats.keyColumns === 0}
              >
                <span className="btn-icon">🚀</span>
                <span className="btn-text">Выполнить группировку</span>
                {stats.keyColumns === 0 && (
                  <span className="warning-tooltip">
                    Выберите хотя бы одну ключевую колонку
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Секция результата */}
      {activeTab === "result" && (
        <div className="tab-content">
          <div className="result-section card">
            <div className="section-header">
              <div>
                <h2>📊 Результат группировки</h2>
                <p className="files-info">
                  На основе {files.length} файл
                  {files.length > 1 ? "ов" : ""}
                </p>
              </div>
              <div className="result-actions-header">
                <button
                  onClick={() => setActiveTab("configure")}
                  className="btn-outline"
                >
                  ⚙️ Вернуться к настройке
                </button>
                <button onClick={downloadResult} className="btn-download">
                  ⬇️ Скачать Excel
                </button>
              </div>
            </div>

            <div className="result-stats">
              <div className="stat-card">
                <div className="stat-number">{stats.totalRows}</div>
                <div className="stat-label">Исходных строк</div>
              </div>
              <div className="stat-arrow">→</div>
              <div className="stat-card highlight">
                <div className="stat-number">{groupedData.length}</div>
                <div className="stat-label-white">Сгруппированных строк</div>
              </div>
            </div>

            <div className="data-preview">
              <div className="preview-header">
                <h3>Предпросмотр данных</h3>
                <span className="preview-count">
                  Показано {Math.min(previewRows, groupedData.length)} из{" "}
                  {groupedData.length} строк
                </span>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      {columnConfigs.map((config, idx) => (
                        <th key={idx}>
                          <div className="column-header">
                            <span>{config.name || `Колонка ${idx + 1}`}</span>
                            {config.keepUnchanged && (
                              <span className="badge key-badge">Ключ</span>
                            )}
                            {config.groupBy && (
                              <span className="badge group-badge">Группа</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedData.slice(0, previewRows).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => {
                          const cellKey = `${rowIndex}-${cellIndex}`;
                          const isChanged = changedCells.has(cellKey);

                          return (
                            <td
                              key={cellIndex}
                              className={`${columnConfigs[cellIndex]?.groupBy ? "grouped-cell" : ""} ${isChanged ? "changed-cell" : ""}`}
                              title={
                                isChanged
                                  ? "Значения различаются в разных файлах"
                                  : ""
                              }
                            >
                              {cell?.toString() || ""}
                              {isChanged && (
                                <span
                                  className="change-indicator"
                                  title="Есть расхождения"
                                >
                                  ⚡
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {groupedData.length > previewRows && (
                <div className="load-more">
                  <button
                    onClick={() =>
                      setPreviewRows((prev) =>
                        Math.min(prev + 20, groupedData.length),
                      )
                    }
                    className="btn-outline"
                  >
                    Показать ещё 20 строк
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Уведомление об ошибке */}
      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          <div className="error-content">
            <span className="error-icon">⚠️</span>
            <span className="error-message">{error}</span>
            <span className="error-close">×</span>
          </div>
        </div>
      )}

      {/* Индикатор загрузки */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <p>Обработка файлов...</p>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${processingProgress}%` }}
            />
          </div>
          <p className="loading-subtitle">
            Файл {currentFileIndex + 1} из {files.length}
          </p>
          {Object.keys(processingStatuses).length > 0 && (
            <div className="processing-statuses">
              {Object.entries(processingStatuses).map(([fileName, status]) => (
                <div key={fileName} className="status-item">
                  <span className="status-file">{fileName}</span>
                  <span className="status-text">{status}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              processingRef.current = false;
              setIsLoading(false);
              setProcessingProgress(0);
              setProcessingStatuses({});
            }}
            className="cancel-btn"
          >
            Отменить
          </button>
        </div>
      )}

      {/* Модальное окно с инструкцией */}
      {showInstructions && (
        <div
          className="header-selector-overlay"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="header-selector-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="header-selector-header">
              <h3>📚 Инструкция по работе с группировкой</h3>
              <button
                className="header-selector-close"
                onClick={() => setShowInstructions(false)}
              >
                ×
              </button>
            </div>

            <div className="instructions-content">
              <div className="instruction-section-li">
                <h4>🎯 Назначение инструмента</h4>
                <p>
                  Этот инструмент объединяет данные из нескольких Excel-файлов,
                  группируя строки по ключевым колонкам и собирая различия из
                  группируемых колонок с указанием источника.
                </p>
              </div>

              <div className="instruction-section-li">
                <h4>📁 Шаг 1: Загрузка файлов</h4>
                <ul>
                  <li>
                    Перетащите Excel-файлы в зону загрузки или нажмите для
                    выбора
                  </li>
                  <li>Поддерживаются форматы: .xlsx, .xls, .xlsm</li>
                  <li>Максимальный размер файла: 60 МБ</li>
                  <li>
                    Файлы будут пронумерованы в порядке загрузки (1, 2, 3...)
                  </li>
                  <li>
                    Нажмите <strong>"Обработать"</strong>
                  </li>
                </ul>
              </div>

              <div className="instruction-section-li">
                <h4>🎯 Шаг 2: Выбор строки с заголовками</h4>
                <ul>
                  <li>
                    Если заголовки не в первой строке — выберите нужную строку
                  </li>
                  <li>
                    Оранжевая метка{" "}
                    <span className="hs-badge hs-badge-header">
                      🔤 Возможно заголовок
                    </span>{" "}
                    подсказывает вероятные заголовки
                  </li>
                  <li>
                    Нажмите{" "}
                    <strong>"Использовать строку X как заголовок"</strong>
                  </li>
                </ul>
              </div>

              <div className="instruction-section-li">
                <h4>⚙️ Шаг 3: Настройка колонок</h4>
                <ul>
                  <li>
                    <span className="instruction-badge key">
                      🔑 Ключевые колонки
                    </span>{" "}
                    — по ним происходит группировка (обычно ФИО, должность,
                    подразделение)
                  </li>
                  <li>
                    <span className="instruction-badge group">
                      🔗 Группируемые колонки
                    </span>{" "}
                    — их значения собираются со всех файлов. Если значения
                    одинаковые — показывается одно, если разные — перечисляются
                    с номерами файлов
                  </li>
                  <li>
                    <span className="instruction-badge skip">
                      ➖ Пропущенные
                    </span>{" "}
                    — эти колонки игнорируются
                  </li>
                </ul>
              </div>

              <div className="instruction-section-li">
                <h4>💡 Быстрые действия</h4>
                <ul>
                  <li>
                    <strong>Все ключевые</strong> — сделать все колонки
                    ключевыми
                  </li>
                  <li>
                    <strong>Все группировка</strong> — сделать все колонки
                    группируемыми
                  </li>
                </ul>
              </div>

              <div className="instruction-section-li">
                <h4>📊 Шаг 4: Результат</h4>
                <ul>
                  <li>Просмотрите сгруппированные данные в таблице</li>
                  <li>
                    <span className="instruction-highlight changed">
                      Оранжевая подсветка
                    </span>{" "}
                    и значок ⚡ показывают ячейки, где значения различаются в
                    разных файлах
                  </li>
                  <li>
                    Нажмите <strong>"Скачать Excel"</strong> для экспорта
                    результата
                  </li>
                </ul>
              </div>

              <div className="instruction-section-li">
                <h4>🔍 Пример работы</h4>
                <div className="instruction-example">
                  <p>
                    <strong>Дано:</strong> 3 файла с перечнем рабочих мест
                  </p>
                  <p>
                    <strong>Ключевые колонки:</strong> Подразделение, Должность
                  </p>
                  <p>
                    <strong>Группируемая колонка:</strong> ФИО сотрудника
                  </p>
                  <p>
                    <strong>Результат:</strong>
                  </p>
                  <ul>
                    <li>
                      Если ФИО одинаковое во всех файлах → показывается одно
                      значение
                    </li>
                    <li>
                      Если ФИО различаются → "1.1. Иванов, 2.1. Петров, 3.1.
                      Сидоров"
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="header-selector-actions">
              <button
                className="btn-primary"
                onClick={() => setShowInstructions(false)}
              >
                ✅ Понятно, приступим!
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default ExcelTableBuilder;
