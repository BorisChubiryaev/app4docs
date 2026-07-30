import React, { useState, useEffect, useCallback } from "react";
import * as ExcelJS from "exceljs";
import { Link } from "react-router-dom";
import { WorkplaceInstructionsModal } from "./components/WorkplaceInstructionsModal";
import "./WorkplaceCompare.css";

export default function Page() {
  const [firstFile, setFirstFile] = useState<File | null>(null);
  const [secondFile, setSecondFile] = useState<File | null>(null);
  const [diffData, setDiffData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const [dragOverFirst, setDragOverFirst] = useState(false);
  const [dragOverSecond, setDragOverSecond] = useState(false);

  const toggleFullscreen = () => {
    setFullscreen((prev) => !prev);
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [fullscreen]);

  const handleDragOver = useCallback(
    (
      e: React.DragEvent,
      setDragState: React.Dispatch<React.SetStateAction<boolean>>,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState(true);
    },
    [],
  );

  const handleDragLeave = useCallback(
    (
      e: React.DragEvent,
      setDragState: React.Dispatch<React.SetStateAction<boolean>>,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (
      e: React.DragEvent,
      setFile: React.Dispatch<React.SetStateAction<File | null>>,
      setDragState: React.Dispatch<React.SetStateAction<boolean>>,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        // Проверяем, что это Excel файл
        if (
          file.name.endsWith(".xlsx") ||
          file.name.endsWith(".xls") ||
          file.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          file.type === "application/vnd.ms-excel"
        ) {
          setFile(file);
        } else {
          alert("Пожалуйста, перетащите файл Excel (.xlsx или .xls)");
        }
      }
    },
    [],
  );

  const columnLabels: Record<string, string> = {
    "Column 4": "Адрес",
    "Column 13": "Этаж",
    "Column 20": "РМ",
    "Column 25": "Тип РМ",
    "Column 39": "Признак",
    "Column 40": "Таб. №",
    "Column 41": "ФИО",
    "Column 45": "Департамент",
    "Column 49": "Ответственный",
    "Column 52": "ДП",
    "Column 54": "Трайб",
    "Column 59": "Дата с",
    "Column 62": "Статус",
    "Column 64": "Кол-во",
  };

  const displayColumns = [
    "Checked",
    "Status",
    ...Object.keys(columnLabels),
    "ChangeType",
  ];

  const requiredColumns = Object.keys(columnLabels);

  const [filters, setFilters] = useState({
    status: new Set<string>(["БЫЛО", "СТАЛО", "НОВАЯ", "УДАЛЕНА"]),
    address: new Set<string>(),
    floor: new Set<string>(),
    city: new Set<string>(),
    quantity: new Set<string>(),
    changeType: new Set<string>(),
    toReserve: false,
    toPartner: false,
  });

  // === Извлечение города из адреса ===
  const extractCity = (address: string): string | null => {
    if (!address) return null;
    const match = address.match(/г\s+([А-Яа-яЁё-]+(?:\s[А-Яа-яЁё-]+)*)/);
    return match ? match[1].trim() : null;
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    setFile: React.Dispatch<React.SetStateAction<File | null>>,
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      setFile(event.target.files[0]);
    }
  };

  const filterColumns = (data: any[]) => {
    return data.map((row) => {
      const filteredRow: any = {};
      requiredColumns.forEach((column) => {
        filteredRow[column] = row[column] !== undefined ? row[column] : null;
      });
      return filteredRow;
    });
  };

  const readExcel = async (file: File) => {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);

    const worksheet = workbook.worksheets[2]; // Третий лист
    const jsonData: any[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Пропускаем заголовок

      const rowData: any = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colKey = `Column ${colNumber}`;
        if (requiredColumns.includes(colKey)) {
          rowData[colKey] = cell.value;
        }
      });

      // Добавляем строку, только если есть данные
      if (Object.values(rowData).some((val) => val != null)) {
        jsonData.push(rowData);
      }
    });

    if (jsonData.length > 0) {
      jsonData.pop();
    }

    return filterColumns(jsonData);
  };

  const compareData = (oldData: any[], newData: any[]) => {
    const keyColumn = "Column 20";
    const mapOldData = new Map(oldData.map((item) => [item[keyColumn], item]));
    const mapNewData = new Map(newData.map((item) => [item[keyColumn], item]));

    const diff: any[] = [];

    for (const [key, newItem] of mapNewData) {
      const oldItem = mapOldData.get(key);
      if (!oldItem) {
        diff.push({ type: "new", rm: key, old: null, new: newItem });
      } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        diff.push({ type: "changed", rm: key, old: oldItem, new: newItem });
      }
    }

    for (const [key, oldItem] of mapOldData) {
      if (!mapNewData.has(key)) {
        diff.push({ type: "deleted", rm: key, old: oldItem, new: null });
      }
    }

    return diff;
  };

  const handleUpload = async () => {
    if (!firstFile || !secondFile) {
      alert("Пожалуйста, загрузите оба файла.");
      return;
    }

    setLoading(true);
    try {
      const oldData = await readExcel(firstFile);
      const newData = await readExcel(secondFile);
      const differences = compareData(oldData, newData);
      setDiffData(differences);
    } catch (error) {
      console.error("Ошибка при обработке файлов:", error);
      alert(
        "Ошибка при чтении файлов. Проверьте, что это корректные .xlsx-файлы.",
      );
    } finally {
      setLoading(false);
    }
  };

  const renderValue = (value: any) => {
    if (
      value == null ||
      value === "" ||
      value === "null" ||
      value === "undefined"
    )
      return <span className="workplace-text-gray-400">—</span>;
    return value;
  };

  // === Подготовка строк с мета-информацией ===
  const allRows = diffData.flatMap((diff) => {
    const rows = [];

    if (diff.type === "changed") {
      const oldCity = extractCity(diff.old["Column 4"]);
      const newCity = extractCity(diff.new["Column 4"]);
      const oldQty = diff.old["Column 64"];
      const newQty = diff.new["Column 64"];

      rows.push({
        type: "old",
        data: diff.old,
        rm: diff.rm,
        city: oldCity,
        quantity: oldQty,
        source: "changed",
      });
      rows.push({
        type: "new",
        data: diff.new,
        rm: diff.rm,
        city: newCity,
        quantity: newQty,
        source: "changed",
      });
    } else if (diff.type === "new") {
      const city = extractCity(diff.new["Column 4"]);
      const qty = diff.new["Column 64"];
      rows.push({
        type: "new",
        data: diff.new,
        rm: diff.rm,
        city,
        quantity: qty,
        source: "new",
      });
    } else if (diff.type === "deleted") {
      const city = extractCity(diff.old["Column 4"]);
      const qty = diff.old["Column 64"];
      rows.push({
        type: "deleted",
        data: diff.old,
        rm: diff.rm,
        city,
        quantity: qty,
        source: "deleted",
      });
    }

    return rows;
  });

  // === Уникальные значения для фильтров ===
  const uniqueAddresses = Array.from(
    new Set(allRows.map((r) => r.data["Column 4"]).filter(Boolean)),
  ).sort();

  const uniqueFloors = Array.from(
    new Set(allRows.map((r) => r.data["Column 13"]).filter(Boolean)),
  ).sort();

  const uniqueCities = Array.from(
    new Set(allRows.map((r) => r.city).filter(Boolean)),
  ).sort();

  const uniqueQuantities = Array.from(
    new Set(
      allRows
        .map((r) => String(r.quantity))
        .filter((q) => q !== "null" && q !== "undefined" && q !== ""),
    ),
  ).sort((a, b) => Number(a) - Number(b));

  // Собираем все типы изменений (названия полей)
  const uniqueChangeTypes: string[] = [];

  // Добавляем типы из изменённых строк
  diffData.forEach((diff) => {
    if (diff.type === "changed") {
      const oldData = diff.old;
      const newData = diff.new;
      const changedFields = requiredColumns.filter(
        (key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]),
      );
      changedFields.forEach((key) => {
        const label = columnLabels[key];
        if (!uniqueChangeTypes.includes(label)) {
          uniqueChangeTypes.push(label);
        }
      });
    }
  });

  // Добавляем специальные типы
  ["Новая запись", "Удалена"].forEach((t) => {
    if (!uniqueChangeTypes.includes(t)) {
      uniqueChangeTypes.push(t);
    }
  });

  // Сортировка: "Признак" — первым
  uniqueChangeTypes.sort((a, b) => {
    if (a === "Признак") return -1;
    if (b === "Признак") return 1;
    return a.localeCompare(b);
  });

  // === Фильтрация ===
  const filteredRows = allRows.filter((row) => {
    const { data, type, city, quantity, source } = row;

    // Определяем отображаемый статус для фильтрации
    let filterStatus = "";
    if (source === "new") {
      filterStatus = "НОВАЯ";
    } else if (source === "deleted") {
      filterStatus = "УДАЛЕНА";
    } else {
      filterStatus = { old: "БЫЛО", new: "СТАЛО", deleted: "УДАЛЕНА" }[type];
    }

    if (!filters.status.has(filterStatus)) return false;

    if (filters.address.size > 0 && data["Column 4"]) {
      if (!filters.address.has(String(data["Column 4"]))) return false;
    }

    if (filters.floor.size > 0 && data["Column 13"]) {
      if (!filters.floor.has(String(data["Column 13"]))) return false;
    }

    if (filters.city.size > 0 && city) {
      if (!filters.city.has(city)) return false;
    }

    if (filters.quantity.size > 0) {
      const qtyStr = String(quantity);
      if (!filters.quantity.has(qtyStr)) return false;
    }

    // === Фильтр по типу изменения ===
    if (filters.changeType.size > 0) {
      let matchesChangeType = false;

      if (source === "new") {
        matchesChangeType = filters.changeType.has("Новая запись");
      } else if (source === "deleted") {
        matchesChangeType = filters.changeType.has("Удалена");
      } else if (type === "new") {
        // Это "СТАЛО" — ищем изменения
        const oldRow = allRows.find((r) => r.type === "old" && r.rm === row.rm);
        if (oldRow) {
          const changedFields = requiredColumns.filter((key) => {
            return (
              JSON.stringify(oldRow.data[key]) !== JSON.stringify(row.data[key])
            );
          });

          const changedLabels = changedFields.map((key) => columnLabels[key]);
          matchesChangeType = changedLabels.some((label) =>
            filters.changeType.has(label),
          );
        }
      }

      if (!matchesChangeType) return false;
    }

    // === Фильтр: Признак → Резерв ===
    if (filters.toReserve) {
      let matches = false;
      if (type === "new" && source !== "new" && source !== "deleted") {
        const oldRow = allRows.find((r) => r.type === "old" && r.rm === row.rm);
        if (oldRow) {
          const oldVal = oldRow.data["Column 39"];
          const newVal = row.data["Column 39"];
          // Проверяем, что стало "Резерв", а было что-то другое
          if (
            newVal &&
            String(newVal).trim() === "Резерв" &&
            (oldVal === null || String(oldVal).trim() !== "Резерв")
          ) {
            matches = true;
          }
        }
      }
      if (!matches) return false;
    }

    // === Фильтр: Признак → Партнер ===
    if (filters.toPartner) {
      let matches = false;
      if (type === "new" && source !== "new" && source !== "deleted") {
        const oldRow = allRows.find((r) => r.type === "old" && r.rm === row.rm);
        if (oldRow) {
          const oldVal = oldRow.data["Column 39"];
          const newVal = row.data["Column 39"];
          const partnerValues = [
            "Размещение делового партнера",
            "Размещение партнера",
            "Партнер",
          ];
          const isNowPartner = partnerValues.some(
            (v) => newVal && String(newVal).trim() === v,
          );
          const wasNotPartner = !partnerValues.some(
            (v) => oldVal && String(oldVal).trim() === v,
          );
          if (isNowPartner && wasNotPartner) {
            matches = true;
          }
        }
      }
      if (!matches) return false;
    }

    return true;
  });

  // Проверяем, активен ли фильтр по изменениям
  const isChangeFilterActive =
    filters.changeType.size > 0 || filters.toReserve || filters.toPartner;

  const resetFilters = () => {
    setFilters({
      status: new Set(["БЫЛО", "СТАЛО", "НОВАЯ", "УДАЛЕНА"]),
      address: new Set(),
      floor: new Set(),
      city: new Set(),
      quantity: new Set(),
      changeType: new Set(),
      toReserve: false,
      toPartner: false,
    });
  };

  const handleExport = () => {
    const { Workbook } = ExcelJS;

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Сравнение данных");

    // Стили
    const styles = {
      old: {
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF0F0" },
        },
      },
      new: {
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "F0FFF0" },
        },
      },
      added: {
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "F0F0FF" },
        },
      },
      deleted: {
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF0D0" },
        },
        font: { strike: true },
      },
      header: {
        font: { bold: true, color: { argb: "FFFFFFFF" } },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF555555" },
        },
        alignment: { vertical: "middle", horizontal: "left" },
      },
    };

    // Заголовки
    const headers = displayColumns.map((col) => {
      if (col === "Status") return "Статус";
      if (col === "ChangeType") return "Тип изменения";
      return columnLabels[col] || col;
    });

    worksheet.addRow(headers);
    worksheet.getRow(1).height = 20;
    worksheet.getRow(1).eachCell((cell) => {
      Object.assign(cell, styles.header);
    });

    // Добавляем строки
    filteredRows.forEach((row) => {
      const rowData = displayColumns.map((col) => {
        if (col === "Status") {
          if (row.source === "new") return "НОВАЯ";
          if (row.source === "deleted") return "УДАЛЕНА";
          return { old: "БЫЛО", new: "СТАЛО", deleted: "УДАЛЕНА" }[row.type];
        }

        if (col === "ChangeType") {
          if (row.source === "new") return "Новая запись";
          if (row.source === "deleted") return "Запись удалена";
          if (row.type === "new") {
            const oldRow = allRows.find(
              (r) => r.type === "old" && r.rm === row.rm,
            );
            if (!oldRow) return "Изменено";
            const changedFields = requiredColumns.filter(
              (key) =>
                JSON.stringify(oldRow.data[key]) !==
                JSON.stringify(row.data[key]),
            );
            if (changedFields.length === 0) return "Без изменений";

            const sortedFields = [...changedFields].sort((a) =>
              a === "Column 39" ? -1 : 1,
            );
            return sortedFields
              .map((key) => {
                const label = columnLabels[key];
                const oldValue = oldRow.data[key];
                const newValue = row.data[key];
                const oldStr = oldValue == null ? "—" : String(oldValue);
                const newStr = newValue == null ? "—" : String(newValue);
                if (key === "Column 39") {
                  return `${label}: "${oldStr}" → "${newStr}"`;
                }
                return `${label}: ${newStr}`;
              })
              .join(", ");
          }
          return "—";
        }

        const value = row.data[col];
        if (value == null || value === "" || value === "null") return "—";
        return String(value);
      });

      const excelRow = worksheet.addRow(rowData);

      // Применяем стили
      if (row.source === "new") {
        excelRow.eachCell((cell) => Object.assign(cell, styles.added));
      } else if (row.source === "deleted") {
        excelRow.eachCell((cell) => Object.assign(cell, styles.deleted));
      } else if (row.type === "old") {
        excelRow.eachCell((cell) => Object.assign(cell, styles.old));
      } else if (row.type === "new") {
        excelRow.eachCell((cell) => Object.assign(cell, styles.new));
      }
    });

    // Автоподбор ширины
    worksheet.columns.forEach((column, i) => {
      const maxLength = Math.max(
        headers[i].length,
        ...filteredRows.map((row) => {
          const value = row.data[displayColumns[i]] || "";
          return String(value).length;
        }),
        10,
      );
      column.width = Math.min(maxLength + 2, 50);
    });

    // Экспорт
    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `сравнение_РМ_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <>
      <WorkplaceInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
      <div
        className={`workplace-compare-page ${
          fullscreen ? "workplace-fullscreen" : ""
        }`}
      >
        <div className="workplace-compare-container">
          {!fullscreen && (
            <div className="workplace-compare-header">
              <div className="header-content">
                <Link to="/" className="home-button">
                  🏠 На главную
                </Link>
                <h1>Сравнение Excel-файлов по рабочим местам</h1>
              </div>
              <button
                className="instructions-button home-button"
                onClick={() => setShowInstructions(true)}
              >
                📚 Инструкция
              </button>
            </div>
          )}

          <div className="workplace-upload-section">
            {/* Левый блок - старый файл */}
            <div
              className={`workplace-upload-box file1 ${
                firstFile ? "file-loaded" : ""
              } ${dragOverFirst ? "drag-over" : ""}`}
              onDragOver={(e) => handleDragOver(e, setDragOverFirst)}
              onDragLeave={(e) => handleDragLeave(e, setDragOverFirst)}
              onDrop={(e) => handleDrop(e, setFirstFile, setDragOverFirst)}
            >
              <div className="workplace-upload-icon">
                {firstFile ? "✅" : "📄"}
              </div>
              <h3>{firstFile ? "✅ Первый документ" : "📄 Первый документ"}</h3>

              {firstFile ? (
                <div className="workplace-file-info">
                  <div className="workplace-file-name">{firstFile.name}</div>
                  <div className="workplace-file-size">
                    {(firstFile.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              ) : (
                <div className="workplace-file-placeholder">
                  {dragOverFirst ? (
                    "Отпустите файл здесь"
                  ) : (
                    <>
                      Загрузите исходную версию документа
                      <small>или перетащите файл в эту область</small>
                    </>
                  )}
                </div>
              )}

              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={(e) => handleFileChange(e, setFirstFile)}
                className="workplace-file-input"
                id="first-file"
              />
              <div className="workplace-file-actions">
                <label
                  htmlFor="first-file"
                  className="workplace-btn workplace-btn-file1"
                >
                  📎 {firstFile ? "Заменить файл" : "Выбрать файл"}
                </label>
                {firstFile && (
                  <button
                    onClick={() => setFirstFile(null)}
                    className="workplace-btn workplace-btn-danger"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Центральный блок с кнопками */}
            <div className="workplace-actions-center">
              <button
                onClick={handleUpload}
                disabled={loading || !firstFile || !secondFile}
                className="workplace-btn workplace-btn-primary workplace-btn-compare"
              >
                {loading ? (
                  <>
                    <span>⏳</span>
                    Обработка...
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    Сравнить файлы
                  </>
                )}
              </button>

              {/* Дополнительная кнопка очистки */}
              <button
                onClick={() => {
                  setFirstFile(null);
                  setSecondFile(null);
                  setDiffData([]);
                }}
                disabled={!firstFile && !secondFile}
                className="workplace-btn workplace-btn-clear"
              >
                <span>🗑️</span>
                Очистить всё
              </button>
            </div>

            {/* Правый блок - новый файл */}
            <div
              className={`workplace-upload-box file2 ${
                secondFile ? "file-loaded" : ""
              } ${dragOverSecond ? "drag-over" : ""}`}
              onDragOver={(e) => handleDragOver(e, setDragOverSecond)}
              onDragLeave={(e) => handleDragLeave(e, setDragOverSecond)}
              onDrop={(e) => handleDrop(e, setSecondFile, setDragOverSecond)}
            >
              <div className="workplace-upload-icon">
                {secondFile ? "✅" : "📊"}
              </div>
              <h3>
                {secondFile ? "✅ Второй документ" : "📊 Второй документ"}
              </h3>

              {secondFile ? (
                <div className="workplace-file-info">
                  <div className="workplace-file-name">{secondFile.name}</div>
                  <div className="workplace-file-size">
                    {(secondFile.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              ) : (
                <div className="workplace-file-placeholder">
                  {dragOverSecond ? (
                    "✨ Отпустите файл здесь"
                  ) : (
                    <>
                      Загрузите обновленную версию документа
                      <small>или перетащите файл в эту область</small>
                    </>
                  )}
                </div>
              )}

              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={(e) => handleFileChange(e, setSecondFile)}
                className="workplace-file-input"
                id="second-file"
              />
              <div className="workplace-file-actions">
                <label
                  htmlFor="second-file"
                  className="workplace-btn workplace-btn-file2"
                >
                  📎 {secondFile ? "Заменить файл" : "Выбрать файл"}
                </label>
                {secondFile && (
                  <button
                    onClick={() => setSecondFile(null)}
                    className="workplace-btn workplace-btn-danger"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Фильтры */}
          {diffData.length > 0 && (
            <div className="workplace-filters-panel">
              {/* Заголовок и кнопки управления */}
              <div className="workplace-filters-header">
                <div className="workplace-filters-title">
                  <h3>Фильтры</h3>
                  <div className="workplace-filters-badges">
                    <span className="workplace-filter-badge">
                      {filteredRows.length} строк
                    </span>
                    {isChangeFilterActive && (
                      <span className="workplace-filter-badge active">
                        Фильтр по изменениям
                      </span>
                    )}
                  </div>
                </div>

                <div className="workplace-filters-actions">
                  <button
                    onClick={resetFilters}
                    className="workplace-filter-action-btn"
                  >
                    <span>🔄</span>
                    Сбросить всё
                  </button>

                  <button
                    onClick={handleExport}
                    className="workplace-filter-action-btn export"
                  >
                    <span>📥</span>
                    Excel
                  </button>

                  <button
                    onClick={toggleFullscreen}
                    className={`workplace-filter-action-btn ${
                      fullscreen ? "fullscreen" : ""
                    }`}
                  >
                    <span>{fullscreen ? "📱" : "🖥️"}</span>
                    {fullscreen ? "Выйти" : "Полный экран"}
                  </button>
                </div>
              </div>

              {/* Основные фильтры в колонках */}
              <div className="workplace-filters-grid">
                {/* Колонка 1: Статус и основные фильтры */}
                <div className="workplace-filter-group">
                  <h4>Статус записи</h4>
                  <div className="workplace-filter-options">
                    {(["БЫЛО", "СТАЛО", "НОВАЯ", "УДАЛЕНА"] as const).map(
                      (status) => (
                        <label key={status} className="workplace-filter-option">
                          <input
                            type="checkbox"
                            checked={filters.status.has(status)}
                            onChange={(e) => {
                              const newSet = new Set(filters.status);
                              e.target.checked
                                ? newSet.add(status)
                                : newSet.delete(status);
                              setFilters((prev) => ({
                                ...prev,
                                status: newSet,
                              }));
                            }}
                          />
                          <span
                            className={`workplace-filter-label workplace-status-badge ${
                              status === "БЫЛО"
                                ? "old"
                                : status === "СТАЛО"
                                  ? "new"
                                  : status === "НОВАЯ"
                                    ? "added"
                                    : "deleted"
                            }`}
                          >
                            {status}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>

                {/* Колонка 2: Типы изменений */}
                {uniqueChangeTypes.length > 0 && (
                  <div className="workplace-filter-group">
                    <h4>Измененные поля</h4>
                    <div className="workplace-filter-options">
                      {uniqueChangeTypes.map((type) => (
                        <label key={type} className="workplace-filter-option">
                          <input
                            type="checkbox"
                            checked={filters.changeType.has(type)}
                            onChange={(e) => {
                              const newSet = new Set(filters.changeType);
                              e.target.checked
                                ? newSet.add(type)
                                : newSet.delete(type);
                              setFilters((prev) => ({
                                ...prev,
                                changeType: newSet,
                              }));
                            }}
                          />
                          <span
                            className={`workplace-filter-label workplace-filter-tag ${
                              type === "Признак" ? "highlight" : ""
                            }`}
                          >
                            {type}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Колонка 3: Локация */}
                <div className="workplace-filter-group">
                  {/* Адрес */}
                  {uniqueAddresses.length > 0 && (
                    <div>
                      <h4>Адрес</h4>
                      <div className="workplace-filter-options">
                        {uniqueAddresses.slice(0, 10).map((addr) => (
                          <label key={addr} className="workplace-filter-option">
                            <input
                              type="checkbox"
                              checked={filters.address.has(String(addr))}
                              onChange={(e) => {
                                const newSet = new Set(filters.address);
                                e.target.checked
                                  ? newSet.add(String(addr))
                                  : newSet.delete(String(addr));
                                setFilters((prev) => ({
                                  ...prev,
                                  address: newSet,
                                }));
                              }}
                            />
                            <span className="workplace-filter-label">
                              {addr}
                            </span>
                          </label>
                        ))}
                        {uniqueAddresses.length > 10 && (
                          <div className="workplace-text-gray-500">
                            +{uniqueAddresses.length - 10} адресов
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Город */}
                  {uniqueCities.length > 0 && (
                    <div>
                      <h4>Город</h4>
                      <div className="workplace-filter-options">
                        {uniqueCities.map((city) => (
                          <label key={city} className="workplace-filter-option">
                            <input
                              type="checkbox"
                              checked={filters.city.has(city)}
                              onChange={(e) => {
                                const newSet = new Set(filters.city);
                                e.target.checked
                                  ? newSet.add(city)
                                  : newSet.delete(city);
                                setFilters((prev) => ({
                                  ...prev,
                                  city: newSet,
                                }));
                              }}
                            />
                            <span className="workplace-filter-label">
                              {city}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Колонка 4: Дополнительные параметры */}
                <div className="workplace-filter-group">
                  {/* Этаж */}
                  {uniqueFloors.length > 0 && (
                    <div>
                      <h4>Этаж</h4>
                      <div className="workplace-filter-options">
                        {uniqueFloors.map((floor) => (
                          <label
                            key={floor}
                            className="workplace-filter-option"
                          >
                            <input
                              type="checkbox"
                              checked={filters.floor.has(String(floor))}
                              onChange={(e) => {
                                const newSet = new Set(filters.floor);
                                e.target.checked
                                  ? newSet.add(String(floor))
                                  : newSet.delete(String(floor));
                                setFilters((prev) => ({
                                  ...prev,
                                  floor: newSet,
                                }));
                              }}
                            />
                            <span className="workplace-filter-label">
                              {floor}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Кол-во */}
                  {uniqueQuantities.length > 0 && (
                    <div>
                      <h4>Занятость РМ</h4>
                      <div className="workplace-filter-options">
                        {uniqueQuantities.map((qty) => (
                          <label key={qty} className="workplace-filter-option">
                            <input
                              type="checkbox"
                              checked={filters.quantity.has(qty)}
                              onChange={(e) => {
                                const newSet = new Set(filters.quantity);
                                e.target.checked
                                  ? newSet.add(qty)
                                  : newSet.delete(qty);
                                setFilters((prev) => ({
                                  ...prev,
                                  quantity: newSet,
                                }));
                              }}
                            />
                            <span className="workplace-filter-label">
                              {qty}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Специальные фильтры по Признаку */}
                  <div>
                    <h4>Изменение Признака</h4>
                    <div className="workplace-filter-options">
                      <label className="workplace-filter-option">
                        <input
                          type="checkbox"
                          checked={filters.toReserve}
                          onChange={(e) =>
                            setFilters((prev) => ({
                              ...prev,
                              toReserve: e.target.checked,
                            }))
                          }
                        />
                        <span className="workplace-filter-label workplace-filter-tag">
                          → Резерв
                        </span>
                      </label>
                      <label className="workplace-filter-option">
                        <input
                          type="checkbox"
                          checked={filters.toPartner}
                          onChange={(e) =>
                            setFilters((prev) => ({
                              ...prev,
                              toPartner: e.target.checked,
                            }))
                          }
                        />
                        <span className="workplace-filter-label workplace-filter-tag">
                          → Партнер
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Быстрые действия */}
              <div className="workplace-filters-footer">
                <div className="workplace-filters-stats">
                  <span className="workplace-text-gray-500">
                    Отображается {filteredRows.length} из {allRows.length} строк
                  </span>
                  {Object.values(filters).some((filter) =>
                    filter instanceof Set ? filter.size > 0 : filter === true,
                  )}
                </div>
                <div className="workplace-text-gray-500">
                  {diffData.length} изменений найдено
                </div>
              </div>
            </div>
          )}

          {/* Таблица */}
          {diffData.length > 0 && (
            <div className="workplace-results-container">
              <table className="workplace-results-table">
                <thead>
                  <tr>
                    {displayColumns.map((col, index) => (
                      <th
                        key={col}
                        className={`${
                          index === 0
                            ? "sticky sticky-0"
                            : index === 1
                              ? "sticky sticky-40"
                              : index === 2
                                ? "sticky sticky-120"
                                : ""
                        }`}
                        style={{
                          width:
                            index === 0
                              ? "40px"
                              : index === 1
                                ? "80px"
                                : index === 2
                                  ? "180px"
                                  : col === "ChangeType"
                                    ? "280px"
                                    : "120px",
                          minWidth: index === 0 ? "40px" : undefined,
                        }}
                      >
                        {col === "Checked"
                          ? "✅"
                          : col === "Status"
                            ? "Статус"
                            : col === "ChangeType"
                              ? "Тип изменения"
                              : columnLabels[col]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={displayColumns.length}
                        className="workplace-text-gray-500"
                        style={{ textAlign: "center", padding: "20px" }}
                      >
                        Нет данных по выбранным фильтрам.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, idx) => {
                      const nextRow = filteredRows[idx + 1];
                      const isPartOfChange =
                        row.type === "old" &&
                        nextRow &&
                        nextRow.type === "new" &&
                        row.rm === nextRow.rm;

                      return (
                        <React.Fragment key={`row-${idx}`}>
                          <tr
                            className={`
                          ${row.type === "old" ? "workplace-row-old" : ""}
                          ${
                            row.type === "new" &&
                            row.source !== "new" &&
                            row.source !== "deleted"
                              ? "workplace-row-new"
                              : ""
                          }
                          ${row.source === "new" ? "workplace-row-added" : ""}
                          ${
                            row.source === "deleted"
                              ? "workplace-row-deleted"
                              : ""
                          }
                          ${
                            checkedRows.has(row.rm)
                              ? "workplace-row-checked"
                              : ""
                          }
                        `}
                          >
                            {displayColumns.map((col, cellIndex) => {
                              // === Ключ строки (для чекбокса) ===
                              const rmKey = row.rm;

                              // === Определение значения для статуса ===
                              let displayStatus = "—";
                              if (col === "Status") {
                                if (row.source === "new") {
                                  displayStatus = "НОВАЯ";
                                } else if (row.source === "deleted") {
                                  displayStatus = "УДАЛЕНА";
                                } else {
                                  displayStatus = {
                                    old: "БЫЛО",
                                    new: "СТАЛО",
                                    deleted: "УДАЛЕНА",
                                  }[row.type];
                                }
                              }
                              const value =
                                col === "Status"
                                  ? displayStatus
                                  : row.data[col];

                              // === Логика для "Тип изменения" (только Признак) ===
                              let changeText = "—";
                              if (col === "ChangeType") {
                                if (row.source === "new") {
                                  const newVal = row.data["Column 39"];
                                  if (
                                    newVal != null &&
                                    String(newVal).trim() !== "" &&
                                    String(newVal).trim() !== "null"
                                  ) {
                                    changeText = `Признак: → "${renderValue(
                                      newVal,
                                    )}"`;
                                  }
                                } else if (row.source === "deleted") {
                                  const oldVal = row.data["Column 39"];
                                  if (
                                    oldVal != null &&
                                    String(oldVal).trim() !== "" &&
                                    String(oldVal).trim() !== "null"
                                  ) {
                                    changeText = `Признак: "${renderValue(
                                      oldVal,
                                    )}" →`;
                                  }
                                } else if (row.type === "new") {
                                  // Это "СТАЛО" — ищем парную "БЫЛО"
                                  const oldRow = allRows.find(
                                    (r) => r.type === "old" && r.rm === row.rm,
                                  );
                                  if (oldRow) {
                                    const oldVal = oldRow.data["Column 39"];
                                    const newVal = row.data["Column 39"];
                                    const oldStr = String(oldVal).trim();
                                    const newStr = String(newVal).trim();

                                    const hasOld =
                                      oldVal != null &&
                                      oldStr !== "" &&
                                      oldStr !== "null";
                                    const hasNew =
                                      newVal != null &&
                                      newStr !== "" &&
                                      newStr !== "null";

                                    if (hasOld && hasNew) {
                                      if (oldStr !== newStr) {
                                        changeText = `Признак: "${renderValue(
                                          oldVal,
                                        )}" → "${renderValue(newVal)}"`;
                                      } else {
                                        changeText = `Признак: "${renderValue(
                                          newVal,
                                        )}"`;
                                      }
                                    } else if (hasOld) {
                                      changeText = `Признак: "${renderValue(
                                        oldVal,
                                      )}" →`;
                                    } else if (hasNew) {
                                      changeText = `Признак: → "${renderValue(
                                        newVal,
                                      )}"`;
                                    }
                                  } else {
                                    // Нет "БЫЛО" — возможно, ошибка, но можно оставить
                                    const newVal = row.data["Column 39"];
                                    if (
                                      newVal != null &&
                                      String(newVal).trim() !== ""
                                    ) {
                                      changeText = `Признак: → "${renderValue(
                                        newVal,
                                      )}"`;
                                    }
                                  }
                                }
                              }

                              // === Подсветка изменений (только если не в режиме фильтрации по изменениям) ===
                              const isChangeFilterActive =
                                filters.changeType.size > 0 ||
                                filters.toReserve ||
                                filters.toPartner;

                              const isChanged =
                                !isPartOfChange &&
                                row.type === "new" &&
                                col !== "Status" &&
                                col !== "ChangeType";
                              const oldValue = allRows[idx - 1]?.data[col];
                              const newValue = row.data[col];
                              const fieldChanged =
                                isChanged &&
                                row.type === "new" &&
                                oldValue !== undefined &&
                                JSON.stringify(oldValue) !==
                                  JSON.stringify(newValue);

                              // === Жирное выделение при фильтрации по изменениям ===
                              const shouldHighlightBold =
                                isChangeFilterActive && row.type === "new";

                              let isTargetField = false;
                              if (
                                shouldHighlightBold &&
                                col !== "Status" &&
                                col !== "ChangeType" &&
                                col !== "Checked"
                              ) {
                                if (
                                  row.source === "new" ||
                                  row.source === "deleted"
                                ) {
                                  // skip
                                } else {
                                  const oldRow = allRows[idx - 1];
                                  if (
                                    oldRow &&
                                    oldRow.type === "old" &&
                                    oldRow.rm === row.rm
                                  ) {
                                    isTargetField =
                                      JSON.stringify(oldRow.data[col]) !==
                                      JSON.stringify(row.data[col]);
                                  }
                                }
                              }

                              // === Определяем, отмечена ли строка ===
                              const isChecked = checkedRows.has(rmKey);

                              return (
                                <td
                                  key={`cell-${col}`}
                                  className={`
                                  ${
                                    cellIndex === 0
                                      ? "sticky sticky-0 workplace-cell-checkbox"
                                      : ""
                                  }
                                  ${
                                    cellIndex === 1
                                      ? "sticky sticky-40 workplace-cell-status"
                                      : ""
                                  }
                                  ${cellIndex === 2 ? "sticky sticky-120" : ""}
                                  ${
                                    fieldChanged && !isChangeFilterActive
                                      ? "workplace-cell-highlight"
                                      : ""
                                  }
                                  ${
                                    isTargetField
                                      ? "workplace-cell-target workplace-font-bold"
                                      : ""
                                  }
                                  ${
                                    col === "ChangeType"
                                      ? "workplace-cell-changetype workplace-italic"
                                      : ""
                                  }
                                  ${isChecked ? "workplace-line-through" : ""}
                                `}
                                  style={{
                                    width:
                                      cellIndex === 0
                                        ? "40px"
                                        : cellIndex === 1
                                          ? "80px"
                                          : cellIndex === 2
                                            ? "180px"
                                            : col === "ChangeType"
                                              ? "280px"
                                              : "120px",
                                    minWidth:
                                      cellIndex === 0 ? "40px" : undefined,
                                  }}
                                >
                                  {col === "Checked" ? (
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        setCheckedRows((prev) => {
                                          const newSet = new Set(prev);
                                          if (newSet.has(rmKey)) {
                                            newSet.delete(rmKey);
                                          } else {
                                            newSet.add(rmKey);
                                          }
                                          return newSet;
                                        });
                                      }}
                                      className="workplace-checkbox"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : col === "ChangeType" ? (
                                    changeText
                                  ) : (
                                    renderValue(value)
                                  )}
                                </td>
                              );
                            })}
                          </tr>

                          {/* Отступ после пары БЫЛО+СТАЛО */}
                          {isPartOfChange && (
                            <tr>
                              <td
                                colSpan={displayColumns.length}
                                className="workplace-row-spacer"
                              ></td>
                            </tr>
                          )}

                          {/* Отступ после одиночной строки */}
                          {!isPartOfChange && (
                            <tr>
                              <td
                                colSpan={displayColumns.length}
                                className="workplace-row-spacer"
                              ></td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Нет данных */}
          {!loading && diffData.length === 0 && (
            <div className="workplace-alert workplace-alert-info">
              <div className="workplace-alert-icon">💡</div>
              <div className="workplace-alert-content">
                Загрузите два файла для сравнения.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
