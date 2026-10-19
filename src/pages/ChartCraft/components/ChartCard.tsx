import React, { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import ChartPreview from "./ChartPreview";
import type { ChartInstance, ColumnInfo, ParsedData } from "../types";
import { copyNodePng, exportChartHtml, exportNodePng, exportNodeSvg } from "../utils/exportUtils";
import { CHROME } from "../utils/palettes";

interface Props {
  instance: ChartInstance;
  data: ParsedData;
  columns: ColumnInfo[];
  activeTool: string;
  /** Масштаб холста — чтобы перетаскивание шло за курсором. */
  scale: number;
  /** Перемещение/размер завершены — одно действие для истории. */
  onUpdate: (id: string, u: Partial<ChartInstance>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onBringToFront: (id: string) => void;
  onNotify: (msg: string, kind?: "ok" | "error") => void;
}

type Fmt = "png" | "svg" | "html" | "copy";

const ChartCard: React.FC<Props> = ({
  instance,
  data,
  columns,
  activeTool,
  scale,
  onUpdate,
  onDelete,
  onDuplicate,
  onEdit,
  onBringToFront,
  onNotify,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<Fmt | null>(null);
  const [showExport, setShowExport] = useState(false);
  const { config } = instance;

  const hasChart = !!config.xColumn && config.yColumns.length > 0;
  const isSelect = activeTool === "select";

  // Меню экспорта закрывается кликом мимо него.
  useEffect(() => {
    if (!showExport) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setShowExport(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showExport]);

  const handleExport = async (fmt: Fmt) => {
    setShowExport(false);
    const el = chartRef.current;
    if (!el) return;
    setExporting(fmt);
    const name = config.title || "График";
    const bg = config.backgroundColor || CHROME[config.theme].surface;
    try {
      if (fmt === "png") await exportNodePng(el, name, bg);
      else if (fmt === "svg") await exportNodeSvg(el, name, bg);
      else if (fmt === "html") await exportChartHtml(el, config, data, columns, bg);
      else {
        await copyNodePng(el, bg);
        onNotify("Картинка скопирована — вставьте её в PowerPoint, Word или письмо (Ctrl+V).");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось выгрузить график.", "error");
    } finally {
      setExporting(null);
    }
  };

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <Rnd
      size={instance.size}
      position={instance.position}
      onDragStop={(_e, d) => {
        if (d.x !== instance.position.x || d.y !== instance.position.y)
          onUpdate(instance.id, { position: { x: d.x, y: d.y } });
      }}
      onResizeStop={(_e, _d, ref, _dl, pos) =>
        onUpdate(instance.id, {
          size: { width: ref.offsetWidth, height: ref.offsetHeight },
          position: pos,
        })
      }
      minWidth={280}
      minHeight={220}
      bounds="parent"
      scale={scale}
      style={{ zIndex: instance.zIndex }}
      dragHandleClassName="cc-card-drag-handle"
      onMouseDown={() => onBringToFront(instance.id)}
      disableDragging={!isSelect || instance.isLocked}
      enableResizing={
        isSelect && !instance.isLocked ? { right: true, bottom: true, bottomRight: true } : false
      }
    >
      <div
        className={`cc-chart-card ${instance.isLocked ? "locked" : ""} ${showExport ? "menu-open" : ""}`}
        onDoubleClick={(e) => {
          // Двойной клик по графику — открыть редактор (но не по кнопкам).
          if (!(e.target as HTMLElement).closest("button")) onEdit(instance.id);
        }}
      >
        <div className="cc-card-toolbar cc-card-drag-handle cc-no-export">
          <div className="cc-card-toolbar-left">
            <span className="cc-card-grip" aria-hidden="true">⋮⋮</span>
            <span className="cc-card-label">{config.title || "График"}</span>
            {instance.isLocked && <span className="cc-lock-icon" title="Закреплён">🔒</span>}
          </div>
          <div className="cc-card-toolbar-right">
            <button className="cc-card-btn" onClick={stop(() => onEdit(instance.id))} title="Настроить (или двойной клик по графику)">
              ✏️
            </button>
            <button
              className="cc-card-btn"
              onClick={stop(() => onUpdate(instance.id, { isLocked: !instance.isLocked }))}
              title={instance.isLocked ? "Открепить" : "Закрепить на месте"}
            >
              {instance.isLocked ? "🔓" : "📌"}
            </button>
            <div className="cc-card-export-wrapper" ref={menuRef}>
              <button
                className="cc-card-btn"
                disabled={!hasChart || !!exporting}
                onClick={stop(() => setShowExport((v) => !v))}
                title="Скачать или скопировать"
                aria-haspopup="menu"
                aria-expanded={showExport}
              >
                {exporting ? "⏳" : "💾"}
              </button>
              {showExport && (
                <div className="cc-card-export-menu" role="menu">
                  <button role="menuitem" className="cc-card-export-option" onClick={stop(() => handleExport("copy"))}>
                    📋 Копировать картинку
                  </button>
                  <button role="menuitem" className="cc-card-export-option" onClick={stop(() => handleExport("png"))}>
                    🖼️ PNG — для презентаций
                  </button>
                  <button role="menuitem" className="cc-card-export-option" onClick={stop(() => handleExport("svg"))}>
                    ✒️ SVG — вектор
                  </button>
                  <button role="menuitem" className="cc-card-export-option" onClick={stop(() => handleExport("html"))}>
                    🌐 HTML — график + таблица
                  </button>
                </div>
              )}
            </div>
            <button className="cc-card-btn" onClick={stop(() => onDuplicate(instance.id))} title="Дублировать">
              ⧉
            </button>
            <button className="cc-card-btn cc-card-btn-danger" onClick={stop(() => onDelete(instance.id))} title="Удалить">
              ✕
            </button>
          </div>
        </div>

        <div className="cc-card-content">
          {hasChart ? (
            <ChartPreview ref={chartRef} data={data} columns={columns} config={config} />
          ) : (
            <button type="button" className="cc-card-empty" onClick={() => onEdit(instance.id)}>
              <span aria-hidden="true">📊</span>
              <p>Выберите данные для графика</p>
            </button>
          )}
        </div>
      </div>
    </Rnd>
  );
};

export default ChartCard;
