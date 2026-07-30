import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import Header from "../../components/header/Header";
import FileUploader from "./components/FileUploader";
import ChartCard from "./components/ChartCard";
import ChartEditor from "./components/ChartEditor";
import DataPreviewTable from "./components/DataPreviewTable";
import CanvasSettingsPanel from "./components/CanvasSettingsPanel";
import DrawingLayer from "./components/DrawingLayer";
import ToolBar from "./components/ToolBar";
import type {
  ParsedData,
  ChartConfig,
  ChartInstance,
  ColumnInfo,
  CanvasSettings,
  CanvasTool,
  DrawingPath,
  TextAnnotation,
  HistoryEntry,
} from "./types";
import {
  parseFile,
  detectColumnTypes,
  suggestChartType,
} from "./utils/dataParser";
import {
  createDefaultConfig,
  createDefaultCanvasSettings,
} from "./utils/constants";
import { exportCanvasToPng, exportCanvasToSvg } from "./utils/exportUtils";
import "./ChartCraft.css";

let idCounter = 0;
const newId = () => `chart-${++idCounter}-${Date.now()}`;
const MAX_HISTORY = 30;

const ChartCraft: React.FC = () => {
  const [showInstructions, setShowInstructions] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [charts, setCharts] = useState<ChartInstance[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxZ, setMaxZ] = useState(1);
  const [canvasSettings, setCanvasSettings] = useState<CanvasSettings>(
    createDefaultCanvasSettings(),
  );
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);

  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [drawColor, setDrawColor] = useState("#e74c3c");
  const [drawWidth, setDrawWidth] = useState(3);
  const [drawOpacity, setDrawOpacity] = useState(1);
  const [drawings, setDrawings] = useState<DrawingPath[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const skipHistoryRef = useRef(false);

  const [showMinimap, setShowMinimap] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);

  const pushHistory = useCallback(
    (ch: ChartInstance[], dr: DrawingPath[], tx: TextAnnotation[]) => {
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        return;
      }
      setHistory((prev) => {
        const h = prev.slice(0, historyIndex + 1);
        h.push({
          charts: JSON.parse(JSON.stringify(ch)),
          drawings: JSON.parse(JSON.stringify(dr)),
          texts: JSON.parse(JSON.stringify(tx)),
        });
        if (h.length > MAX_HISTORY) h.shift();
        return h;
      });
      setHistoryIndex((p) => Math.min(p + 1, MAX_HISTORY - 1));
    },
    [historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const e = history[historyIndex - 1];
    skipHistoryRef.current = true;
    setCharts(e.charts);
    setDrawings(e.drawings);
    setTextAnnotations(e.texts);
    setHistoryIndex((p) => p - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const e = history[historyIndex + 1];
    skipHistoryRef.current = true;
    setCharts(e.charts);
    setDrawings(e.drawings);
    setTextAnnotations(e.texts);
    setHistoryIndex((p) => p + 1);
  }, [history, historyIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") setActiveTool("select");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  useEffect(() => {
    pushHistory(charts, drawings, textAnnotations);
  }, [drawings, textAnnotations]);

  const canvasStyle = useMemo(() => {
    const {
      backgroundColor: bg,
      patternColor: pc,
      patternSize: ps,
      backgroundPattern,
    } = canvasSettings;
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

  const handleFileLoaded = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    try {
      const data = await parseFile(file);
      setParsedData(data);
      const colInfos = detectColumnTypes(data);
      setColumns(colInfos);
      const cat = colInfos.find((c) => c.type === "category");
      const nums = colInfos.filter((c) => c.type === "numeric");
      const sug = suggestChartType(colInfos, data.rows.length);
      const first: ChartInstance = {
        id: newId(),
        config: {
          ...createDefaultConfig(),
          chartType: sug,
          xColumn: cat?.name || colInfos[0]?.name || "",
          yColumns:
            nums.length > 0
              ? [nums[0].name]
              : colInfos.length > 1
                ? [colInfos[1].name]
                : [],
          title: file.name.replace(/\.[^/.]+$/, ""),
        },
        position: { x: 40, y: 20 },
        size: { width: 600, height: 450 },
        zIndex: 1,
        isEditing: false,
        isMinimized: false,
        isLocked: false,
      };
      setCharts([first]);
      setEditingId(first.id);
      setMaxZ(1);
      setDrawings([]);
      setTextAnnotations([]);
      setHistory([]);
      setHistoryIndex(-1);
    } catch (err: any) {
      setError(err.message || "Ошибка");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const addChart = useCallback(() => {
    if (!parsedData) return;
    const off = charts.length * 30;
    const nc: ChartInstance = {
      id: newId(),
      config: {
        ...createDefaultConfig(),
        title: `График ${charts.length + 1}`,
      },
      position: { x: 60 + off, y: 40 + off },
      size: { width: 600, height: 450 },
      zIndex: maxZ + 1,
      isEditing: false,
      isMinimized: false,
      isLocked: false,
    };
    setMaxZ((p) => p + 1);
    setCharts((prev) => {
      const n = [...prev, nc];
      pushHistory(n, drawings, textAnnotations);
      return n;
    });
    setEditingId(nc.id);
  }, [parsedData, charts.length, maxZ, drawings, textAnnotations, pushHistory]);

  const updateChart = useCallback((id: string, u: Partial<ChartInstance>) => {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, ...u } : c)));
  }, []);

  const deleteChart = useCallback(
    (id: string) => {
      setCharts((prev) => {
        const n = prev.filter((c) => c.id !== id);
        pushHistory(n, drawings, textAnnotations);
        return n;
      });
      setEditingId((p) => (p === id ? null : p));
    },
    [drawings, textAnnotations, pushHistory],
  );

  const duplicateChart = useCallback(
    (id: string) => {
      setCharts((prev) => {
        const src = prev.find((c) => c.id === id);
        if (!src) return prev;
        const cl: ChartInstance = {
          ...src,
          id: newId(),
          config: { ...src.config, title: `${src.config.title} (копия)` },
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          zIndex: maxZ + 1,
          isLocked: false,
        };
        setMaxZ((p) => p + 1);
        const n = [...prev, cl];
        pushHistory(n, drawings, textAnnotations);
        return n;
      });
    },
    [maxZ, drawings, textAnnotations, pushHistory],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const nz = maxZ + 1;
      setMaxZ(nz);
      setCharts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, zIndex: nz } : c)),
      );
    },
    [maxZ],
  );

  const handleEditSave = useCallback(
    (id: string, config: ChartConfig) => {
      setCharts((prev) => {
        const n = prev.map((c) => (c.id === id ? { ...c, config } : c));
        pushHistory(n, drawings, textAnnotations);
        return n;
      });
      setEditingId(null);
    },
    [drawings, textAnnotations, pushHistory],
  );

  const handleExportAll = useCallback(
    async (fmt: "png" | "svg") => {
      if (!canvasRef.current) return;
      setIsProcessing(true);
      try {
        const name = `charts-${Date.now()}`;
        if (fmt === "png")
          await exportCanvasToPng(
            canvasRef.current,
            name,
            canvasSettings.backgroundColor,
          );
        else
          await exportCanvasToSvg(
            canvasRef.current,
            name,
            canvasSettings.backgroundColor,
          );
      } catch (e: any) {
        setError(e.message);
      } finally {
        setIsProcessing(false);
      }
    },
    [canvasSettings.backgroundColor],
  );

  const handleReset = useCallback(() => {
    setParsedData(null);
    setColumns([]);
    setCharts([]);
    setEditingId(null);
    setError(null);
    setMaxZ(1);
    setCanvasSettings(createDefaultCanvasSettings());
    setDrawings([]);
    setTextAnnotations([]);
    setHistory([]);
    setHistoryIndex(-1);
    setActiveTool("select");
  }, []);

  const editingInstance = editingId
    ? charts.find((c) => c.id === editingId)
    : null;

  return (
    <div className="chartcraft-container">
      <Header
        title="Генератор графиков"
        description="Превращайте таблицы в красивые графики"
        onShowInstructions={() => setShowInstructions(true)}
        showHomeButton={true}
        showInstructionsButton={true}
      />

      {showInstructions && (
        <div
          className="cc-modal-overlay"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="cc-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="cc-modal-close"
              onClick={() => setShowInstructions(false)}
            >
              ✕
            </button>
            <h2 className="cc-modal-title">📊 Генератор графиков</h2>
            <div className="cc-instructions-list">
              {[
                ["Загрузите файл", "CSV, XLSX или XLS"],
                ["Создайте графики", "Несколько графиков на одном холсте"],
                ["Рисуйте", "Стрелки, фигуры, текст прямо на холсте"],
                ["Настройте", "Тип, цвета, размер холста"],
                [
                  "Экспортируйте",
                  "Каждый график или весь холст — PNG, SVG, HTML",
                ],
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
        <div className="cc-error-banner">
          <span>⚠️</span>
          <span>{error}</span>
          <button className="cc-error-close" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {!parsedData && (
        <div className="cc-upload-wrapper">
          <FileUploader
            onFileLoaded={handleFileLoaded}
            isProcessing={isProcessing}
          />
        </div>
      )}

      {parsedData && (
        <>
          <div className="cc-workspace-toolbar">
            <div className="cc-toolbar-left">
              <div className="cc-toolbar-file-info">
                <span className="cc-toolbar-file-icon">📄</span>
                <span className="cc-toolbar-file-name">
                  {parsedData.fileName}
                </span>
                <span className="cc-toolbar-file-stats">
                  {parsedData.totalRows}×{parsedData.headers.length}
                </span>
              </div>
              <div className="cc-toolbar-divider" />
              <span className="cc-toolbar-chart-count">📊 {charts.length}</span>
            </div>
            <div className="cc-toolbar-right">
              <button className="cc-button cc-button-accent" onClick={addChart}>
                + График
              </button>
              <div className="cc-toolbar-divider" />
              <button
                className={`cc-button ${showCanvasSettings ? "cc-button-primary" : "cc-button-secondary"}`}
                onClick={() => setShowCanvasSettings(!showCanvasSettings)}
              >
                🎨 Холст
              </button>
              <button
                className={`cc-button ${showMinimap ? "cc-button-primary" : "cc-button-secondary"}`}
                onClick={() => setShowMinimap(!showMinimap)}
              >
                🗺️
              </button>
              <div className="cc-toolbar-divider" />
              <button
                className="cc-button cc-button-secondary"
                onClick={() => handleExportAll("png")}
                disabled={!charts.length || isProcessing}
              >
                🖼️ PNG
              </button>
              <button
                className="cc-button cc-button-secondary"
                onClick={() => handleExportAll("svg")}
                disabled={!charts.length || isProcessing}
              >
                ✏️ SVG
              </button>
              <div className="cc-toolbar-divider" />
              <button
                className="cc-button cc-button-danger"
                onClick={handleReset}
              >
                🔄
              </button>
            </div>
          </div>

          {showCanvasSettings && (
            <div className="cc-canvas-settings-bar">
              <CanvasSettingsPanel
                settings={canvasSettings}
                onChange={(u) => setCanvasSettings((p) => ({ ...p, ...u }))}
              />
            </div>
          )}

          <ToolBar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            drawColor={drawColor}
            onColorChange={setDrawColor}
            drawWidth={drawWidth}
            onWidthChange={setDrawWidth}
            drawOpacity={drawOpacity}
            onOpacityChange={setDrawOpacity}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onUndo={undo}
            onRedo={redo}
            onClearDrawings={() => {
              setDrawings([]);
              setTextAnnotations([]);
            }}
          />

          <div className="cc-canvas-viewport">
            <div
              className="cc-canvas"
              ref={canvasRef}
              style={{
                ...canvasStyle,
                width: canvasSettings.canvasWidth,
                height: canvasSettings.canvasHeight,
              }}
            >
              {charts.length === 0 &&
                drawings.length === 0 &&
                textAnnotations.length === 0 && (
                  <div className="cc-canvas-empty">
                    <span className="cc-canvas-empty-icon">📊</span>
                    <h3>Холст пуст</h3>
                    <p>Добавьте графики или рисуйте</p>
                  </div>
                )}

              {charts.map((ch) => (
                <ChartCard
                  key={ch.id}
                  instance={ch}
                  data={parsedData}
                  activeTool={activeTool}
                  onUpdate={updateChart}
                  onDelete={deleteChart}
                  onDuplicate={duplicateChart}
                  onEdit={setEditingId}
                  onBringToFront={bringToFront}
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
                canvasWidth={canvasSettings.canvasWidth}
                canvasHeight={canvasSettings.canvasHeight}
              />
            </div>

            {showMinimap && (
              <div className="cc-minimap">
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

          <details className="cc-data-details">
            <summary className="cc-data-summary">
              📋 Данные ({parsedData.totalRows} строк)
            </summary>
            <DataPreviewTable data={parsedData} maxRows={15} />
          </details>
        </>
      )}

      {editingInstance && parsedData && (
        <ChartEditor
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
            <p>Обработка...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartCraft;
