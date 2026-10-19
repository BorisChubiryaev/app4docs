import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import PageShell from "../../components/PageShell";
import FileUploader from "./components/FileUploader";
import ChartCard from "./components/ChartCard";
import ChartEditor from "./components/ChartEditor";
import DataPreviewTable from "./components/DataPreviewTable";
import CanvasSettingsPanel from "./components/CanvasSettingsPanel";
import DrawingLayer from "./components/DrawingLayer";
import ToolBar from "./components/ToolBar";
import { Icon } from "./components/icons";
import type {
  ParsedData,
  ChartConfig,
  ChartInstance,
  CanvasSettings,
  CanvasTool,
  DrawingPath,
  TextAnnotation,
  Snapshot,
} from "./types";
import {
  readWorkbook,
  readPastedText,
  workbookSheet,
  detectColumnTypes,
  defaultColumns,
  suggestChartType,
  type Workbook,
} from "./utils/dataParser";
import { createDefaultConfig, createDefaultCanvasSettings } from "./utils/constants";
import { exportCanvasPng, exportCanvasSvg } from "./utils/exportUtils";
import { demoTable } from "./utils/demoData";
import { plural } from "../../utils/plural";
import "./ChartCraft.css";

let idCounter = 0;
const newId = () => `chart-${++idCounter}-${Date.now()}`;
const MAX_HISTORY = 50;
const CARD_SIZE = { width: 880, height: 540 };

interface History {
  stack: Snapshot[];
  index: number;
}
const EMPTY_HISTORY: History = { stack: [], index: -1 };

