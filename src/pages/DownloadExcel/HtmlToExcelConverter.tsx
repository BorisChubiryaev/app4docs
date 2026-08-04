import React, { useState, useEffect, useRef } from "react";
import * as ExcelJS from "exceljs";
import { handleUrlExcelDownload } from "../../utils/urlExcelDownloader";
import "./HtmlToExcelConverter.css";
import InstructionsModalShell from "../../components/InstructionsModal";
import PageShell from "../../components/PageShell";

const HtmlToExcelConverter: React.FC = () => {
  // Существующие состояния для HTML
  const [htmlInput, setHtmlInput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [previewTable, setPreviewTable] = useState<HTMLTableElement | null>(
    null,
  );
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const [showConstructor, setShowConstructor] = useState<boolean>(false);
  const [tables, setTables] = useState<HTMLTableElement[]>([]);
  const [selectedTableIndex, setSelectedTableIndex] = useState<number | null>(
    null,
  );
  const [selectedTables, setSelectedTables] = useState<number[]>([]);
  const [mode, setMode] = useState<"single" | "fullpage">("single");
  const [fileName, setFileName] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [filteredTables, setFilteredTables] = useState<number[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<number[]>([]);

  // Новые состояния для JSON
  const [converterType, setConverterType] = useState<"html" | "json">("html");
  const [jsonInput, setJsonInput] = useState<string>("");
  const [jsonData, setJsonData] = useState<any[] | null>(null);
  const [jsonKeys, setJsonKeys] = useState<string[]>([]);
  const [selectedJsonKeys, setSelectedJsonKeys] = useState<string[]>([]);
  const [jsonPreviewMode, setJsonPreviewMode] = useState<"table" | "raw">(
    "table",
  );
  const [jsonArrayPath, setJsonArrayPath] = useState<string>("");

  useEffect(() => {
    handleUrlExcelDownload();
  }, []);

  // Функция для поиска в таблицах (HTML)
  const searchInTables = (term: string) => {
    if (!term.trim()) {
      setFilteredTables(tables.map((_, index) => index));
      return;
    }

    const foundTables: number[] = [];
    const searchLower = term.toLowerCase();

    tables.forEach((table, index) => {
      const tableText = table.textContent?.toLowerCase() || "";
      if (tableText.includes(searchLower)) {
        foundTables.push(index);
      }
    });

    setFilteredTables(foundTables);
  };

  const sanitizeFileName = (
    fileName: string,
    maxLength: number = 150,
  ): string => {
    let cleanName = fileName.replace(/[<>:"/\\|?*]/g, "_");
    if (cleanName.length > maxLength) {
      const extension = cleanName.includes(".")
        ? cleanName.substring(cleanName.lastIndexOf("."))
        : "";
      const nameWithoutExt = cleanName.substring(
        0,
        cleanName.length - extension.length,
      );
      const maxNameLength = maxLength - extension.length;
      cleanName =
        nameWithoutExt.substring(0, maxNameLength - 3) + "..." + extension;
    }
    return cleanName;
  };

  useEffect(() => {
    setFilteredTables(tables.map((_, index) => index));
  }, [tables]);

  useEffect(() => {
    searchInTables(searchTerm);
  }, [searchTerm, tables]);

  useEffect(() => {
    if (previewTable && showConstructor) {
      resetConstructor();
    }
  }, [previewTable]);

  // Обработка JSON
  const parseJsonInput = () => {
    if (!jsonInput.trim()) {
      setJsonData(null);
      setJsonKeys([]);
      setSelectedJsonKeys([]);
      setError(null);
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);
      let dataArray: any[] = [];

      // Если это массив
      if (Array.isArray(parsed)) {
        dataArray = parsed;
      }
      // Если это объект с массивом внутри
      else if (typeof parsed === "object" && parsed !== null) {
        // Пытаемся найти массив в объекте
        if (jsonArrayPath) {
          const pathParts = jsonArrayPath.split(".");
          let current = parsed;
          for (const part of pathParts) {
            if (current && typeof current === "object" && part in current) {
              current = current[part];
            } else {
              throw new Error(`Путь "${jsonArrayPath}" не найден в JSON`);
            }
          }
          if (Array.isArray(current)) {
            dataArray = current;
          } else {
            throw new Error(
              `Значение по пути "${jsonArrayPath}" не является массивом`,
            );
          }
        } else {
          // Ищем первый массив в объекте
          for (const key in parsed) {
            if (Array.isArray(parsed[key])) {
              dataArray = parsed[key];
              setJsonArrayPath(key);
              break;
            }
          }
          if (dataArray.length === 0) {
            dataArray = [parsed]; // Преобразуем объект в массив из одного элемента
          }
        }
      }

      if (dataArray.length === 0) {
        throw new Error("Не удалось найти данные для конвертации");
      }

      // Получаем все ключи из объектов
      const allKeys = new Set<string>();
      dataArray.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          Object.keys(item).forEach((key) => allKeys.add(key));
        }
      });

      const keys = Array.from(allKeys);
      setJsonData(dataArray);
      setJsonKeys(keys);
      setSelectedJsonKeys(keys);
      setError(null);
      setSuccess(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при парсинге JSON");
      setJsonData(null);
      setJsonKeys([]);
      setSelectedJsonKeys([]);
    }
  };

  useEffect(() => {
    if (converterType === "json") {
      parseJsonInput();
    }
  }, [jsonInput, jsonArrayPath, converterType]);

  const handleJsonInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonInput(e.target.value);
  };

  const toggleJsonKey = (key: string) => {
    setSelectedJsonKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  const selectAllJsonKeys = () => {
    setSelectedJsonKeys([...jsonKeys]);
  };

  const clearJsonKeys = () => {
    setSelectedJsonKeys([]);
  };

  // Конвертация JSON в Excel
  const convertJsonToExcel = async () => {
    if (!jsonData || selectedJsonKeys.length === 0) {
      setError("Нет данных для конвертации или не выбраны колонки");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(false);

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Данные");

      // Добавляем заголовки
      const headerRow = worksheet.addRow(selectedJsonKeys);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF5F5F7" },
      };
      headerRow.eachCell((cell) => {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      // Добавляем данные
      jsonData.forEach((item) => {
        const rowData = selectedJsonKeys.map((key) => {
          const value =
            typeof item === "object" && item !== null ? item[key] : item;
          if (typeof value === "object" && value !== null) {
            return JSON.stringify(value);
          }
          return value !== undefined && value !== null ? String(value) : "";
        });
        worksheet.addRow(rowData);
      });

      // Настраиваем ширину колонок
      worksheet.columns.forEach((column) => {
        if (column) {
          let maxLength = 0;
          column.eachCell?.({ includeEmpty: true }, (cell) => {
            const cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
              maxLength = cellLength;
            }
          });
          column.width = Math.min(Math.max(maxLength + 2, 10), 50);
        }
      });

      // Добавляем границы
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
          cell.alignment = { vertical: "middle", wrapText: true };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const safeFilename = sanitizeFileName("json_данные_из_EX-El.xlsx");
      downloadExcelFile(buffer, safeFilename);
      setSuccess(true);
    } catch (err) {
      setError("Ошибка при создании Excel файла из JSON");
      console.error("Detailed error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Функция для подсветки совпадений в тексте
  const highlightText = (text: string, search: string) => {
    if (!search.trim()) return text;
    const regex = new RegExp(
      `(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    return text
      .split(regex)
      .map((part, index) =>
        regex.test(part) ? <mark key={index}>{part}</mark> : part,
      );
  };

  useEffect(() => {
    if (converterType === "html") {
      processHtmlInput();
    }
  }, [htmlInput, converterType]);

  const handleConvertAndDownload = async () => {
    if (converterType === "json") {
      await convertJsonToExcel();
      return;
    }

    setError(null);
    setSuccess(false);
    setIsProcessing(true);

    try {
      if (mode === "single") {
        if (!previewTable) {
          setError("Нет таблицы для конвертации.");
          setIsProcessing(false);
          return;
        }

        let tableToDownload = previewTable;
        if (
          showConstructor &&
          (selectedRows.length > 0 || selectedColumns.length > 0)
        ) {
          tableToDownload = createCustomTable(previewTable);
        }
        const defaultFilename = "таблица_из_EX-El.xlsx";
        await downloadSingleTable(tableToDownload, defaultFilename);
      } else {
        if (selectedTables.length === 0) {
          setError("Выберите хотя бы одну таблицу для скачивания.");
          setIsProcessing(false);
          return;
        }

        if (
          showConstructor &&
          (selectedRows.length > 0 || selectedColumns.length > 0)
        ) {
          await downloadMultipleTablesWithCustomSelection(selectedTables);
        } else {
          await downloadMultipleTables(selectedTables);
        }
      }

      setSuccess(true);
      if (showConstructor) {
        setShowConstructor(false);
      }
    } catch (err) {
      setError("Ошибка при создании Excel файла.");
      console.error("Detailed error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Существующие функции для HTML (createCustomTable, getCustomTablePreview, downloadMultipleTablesWithCustomSelection, downloadSingleTable, downloadMultipleTables, createWorkbookFromTable, addTableToWorkbook, downloadExcelFile)
  const createCustomTable = (
    originalTable: HTMLTableElement,
  ): HTMLTableElement => {
    const newTable = document.createElement("table");
    const originalRows = Array.from(originalTable.rows);

    const rowsToInclude =
      selectedRows.length > 0
        ? selectedRows
        : Array.from({ length: originalRows.length }, (_, i) => i);

    const columnsToInclude =
      selectedColumns.length > 0
        ? selectedColumns
        : Array.from(
            {
              length: Math.max(...originalRows.map((row) => row.cells.length)),
            },
            (_, i) => i,
          );

    rowsToInclude.forEach((rowIndex) => {
      if (rowIndex < originalRows.length) {
        const originalRow = originalRows[rowIndex];
        const newRow = document.createElement("tr");

        columnsToInclude.forEach((colIndex) => {
          const originalCell = originalRow.cells[colIndex];
          if (originalCell) {
            const newCell = originalCell.cloneNode(
              true,
            ) as HTMLTableCellElement;
            newRow.appendChild(newCell);
          }
        });

        newTable.appendChild(newRow);
      }
    });

    return newTable;
  };

  const getCustomTablePreview = (): HTMLTableElement | null => {
    if (!previewTable) return null;
    if (
      showConstructor &&
      (selectedRows.length > 0 || selectedColumns.length > 0)
    ) {
      return createCustomTable(previewTable);
    }
    return previewTable;
  };

  const downloadMultipleTablesWithCustomSelection = async (
    tableIndexes: number[],
  ) => {
    if (tableIndexes.length === 1) {
      const tableIndex = tableIndexes[0];
      const table = tables[tableIndex];
      const customTable = createCustomTable(table);
      const baseName = fileName
        ? fileName.replace(".html", "").replace(".htm", "")
        : "таблица";
      await downloadSingleTable(
        customTable,
        `${baseName}_${tableIndex + 1}_custom.xlsx`,
      );
    } else {
      const workbook = new ExcelJS.Workbook();
      const baseName = fileName
        ? fileName.replace(".html", "").replace(".htm", "")
        : "таблицы";

      tableIndexes.forEach((tableIndex) => {
        const table = tables[tableIndex];
        const customTable = createCustomTable(table);
        const worksheet = addTableToWorkbook(
          workbook,
          customTable,
          `Таблица_${tableIndex + 1}`,
        );

        if (customTable.rows.length > 0) {
          const headerRow = worksheet.getRow(1);
          headerRow.font = { bold: true };
          headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F5F7" },
          };
          headerRow.eachCell((cell) => {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          });
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const safeFilename = sanitizeFileName(`${baseName}_custom_из_EX-El.xlsx`);
      downloadExcelFile(buffer, safeFilename);
    }
  };

  const downloadSingleTable = async (
    table: HTMLTableElement,
    filename: string,
  ) => {
    const workbook = await createWorkbookFromTable(table, "Таблица");
    const buffer = await workbook.xlsx.writeBuffer();
    const safeFilename = sanitizeFileName(filename);
    downloadExcelFile(buffer, safeFilename);
  };

  const downloadMultipleTables = async (tableIndexes: number[]) => {
    if (tableIndexes.length === 1) {
      const tableIndex = tableIndexes[0];
      const table = tables[tableIndex];
      const baseName = fileName
        ? fileName.replace(".html", "").replace(".htm", "")
        : "таблица";
      await downloadSingleTable(table, `${baseName}_${tableIndex + 1}.xlsx`);
    } else {
      const workbook = new ExcelJS.Workbook();
      const baseName = fileName
        ? fileName.replace(".html", "").replace(".htm", "")
        : "таблицы";

      tableIndexes.forEach((tableIndex) => {
        const table = tables[tableIndex];
        const worksheet = addTableToWorkbook(
          workbook,
          table,
          `Таблица_${tableIndex + 1}`,
        );

        if (table.rows.length > 0) {
          const headerRow = worksheet.getRow(1);
          headerRow.font = { bold: true };
          headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F5F7" },
          };
          headerRow.eachCell((cell) => {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          });
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const safeFilename = sanitizeFileName(`${baseName}_из_EX-El.xlsx`);
      downloadExcelFile(buffer, safeFilename);
    }
  };

  const createWorkbookFromTable = async (
    table: HTMLTableElement,
    sheetName: string,
  ) => {
    const workbook = new ExcelJS.Workbook();
    addTableToWorkbook(workbook, table, sheetName);
    return workbook;
  };

  const addTableToWorkbook = (
    workbook: ExcelJS.Workbook,
    table: HTMLTableElement,
    sheetName: string,
  ) => {
    const worksheet = workbook.addWorksheet(sheetName);
    const rows = Array.from(table.querySelectorAll("tr"));

    const cellMatrix: {
      value: string;
      rowspan: number;
      colspan: number;
      skipped: boolean;
    }[][] = [];
    const merges: {
      start: { row: number; col: number };
      end: { row: number; col: number };
    }[] = [];

    rows.forEach((row, rowIndex) => {
      cellMatrix[rowIndex] = [];
    });

    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll("th, td")).filter(
        (cell) =>
          !cell.hasAttribute("style") ||
          !cell.getAttribute("style")?.includes("display: none"),
      );

      let colIndex = 0;

      cells.forEach((cell) => {
        while (cellMatrix[rowIndex][colIndex]?.skipped) {
          colIndex++;
        }

        let cellValue = cell.textContent?.trim() || "";
        cellValue = cellValue.replace(/[\s\n]+/g, " ").trim();
        cellValue = cellValue.replace(/^[\s\n]+$/, "");

        const rowspan = parseInt(cell.getAttribute("rowspan") || "1");
        const colspan = parseInt(cell.getAttribute("colspan") || "1");

        cellMatrix[rowIndex][colIndex] = {
          value: cellValue,
          rowspan,
          colspan,
          skipped: false,
        };

        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (r === 0 && c === 0) continue;
            const targetRow = rowIndex + r;
            const targetCol = colIndex + c;
            if (!cellMatrix[targetRow]) cellMatrix[targetRow] = [];
            cellMatrix[targetRow][targetCol] = {
              value: "",
              rowspan: 0,
              colspan: 0,
              skipped: true,
            };
          }
        }

        if (rowspan > 1 || colspan > 1) {
          merges.push({
            start: { row: rowIndex, col: colIndex },
            end: { row: rowIndex + rowspan - 1, col: colIndex + colspan - 1 },
          });
        }

        colIndex += colspan;
      });
    });

    cellMatrix.forEach((rowData, rowIndex) => {
      const excelRowData = rowData.map((cell) => (cell ? cell.value : ""));
      worksheet.addRow(excelRowData);
    });

    merges.forEach((merge) => {
      try {
        worksheet.mergeCells(
          merge.start.row + 1,
          merge.start.col + 1,
          merge.end.row + 1,
          merge.end.col + 1,
        );
      } catch (error) {
        console.warn("Не удалось объединить ячейки:", error);
      }
    });

    worksheet.columns.forEach((column) => {
      if (column) {
        let maxLength = 0;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const cellLength = cell.value ? cell.value.toString().length : 0;
          if (cellLength > maxLength) maxLength = cellLength;
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      }
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    return worksheet;
  };

  const downloadExcelFile = (buffer: ArrayBuffer, filename: string) => {
    const safeFilename = sanitizeFileName(filename);
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Функции для конструктора таблиц (HTML)
  const toggleConstructor = () => {
    setShowConstructor(!showConstructor);
    if (!showConstructor) {
      resetConstructor();
    }
  };

  const resetConstructor = () => {
    setSelectedRows([]);
    setSelectedColumns([]);
  };

  const toggleRowSelection = (rowIndex: number) => {
    setSelectedRows((prev) => {
      if (prev.includes(rowIndex)) return prev.filter((i) => i !== rowIndex);
      return [...prev, rowIndex];
    });
  };

  const toggleColumnSelection = (colIndex: number) => {
    setSelectedColumns((prev) => {
      if (prev.includes(colIndex)) return prev.filter((i) => i !== colIndex);
      return [...prev, colIndex];
    });
  };

  const selectAllRows = () => {
    if (!previewTable) return;
    const allRows = Array.from(
      { length: previewTable.rows.length },
      (_, i) => i,
    );
    setSelectedRows(allRows);
  };

  const selectAllColumns = () => {
    if (!previewTable) return;
    const maxCols = Math.max(
      ...Array.from(previewTable.rows).map((row) => row.cells.length),
    );
    const allCols = Array.from({ length: maxCols }, (_, i) => i);
    setSelectedColumns(allCols);
  };

  const clearRowSelection = () => setSelectedRows([]);
  const clearColumnSelection = () => setSelectedColumns([]);

  const getTableInfo = () => {
    if (!previewTable) return null;
    const rows = previewTable.rows.length;
    const cols = Math.max(
      ...Array.from(previewTable.rows).map((row) => row.cells.length),
    );
    return { rows, cols };
  };

  const processHtmlInput = () => {
    if (htmlInput.trim()) {
      setError(null);
      setSuccess(false);
    }

    if (!htmlInput.trim()) {
      setPreviewTable(null);
      setTables([]);
      setSelectedTableIndex(null);
      setSelectedTables([]);
      setShowConstructor(false);
      resetConstructor();
      return;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlInput, "text/html");

      if (mode === "single") {
        const table = doc.querySelector("table");
        if (!table) {
          setError("Таблица не найдена в HTML.");
          setPreviewTable(null);
          return;
        }
        setPreviewTable(table as HTMLTableElement);
      } else {
        const allTables = Array.from(doc.querySelectorAll("table"));
        setTables(allTables as HTMLTableElement[]);

        if (allTables.length === 0) {
          setError("Таблицы не найдены в HTML.");
          setPreviewTable(null);
          return;
        }

        setSelectedTableIndex(0);
        setPreviewTable(allTables[0] as HTMLTableElement);
        setSelectedTables([0]);
      }

      setError(null);
    } catch (err) {
      setError("Ошибка при обработке HTML. Проверьте корректность кода.");
      setPreviewTable(null);
      setTables([]);
      console.error(err);
    }
  };

  const normalizeHtmlInput = (html: string): string => {
    return html
      .replace(/\r?\n|\r/g, " ")
      .replace(/\s+/g, " ")
      .replace(/>\s+</g, "><")
      .trim();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const normalizedHtml = normalizeHtmlInput(e.target.value);
    setHtmlInput(normalizedHtml);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (converterType === "html") {
      if (
        !file.type.includes("html") &&
        !file.name.endsWith(".html") &&
        !file.name.endsWith(".htm")
      ) {
        setError("Пожалуйста, выберите HTML файл (.html или .htm)");
        return;
      }
    } else {
      if (!file.name.endsWith(".json")) {
        setError("Пожалуйста, выберите JSON файл (.json)");
        return;
      }
    }

    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (converterType === "html") {
          const normalizedHtml = normalizeHtmlInput(content);
          setHtmlInput(normalizedHtml);
          setMode("fullpage");
        } else {
          setJsonInput(content);
        }
        setSuccess(false);
      } catch (err) {
        setError("Ошибка при чтении файла.");
        console.error(err);
      }
    };

    reader.onerror = () => {
      setError("Ошибка при загрузке файла.");
    };

    reader.readAsText(file, "UTF-8");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleModeChange = (newMode: "single" | "fullpage") => {
    setMode(newMode);
    setSelectedTableIndex(null);
    setSelectedTables([]);
    setTables([]);
    setShowConstructor(false);
    resetConstructor();
  };

  const handleTableSelect = (index: number) => {
    setSelectedTableIndex(index);
    setPreviewTable(tables[index]);
    setShowConstructor(false);
    resetConstructor();
  };

  const handleTableToggle = (index: number) => {
    setSelectedTables((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      return [...prev, index];
    });
  };

  const selectAllTables = () => {
    setSelectedTables(tables.map((_, index) => index));
  };

  const clearAllTables = () => {
    setSelectedTables([]);
  };

  const clearAll = () => {
    setHtmlInput("");
    setJsonInput("");
    setError(null);
    setSuccess(false);
    setPreviewTable(null);
    setTables([]);
    setSelectedTableIndex(null);
    setSelectedTables([]);
    setFileName("");
    setShowConstructor(false);
    setJsonData(null);
    setJsonKeys([]);
    setSelectedJsonKeys([]);
    resetConstructor();
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleConverterTypeChange = (type: "html" | "json") => {
    setConverterType(type);
    setError(null);
    setSuccess(false);
    if (type === "json") {
      parseJsonInput();
    }
  };

  // Рендер JSON предпросмотра
  const renderJsonPreview = () => {
    if (!jsonData) return null;

    return (
      <div className="json-preview-container">
        <div className="json-preview-header">
          <div className="json-preview-info">
            <span>Найдено объектов: {jsonData.length}</span>
            <span>Колонок: {jsonKeys.length}</span>
          </div>
          <div className="json-preview-controls">
            <button
              className={`btn btn-small ${jsonPreviewMode === "table" ? "active" : ""}`}
              onClick={() => setJsonPreviewMode("table")}
            >
              Таблица
            </button>
            <button
              className={`btn btn-small ${jsonPreviewMode === "raw" ? "active" : ""}`}
              onClick={() => setJsonPreviewMode("raw")}
            >
              Raw JSON
            </button>
          </div>
        </div>

        {jsonPreviewMode === "table" ? (
          <div className="json-table-container">
            <div className="json-keys-selector">
              <div className="json-keys-header">
                <h4>Колонки для экспорта</h4>
                <div className="json-keys-actions">
                  <button onClick={selectAllJsonKeys} className="btn btn-small">
                    Все
                  </button>
                  <button onClick={clearJsonKeys} className="btn btn-small">
                    Очистить
                  </button>
                </div>
              </div>
              <div className="json-keys-list">
                {jsonKeys.map((key) => (
                  <label
                    key={key}
                    className={`json-key-item ${selectedJsonKeys.includes(key) ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedJsonKeys.includes(key)}
                      onChange={() => toggleJsonKey(key)}
                    />
                    <span>{key}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="json-table-preview">
              <table>
                <thead>
                  <tr>
                    {selectedJsonKeys.map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jsonData.slice(0, 100).map((item, index) => (
                    <tr key={index}>
                      {selectedJsonKeys.map((key) => {
                        const value =
                          typeof item === "object" && item !== null
                            ? item[key]
                            : item;
                        const displayValue =
                          typeof value === "object" && value !== null
                            ? JSON.stringify(value)
                            : value !== undefined && value !== null
                              ? String(value)
                              : "";
                        return <td key={key}>{displayValue}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {jsonData.length > 100 && (
                <div className="json-table-more">
                  Показано 100 из {jsonData.length} записей
                </div>
              )}
            </div>
          </div>
        ) : (
          <pre className="json-raw-preview">
            {JSON.stringify(jsonData.slice(0, 10), null, 2)}
            {jsonData.length > 10 &&
              `\n... и еще ${jsonData.length - 10} записей`}
          </pre>
        )}
      </div>
    );
  };

  // Модальное окно конструктора (HTML)
  const ConstructorModal: React.FC = () => {
    if (!showConstructor || !previewTable) return null;

    const tableInfo = getTableInfo();
    if (!tableInfo) return null;

    const { rows, cols } = tableInfo;
    const customTablePreview = getCustomTablePreview();

    const getColumnHeaders = (): string[] => {
      const headers: string[] = [];
      if (previewTable && previewTable.rows.length > 0) {
        const headerRow = previewTable.rows[0];
        const cells = Array.from(headerRow.cells);
        cells.forEach((cell, index) => {
          let cellText = cell.textContent?.trim() || "";
          cellText = cellText.replace(/[\s\n]+/g, " ").trim();
          headers[index] = cellText || `Колонка ${index + 1}`;
        });
      }
      for (let i = 0; i < cols; i++) {
        if (!headers[i]) headers[i] = `Колонка ${i + 1}`;
      }
      return headers;
    };

    const getRowLabels = (): string[] => {
      const labels: string[] = [];
      for (let i = 0; i < rows; i++) {
        if (previewTable && i < previewTable.rows.length) {
          const row = previewTable.rows[i];
          const firstCell = row.cells[0];
          if (firstCell) {
            let cellText = firstCell.textContent?.trim() || "";
            cellText = cellText.replace(/[\s\n]+/g, " ").trim();
            labels[i] = cellText.substring(0, 20) || `Строка ${i + 1}`;
            if (cellText.length > 20) labels[i] += "...";
          } else {
            labels[i] = `Строка ${i + 1}`;
          }
        }
      }
      return labels;
    };

    const columnHeaders = getColumnHeaders();
    const rowLabels = getRowLabels();

    return (
      <div
        className="modal-overlay constructor-modal-overlay"
        onClick={() => setShowConstructor(false)}
      >
        <div
          className="modal-content constructor-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="constructor-modal-header">
            <div className="constructor-title">
              <h2>🛠️ Конструктор таблицы</h2>
              <p>Выберите строки и столбцы для скачивания</p>
            </div>
            <button
              className="modal-close"
              onClick={() => setShowConstructor(false)}
            >
              ✕
            </button>
          </div>

          <div className="constructor-modal-body">
            <div className="constructor-layout">
              <div className="constructor-controls-panel">
                <div className="constructor-controls-section">
                  <div className="constructor-section-header">
                    <h3>Выбор столбцов</h3>
                    <div className="constructor-control-buttons">
                      <button
                        onClick={selectAllColumns}
                        className="btn-constructor-control"
                      >
                        Выбрать все
                      </button>
                      <button
                        onClick={clearColumnSelection}
                        className="btn-constructor-control"
                      >
                        Очистить
                      </button>
                    </div>
                  </div>
                  <div className="constructor-selection-counter">
                    Выбрано: {selectedColumns.length} из {cols} столбцов
                  </div>
                  <div className="constructor-columns-list">
                    {Array.from({ length: cols }).map((_, index) => (
                      <div
                        key={index}
                        className={`constructor-column-item ${selectedColumns.includes(index) ? "selected" : ""}`}
                        onClick={() => toggleColumnSelection(index)}
                      >
                        <div className="constructor-column-checkbox">
                          {selectedColumns.includes(index) ? "✓" : ""}
                        </div>
                        <div
                          className="constructor-column-label"
                          title={columnHeaders[index]}
                        >
                          {columnHeaders[index]}
                        </div>
                        <div className="constructor-column-number">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="constructor-controls-section">
                  <div className="constructor-section-header">
                    <h3>Выбор строк</h3>
                    <div className="constructor-control-buttons">
                      <button
                        onClick={selectAllRows}
                        className="btn-constructor-control"
                      >
                        Выбрать все
                      </button>
                      <button
                        onClick={clearRowSelection}
                        className="btn-constructor-control"
                      >
                        Очистить
                      </button>
                    </div>
                  </div>
                  <div className="constructor-selection-counter">
                    Выбрано: {selectedRows.length} из {rows} строк
                  </div>
                  <div className="constructor-rows-list">
                    {Array.from({ length: rows }).map((_, index) => (
                      <div
                        key={index}
                        className={`constructor-row-item ${selectedRows.includes(index) ? "selected" : ""}`}
                        onClick={() => toggleRowSelection(index)}
                      >
                        <div className="constructor-row-checkbox">
                          {selectedRows.includes(index) ? "✓" : ""}
                        </div>
                        <div className="constructor-row-label">
                          {rowLabels[index]}
                        </div>
                        <div className="constructor-row-number">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="constructor-preview-panel">
                <div className="constructor-preview-header">
                  <h3>Предпросмотр результата</h3>
                  <div className="constructor-preview-info">
                    {selectedRows.length === 0 &&
                    selectedColumns.length === 0 ? (
                      <span className="constructor-warning-text">
                        Выберите строки и столбцы
                      </span>
                    ) : (
                      <span className="constructor-success-text">
                        Будет скачано:{" "}
                        {selectedRows.length > 0
                          ? `${selectedRows.length} строк`
                          : "Все строки"}
                        ,
                        {selectedColumns.length > 0
                          ? ` ${selectedColumns.length} столбцов`
                          : " все столбцы"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="constructor-preview-container">
                  <div className="constructor-preview-table">
                    {customTablePreview ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: customTablePreview.outerHTML,
                        }}
                      />
                    ) : (
                      <div className="constructor-no-preview">
                        <p>Выберите строки и столбцы для предпросмотра</p>
                      </div>
                    )}
                  </div>

                  <div className="constructor-highlight-info">
                    <div className="constructor-highlight-item">
                      <div className="constructor-highlight-color-row"></div>
                      <span>Выбранные строки</span>
                    </div>
                    <div className="constructor-highlight-item">
                      <div className="constructor-highlight-color-column"></div>
                      <span>Выбранные столбцы</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="constructor-modal-footer">
            <button
              onClick={() => setShowConstructor(false)}
              className="btn btn-secondary"
            >
              Отмена
            </button>
            <button
              onClick={handleConvertAndDownload}
              disabled={!previewTable || isProcessing}
              className={`btn btn-primary ${isProcessing ? "processing" : ""}`}
            >
              {isProcessing ? (
                <>
                  <div className="spinner-small"></div>Обработка...
                </>
              ) : (
                <>
                  <span>📥</span>Скачать выбранные данные
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Модальное окно инструкции
  const InstructionsModal: React.FC = () => (
    <InstructionsModalShell
      isOpen={showInstructions}
      onClose={() => setShowInstructions(false)}
      title="📋 Инструкция по использованию конвертера"
      footerLabel="Понятно! Начать работу!"
    >
      <div className="instructions-section">
        <h3>🔄 Режимы конвертера</h3>
        <p>Конвертер поддерживает два типа входных данных:</p>
        <ul>
          <li>
            <strong>HTML в Excel</strong> - конвертация HTML-таблиц
          </li>
          <li>
            <strong>JSON в Excel</strong> - конвертация JSON-данных
          </li>
        </ul>
      </div>

      <div className="instructions-section">
        <h3>📊 JSON в Excel</h3>
        <ol>
          <li>Выберите вкладку "JSON в Excel"</li>
          <li>
            Вставьте JSON-данные (массив объектов или объект с массивом)
          </li>
          <li>Выберите нужные колонки для экспорта</li>
          <li>Нажмите "Скачать как Excel"</li>
        </ol>
        <p>
          <strong>Поддерживаемые форматы JSON:</strong>
        </p>
        <ul>
          <li>Вложенные объекты автоматически преобразуются в строку</li>
        </ul>
      </div>

      <div className="instructions-section">
        <h3>🛠️ Конструктор таблиц (HTML)</h3>
        <p>
          Для HTML-таблиц доступен конструктор для выбора строк и столбцов
        </p>
      </div>

      <div className="instructions-section">
        <h3>⚠️ Частые проблемы и решения</h3>
        <ul>
          <li>
            <strong>JSON не парсится:</strong> Убедитесь, что JSON валиден
          </li>
          <li>
            <strong>Не найден массив:</strong> Укажите путь к массиву в поле
            "Путь к массиву"
          </li>
          <li>
            <strong>Большой объем данных:</strong> Для больших массивов
            рекомендуется разбить на части
          </li>
        </ul>
      </div>
    </InstructionsModalShell>
  );

  return (
    <>
      <InstructionsModal />
      <ConstructorModal />

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept={
          converterType === "html"
            ? ".html,.htm,text/html"
            : ".json,application/json"
        }
        style={{ display: "none" }}
      />

      <PageShell
        title="Конвертер в Excel"
        subtitle="Преобразуйте HTML-таблицы и JSON-данные в файлы Excel"
        onShowInstructions={() => setShowInstructions(true)}
      >

          <div className="converter-content">
            <div className="input-section">
              <div className="section-header">
                <div className="section-icon">📝</div>
                <h2>Входные данные</h2>
              </div>

              {/* Переключатель типа конвертера */}
              <div className="converter-type-selector">
                <button
                  className={`converter-type-btn ${converterType === "html" ? "active" : ""}`}
                  onClick={() => handleConverterTypeChange("html")}
                >
                  📄 HTML в Excel
                </button>
                <button
                  className={`converter-type-btn ${converterType === "json" ? "active" : ""}`}
                  onClick={() => handleConverterTypeChange("json")}
                >
                  📊 JSON в Excel
                </button>
              </div>

              {/* Кнопка загрузки файла */}
              <div className="file-upload-section">
                <button
                  type="button"
                  onClick={triggerFileInput}
                  className="btn btn-file"
                >
                  <span>📁</span>
                  Загрузить {converterType === "html" ? "HTML" : "JSON"} файл
                </button>
                {fileName && (
                  <div className="file-info">
                    <span className="file-name">📄 {fileName}</span>
                    <button
                      type="button"
                      onClick={() => setFileName("")}
                      className="btn-remove-file"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div className="or-divider">
                <span>или</span>
              </div>

              {converterType === "html" ? (
                <>
                  {/* Переключатель режимов HTML */}
                  <div className="mode-selector">
                    <label className="mode-option">
                      <input
                        type="radio"
                        value="single"
                        checked={mode === "single"}
                        onChange={() => handleModeChange("single")}
                      />
                      <span>Одиночная таблица</span>
                    </label>
                    <label className="mode-option">
                      <input
                        type="radio"
                        value="fullpage"
                        checked={mode === "fullpage"}
                        onChange={() => handleModeChange("fullpage")}
                      />
                      <span>Полная страница</span>
                    </label>
                  </div>

                  <textarea
                    value={htmlInput}
                    onChange={handleInputChange}
                    placeholder={
                      mode === "single"
                        ? "Вставьте HTML код таблицы..."
                        : "Вставьте HTML код всей страницы..."
                    }
                    className="html-textarea"
                  />
                </>
              ) : (
                <>
                  {/* JSON input */}
                  <div className="json-path-input">
                    <label>Путь к массиву (опционально):</label>
                    <input
                      type="text"
                      value={jsonArrayPath}
                      onChange={(e) => setJsonArrayPath(e.target.value)}
                      placeholder="например: data.items"
                      className="path-input"
                    />
                  </div>
                  <textarea
                    value={jsonInput}
                    onChange={handleJsonInputChange}
                    placeholder={`Вставьте JSON данные...\n\nПример:\n[\n  {"name": "John", "age": 30},\n  {"name": "Jane", "age": 25}\n]\n\nИли:\n{\n  "data": [\n    {"name": "John", "age": 30}\n  ]\n}`}
                    className="html-textarea json-textarea"
                  />
                </>
              )}

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
                  <div className="alert-content">Файл успешно скачан</div>
                </div>
              )}
            </div>

            <div className="preview-section">
              <div className="section-header">
                <div className="section-icon">👁️</div>
                <div className="section-header-right">
                  <h2>
                    Предпросмотр
                    {converterType === "html" &&
                      mode === "fullpage" &&
                      selectedTableIndex !== null && (
                        <span className="table-number">
                          {" "}
                          (Таблица {selectedTableIndex + 1})
                        </span>
                      )}
                  </h2>
                  {converterType === "html" && previewTable && (
                    <button
                      onClick={toggleConstructor}
                      className="btn-constructor"
                      title="Открыть конструктор таблиц"
                    >
                      🛠️ Конструктор таблиц
                    </button>
                  )}
                </div>
              </div>

              {converterType === "html" && (
                <div className="search-section">
                  <div className="search-input-wrapper">
                    <input
                      type="text"
                      placeholder="Поиск по содержимому таблиц..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="search-input"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        className="search-clear"
                      >
                        ✕
                      </button>
                    )}
                    <span className="search-icon">🔍</span>
                  </div>
                  {searchTerm && (
                    <div className="search-results-info">
                      Найдено таблиц: {filteredTables.length} из {tables.length}
                      {filteredTables.length === 0 && (
                        <span className="no-results">
                          {" "}
                          - совпадений не найдено
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Список таблиц HTML */}
              {converterType === "html" &&
                mode === "fullpage" &&
                tables.length > 0 && (
                  <div className="tables-selection">
                    <div className="tables-header">
                      <h3>Найдено таблиц: {tables.length}</h3>
                      <div className="tables-actions">
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={selectAllTables}
                        >
                          Выбрать все
                        </button>
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={clearAllTables}
                        >
                          Очистить
                        </button>
                      </div>
                    </div>

                    <div className="tables-list">
                      {tables.map((table, index) => {
                        if (!filteredTables.includes(index)) return null;

                        // Извлекаем текст из таблицы
                        let tableText = "";
                        try {
                          tableText =
                            table.textContent || table.innerText || "";
                          tableText = tableText.replace(/\s+/g, " ").trim();
                        } catch (e) {
                          tableText = "Нет текста";
                        }

                        const previewText =
                          tableText.length > 150
                            ? tableText.substring(0, 150) + "..."
                            : tableText;

                        const rowsCount = table.rows ? table.rows.length : 0;
                        const colsCount =
                          rowsCount > 0
                            ? Math.max(
                                ...Array.from(table.rows).map((row) =>
                                  row.cells ? row.cells.length : 0,
                                ),
                              )
                            : 0;

                        return (
                          <div
                            key={index}
                            className={`table-item table-item-cell  ${selectedTableIndex === index ? "active" : ""}`}
                          >
                            <div
                              className="table-preview-area"
                              onClick={() => handleTableSelect(index)}
                            >
                              <div className="table-header">
                                <span className="table-title">
                                  Таблица {index + 1}
                                </span>
                                <div className="table-info">
                                  <small>
                                    {rowsCount} строк, {colsCount} колонок
                                  </small>
                                </div>
                              </div>
                              {/* Всегда показываем превью, даже если текст пустой */}
                              <div
                                className="table-content-preview"
                                style={{ display: "block", minHeight: "20px" }}
                              >
                                {searchTerm ? (
                                  <span>
                                    {highlightText(previewText, searchTerm)}
                                  </span>
                                ) : (
                                  <span>{previewText || "Пустая таблица"}</span>
                                )}
                              </div>
                            </div>
                            <div className="table-selection-area">
                              <label className="table-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedTables.includes(index)}
                                  onChange={() => handleTableToggle(index)}
                                />
                                <span>Выбрать</span>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      {filteredTables.length === 0 && searchTerm && (
                        <div className="no-tables-found">
                          <p>Таблицы не найдены по запросу "{searchTerm}"</p>
                        </div>
                      )}
                    </div>

                    {selectedTables.length > 0 && (
                      <div className="selection-info">
                        Выбрано таблиц: {selectedTables.length}
                      </div>
                    )}
                  </div>
                )}

              <div className="actions">
                <button
                  onClick={handleConvertAndDownload}
                  disabled={
                    converterType === "json"
                      ? !jsonData ||
                        selectedJsonKeys.length === 0 ||
                        isProcessing
                      : converterType === "html"
                        ? mode === "single"
                          ? !previewTable
                          : selectedTables.length === 0 || isProcessing
                        : false
                  }
                  className={`btn btn-primary ${isProcessing ? "processing" : ""}`}
                >
                  {isProcessing ? (
                    <>
                      <div className="spinner-small"></div>Обработка...
                    </>
                  ) : (
                    <>
                      <span>📥</span>
                      {converterType === "html"
                        ? mode === "single"
                          ? "Скачать как Excel"
                          : selectedTables.length === 1
                            ? `Скачать таблицу ${selectedTables[0] + 1}`
                            : `Скачать ${selectedTables.length} таблиц`
                        : "Скачать как Excel"}
                    </>
                  )}
                </button>
                <button
                  onClick={clearAll}
                  disabled={
                    converterType === "html"
                      ? !htmlInput.trim() && !previewTable
                      : !jsonInput.trim() && !jsonData
                  }
                  className="btn btn-secondary"
                >
                  <span>🗑️</span>
                  Очистить все
                </button>
              </div>

              {/* Предпросмотр */}
              {converterType === "html" ? (
                previewTable ? (
                  <div className="preview-table">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: previewTable.outerHTML,
                      }}
                    />
                  </div>
                ) : htmlInput.trim() ? (
                  <div className="preview-placeholder loading">
                    <div className="spinner"></div>
                    <p>Обработка HTML кода...</p>
                  </div>
                ) : (
                  <div className="preview-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p>Введите HTML-код таблицы для предпросмотра</p>
                  </div>
                )
              ) : jsonData ? (
                renderJsonPreview()
              ) : jsonInput.trim() ? (
                <div className="preview-placeholder loading">
                  <div className="spinner"></div>
                  <p>Обработка JSON данных...</p>
                </div>
              ) : (
                <div className="preview-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p>Введите JSON данные для предпросмотра</p>
                </div>
              )}
            </div>
          </div>
      </PageShell>
    </>
  );
};

export default HtmlToExcelConverter;
