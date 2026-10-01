import React, { useState, useCallback, useEffect } from "react";
import InstructionsModalShell from "../../components/InstructionsModal";
import PageShell from "../../components/PageShell";
import { parseDocx, type WordDocModel } from "./wordCompare";
import WordCompareView from "./word/WordCompareView";

import { isLegacyOfficeFile, LEGACY_XLS_MESSAGE } from "../../utils/excelCell";
import { parseExcelInWorker } from "../../utils/parseExcelInWorker";
import type { ExcelSheet } from "../../types/sheet.types";
import ExcelCompareView from "./excel/ExcelCompareView";

import "./ComparePage.css";

// Интерфейсы для Word документов
interface WordParagraph {
  id: number;
  text: string;
  originalIndex: number;
  hash: string;
}

interface WordTable {
  id: number;
  rows: WordRow[];
  originalIndex: number;
}

interface WordRow {
  cells: WordCell[];
}

interface WordCell {
  text: string;
  rowIndex: number;
  colIndex: number;
}

interface WordDocumentData {
  paragraphs: WordParagraph[];
  tables: WordTable[];
  fullText: string;
  /** Структурная модель документа (абзацы + таблицы в порядке следования). */
  model: WordDocModel;
}

interface SheetData {
  name: string;
  data: any[][];
  rowCount: number;
  colCount: number;
  type: "excel" | "word";
  wordData?: WordDocumentData;
  excel?: ExcelSheet;
}

