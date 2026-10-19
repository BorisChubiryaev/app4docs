import React from "react";
import type {
  ChartConfig,
  ChartTheme,
  LegendPosition,
  NumberUnit,
  ReferenceLineMode,
  ValueLabels,
} from "../types";
import { CHROME, PALETTE, seriesColor } from "../utils/palettes";

interface Props {
  section: "style" | "axes";
  config: ChartConfig;
  /** Имена рядов (или долей круговой) — для выбора цветов. */
  colorTargets: string[];
  onChange: (u: Partial<ChartConfig>) => void;
}

const Toggle: React.FC<{ checked: boolean; label: string; onChange: (v: boolean) => void }> = ({
  checked,
  label,
  onChange,
}) => (
  <label className="cc-toggle-item">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

const Range: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, suffix = "px", onChange }) => (
  <div className="cc-field-group">
    <label className="cc-field-label">
      {label}: {value}
      {suffix}
    </label>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="cc-range"
    />
  </div>
);

const numOrNull = (s: string): number | null => {
  const n = Number(s.replace(",", ".").replace(/\s/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

const ChartCustomizer: React.FC<Props> = ({ section, config, colorTargets, onChange }) => {
  const t = config.chartType;
  const isPie = t === "pie" || t === "donut";
  const hasBars = t === "bar" || t === "barH" || t === "composed";
  const hasLines = t === "line" || t === "area" || t === "composed" || t === "radar";
  const legendMatters = isPie || config.yColumns.length > 1;

  if (section === "axes") {
    return (
      <div className="cc-customizer">
        {!isPie && t !== "radar" && (
          <div className="cc-customizer-group">
            <h4 className="cc-customizer-group-title">Подписи осей</h4>
            <div className="cc-field-group">
              <label className="cc-field-label" htmlFor="cc-xl">
                {t === "scatter" ? "Ось X" : "Ось категорий"}
              </label>
              <input
                id="cc-xl"
                className="cc-input"
                value={config.xAxisLabel}
                placeholder={config.xColumn}
                onChange={(e) => onChange({ xAxisLabel: e.target.value })}
              />
            </div>
            <div className="cc-field-group">
              <label className="cc-field-label" htmlFor="cc-yl">
                {t === "scatter" ? "Ось Y" : "Ось значений"}
              </label>
              <input
                id="cc-yl"
                className="cc-input"
                value={config.yAxisLabel}
                placeholder="например, «тыс. ₽»"
                onChange={(e) => onChange({ yAxisLabel: e.target.value })}
              />
            </div>
            {config.stack !== "percent" && (
              <div className="cc-inline cc-field-group">
                <label className="cc-field-label" htmlFor="cc-ymin">
                  Мин.
                </label>
                <input
                  id="cc-ymin"
                  className="cc-input cc-input-small"
                  inputMode="decimal"
                  placeholder="авто"
                  defaultValue={config.yMin ?? ""}
                  onBlur={(e) => onChange({ yMin: numOrNull(e.target.value) })}
                />
                <label className="cc-field-label" htmlFor="cc-ymax">
                  Макс.
                </label>
                <input
                  id="cc-ymax"
                  className="cc-input cc-input-small"
                  inputMode="decimal"
                  placeholder="авто"
                  defaultValue={config.yMax ?? ""}
                  onBlur={(e) => onChange({ yMax: numOrNull(e.target.value) })}
                />
              </div>
            )}
          </div>
        )}

        <div className="cc-customizer-group">
          <h4 className="cc-customizer-group-title">Числа</h4>
          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-unit">
              Сокращение
            </label>
            <select
              id="cc-unit"
              className="cc-select"
              value={config.unit}
              onChange={(e) => onChange({ unit: e.target.value as NumberUnit })}
            >
              <option value="auto">Авто (12,3 тыс. / 4,5 млн)</option>
              <option value="none">Без сокращений (12 345)</option>
              <option value="thousands">В тысячах</option>
              <option value="millions">В миллионах</option>
              <option value="billions">В миллиардах</option>
            </select>
          </div>
          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-dec">
              Знаков после запятой
            </label>
            <select
              id="cc-dec"
              className="cc-select"
              value={config.decimals}
              onChange={(e) => onChange({ decimals: Number(e.target.value) })}
            >
              <option value={-1}>Авто</option>
              {[0, 1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="cc-inline cc-field-group">
            <input
              className="cc-input cc-input-small"
              aria-label="Перед числом"
              placeholder="перед"
              value={config.prefix}
              onChange={(e) => onChange({ prefix: e.target.value })}
            />
            <span className="cc-field-hint">123</span>
            <input
              className="cc-input cc-input-small"
              aria-label="После числа"
              placeholder="после"
              value={config.suffix}
              onChange={(e) => onChange({ suffix: e.target.value })}
            />
          </div>
          <div className="cc-chips">
            {[
              ["₽", "", " ₽"],
              ["$", "$", ""],
              ["€", "", " €"],
              ["%", "", " %"],
              ["шт.", "", " шт."],
              ["Убрать", "", ""],
            ].map(([l, pre, suf]) => (
              <button
                key={l}
                type="button"
                className="cc-chip"
                onClick={() => onChange({ prefix: pre, suffix: suf })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {!isPie && t !== "radar" && config.stack !== "percent" && (
          <div className="cc-customizer-group">
            <h4 className="cc-customizer-group-title">Линия-ориентир</h4>
            <div className="cc-field-group">
              <select
                className="cc-select"
                aria-label="Линия-ориентир"
                value={config.referenceLine}
                onChange={(e) => onChange({ referenceLine: e.target.value as ReferenceLineMode })}
              >
                <option value="none">Нет</option>
                {t !== "scatter" && <option value="average">Среднее по первому ряду</option>}
                <option value="value">Своё значение (план, цель, норма)</option>
              </select>
            </div>
            {config.referenceLine === "value" && (
              <div className="cc-field-group">
                <input
                  className="cc-input"
                  inputMode="decimal"
                  placeholder="Значение, например 100000"
                  defaultValue={config.referenceValue ?? ""}
                  onBlur={(e) => onChange({ referenceValue: numOrNull(e.target.value) })}
                />
              </div>
            )}
            {config.referenceLine !== "none" && (
              <input
                className="cc-input"
                placeholder={config.referenceLine === "average" ? "Подпись: Среднее" : "Подпись: Цель"}
                value={config.referenceLabel}
                onChange={(e) => onChange({ referenceLabel: e.target.value })}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Оформление ──
  const setTheme = (theme: ChartTheme) =>
    onChange({ theme, backgroundColor: CHROME[theme].surface });

  return (
    <div className="cc-customizer">
      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">Заголовки</h4>
        <div className="cc-field-group">
          <input
            className="cc-input"
            aria-label="Заголовок"
            value={config.title}
            placeholder="Заголовок графика"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div className="cc-field-group">
          <input
            className="cc-input"
            aria-label="Подзаголовок"
            value={config.subtitle}
            placeholder="Подзаголовок: период, источник, единицы"
            onChange={(e) => onChange({ subtitle: e.target.value })}
          />
        </div>
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">Цвета</h4>
        <div className="cc-segmented" role="radiogroup" aria-label="Тема графика">
          {(
            [
              ["light", "Светлый"],
              ["dark", "Тёмный"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={config.theme === v}
              className={config.theme === v ? "active" : ""}
              onClick={() => setTheme(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="cc-colors-grid">
          {colorTargets.map((name, i) => (
            <label key={`${name}-${i}`} className="cc-color-item" title={name}>
              <input
                type="color"
                value={seriesColor(config.theme, config.colors, i)}
                onChange={(e) => {
                  const nc = [...config.colors];
                  nc[i] = e.target.value;
                  onChange({ colors: nc });
                }}
                className="cc-color-input"
              />
              <span className="cc-color-label">{name}</span>
            </label>
          ))}
        </div>
        {config.colors.some(Boolean) && (
          <button type="button" className="cc-link-btn" onClick={() => onChange({ colors: [] })}>
            Вернуть цвета палитры
          </button>
        )}
        <p className="cc-field-note">
          Палитра проверена на различимость при нарушениях цветового зрения:{" "}
          {PALETTE[config.theme].slice(0, 8).map((c) => (
            <span key={c} className="cc-mini-swatch" style={{ background: c }} />
          ))}
        </p>
        <div className="cc-field-group cc-inline">
          <label className="cc-field-label" htmlFor="cc-bg">
            Фон
          </label>
          <input
            id="cc-bg"
            type="color"
            value={config.backgroundColor}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="cc-color-input"
          />
          {config.backgroundColor !== CHROME[config.theme].surface && (
            <button
              type="button"
              className="cc-link-btn"
              onClick={() => onChange({ backgroundColor: CHROME[config.theme].surface })}
            >
              по теме
            </button>
          )}
        </div>
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">Что показывать</h4>
        <div className="cc-toggles-grid">
          {legendMatters && (
            <Toggle label="Легенда" checked={config.showLegend} onChange={(v) => onChange({ showLegend: v })} />
          )}
          {!isPie && <Toggle label="Сетка" checked={config.showGrid} onChange={(v) => onChange({ showGrid: v })} />}
          <Toggle label="Подсказки" checked={config.showTooltip} onChange={(v) => onChange({ showTooltip: v })} />
          {(t === "bar" || t === "line" || t === "area" || t === "composed") && (
            <Toggle label="Ползунок прокрутки" checked={config.showBrush} onChange={(v) => onChange({ showBrush: v })} />
          )}
        </div>
        {legendMatters && config.showLegend && (
          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-lp">
              Где легенда
            </label>
            <select
              id="cc-lp"
              className="cc-select"
              value={config.legendPosition}
              onChange={(e) => onChange({ legendPosition: e.target.value as LegendPosition })}
            >
              <option value="bottom">Снизу</option>
              <option value="top">Сверху</option>
              <option value="right">Справа</option>
              <option value="left">Слева</option>
            </select>
          </div>
        )}
        <div className="cc-field-group">
          <label className="cc-field-label" htmlFor="cc-vl">
            {isPie ? "Подписи долей" : "Подписи значений"}
          </label>
          <select
            id="cc-vl"
            className="cc-select"
            value={config.valueLabels}
            onChange={(e) => onChange({ valueLabels: e.target.value as ValueLabels })}
          >
            <option value="none">Нет</option>
            <option value="all">{isPie ? "Название и доля" : "У всех"}</option>
            {!isPie && <option value="last">Только последнее</option>}
            {!isPie && <option value="extremes">Максимум и минимум</option>}
          </select>
        </div>
      </div>

      <div className="cc-customizer-group">
        <h4 className="cc-customizer-group-title">Размеры</h4>
        {hasBars && (
          <>
            <Range label="Ширина столбцов" value={config.barSize} min={8} max={80} onChange={(v) => onChange({ barSize: v })} />
            <Range label="Скругление" value={config.borderRadius} min={0} max={16} onChange={(v) => onChange({ borderRadius: v })} />
          </>
        )}
        {hasLines && (
          <Range label="Толщина линий" value={config.strokeWidth} min={1} max={6} onChange={(v) => onChange({ strokeWidth: v })} />
        )}
        <Range label="Шрифт" value={config.fontSize} min={9} max={22} onChange={(v) => onChange({ fontSize: v })} />
      </div>
    </div>
  );
};

export default ChartCustomizer;
