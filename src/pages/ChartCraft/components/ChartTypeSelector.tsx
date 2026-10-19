import React from "react";
import type { ChartConfig, ChartType, ColumnInfo, StackMode } from "../types";
import { CHART_TYPES, canStack } from "../utils/constants";

interface Props {
  config: ChartConfig;
  x: ColumnInfo | undefined;
  onChangeType: (t: ChartType) => void;
  onChange: (u: Partial<ChartConfig>) => void;
}

/** Мини-иконки типов (currentColor — подстраиваются под тему). */
const ICONS: Record<ChartType, React.ReactNode> = {
  bar: (
    <>
      <rect x="4" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="16" y="9" width="4" height="11" rx="1" />
    </>
  ),
  barH: (
    <>
      <rect x="4" y="4" width="14" height="4" rx="1" />
      <rect x="4" y="10" width="10" height="4" rx="1" />
      <rect x="4" y="16" width="16" height="4" rx="1" />
    </>
  ),
  line: <polyline points="3,18 9,11 14,14 21,5" fill="none" strokeWidth="2" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" />,
  area: (
    <>
      <path d="M3 18 L9 10 L14 13 L21 5 V20 H3 Z" opacity="0.35" />
      <polyline points="3,18 9,10 14,13 21,5" fill="none" strokeWidth="2" stroke="currentColor" strokeLinejoin="round" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3 A9 9 0 1 0 21 12 H12 Z" opacity="0.45" />
      <path d="M13.5 1.5 A9 9 0 0 1 22.5 10.5 H13.5 Z" />
    </>
  ),
  donut: (
    <>
      <circle cx="12" cy="12" r="7.5" fill="none" strokeWidth="4" stroke="currentColor" opacity="0.4" />
      <path d="M12 4.5 A7.5 7.5 0 0 1 19.5 12" fill="none" strokeWidth="4" stroke="currentColor" />
    </>
  ),
  radar: (
    <>
      <polygon points="12,3 20.5,9 17.5,19.5 6.5,19.5 3.5,9" fill="none" strokeWidth="1.2" stroke="currentColor" opacity="0.5" />
      <polygon points="12,7 17,10 15,16 8,15 6.5,10" opacity="0.6" />
    </>
  ),
  scatter: (
    <>
      <circle cx="6" cy="17" r="1.8" />
      <circle cx="9" cy="13" r="1.8" />
      <circle cx="13" cy="14" r="1.8" />
      <circle cx="15" cy="9" r="1.8" />
      <circle cx="19" cy="6" r="1.8" />
      <line x1="4" y1="19" x2="21" y2="5" strokeWidth="1.2" stroke="currentColor" strokeDasharray="2 2" />
    </>
  ),
  composed: (
    <>
      <rect x="4" y="12" width="4" height="8" rx="1" opacity="0.5" />
      <rect x="10" y="9" width="4" height="11" rx="1" opacity="0.5" />
      <rect x="16" y="13" width="4" height="7" rx="1" opacity="0.5" />
      <polyline points="4,9 12,5 20,8" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
};

const STACKS: [StackMode, string][] = [
  ["none", "Рядом"],
  ["stacked", "Стопкой"],
  ["percent", "100 %"],
];

const ChartTypeSelector: React.FC<Props> = ({ config, x, onChangeType, onChange }) => {
  const n = config.yColumns.length;
  const t = config.chartType;
  return (
    <div className="cc-type-panel">
      <div className="cc-type-grid">
        {CHART_TYPES.map((info) => {
          const reason = info.unavailable(x, n);
          const selected = t === info.type;
          return (
            <button
              key={info.type}
              type="button"
              className={`cc-type-card ${selected ? "selected" : ""} ${reason ? "disabled" : ""}`}
              onClick={() => !reason && onChangeType(info.type)}
              disabled={!!reason}
              title={reason ?? info.description}
              aria-pressed={selected}
            >
              <svg className="cc-type-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {ICONS[info.type]}
              </svg>
              <span className="cc-type-label">{info.label}</span>
              <span className="cc-type-desc">{reason ?? info.description}</span>
            </button>
          );
        })}
      </div>

      {canStack(t) && n > 1 && (
        <div className="cc-field-group">
          <span className="cc-field-label">Несколько рядов</span>
          <div className="cc-segmented" role="radiogroup">
            {STACKS.map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={config.stack === v}
                className={config.stack === v ? "active" : ""}
                onClick={() => onChange({ stack: v })}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="cc-field-note">
            «Стопкой» — видно итог, «100 %» — доли каждого ряда в категории.
          </p>
        </div>
      )}

      {(t === "line" || t === "area" || t === "composed" || t === "radar") && (
        <div className="cc-toggles-grid">
          {t !== "radar" && (
            <label className="cc-toggle-item">
              <input type="checkbox" checked={config.smooth} onChange={(e) => onChange({ smooth: e.target.checked })} />
              <span>Сглаживать линии</span>
            </label>
          )}
          <label className="cc-toggle-item">
            <input type="checkbox" checked={config.showDots} onChange={(e) => onChange({ showDots: e.target.checked })} />
            <span>Точки на линии</span>
          </label>
        </div>
      )}

      {t === "scatter" && (
        <label className="cc-toggle-item">
          <input type="checkbox" checked={config.showTrend} onChange={(e) => onChange({ showTrend: e.target.checked })} />
          <span>Линия тренда и R² (сила связи)</span>
        </label>
      )}
    </div>
  );
};

export default ChartTypeSelector;
