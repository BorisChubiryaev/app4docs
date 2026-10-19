import React, { useEffect, useMemo, useState } from "react";
import ColumnSelector from "./ColumnSelector";
import ChartTypeSelector from "./ChartTypeSelector";
import ChartCustomizer from "./ChartCustomizer";
import ChartPreview from "./ChartPreview";
import ChartDataTable from "./ChartDataTable";
import type { ChartConfig, ChartInstance, ChartType, ColumnInfo, ParsedData } from "../types";
import { suggestChartType } from "../utils/dataParser";
import { buildChartData } from "../utils/chartData";
import { CHART_TYPES } from "../utils/constants";
import { MAX_SCATTER_SERIES } from "../utils/palettes";

interface Props {
  instance: ChartInstance;
  data: ParsedData;
  columns: ColumnInfo[];
  onSave: (id: string, config: ChartConfig) => void;
  onClose: () => void;
}

type Tab = "columns" | "type" | "style" | "axes";
const TABS: [Tab, string][] = [
  ["columns", "Данные"],
  ["type", "Тип"],
  ["style", "Оформление"],
  ["axes", "Оси"],
];

/**
 * Согласует конфиг после смены столбцов: пока тип выбран автоматически —
 * подбираем его заново; выбранный вручную не трогаем, если он ещё возможен.
 */
function reconcile(next: ChartConfig, columns: ColumnInfo[]): ChartConfig {
  const x = columns.find((c) => c.name === next.xColumn);
  const ys = columns.filter((c) => next.yColumns.includes(c.name));
  const info = CHART_TYPES.find((t) => t.type === next.chartType);
  const impossible = !!info?.unavailable(x, ys.length);
  if (next.autoType || impossible) {
    return { ...next, chartType: suggestChartType(x, ys), autoType: true };
  }
  return next;
}

const ChartEditor: React.FC<Props> = ({ instance, data, columns, onSave, onClose }) => {
  const [config, setConfig] = useState<ChartConfig>({ ...instance.config });
  const [tab, setTab] = useState<Tab>(instance.config.yColumns.length ? "type" : "columns");
  const [view, setView] = useState<"chart" | "table">("chart");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (u: Partial<ChartConfig>) =>
    setConfig((p) => {
      const next = { ...p, ...u };
      return "xColumn" in u || "yColumns" in u ? reconcile(next, columns) : next;
    });

  const changeType = (t: ChartType) =>
    setConfig((p) => ({
      ...p,
      chartType: t,
      autoType: false,
      yColumns: t === "scatter" ? p.yColumns.slice(0, MAX_SCATTER_SERIES) : p.yColumns,
      highlight: t === "bar" || t === "barH" ? p.highlight : null,
    }));

  const x = columns.find((c) => c.name === config.xColumn);
  const canPreview = !!config.xColumn && config.yColumns.length > 0;

  // Кому назначать цвета: долям круговой или рядам.
  const colorTargets = useMemo(() => {
    if (config.chartType !== "pie" && config.chartType !== "donut") return config.yColumns.slice(0, 8);
    const cd = buildChartData(data, config, columns);
    return cd.kind === "category" ? cd.points.filter((p) => !p.isOther).map((p) => p.name) : [];
  }, [data, config, columns]);

  return (
    <div className="cc-editor-overlay">
      <div
        className="cc-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Редактор графика"
      >
        <div className="cc-editor-header">
          <h2>Редактор графика{config.title && `: ${config.title}`}</h2>
          <button className="cc-editor-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="cc-editor-body">
          <div className="cc-editor-settings">
            <div className="ds-tabs ds-tabs--fill cc-editor-tabs" role="tablist">
              {TABS.map(([k, l]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={`ds-tab ${tab === k ? "ds-tab--active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="cc-editor-tab-content">
              {tab === "columns" && (
                <ColumnSelector data={data} columns={columns} config={config} onChange={patch} />
              )}
              {tab === "type" && (
                <ChartTypeSelector config={config} x={x} onChangeType={changeType} onChange={patch} />
              )}
              {(tab === "style" || tab === "axes") && (
                <ChartCustomizer
                  section={tab}
                  config={config}
                  colorTargets={colorTargets}
                  onChange={patch}
                />
              )}
            </div>
          </div>
          <div className="cc-editor-preview">
            <div className="cc-segmented cc-preview-switch" role="radiogroup" aria-label="Вид">
              {(
                [
                  ["chart", "График"],
                  ["table", "Таблица"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  className={view === v ? "active" : ""}
                  onClick={() => setView(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="cc-editor-preview-body">
              {!canPreview ? (
                <div className="cc-editor-preview-empty">
                  <p>Выберите категории (ось X) и хотя бы одно числовое значение на вкладке «Данные».</p>
                </div>
              ) : view === "chart" ? (
                <ChartPreview data={data} columns={columns} config={config} />
              ) : (
                <ChartDataTable data={data} columns={columns} config={config} />
              )}
            </div>
          </div>
        </div>
        <div className="cc-editor-footer">
          <button className="cc-button cc-button-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            className="cc-button cc-button-primary"
            onClick={() => onSave(instance.id, config)}
            disabled={!canPreview}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChartEditor;
