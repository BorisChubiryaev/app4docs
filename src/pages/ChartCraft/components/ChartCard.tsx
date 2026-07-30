import React, { useRef, useState } from "react";
import { Rnd } from "react-rnd";
import ChartPreview from "./ChartPreview";
import type { ChartInstance, ParsedData } from "../types";
import { exportToPng, exportToSvg, exportToHtml } from "../utils/exportUtils";

interface Props {
  instance: ChartInstance;
  data: ParsedData;
  activeTool: string;
  onUpdate: (id: string, u: Partial<ChartInstance>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onBringToFront: (id: string) => void;
}

const ChartCard: React.FC<Props> = ({
  instance,
  data,
  activeTool,
  onUpdate,
  onDelete,
  onDuplicate,
  onEdit,
  onBringToFront,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const hasChart =
    instance.config.xColumn && instance.config.yColumns.length > 0;
  const isSelect = activeTool === "select";

  const handleExport = async (fmt: "png" | "svg" | "html") => {
    setExporting(fmt);
    setShowExport(false);
    const name = instance.config.title || `chart-${instance.id}`;
    try {
      if (fmt === "html") exportToHtml(instance.config, data, name);
      else if (chartRef.current) {
        if (fmt === "png") await exportToPng(chartRef.current, name);
        else await exportToSvg(chartRef.current, name);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(null);
    }
  };

  return (
    <Rnd
      size={instance.size}
      position={instance.position}
      onDragStop={(_e, d) =>
        onUpdate(instance.id, { position: { x: d.x, y: d.y } })
      }
      onResizeStop={(_e, _d, ref, _dl, pos) =>
        onUpdate(instance.id, {
          size: {
            width: parseInt(ref.style.width),
            height: parseInt(ref.style.height),
          },
          position: pos,
        })
      }
      minWidth={280}
      minHeight={220}
      bounds="parent"
      style={{ zIndex: instance.zIndex }}
      dragHandleClassName="cc-card-drag-handle"
      onMouseDown={() => onBringToFront(instance.id)}
      disableDragging={!isSelect || instance.isLocked}
      enableResizing={
        isSelect && !instance.isLocked
          ? { right: true, bottom: true, bottomRight: true }
          : false
      }
    >
      <div
        className={`cc-chart-card ${hover ? "hovered" : ""} ${instance.isLocked ? "locked" : ""}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setShowExport(false);
        }}
      >
        <div className="cc-card-toolbar cc-card-drag-handle">
          <div className="cc-card-toolbar-left">
            <span className="cc-card-grip">⋮⋮</span>
            <span className="cc-card-label">
              {instance.config.title || "График"}
            </span>
            {instance.isLocked && <span className="cc-lock-icon">🔒</span>}
          </div>
          <div className={`cc-card-toolbar-right ${hover ? "visible" : ""}`}>
            <button
              className="cc-card-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(instance.id);
              }}
              title="Редактировать"
            >
              ✏️
            </button>
            <button
              className="cc-card-btn"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(instance.id, { isLocked: !instance.isLocked });
              }}
              title={instance.isLocked ? "Разблокировать" : "Заблокировать"}
            >
              {instance.isLocked ? "🔓" : "🔒"}
            </button>
            <div className="cc-card-export-wrapper">
              <button
                className={`cc-card-btn ${exporting ? "spinning" : ""}`}
                disabled={!hasChart || !!exporting}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowExport(!showExport);
                }}
                title="Экспорт"
              >
                {exporting ? "⏳" : "💾"}
              </button>
              {showExport && (
                <div className="cc-card-export-menu">
                  <button
                    className="cc-card-export-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport("png");
                    }}
                  >
                    🖼️ PNG
                  </button>
                  <button
                    className="cc-card-export-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport("svg");
                    }}
                  >
                    ✏️ SVG
                  </button>
                  <button
                    className="cc-card-export-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport("html");
                    }}
                  >
                    🌐 HTML
                  </button>
                </div>
              )}
            </div>
            <button
              className="cc-card-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(instance.id);
              }}
              title="Дублировать"
            >
              📋
            </button>
            <button
              className="cc-card-btn cc-card-btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(instance.id);
              }}
              title="Удалить"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="cc-card-content">
          {hasChart ? (
            <ChartPreview ref={chartRef} data={data} config={instance.config} />
          ) : (
            <div className="cc-card-empty">
              <span>📊</span>
              <p>Нажмите ✏️ для настройки</p>
            </div>
          )}
        </div>
        <div className="cc-card-resize-handle">⤡</div>
      </div>
    </Rnd>
  );
};

export default ChartCard;
