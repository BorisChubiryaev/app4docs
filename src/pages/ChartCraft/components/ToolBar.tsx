import React from "react";
import type { CanvasTool } from "../types";
import { DRAW_COLORS } from "../utils/constants";
import { Icon, type IconName } from "./icons";

interface Props {
  activeTool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  drawColor: string;
  onColorChange: (c: string) => void;
  drawWidth: number;
  onWidthChange: (w: number) => void;
  drawOpacity: number;
  onOpacityChange: (o: number) => void;
  hasDrawings: boolean;
  onClearDrawings: () => void;
}

/** Инструменты холста; буква — горячая клавиша (обрабатывается в ChartCraft). */
const TOOLS: { tool: CanvasTool; icon: IconName; label: string; key: string }[] = [
  { tool: "select", icon: "select", label: "Выбор и перенос", key: "V" },
  { tool: "draw", icon: "pencil", label: "Карандаш", key: "P" },
  { tool: "arrow", icon: "arrow", label: "Стрелка", key: "A" },
  { tool: "rect", icon: "rect", label: "Рамка", key: "R" },
  { tool: "text", icon: "text", label: "Надпись", key: "T" },
  { tool: "eraser", icon: "eraser", label: "Ластик", key: "E" },
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
  hasDrawings,
  onClearDrawings,
}) => {
  const drawing = activeTool !== "select" && activeTool !== "eraser";
  return (
    <div className="cc-toolbar-draw" role="toolbar" aria-label="Инструменты холста">
      <div className="cc-iconbar" role="radiogroup" aria-label="Инструмент">
        {TOOLS.map(({ tool, icon, label, key }) => (
          <button
            key={tool}
            type="button"
            role="radio"
            aria-checked={activeTool === tool}
            className={`cc-icon-btn ${activeTool === tool ? "active" : ""}`}
            onClick={() => onToolChange(tool)}
            title={`${label} (${key})`}
            aria-label={label}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>

      {drawing && (
        <>
          <div className="cc-tool-divider" />
          <div className="cc-quick-colors" role="radiogroup" aria-label="Цвет">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={drawColor === c}
                aria-label={c}
                className={`cc-quick-color ${drawColor === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => onColorChange(c)}
              />
            ))}
          </div>
          {activeTool !== "text" && (
            <>
              <div className="cc-tool-divider" />
              <label className="cc-slider-item" title="Толщина линии">
                <span>Толщина</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={drawWidth}
                  onChange={(e) => onWidthChange(Number(e.target.value))}
                  className="cc-range-mini"
                />
                <span className="cc-slider-value">{drawWidth}</span>
              </label>
              <label className="cc-slider-item" title="Прозрачность">
                <span>Непрозр.</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(drawOpacity * 100)}
                  onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
                  className="cc-range-mini"
                />
                <span className="cc-slider-value">{Math.round(drawOpacity * 100)}%</span>
              </label>
            </>
          )}
        </>
      )}

      <span className="cc-tool-hint">
        {activeTool === "select"
          ? "Тяните график за шапку · двойной клик — настроить"
          : activeTool === "text"
            ? "Кликните на холст и введите текст · двойной клик — изменить"
            : activeTool === "eraser"
              ? "Кликните по рисунку или надписи, чтобы удалить"
              : "Рисуйте мышью на холсте · Esc — выбор"}
      </span>

      {hasDrawings && (
        <button type="button" className="cc-text-btn" onClick={onClearDrawings} title="Удалить все рисунки и надписи">
          <Icon name="trash" size={16} />
          Стереть рисунки
        </button>
      )}
    </div>
  );
};

export default ToolBar;
