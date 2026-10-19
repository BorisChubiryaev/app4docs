import React, { useMemo } from "react";
import type { Aggregation, ChartConfig, ColumnInfo, ParsedData, SortMode } from "../types";
import { AGGREGATION_LABELS, buildChartData, PIE_DEFAULT_SLICES, PIE_MAX_SLICES } from "../utils/chartData";
import { MAX_SCATTER_SERIES, MAX_SERIES } from "../utils/palettes";
import { formatPlain } from "../utils/formatUtils";

interface Props {
  data: ParsedData;
  columns: ColumnInfo[];
  config: ChartConfig;
  onChange: (u: Partial<ChartConfig>) => void;
}

const TYPE_LABEL: Record<ColumnInfo["type"], string> = {
  numeric: "числа",
  category: "текст",
  date: "даты",
  unknown: "пусто",
};
const TYPE_ICON: Record<ColumnInfo["type"], string> = {
  numeric: "🔢",
  category: "🏷️",
  date: "📅",
  unknown: "▫️",
};

const SORTS: [SortMode, string][] = [
  ["none", "Как в таблице (даты — по времени)"],
  ["valueDesc", "По значению: от большего"],
  ["valueAsc", "По значению: от меньшего"],
  ["labelAsc", "По названию: А → Я"],
];

const ColumnSelector: React.FC<Props> = ({ data, columns, config, onChange }) => {
  const x = columns.find((c) => c.name === config.xColumn);
  const isPie = config.chartType === "pie" || config.chartType === "donut";
  const isScatter = config.chartType === "scatter";
  const maxY = isPie ? 1 : isScatter ? MAX_SCATTER_SERIES : MAX_SERIES;
  const repeats = !!x && !isScatter && x.uniqueCount < x.filledCount;

  // Категории для «Выделить» — уже после группировки и сортировки.
  const categories = useMemo(() => {
    const cd = buildChartData(data, { ...config, highlight: null }, columns);
    return cd.kind === "category" ? cd.points.filter((p) => !p.isOther).map((p) => p.name) : [];
  }, [data, config, columns]);

  const toggleY = (name: string) => {
    if (config.yColumns.includes(name)) {
      onChange({ yColumns: config.yColumns.filter((c) => c !== name) });
    } else if (isPie) {
      onChange({ yColumns: [name] }); // у круговой ряд один — заменяем
    } else if (config.yColumns.length < maxY) {
      onChange({ yColumns: [...config.yColumns, name] });
    }
  };

  return (
    <div className="cc-column-selector">
      <div className="cc-field-group">
        <label className="cc-field-label" htmlFor="cc-x">
          {isScatter ? "Ось X (числа)" : "Категории — ось X"}
        </label>
        <select
          id="cc-x"
          value={config.xColumn}
          onChange={(e) =>
            onChange({
              xColumn: e.target.value,
              yColumns: config.yColumns.filter((y) => y !== e.target.value),
              highlight: null,
            })
          }
          className="cc-select"
        >
          <option value="">— выберите столбец —</option>
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {TYPE_ICON[c.type]} {c.name} · {TYPE_LABEL[c.type]}, {c.uniqueCount} разн.
            </option>
          ))}
        </select>
      </div>

      <div className="cc-field-group">
        <label className="cc-field-label">
          Значения — ось Y{" "}
          <span className="cc-field-hint">
            {isPie ? "(один столбец)" : `(до ${maxY})`}
          </span>
        </label>
        <div className="cc-checkbox-grid">
          {columns
            .filter((c) => c.name !== config.xColumn)
            .map((col) => {
              const selected = config.yColumns.includes(col.name);
              const numeric = col.type === "numeric";
              const full = !selected && !isPie && config.yColumns.length >= maxY;
              const disabled = !numeric || full;
              return (
                <label
                  key={col.name}
                  className={`cc-checkbox-item ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                  title={
                    !numeric
                      ? "В этом столбце не числа — его нельзя отложить по оси значений"
                      : full
                        ? `Не больше ${maxY} рядов — иначе цвета начнут путаться`
                        : undefined
                  }
                >
                  <input
                    type={isPie ? "radio" : "checkbox"}
                    name="cc-y"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => toggleY(col.name)}
                    className="cc-checkbox-input"
                  />
                  <div className="cc-checkbox-content">
                    <span className="cc-checkbox-icon">{TYPE_ICON[col.type]}</span>
                    <span className="cc-checkbox-name">{col.name}</span>
                    <span className="cc-checkbox-type">
                      {numeric && col.min !== undefined
                        ? `${formatPlain(col.min)} … ${formatPlain(col.max)}`
                        : TYPE_LABEL[col.type]}
                    </span>
                  </div>
                </label>
              );
            })}
        </div>
      </div>

      {!isScatter && (
        <>
          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-agg">
              Одинаковые категории
            </label>
            <select
              id="cc-agg"
              className="cc-select"
              value={config.aggregation}
              onChange={(e) => onChange({ aggregation: e.target.value as Aggregation })}
            >
              {(Object.keys(AGGREGATION_LABELS) as Aggregation[]).map((a) => (
                <option key={a} value={a}>
                  {AGGREGATION_LABELS[a]}
                </option>
              ))}
            </select>
            {repeats && x && (
              <p className="cc-field-note">
                В «{x.name}» {x.filledCount} строк, но только {x.uniqueCount} разных значений.
                {config.aggregation === "none"
                  ? " Сейчас каждая строка — отдельная точка: выберите «Сумма» или «Среднее», чтобы объединить."
                  : ` Строки с одинаковым значением объединяются (${AGGREGATION_LABELS[config.aggregation].toLowerCase()}).`}
              </p>
            )}
          </div>

          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-sort">
              Порядок
            </label>
            <select
              id="cc-sort"
              className="cc-select"
              value={config.sort}
              onChange={(e) => onChange({ sort: e.target.value as SortMode })}
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="cc-field-group">
            <label className="cc-field-label" htmlFor="cc-top">
              Сколько показывать
            </label>
            <div className="cc-inline">
              <input
                id="cc-top"
                type="number"
                min={0}
                max={isPie ? PIE_MAX_SLICES : 500}
                className="cc-input cc-input-small"
                value={config.topN || ""}
                placeholder={isPie ? String(PIE_DEFAULT_SLICES) : "все"}
                onChange={(e) => onChange({ topN: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="cc-field-hint">
                {isPie
                  ? `крупнейших долей (до ${PIE_MAX_SLICES}), остальное — «Другое»`
                  : "крупнейших категорий; пусто — все"}
              </span>
            </div>
            {!isPie && config.topN > 0 && (
              <label className="cc-toggle-item">
                <input
                  type="checkbox"
                  checked={config.otherBucket}
                  onChange={(e) => onChange({ otherBucket: e.target.checked })}
                />
                <span>Остальное сложить в «Другое»</span>
              </label>
            )}
          </div>

          {(config.chartType === "bar" || config.chartType === "barH") &&
            config.yColumns.length === 1 &&
            categories.length > 1 && (
            <div className="cc-field-group">
              <label className="cc-field-label" htmlFor="cc-hl">
                Выделить категорию
              </label>
              <select
                id="cc-hl"
                className="cc-select"
                value={config.highlight ?? ""}
                onChange={(e) => onChange({ highlight: e.target.value || null })}
              >
                <option value="">— не выделять —</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="cc-field-note">
                Нужная категория останется цветной, остальные станут серыми — так взгляд сразу
                находит главное.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ColumnSelector;
