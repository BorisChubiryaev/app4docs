import React from "react";
import type { CanvasSettings, CanvasBackground } from "../types";
import { CANVAS_PRESETS } from "../utils/constants";

interface Props {
  settings: CanvasSettings;
  onChange: (u: Partial<CanvasSettings>) => void;
}

const PATTERNS: { value: CanvasBackground; label: string; icon: string }[] = [
  { value: "dots", label: "Точки", icon: "⚬" },
  { value: "grid", label: "Сетка", icon: "▦" },
  { value: "lines", label: "Линии", icon: "☰" },
  { value: "none", label: "Нет", icon: "▢" },
];

const BG_PRESETS = [
  { color: "#f5f6fa", label: "Светлый" },
  { color: "#ffffff", label: "Белый" },
  { color: "#1a1a2e", label: "Тёмный" },
  { color: "#f0f5e9", label: "Зелёный" },
  { color: "#fdf2e9", label: "Тёплый" },
  { color: "#eaf2f8", label: "Голубой" },
  { color: "#f9ebea", label: "Розовый" },
  { color: "#f4ecf7", label: "Лавандовый" },
];

const CanvasSettingsPanel: React.FC<Props> = ({ settings, onChange }) => {
  const handlePreset = (name: string) => {
    const preset = CANVAS_PRESETS.find((p) => p.name === name);
    if (preset)
      onChange({
        canvasWidth: preset.width,
        canvasHeight: preset.height,
        presetName: name,
      });
  };

  return (
    <div className="cc-canvas-settings">
      {/* Size presets */}
      <div className="cc-canvas-settings-group">
        <label className="cc-field-label">Размер холста</label>
        <div className="cc-size-presets">
          {CANVAS_PRESETS.map((p) => (
            <button
              key={p.name}
              className={`cc-size-preset-btn ${settings.presetName === p.name ? "active" : ""}`}
              onClick={() => handlePreset(p.name)}
              title={`${p.width}×${p.height}`}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        {settings.presetName === "custom" && (
          <div className="cc-custom-size">
            <div className="cc-size-input-group">
              <label>Ш:</label>
              <input
                type="number"
                value={settings.canvasWidth}
                min={400}
                max={7680}
                onChange={(e) =>
                  onChange({ canvasWidth: Number(e.target.value) })
                }
                className="cc-input cc-input-small"
              />
            </div>
            <span>×</span>
            <div className="cc-size-input-group">
              <label>В:</label>
              <input
                type="number"
                value={settings.canvasHeight}
                min={300}
                max={4320}
                onChange={(e) =>
                  onChange({ canvasHeight: Number(e.target.value) })
                }
                className="cc-input cc-input-small"
              />
            </div>
          </div>
        )}
        <div className="cc-size-display">
          {settings.canvasWidth} × {settings.canvasHeight} px
        </div>
      </div>

      {/* Background color */}
      <div className="cc-canvas-settings-group">
        <label className="cc-field-label">Цвет фона</label>
        <div className="cc-preset-colors">
          {BG_PRESETS.map((p) => (
            <button
              key={p.color}
              className={`cc-preset-color-btn ${settings.backgroundColor === p.color ? "active" : ""}`}
              style={{ backgroundColor: p.color }}
              onClick={() => onChange({ backgroundColor: p.color })}
              title={p.label}
            />
          ))}
          <input
            type="color"
            value={settings.backgroundColor}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="cc-color-input-small"
          />
        </div>
      </div>

      {/* Pattern */}
      <div className="cc-canvas-settings-group">
        <label className="cc-field-label">Паттерн</label>
        <div className="cc-pattern-options">
          {PATTERNS.map((o) => (
            <button
              key={o.value}
              className={`cc-pattern-btn ${settings.backgroundPattern === o.value ? "active" : ""}`}
              onClick={() => onChange({ backgroundPattern: o.value })}
            >
              <span>{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {settings.backgroundPattern !== "none" && (
        <div className="cc-canvas-settings-group cc-inline-settings">
          <div>
            <label className="cc-field-label">Цвет</label>
            <input
              type="color"
              value={settings.patternColor}
              onChange={(e) => onChange({ patternColor: e.target.value })}
              className="cc-color-input"
            />
          </div>
          <div>
            <label className="cc-field-label">
              Размер: {settings.patternSize}px
            </label>
            <input
              type="range"
              min={10}
              max={50}
              value={settings.patternSize}
              onChange={(e) =>
                onChange({ patternSize: Number(e.target.value) })
              }
              className="cc-range"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasSettingsPanel;
