import React from "react";
import type { CanvasTool } from "../types";
import { DRAW_COLORS } from "../utils/constants";

interface Props {
  activeTool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  drawColor: string;
  onColorChange: (c: string) => void;
  drawWidth: number;
  onWidthChange: (w: number) => void;
  drawOpacity: number;
  onOpacityChange: (o: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearDrawings: () => void;
}

const TOOLS: { tool: CanvasTool; icon: string; label: string }[] = [
  { tool: "select", icon: "🖱️", label: "Выбор" },
  { tool: "draw", icon: "✏️", label: "Рисование" },
  { tool: "arrow", icon: "➡️", label: "Стрелка" },
  { tool: "rect", icon: "⬜", label: "Прямоугольник" },
  { tool: "text", icon: "🔤", label: "Текст" },
  { tool: "eraser", icon: "🧹", label: "Ластик" },
];

const ToolBar: React.FC<Props> = ({
  activeTool,
  onToolChange,
  drawColor,
  onColorChange,
  drawWidth,
  onWidthChange,
  drawOpacity,
  onOpacityChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearDrawings,
}) => (
  <div className="cc-toolbar-draw">
    {/* Tools */}
    <div className="cc-tool-group">
      {TOOLS.map(({ tool, icon, label }) => (
        <button
          key={tool}
          className={`cc-tool-btn ${activeTool === tool ? "active" : ""}`}
          onClick={() => onToolChange(tool)}
          title={label}
        >
          <span className="cc-tool-icon">{icon}</span>
          <span className="cc-tool-label">{label}</span>
        </button>
      ))}
    </div>

    {/* Drawing options */}
    {activeTool !== "select" && activeTool !== "eraser" && (
      <>
        <div className="cc-tool-divider" />
        <div className="cc-tool-group">
          <div className="cc-quick-colors">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                className={`cc-quick-color ${drawColor === c ? "active" : ""}`}
                style={{
                  backgroundColor: c,
                  border: c === "#ffffff" ? "1px solid #ccc" : "none",
                }}
                onClick={() => onColorChange(c)}
              />
            ))}
          </div>
        </div>

        <div className="cc-tool-divider" />
        <div className="cc-tool-group cc-tool-sliders">
          <div className="cc-slider-item">
            <span>{drawWidth}px</span>
            <input
              type="range"
              min={1}
              max={12}
              value={drawWidth}
              onChange={(e) => onWidthChange(Number(e.target.value))}
              className="cc-range-mini"
            />
          </div>
          <div className="cc-slider-item">
            <span>{Math.round(drawOpacity * 100)}%</span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(drawOpacity * 100)}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
              className="cc-range-mini"
            />
          </div>
        </div>
      </>
    )}

    <div className="cc-tool-divider" />
    <div className="cc-tool-group">
      <button
        className="cc-tool-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Отменить (Ctrl+Z)"
      >
        ↩️
      </button>
      <button
        className="cc-tool-btn"
        onClick={onRedo}
        disabled={!canRedo}
        title="Повторить (Ctrl+Y)"
      >
        ↪️
      </button>
      <button
        className="cc-tool-btn cc-tool-btn-danger"
        onClick={onClearDrawings}
        title="Очистить рисунки"
      >
        🗑️
      </button>
    </div>
  </div>
);

export default ToolBar;
