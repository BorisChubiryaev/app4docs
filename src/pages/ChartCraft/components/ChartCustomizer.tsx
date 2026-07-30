import React from "react";
import type { ChartConfig, LegendPosition } from "../types";

interface Props {
  config: ChartConfig;
  yColumns: string[];
  onChange: (u: Partial<ChartConfig>) => void;
}

const ChartCustomizer: React.FC<Props> = ({ config, yColumns, onChange }) => {
  const handleColor = (i: number, c: string) => {
    const nc = [...config.colors];
    nc[i] = c;
    onChange({ colors: nc });
  };

  return (
    <div className="cc-customizer">
      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">📝 Заголовки</h4>
        <div className="cc-field-group">
          <label className="cc-field-label">Заголовок</label>
          <input
            type="text"
            value={config.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="cc-input"
            placeholder="Название графика"
          />
        </div>
        <div className="cc-field-group">
          <label className="cc-field-label">Подзаголовок</label>
          <input
            type="text"
            value={config.subtitle}
            onChange={(e) => onChange({ subtitle: e.target.value })}
            className="cc-input"
            placeholder="Описание"
          />
        </div>
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">🎨 Цвета</h4>
        <div className="cc-colors-grid">
          {yColumns.map((col, i) => (
            <div key={col} className="cc-color-item">
              <input
                type="color"
                value={config.colors[i] || "#3498db"}
                onChange={(e) => handleColor(i, e.target.value)}
                className="cc-color-input"
              />
              <span className="cc-color-label">{col}</span>
            </div>
          ))}
        </div>
        <div className="cc-field-group">
          <label className="cc-field-label">Фон графика</label>
          <div className="cc-color-item">
            <input
              type="color"
              value={config.backgroundColor}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="cc-color-input"
            />
            <span className="cc-color-label">{config.backgroundColor}</span>
          </div>
        </div>
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">👁️ Отображение</h4>
        <div className="cc-toggles-grid">
          {(
            [
              ["showLegend", "Легенда"],
              ["showGrid", "Сетка"],
              ["showValues", "Значения"],
              ["showTooltip", "Подсказки"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="cc-toggle-item">
              <input
                type="checkbox"
                checked={config[k] as boolean}
                onChange={(e) => onChange({ [k]: e.target.checked })}
              />
              <span>{l}</span>
            </label>
          ))}
        </div>
        {config.showLegend && (
          <div className="cc-field-group">
            <label className="cc-field-label">Позиция легенды</label>
            <select
              value={config.legendPosition}
              onChange={(e) =>
                onChange({ legendPosition: e.target.value as LegendPosition })
              }
              className="cc-select"
            >
              <option value="top">Сверху</option>
              <option value="bottom">Снизу</option>
              <option value="left">Слева</option>
              <option value="right">Справа</option>
            </select>
          </div>
        )}
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">⚙️ Параметры</h4>
        {(
          [
            { k: "borderRadius", l: "Скругление", min: 0, max: 20, s: "px" },
            {
              k: "fillOpacity",
              l: "Прозрачность",
              min: 0,
              max: 100,
              s: "%",
              tr: (v: number) => v / 100,
              dp: (v: number) => Math.round(v * 100),
            },
            { k: "strokeWidth", l: "Толщина линий", min: 1, max: 6, s: "px" },
            { k: "fontSize", l: "Шрифт", min: 8, max: 20, s: "px" },
          ] as const
        ).map(({ k, l, min, max, s, tr, dp }) => {
          const raw = config[k as keyof ChartConfig] as number;
          const dv = dp ? dp(raw) : raw;
          return (
            <div key={k} className="cc-field-group">
              <label className="cc-field-label">
                {l}: {dv}
                {s}
              </label>
              <input
                type="range"
                min={min}
                max={max}
                value={dv}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ [k]: tr ? tr(v) : v });
                }}
                className="cc-range"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChartCustomizer;