const ComparePage: React.FC = () => {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [sheets1, setSheets1] = useState<SheetData[]>([]);
  const [sheets2, setSheets2] = useState<SheetData[]>([]);
  const [selectedSheet1, setSelectedSheet1] = useState<number>(0);
  const [selectedSheet2, setSelectedSheet2] = useState<number>(0);
  const [excelPair, setExcelPair] = useState<{
    a: ExcelSheet;
    b: ExcelSheet;
  } | null>(null);
  const [wordPair, setWordPair] = useState<{
    a: WordDocModel;
    b: WordDocModel;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullScreenMode, setFullScreenMode] = useState<boolean>(false);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const [fileType1, setFileType1] = useState<"excel" | "word" | null>(null);
  const [fileType2, setFileType2] = useState<"excel" | "word" | null>(null);

  // Результат сравнения Excel относится к конкретной паре листов —
  // при смене файла или листа он устаревает.
  useEffect(() => {
    setExcelPair(null);
    setWordPair(null);
  }, [sheets1, sheets2, selectedSheet1, selectedSheet2]);

  const [dragOverFirst, setDragOverFirst] = useState(false);
  const [dragOverSecond, setDragOverSecond] = useState(false);

  // === Drag & Drop handlers ===
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

  // Определяем тип файла по расширению
  const getFileType = (fileName: string): "excel" | "word" => {
    const ext = fileName.toLowerCase().split(".").pop();
    if (ext === "docx" || ext === "doc") {
      return "word";
    }
    return "excel";
  };

  // Генерация хэша для параграфа
  const generateHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  };

  // Функция для загрузки Word документа
  const loadWordDocument = async (file: File): Promise<WordDocumentData> => {
    const arrayBuffer = await file.arrayBuffer();
    if (isLegacyOfficeFile(arrayBuffer)) {
      throw new Error(
        "файл в старом формате .doc (Word 97–2003). Откройте его в Word и сохраните как .docx.",
      );
    }

    // Структурный разбор .docx: абзацы и таблицы в порядке следования.
    const model = await parseDocx(arrayBuffer);

    // Для обратной совместимости с параллельным просмотром строим также
    // плоские списки абзацев и таблиц.
    const paragraphs: WordParagraph[] = [];
    const tables: WordTable[] = [];
    let paraId = 1;
    let tableId = 1;
    const fullTextParts: string[] = [];

    model.blocks.forEach((block) => {
      if (block.kind === "paragraph") {
        paragraphs.push({
          id: paraId,
          text: block.text,
          originalIndex: paraId - 1,
          hash: generateHash(block.text.trim()),
        });
        paraId++;
        fullTextParts.push(block.text);
      } else {
        const rows: WordRow[] = block.rows.map((cells, rowIndex) => ({
          cells: cells.map((text, colIndex) => ({
            text,
            rowIndex,
            colIndex,
          })),
        }));
        tables.push({ id: tableId, rows, originalIndex: tableId - 1 });
        tableId++;
        block.rows.forEach((r) => fullTextParts.push(r.join("\t")));
      }
    });

    return {
      paragraphs,
      tables,
      fullText: fullTextParts.join("\n"),
      model,
    };
  };

  // Конвертация Word документа в SheetData
  const wordToSheetData = (
    wordData: WordDocumentData,
    fileName: string,
  ): SheetData[] => {
    const sheets: SheetData[] = [];

    // Создаем лист для общего текста
    sheets.push({
      name: "Текст документа",
      data: wordData.fullText.split("\n").map((line, i) => [line]),
      rowCount: wordData.fullText.split("\n").length,
      colCount: 1,
      type: "word",
      wordData,
    });

    // Создаем отдельные листы для таблиц, если они есть
    if (wordData.tables.length > 0) {
      wordData.tables.forEach((table, tableIndex) => {
        const data: any[][] = [];
        const maxCols = Math.max(...table.rows.map((row) => row.cells.length));

        table.rows.forEach((row, rowIndex) => {
          data[rowIndex] = [];
          row.cells.forEach((cell) => {
            data[rowIndex][cell.colIndex] = cell.text;
          });
        });

        sheets.push({
          name: `Таблица ${tableIndex + 1}`,
          data,
          rowCount: table.rows.length,
          colCount: maxCols,
          type: "word",
          wordData,
        });
      });
    }

    return sheets;
  };

  // Обновленная функция загрузки файлов
  const loadFileSheets = async (
    file: File,
    fileType: "excel" | "word",
  ): Promise<SheetData[]> => {
    if (fileType === "word") {
      try {
        const wordData = await loadWordDocument(file);
        return wordToSheetData(wordData, file.name);
      } catch (err: any) {
        throw new Error(`Ошибка при чтении Word документа: ${err.message}`);
      }
    } else {
      const arrayBuffer = await file.arrayBuffer();
      if (isLegacyOfficeFile(arrayBuffer)) {
        throw new Error(LEGACY_XLS_MESSAGE);
      }
      // Разбор в Web Worker: большие файлы больше не замораживают страницу.
      const excelSheets = await parseExcelInWorker(arrayBuffer);
      return excelSheets.map((sheet) => ({
        name: sheet.name,
        data: [],
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
        type: "excel" as const,
        excel: sheet,
      }));
    }
  };

  const handleDrop = useCallback(
    (
      e: React.DragEvent,
      fileSetter: React.Dispatch<React.SetStateAction<File | null>>,
      sheetSetter: React.Dispatch<React.SetStateAction<SheetData[]>>,
      selectedSetter: React.Dispatch<React.SetStateAction<number>>,
      fileTypeSetter: React.Dispatch<
        React.SetStateAction<"excel" | "word" | null>
      >,
      setDragState: React.Dispatch<React.SetStateAction<boolean>>,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const fileName = file.name.toLowerCase();

        // Проверяем, что это поддерживаемый формат
        if (
          fileName.endsWith(".xlsx") ||
          fileName.endsWith(".xls") ||
          fileName.endsWith(".docx") ||
          fileName.endsWith(".doc")
        ) {
          const fileType = getFileType(file.name);
          fileSetter(file);
          fileTypeSetter(fileType);
          setLoading(true);

          loadFileSheets(file, fileType)
            .then((sheets) => {
              sheetSetter(sheets);
              selectedSetter(0);
              setError(null);
            })
            .catch((err: any) => {
              setError(`Ошибка при чтении файла: ${err.message}`);
              sheetSetter([]);
              fileTypeSetter(null);
            })
            .finally(() => {
              setLoading(false);
            });
        } else {
          alert(
            "Пожалуйста, перетащите файл Excel (.xlsx, .xls) или Word (.docx, .doc)",
          );
        }
      }
    },
    [loadFileSheets, getFileType],
  );

  // Обновленный обработчик файлов
  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fileSetter: React.Dispatch<React.SetStateAction<File | null>>,
    sheetSetter: React.Dispatch<React.SetStateAction<SheetData[]>>,
    selectedSetter: React.Dispatch<React.SetStateAction<number>>,
    fileTypeSetter: React.Dispatch<
      React.SetStateAction<"excel" | "word" | null>
    >,
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      const fileType = getFileType(selectedFile.name);

      fileSetter(selectedFile);
      fileTypeSetter(fileType);
      setLoading(true);

      try {
        const sheets = await loadFileSheets(selectedFile, fileType);
        sheetSetter(sheets);
        selectedSetter(0);
        setError(null);
      } catch (err: any) {
        setError(`Ошибка при чтении файла: ${err.message}`);
        sheetSetter([]);
        fileTypeSetter(null);
      } finally {
        setLoading(false);
      }
    } else {
      fileSetter(null);
      sheetSetter([]);
      fileTypeSetter(null);
    }
  };

  const compareFiles = () => {

    if (sheets1.length === 0 || sheets2.length === 0) {
      setError("Пожалуйста, загрузите оба файла.");
      return;
    }

    const sheetData1 = sheets1[selectedSheet1];
    const sheetData2 = sheets2[selectedSheet2];

    if (!sheetData1 || !sheetData2) {
      setError("Выбранный лист недоступен.");
      return;
    }

    // Проверяем, совместимы ли типы файлов для сравнения
    if (sheetData1.type !== sheetData2.type) {
      setError("Невозможно сравнить файлы разных типов (Excel vs Word).");
      return;
    }

    // Для Word документов используем специальное сравнение
    if (
      sheetData1.type === "word" &&
      sheetData1.wordData &&
      sheetData2.wordData
    ) {
      // Само сравнение и фильтры — в WordCompareView.
      setWordPair({ a: sheetData1.wordData.model, b: sheetData2.wordData.model });
      setExcelPair(null);
      return;
    }

    // Excel: само сравнение и фильтры — в ExcelCompareView.
    if (sheetData1.excel && sheetData2.excel) {
      setWordPair(null);
      setExcelPair({ a: sheetData1.excel, b: sheetData2.excel });
    }
  };

  const clearAll = () => {
    setFile1(null);
    setFile2(null);
    setSheets1([]);
    setSheets2([]);
    setSelectedSheet1(0);
    setSelectedSheet2(0);
    setExcelPair(null);
    setWordPair(null);
    setError(null);
    setFullScreenMode(false);
    setFileType1(null);
    setFileType2(null);
  };

  // Отображение Word документа
  const renderWordDocument = (
    wordData: WordDocumentData,
    fileType: "file1" | "file2",
  ) => {
    if (!wordData) return null;

    return (
      <div className="word-document-view">
        <div className="word-document-header">
          <h3>{fileType === "file1" ? "📄 Файл 1" : "📄 Файл 2"}</h3>
          <div className="word-stats">
            <span className="stat-item">
              📝 Параграфов: {wordData.paragraphs.length}
            </span>
            <span className="stat-item">
              📊 Таблиц: {wordData.tables.length}
            </span>
            <span className="stat-item">
              📏 Символов: {wordData.fullText.length}
            </span>
          </div>
        </div>

        <div className="word-content">
          {/* Параграфы */}
          <div className="word-section">
            <h4 className="word-section-title">Параграфы:</h4>
            <div className="paragraphs-list">
              {wordData.paragraphs.length > 0 ? (
                wordData.paragraphs.map((para, index) => (
                  <div key={para.id} className="paragraph-item">
                    <div className="paragraph-number">#{index + 1}</div>
                    <div className="paragraph-text">{para.text}</div>
                  </div>
                ))
              ) : (
                <div className="no-content">Нет параграфов</div>
              )}
            </div>
          </div>

          {/* Таблицы */}
          <div className="word-section">
            <h4 className="word-section-title">Таблицы:</h4>
            <div className="tables-list">
              {wordData.tables.length > 0 ? (
                wordData.tables.map((table, index) => (
                  <div key={table.id} className="table-item">
                    <div className="table-header">
                      <span className="table-number">Таблица #{index + 1}</span>
                      <span className="table-size">
                        ({table.rows.length} строк)
                      </span>
                    </div>
                    <div className="table-preview">
                      <table className="word-table-preview">
                        <tbody>
                          {table.rows.slice(0, 3).map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {row.cells.slice(0, 4).map((cell, cellIndex) => (
                                <td key={cellIndex} title={cell.text}>
                                  {cell.text.length > 20
                                    ? cell.text.substring(0, 20) + "..."
                                    : cell.text}
                                </td>
                              ))}
                              {row.cells.length > 4 && (
                                <td className="more-cells">...</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {table.rows.length > 3 && (
                        <div className="table-more">
                          ... и ещё {table.rows.length - 3} строк
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="no-content">Нет таблиц</div>
              )}
            </div>
          </div>

          {/* Полный текст */}
          <div className="word-section">
            <h4 className="word-section-title">Полный текст:</h4>
            <div className="full-text-preview">
              {wordData.fullText.length > 500
                ? wordData.fullText.substring(0, 500) + "..."
                : wordData.fullText}
              {wordData.fullText.length > 500 && (
                <div className="text-truncated">
                  (текст сокращён, всего {wordData.fullText.length} символов)
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const InstructionsModal: React.FC = () => (
    <InstructionsModalShell
      isOpen={showInstructions}
      onClose={() => setShowInstructions(false)}
      title="📋 Инструкция по использованию Compare Files"
      footerLabel="Понятно! Начать работу!"
      maxWidth={820}
    >
      <div className="instructions-section">
        <h3>🎯 Что такое Compare Files?</h3>
        <p>
          Compare Files - это мощный инструмент для точного сравнения Excel и
          Word файлов. Для Word документов используется специальный режим
          сравнения с анализом параграфов и таблиц.
        </p>
      </div>

      <div className="instructions-section">
        <h3>📝 Поддерживаемые форматы</h3>
        <p>
          <strong>Excel файлы:</strong>
        </p>
        <ul>
          <li>.xlsx (Excel Workbook)</li>
          <li>
            .xls (Excel 97-2003) — пересохраните в .xlsx: Файл → Сохранить как
          </li>
          <li>Сравнение по ячейкам с подсветкой</li>
        </ul>

        <p>
          <strong>Word файлы:</strong>
        </p>
        <ul>
          <li>.docx (Word Document)</li>
          <li>.doc (Word 97-2003) — пересохраните в .docx</li>
          <li>Сравнение параграфов и таблиц</li>
          <li>Детальный анализ различий</li>
        </ul>
      </div>

      <div className="instructions-section">
        <h3>🔎 Фильтры сравнения Excel</h3>
        <ul>
          <li>
            <strong>Тип изменения:</strong> изменено, добавлено (ячейка была
            пустой), удалено (ячейка стала пустой) — включайте и выключайте
          </li>
          <li>
            <strong>Колонка и поиск:</strong> оставьте различия только в одной
            колонке или найдите значение / адрес ячейки (например, B12)
          </li>
          <li>
            <strong>Только строки с различиями:</strong> одинаковые строки
            скрываются, можно скрыть и колонки без различий
          </li>
          <li>
            <strong>Без учёта регистра / лишних пробелов:</strong> «Москва» и
            « МОСКВА » считаются одинаковыми
          </li>
          <li>
            <strong>Навигация:</strong> кнопки «Предыдущее / Следующее» или
            клик по строке в списке различий прокручивают обе таблицы к ячейке
          </li>
        </ul>
      </div>

      <div className="instructions-section">
        <h3>🔄 Режимы сравнения Word</h3>
        <ul>
          <li>
            <strong>Сравнение параграфов:</strong> Анализ каждого параграфа по
            отдельности
          </li>
          <li>
            <strong>Сравнение таблиц:</strong> Проверка наличия и содержания
            таблиц
          </li>
          <li>
            <strong>Параллельный просмотр:</strong> Side-by-side отображение
            обоих документов
          </li>
          <li>
            <strong>Детальная таблица:</strong> Поэлементное сравнение с
            указанием статуса
          </li>
        </ul>
      </div>

      <div className="instructions-section">
        <h3>🎨 Особенности Word сравнения</h3>
        <ul>
          <li>
            <strong>Интеллектуальное разбиение:</strong> Автоматическое
            определение параграфов и таблиц
          </li>
          <li>
            <strong>Цветовая кодировка:</strong> Различия подсвечиваются
            красным, идентичные элементы - зеленым
          </li>
          <li>
            <strong>Статистика:</strong> Отображение количества параграфов,
            таблиц и символов
          </li>
          <li>
            <strong>Предпросмотр:</strong> Возможность увидеть содержимое каждого
            документа
          </li>
          <li>
            <strong>Фильтры:</strong> статус (изменено, добавлено, удалено,
            без изменений), только абзацы или только таблицы, поиск по тексту
            и месту («Абзац 12»)
          </li>
          <li>
            <strong>Параметры сравнения:</strong> без учёта регистра,
            игнорировать нумерацию пунктов (после вставки пункта остальные не
            считаются изменёнными) и пунктуацию
          </li>
          <li>
            <strong>Навигация:</strong> кнопки «Предыдущее / Следующее»
            переходят между различиями
          </li>
        </ul>
      </div>
    </InstructionsModalShell>
  );

  const FullScreenModal = () => {
    if (!fullScreenMode) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setFullScreenMode(false);
      }
    };

    const sheetData1 = sheets1[selectedSheet1];
    const sheetData2 = sheets2[selectedSheet2];

    return (
      <div className="full-screen-modal" onClick={handleBackdropClick}>
        <div className="full-screen-modal-content">
          <div className="full-screen-modal-header">
            <div className="full-screen-modal-title">
              <h2>Полноэкранный просмотр</h2>
              <span className="file-type-indicator">
                {fileType1 === "word" ? "📝 Word документы" : "📄 Excel файлы"}
              </span>
            </div>
            <button
              className="btn btn-close-fullscreen"
              onClick={() => setFullScreenMode(false)}
            >
              ✕ Закрыть
            </button>
          </div>

          <div className="full-screen-modal-body">
            {fileType1 === "word" &&
            sheetData1?.wordData &&
            sheetData2?.wordData ? (
              <div className="side-by-side full-screen">
                <div className="word-preview full-screen-preview">
                  <div className="word-preview-header">
                    <h3 style={{ color: "#3b82f6" }}>Файл 1</h3>
                    <span className="file-title file1">📝 {file1?.name}</span>
                  </div>
                  {renderWordDocument(sheetData1.wordData, "file1")}
                </div>

                <div className="word-preview full-screen-preview">
                  <div className="word-preview-header">
                    <h3 style={{ color: "#10b981" }}>Файл 2</h3>
                    <span className="file-title file2">📝 {file2?.name}</span>
                  </div>
                  {renderWordDocument(sheetData2.wordData, "file2")}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  // Компонент для отображения загрузки файлов
  const renderFileInput = (
    file: File | null,
    fileType: "excel" | "word" | null,
    sheets: SheetData[],
    selectedSheet: number,
    fileNumber: 1 | 2,
    fileSetter: React.Dispatch<React.SetStateAction<File | null>>,
    sheetSetter: React.Dispatch<React.SetStateAction<SheetData[]>>,
    selectedSetter: React.Dispatch<React.SetStateAction<number>>,
    fileTypeSetter: React.Dispatch<
      React.SetStateAction<"excel" | "word" | null>
    >,
    dragOver: boolean,
    onDragOver: (e: React.DragEvent) => void,
    onDragLeave: (e: React.DragEvent) => void,
    onDrop: (e: React.DragEvent) => void,
  ) => {
    const fileId = `file${fileNumber}`;
    const acceptTypes = ".xlsx, .xls, .docx, .doc";

    return (
      <div
        className={`upload-box file${fileNumber} ${file ? "file-loaded" : ""} ${fileType || ""} ${dragOver ? "drag-over" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="upload-icon">{fileType === "word" ? "📝" : "📄"}</div>
        <h3>
          {file ? `✅ Файл ${fileNumber}` : `Файл ${fileNumber}`}
          {fileType && (
            <span className="file-type-badge">
              {fileType === "word" ? "Word" : "Excel"}
            </span>
          )}
        </h3>

        {file ? (
          <div className="file-info">
            <div className="file-name">{file.name}</div>
            <div className="file-size">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
            <div className="file-type">
              Тип: {fileType === "word" ? "Word документ" : "Excel файл"}
            </div>
          </div>
        ) : (
          <div className="file-placeholder">
            {dragOver ? (
              "✨ Отпустите файл здесь"
            ) : (
              <>
                Загрузите {fileNumber === 1 ? "первый" : "второй"} файл
                <small>или перетащите файл в эту область</small>
              </>
            )}
            <div className="file-formats">
              Поддерживаемые форматы: .xlsx, .xls, .docx, .doc
            </div>
          </div>
        )}

        <input
          type="file"
          accept={acceptTypes}
          onChange={(e) =>
            handleFileChange(
              e,
              fileSetter,
              sheetSetter,
              selectedSetter,
              fileTypeSetter,
            )
          }
          className="file-input"
          id={fileId}
        />

        <div className="file-actions">
          <label htmlFor={fileId} className={`btn btn-file${fileNumber}`}>
            📎 {file ? "Заменить" : "Выбрать файл"}
          </label>
          {file && (
            <button
              onClick={() => {
                fileSetter(null);
                sheetSetter([]);
                fileTypeSetter(null);
              }}
              className="btn btn-danger"
            >
              ✕
            </button>
          )}
        </div>

        {sheets.length > 0 && (
          <div className="sheet-selector">
            <label>{fileType === "word" ? "Элемент:" : "Лист:"}</label>
            <select
              value={selectedSheet}
              onChange={(e) => selectedSetter(Number(e.target.value))}
            >
              {sheets.map((sheet, idx) => (
                <option key={idx} value={idx}>
                  {sheet.name} ({sheet.type === "word" ? "Word" : "Excel"})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <FullScreenModal />
      <InstructionsModal />

      <PageShell
        title="Сравнение Excel и Word файлов"
        subtitle={
          fileType1 === "word"
            ? "Интеллектуальное сравнение Word документов по параграфам и таблицам"
            : "Точное сравнение Excel файлов по ячейкам с визуальной подсветкой"
        }
        onShowInstructions={() => setShowInstructions(true)}
      >

          <div className="upload-section">
            {/* Файл 1 */}
            {renderFileInput(
              file1,
              fileType1,
              sheets1,
              selectedSheet1,
              1,
              setFile1,
              setSheets1,
              setSelectedSheet1,
              setFileType1,
              dragOverFirst,
              (e) => handleDragOver(e, setDragOverFirst),
              (e) => handleDragLeave(e, setDragOverFirst),
              (e) =>
                handleDrop(
                  e,
                  setFile1,
                  setSheets1,
                  setSelectedSheet1,
                  setFileType1,
                  setDragOverFirst,
                ),
            )}

            {/* Центральные кнопки */}
            <div className="actions-center">
              <button
                onClick={compareFiles}
                disabled={loading || !file1 || !file2}
                className="btn btn-primary btn-compare"
              >
                {loading ? "⏳ Сравниваем..." : "🔍 Сравнить файлы"}
              </button>

              <button
                onClick={clearAll}
                disabled={!file1 && !file2}
                className="btn btn-secondary btn-clear"
              >
                🗑️ Очистить всё
              </button>
            </div>

            {/* Файл 2 */}
            {renderFileInput(
              file2,
              fileType2,
              sheets2,
              selectedSheet2,
              2,
              setFile2,
              setSheets2,
              setSelectedSheet2,
              setFileType2,
              dragOverSecond,
              (e) => handleDragOver(e, setDragOverSecond),
              (e) => handleDragLeave(e, setDragOverSecond),
              (e) =>
                handleDrop(
                  e,
                  setFile2,
                  setSheets2,
                  setSelectedSheet2,
                  setFileType2,
                  setDragOverSecond,
                ),
            )}
          </div>

          {error && (
            <div className="alert alert-error">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <strong>Ошибка:</strong> {error}
              </div>
            </div>
          )}

          {/* Excel сравнение */}
          {excelPair && (
            <ExcelCompareView
              sheet1={excelPair.a}
              sheet2={excelPair.b}
              fileName1={file1?.name ?? "Файл 1"}
              fileName2={file2?.name ?? "Файл 2"}
            />
          )}

          {/* Word сравнение */}
          {wordPair && (
            <>
              <div className="view-mode-toggle">
                <button
                  onClick={() => setFullScreenMode(true)}
                  className="btn btn-fullscreen-small"
                >
                  📺 Просмотр документов целиком
                </button>
              </div>
              <WordCompareView model1={wordPair.a} model2={wordPair.b} />
            </>
          )}
      </PageShell>
    </>
  );
};

export default ComparePage;