/** Ctrl+Z в поле ввода — это отмена набора текста, а не действий на холсте. */
const TOOL_KEYS: Record<string, CanvasTool> = {
  KeyV: "select",
  KeyP: "draw",
  KeyA: "arrow",
  KeyR: "rect",
  KeyT: "text",
  KeyE: "eraser",
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

const fileTitle = (data: ParsedData) =>
  data.sheetNames && data.sheetNames.length > 1
    ? data.sheetName
    : data.fileName.replace(/\.[^/.]+$/, "");

/** Первый график по данным: подходящие столбцы и тип. */
function firstChart(data: ParsedData, demo = false): ChartInstance {
  const cols = detectColumnTypes(data);
  const { x, y } = defaultColumns(cols);
  const config: ChartConfig = {
    ...createDefaultConfig(),
    xColumn: x,
    yColumns: y,
    title: fileTitle(data),
  };
  if (demo) {
    // Пример показывает возможности: стопка, линия плана, подписи осей.
    Object.assign(config, {
      yColumns: ["Офлайн", "Онлайн", "Партнёры"],
      chartType: "bar",
      autoType: false,
      stack: "stacked",
      title: "Продажи по каналам",
      subtitle: "2025 год, тыс. ₽",
      referenceLine: "value",
      referenceValue: 1400,
      referenceLabel: "План",
    } satisfies Partial<ChartConfig>);
  } else {
    config.chartType = suggestChartType(
      cols.find((c) => c.name === x),
      cols.filter((c) => y.includes(c.name)),
    );
  }
  return {
    id: newId(),
    config,
    position: { x: 40, y: 32 },
    size: CARD_SIZE,
    zIndex: 1,
    isLocked: false,
  };
}

const ChartCraft: React.FC = () => {
  const [showInstructions, setShowInstructions] = useState(false);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [charts, setCharts] = useState<ChartInstance[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [maxZ, setMaxZ] = useState(1);
  const [canvasSettings, setCanvasSettings] = useState<CanvasSettings>(createDefaultCanvasSettings);
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showData, setShowData] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [drawColor, setDrawColor] = useState("#e34948");
  const [drawWidth, setDrawWidth] = useState(3);
  const [drawOpacity, setDrawOpacity] = useState(1);
  const [drawings, setDrawings] = useState<DrawingPath[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);

  const [showMinimap, setShowMinimap] = useState(true);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [viewportWidth, setViewportWidth] = useState(0);

  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // ── История: снимок после каждого завершённого действия ──
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [commitTick, setCommitTick] = useState(0);
  const latest = useRef<Snapshot>({ charts, drawings, texts: textAnnotations });
  latest.current = { charts, drawings, texts: textAnnotations };

  /** Запомнить состояние после обновления (снимок делается уже по новому state). */
  const commit = useCallback(() => setCommitTick((t) => t + 1), []);

  useEffect(() => {
    if (!commitTick) return;
    setHistory((h) => {
      const stack = [...h.stack.slice(0, h.index + 1), latest.current].slice(-MAX_HISTORY);
      return { stack, index: stack.length - 1 };
    });
  }, [commitTick]);

  const restore = useCallback((s: Snapshot) => {
    setCharts(s.charts);
    setDrawings(s.drawings);
    setTextAnnotations(s.texts);
    setEditingId(null);
  }, []);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  const undo = useCallback(() => {
    if (history.index <= 0) return;
    restore(history.stack[history.index - 1]);
    setHistory((h) => ({ ...h, index: h.index - 1 }));
  }, [history, restore]);

  const redo = useCallback(() => {
    if (history.index >= history.stack.length - 1) return;
    restore(history.stack[history.index + 1]);
    setHistory((h) => ({ ...h, index: h.index + 1 }));
  }, [history, restore]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingId || isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // «я»/«н» — те же клавиши в русской раскладке.
      if (mod && (key === "z" || key === "я") && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (key === "y" || key === "н" || ((key === "z" || key === "я") && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") setActiveTool("select");
      else if (!mod && !e.altKey && parsedData) {
        // Инструменты по буквам (по физической клавише — работает и в русской раскладке).
        const tool = TOOL_KEYS[e.code];
        if (tool) setActiveTool(tool);
        else if (e.code === "Digit0") setZoom("fit");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, editingId, parsedData]);

  // Меню «Холст» закрывается кликом мимо.
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen]);

  // Уведомление исчезает само.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Масштаб холста: по умолчанию вписываем в ширину экрана ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewportWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [parsedData]);

  const scale =
    zoom === "fit"
      ? viewportWidth
        ? Math.min(1, (viewportWidth - 32) / canvasSettings.canvasWidth)
        : 1
      : zoom;

  const columns = useMemo(() => (parsedData ? detectColumnTypes(parsedData) : []), [parsedData]);

  const canvasStyle = useMemo(() => {
    const { backgroundColor: bg, patternColor: pc, patternSize: ps, backgroundPattern } = canvasSettings;
    switch (backgroundPattern) {
      case "dots":
        return {
          background: `radial-gradient(circle at 1px 1px, ${pc} 1px, transparent 0) 0 0 / ${ps}px ${ps}px, ${bg}`,
        };
      case "grid":
        return {
          backgroundImage: `linear-gradient(${pc} 1px, transparent 1px), linear-gradient(90deg, ${pc} 1px, transparent 1px)`,
          backgroundSize: `${ps}px ${ps}px`,
          backgroundColor: bg,
        };
      case "lines":
        return {
          backgroundImage: `linear-gradient(${pc} 1px, transparent 1px)`,
          backgroundSize: `${ps}px ${ps}px`,
          backgroundColor: bg,
        };
      default:
        return { backgroundColor: bg };
    }
  }, [canvasSettings]);

  /** Новые данные: один стартовый график, история с чистого листа. */
  const startWith = useCallback((wb: Workbook, sheet?: string, demo = false) => {
    const data = workbookSheet(wb, sheet);
    if (!data.headers.length || !data.rows.length)
      throw new Error(`На листе «${data.sheetName}» нет данных — нужна таблица с заголовками.`);
    const first = firstChart(data, demo);
    setWorkbook(wb);
    setParsedData(data);
    setCharts([first]);
    setDrawings([]);
    setTextAnnotations([]);
    setMaxZ(1);
    setHistory({ stack: [{ charts: [first], drawings: [], texts: [] }], index: 0 });
    // Если столбцы не подобрались — сразу открываем редактор.
    setEditingId(first.config.yColumns.length ? null : first.id);
  }, []);

  const run = useCallback(async (fn: () => Promise<void> | void) => {
    setIsProcessing(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать данные.");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleFile = (file: File) => run(async () => startWith(await readWorkbook(file)));
  const handlePaste = (text: string) => run(() => startWith(readPastedText(text)));
  const handleDemo = () =>
    run(() => startWith({ ...readPastedText(demoTable()), fileName: "Пример" }, undefined, true));

  /** Другой лист той же книги: графики остаются, столбцы которых там есть. */
  const switchSheet = (name: string) =>
    run(() => {
      if (!workbook) return;
      const data = workbookSheet(workbook, name);
      const cols = new Set(data.headers);
      const keep = charts.filter((c) => cols.has(c.config.xColumn) && c.config.yColumns.every((y) => cols.has(y)));
      setParsedData(data);
      if (keep.length) {
        setCharts(keep);
        commit();
      } else {
        const first = firstChart(data);
        setCharts([first]);
        commit();
      }
    });

  const addChart = useCallback(() => {
    if (!parsedData) return;
    const off = (charts.length % 8) * 32;
    const { x, y } = defaultColumns(columns);
    const nc: ChartInstance = {
      id: newId(),
      config: { ...createDefaultConfig(), xColumn: x, yColumns: y, title: `График ${charts.length + 1}` },
      position: { x: 60 + off, y: 48 + off },
      size: CARD_SIZE,
      zIndex: maxZ + 1,
      isLocked: false,
    };
    setMaxZ((p) => p + 1);
    setCharts((prev) => [...prev, nc]);
    commit();
    setEditingId(nc.id);
  }, [parsedData, charts.length, columns, maxZ, commit]);

  /** Изменение карточки по завершённому действию (перенос, размер, замок). */
  const updateChart = useCallback(
    (id: string, u: Partial<ChartInstance>) => {
      setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, ...u } : c)));
      commit();
    },
    [commit],
  );

  const deleteChart = useCallback(
    (id: string) => {
      setCharts((prev) => prev.filter((c) => c.id !== id));
      commit();
      setEditingId((p) => (p === id ? null : p));
    },
    [commit],
  );

  const duplicateChart = useCallback(
    (id: string) => {
      const src = charts.find((c) => c.id === id);
      if (!src) return;
      const cl: ChartInstance = {
        ...src,
        id: newId(),
        config: { ...src.config, title: src.config.title ? `${src.config.title} (копия)` : "" },
        position: {
          x: Math.min(src.position.x + 40, Math.max(0, canvasSettings.canvasWidth - src.size.width)),
          y: Math.min(src.position.y + 40, Math.max(0, canvasSettings.canvasHeight - src.size.height)),
        },
        zIndex: maxZ + 1,
        isLocked: false,
      };
      setMaxZ((p) => p + 1);
      setCharts((prev) => [...prev, cl]);
      commit();
    },
    [charts, maxZ, canvasSettings.canvasWidth, canvasSettings.canvasHeight, commit],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const top = charts.find((c) => c.id === id);
      if (!top || top.zIndex === maxZ) return;
      const nz = maxZ + 1;
      setMaxZ(nz);
      setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, zIndex: nz } : c)));
    },
    [charts, maxZ],
  );

  const handleEditSave = useCallback(
    (id: string, config: ChartConfig) => {
      setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, config } : c)));
      commit();
      setEditingId(null);
    },
    [commit],
  );

  const handleExportAll = useCallback(
    async (fmt: "png" | "svg") => {
      if (!canvasRef.current) return;
      setIsProcessing(true);
      try {
        const name = parsedData ? fileTitle(parsedData) : "Графики";
        if (fmt === "png") await exportCanvasPng(canvasRef.current, name, canvasSettings.backgroundColor);
        else await exportCanvasSvg(canvasRef.current, name, canvasSettings.backgroundColor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить холст.");
      } finally {
        setIsProcessing(false);
      }
    },
    [canvasSettings.backgroundColor, parsedData],
  );

  const handleReset = useCallback(() => {
    setWorkbook(null);
    setParsedData(null);
    setCharts([]);
    setEditingId(null);
    setError(null);
    setMaxZ(1);
    setCanvasSettings(createDefaultCanvasSettings());
    setDrawings([]);
    setTextAnnotations([]);
    setHistory(EMPTY_HISTORY);
    setActiveTool("select");
    setConfirmReset(false);
  }, []);

  const notify = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    if (kind === "error") setError(msg);
    else setToast(msg);
  }, []);

  const editingInstance = editingId ? charts.find((c) => c.id === editingId) : null;
  const sheetNames = parsedData?.sheetNames ?? [];

  return (
    <PageShell
      fill={!!parsedData}
      width={parsedData ? "100%" : undefined}
      title="Генератор графиков"
      subtitle="Таблица → понятный график для отчёта или презентации"
      onShowInstructions={() => setShowInstructions(true)}
    >
      {showInstructions && (
        <div className="cc-modal-overlay" onClick={() => setShowInstructions(false)}>
          <div className="cc-modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="cc-modal-close" onClick={() => setShowInstructions(false)} aria-label="Закрыть">
              ✕
            </button>
            <h2 className="cc-modal-title">📊 Генератор графиков</h2>
            <div className="cc-instructions-list">
              {[
                ["Загрузите данные", "Файл XLSX или CSV, вставка из Excel (Ctrl+V) или готовый пример. В книге с несколькими листами можно переключать лист."],
                ["Тип подберётся сам", "По датам — линия, по категориям — столбцы, по долям — кольцо. Выбранный вручную тип больше не меняется."],
                ["Сведите данные", "Повторяющиеся категории суммируются (или среднее, количество, мин., макс.). Можно оставить топ-N, остальное сложить в «Другое», выделить нужную категорию."],
                ["Оформите", "Стопка и 100 %, подписи значений, линия плана или среднего, тыс./млн, ₽ и %, тёмная тема. Цвета подобраны так, чтобы их различали и люди с нарушением цветовосприятия."],
                ["Дополните холст", "Несколько графиков, стрелки, рамки, надписи. Горячие клавиши: V — выбор, P — карандаш, A — стрелка, R — рамка, T — надпись, E — ластик, 0 — вписать холст, Ctrl+Z / Ctrl+Y — отмена и повтор."],
                ["Выгрузите", "Кнопка выгрузки на графике: копировать картинку (сразу в PowerPoint), PNG, SVG или HTML с таблицей данных. Весь холст — кнопкой «Холст» в верхней панели."],
              ].map(([t, d], i) => (
                <div key={i} className="cc-instruction-item">
                  <span className="cc-instruction-number">{i + 1}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="cc-error-banner" role="alert">
          <span>⚠️</span>
          <span>{error}</span>
          <button className="cc-error-close" onClick={() => setError(null)} aria-label="Закрыть">
            ✕
          </button>
        </div>
      )}
      {toast && (
        <div className="cc-toast" role="status">
          ✓ {toast}
        </div>
      )}

      {!parsedData && (
        <div className="cc-upload-wrapper">
          <FileUploader onFile={handleFile} onPaste={handlePaste} onDemo={handleDemo} isProcessing={isProcessing} />
        </div>
      )}

      {parsedData && (
        <>
          <div className="cc-bar">
            <div className="cc-bar-row">
              <div className="cc-file-chip" title={parsedData.fileName}>
                <Icon name="file" size={16} />
                <span className="cc-file-name">{parsedData.fileName}</span>
                <span className="cc-file-stats">
                  {parsedData.totalRows} {plural(parsedData.totalRows, ["строка", "строки", "строк"])} ×{" "}
                  {parsedData.headers.length}
                </span>
              </div>
              {sheetNames.length > 1 && (
                <select
                  className="cc-select cc-sheet-select"
                  value={parsedData.sheetName}
                  onChange={(e) => switchSheet(e.target.value)}
                  aria-label="Лист книги"
                >
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      Лист: {n}
                    </option>
                  ))}
                </select>
              )}

              <div className="cc-bar-spacer" />

              <button className="cc-btn cc-btn-primary" onClick={addChart} title="Добавить график">
                <Icon name="plus" size={16} />
                График
              </button>

              <div className="cc-iconbar">
                <button className="cc-icon-btn" onClick={undo} disabled={!canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить">
                  <Icon name="undo" />
                </button>
                <button className="cc-icon-btn" onClick={redo} disabled={!canRedo} title="Повторить (Ctrl+Y)" aria-label="Повторить">
                  <Icon name="redo" />
                </button>
              </div>

              <div className="cc-iconbar" role="group" aria-label="Масштаб">
                <button
                  className="cc-icon-btn"
                  onClick={() => setZoom(Math.max(0.25, Math.round((scale - 0.1) * 10) / 10))}
                  title="Уменьшить"
                  aria-label="Уменьшить"
                >
                  <Icon name="minus" />
                </button>
                <button
                  className="cc-icon-btn cc-zoom-value"
                  onClick={() => setZoom(1)}
                  title="Натуральная величина"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  className="cc-icon-btn"
                  onClick={() => setZoom(Math.min(2, Math.round((scale + 0.1) * 10) / 10))}
                  title="Увеличить"
                  aria-label="Увеличить"
                >
                  <Icon name="plus" />
                </button>
                <button
                  className={`cc-icon-btn ${zoom === "fit" ? "active" : ""}`}
                  onClick={() => setZoom("fit")}
                  title="Вписать в экран (0)"
                  aria-label="Вписать в экран"
                >
                  <Icon name="fit" />
                </button>
              </div>

              <div className="cc-iconbar">
                <button
                  className={`cc-icon-btn ${showCanvasSettings ? "active" : ""}`}
                  onClick={() => setShowCanvasSettings(!showCanvasSettings)}
                  aria-pressed={showCanvasSettings}
                  title="Размер и фон холста"
                  aria-label="Настройки холста"
                >
                  <Icon name="sliders" />
                </button>
                <button
                  className={`cc-icon-btn ${showMinimap ? "active" : ""}`}
                  onClick={() => setShowMinimap(!showMinimap)}
                  aria-pressed={showMinimap}
                  title="Мини-карта холста"
                  aria-label="Мини-карта"
                >
                  <Icon name="map" />
                </button>
                <button
                  className={`cc-icon-btn ${showData ? "active" : ""}`}
                  onClick={() => setShowData(!showData)}
                  aria-pressed={showData}
                  title="Исходные данные"
                  aria-label="Исходные данные"
                >
                  <Icon name="table" />
                </button>
              </div>

              <div className="cc-menu-wrap" ref={exportMenuRef}>
                <button
                  className="cc-btn"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={!charts.length || isProcessing}
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  title="Сохранить весь холст"
                >
                  <Icon name="download" size={16} />
                  Холст
                  <Icon name="chevron" size={14} />
                </button>
                {exportOpen && (
                  <div className="cc-menu" role="menu">
                    <button role="menuitem" className="cc-menu-item" onClick={() => { setExportOpen(false); handleExportAll("png"); }}>
                      <Icon name="image" size={16} /> PNG — картинка
                    </button>
                    <button role="menuitem" className="cc-menu-item" onClick={() => { setExportOpen(false); handleExportAll("svg"); }}>
                      <Icon name="pencil" size={16} /> SVG — вектор
                    </button>
                  </div>
                )}
              </div>

              {confirmReset ? (
                <span className="cc-confirm">
                  Начать заново?
                  <button className="cc-btn cc-btn-danger" onClick={handleReset}>
                    Да
                  </button>
                  <button className="cc-btn" onClick={() => setConfirmReset(false)}>
                    Нет
                  </button>
                </span>
              ) : (
                <button className="cc-btn cc-btn-ghost" onClick={() => setConfirmReset(true)} title="Загрузить другие данные">
                  <Icon name="folder" size={16} />
                  Другой файл
                </button>
              )}
            </div>

            <ToolBar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              drawColor={drawColor}
              onColorChange={setDrawColor}
              drawWidth={drawWidth}
              onWidthChange={setDrawWidth}
              drawOpacity={drawOpacity}
              onOpacityChange={setDrawOpacity}
              hasDrawings={drawings.length > 0 || textAnnotations.length > 0}
              onClearDrawings={() => {
                setDrawings([]);
                setTextAnnotations([]);
                commit();
              }}
            />

            {showCanvasSettings && (
              <div className="cc-canvas-settings-bar">
                <CanvasSettingsPanel
                  settings={canvasSettings}
                  onChange={(u) => setCanvasSettings((p) => ({ ...p, ...u }))}
                />
              </div>
            )}
          </div>

          <div className="cc-stage">
          <div className="cc-canvas-viewport" ref={viewportRef}>
            <div
              className="cc-canvas-sizer"
              style={{
                width: canvasSettings.canvasWidth * scale,
                height: canvasSettings.canvasHeight * scale,
              }}
            >
              <div
                className="cc-canvas"
                ref={canvasRef}
                style={{
                  ...canvasStyle,
                  width: canvasSettings.canvasWidth,
                  height: canvasSettings.canvasHeight,
                  transform: `scale(${scale})`,
                }}
              >
                {charts.length === 0 && drawings.length === 0 && textAnnotations.length === 0 && (
                  <div className="cc-canvas-empty">
                    <span className="cc-canvas-empty-icon">📊</span>
                    <h3>Холст пуст</h3>
                    <p>Нажмите «+ График» или нарисуйте что-нибудь</p>
                  </div>
                )}

                {charts.map((ch) => (
                  <ChartCard
                    key={ch.id}
                    instance={ch}
                    data={parsedData}
                    columns={columns}
                    activeTool={activeTool}
                    scale={scale}
                    onUpdate={updateChart}
                    onDelete={deleteChart}
                    onDuplicate={duplicateChart}
                    onEdit={setEditingId}
                    onBringToFront={bringToFront}
                    onNotify={notify}
                  />
                ))}

                <DrawingLayer
                  tool={activeTool}
                  drawColor={drawColor}
                  drawWidth={drawWidth}
                  drawOpacity={drawOpacity}
                  paths={drawings}
                  texts={textAnnotations}
                  onPathsChange={setDrawings}
                  onTextsChange={setTextAnnotations}
                  onCommit={commit}
                  canvasWidth={canvasSettings.canvasWidth}
                  canvasHeight={canvasSettings.canvasHeight}
                />
              </div>
            </div>

            </div>

            {showMinimap && (
              <div className="cc-minimap" aria-hidden="true">
                <div
                  className="cc-minimap-content"
                  style={{
                    ...canvasStyle,
                    aspectRatio: `${canvasSettings.canvasWidth}/${canvasSettings.canvasHeight}`,
                  }}
                >
                  {charts.map((ch) => (
                    <div
                      key={ch.id}
                      className="cc-minimap-chart"
                      style={{
                        left: `${(ch.position.x / canvasSettings.canvasWidth) * 100}%`,
                        top: `${(ch.position.y / canvasSettings.canvasHeight) * 100}%`,
                        width: `${(ch.size.width / canvasSettings.canvasWidth) * 100}%`,
                        height: `${(ch.size.height / canvasSettings.canvasHeight) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {showData && (
            <section className="cc-data-drawer" aria-label="Исходные данные">
              <button className="cc-icon-btn cc-data-drawer-close" onClick={() => setShowData(false)} aria-label="Скрыть данные" title="Скрыть">
                <Icon name="close" size={16} />
              </button>
              <DataPreviewTable data={parsedData} maxRows={200} />
            </section>
          )}
        </>
      )}

      {editingInstance && parsedData && (
        <ChartEditor
          key={editingInstance.id}
          instance={editingInstance}
          data={parsedData}
          columns={columns}
          onSave={handleEditSave}
          onClose={() => setEditingId(null)}
        />
      )}

      {isProcessing && (
        <div className="cc-loading-overlay">
          <div className="cc-loading-content">
            <div className="cc-loading-spinner" />
            <p>Обработка…</p>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default ChartCraft;
