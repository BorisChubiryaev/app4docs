import React, { useState } from "react";
import ColumnSelector from "./ColumnSelector";
import ChartTypeSelector from "./ChartTypeSelector";
import ChartCustomizer from "./ChartCustomizer";
import ChartPreview from "./ChartPreview";
import type {
  ChartConfig,
  ChartInstance,
  ColumnInfo,
  ParsedData,
  ChartType,
} from "../types";
import { suggestChartType } from "../utils/dataParser";

interface Props {
  instance: ChartInstance;
  data: ParsedData;
  columns: ColumnInfo[];
  onSave: (id: string, config: ChartConfig) => void;
  onClose: () => void;
}

const ChartEditor: React.FC<Props> = ({
  instance,
  data,
  columns,
  onSave,
  onClose,
}) => {
  const [config, setConfig] = useState<ChartConfig>({ ...instance.config });
  const [tab, setTab] = useState<"columns" | "type" | "style">("columns");

  const handleColChange = (x: string, y: string[]) => {
    const infos = [
      columns.find((c) => c.name === x),
      ...columns.filter((c) => y.includes(c.name)),
    ].filter(Boolean) as ColumnInfo[];
    setConfig((p) => ({
      ...p,
      xColumn: x,
      yColumns: y,
      chartType: suggestChartType(infos, data.rows.length),
    }));
  };

  const canPreview = config.xColumn && config.yColumns.length > 0;

  return (
    <div className="cc-editor-overlay" onClick={onClose}>
      <div className="cc-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-editor-header">
          <h2>✏️ Редактор{config.title && `: ${config.title}`}</h2>
          <button className="cc-editor-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cc-editor-body">
          <div className="cc-editor-settings">
            <div className="ds-tabs ds-tabs--fill cc-editor-tabs">
              {(
                [
                  ["columns", "📋 Данные"],
                  ["type", "📊 Тип"],
                  ["style", "🎨 Стиль"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`ds-tab ${tab === k ? "ds-tab--active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="cc-editor-tab-content">
              {tab === "columns" && (
                <ColumnSelector
                  columns={columns}
                  xColumn={config.xColumn}
                  yColumns={config.yColumns}
                  onChange={handleColChange}
                />
              )}
              {tab === "type" && (
                <ChartTypeSelector
                  selectedType={config.chartType}
                  onChange={(t: ChartType) =>
                    setConfig((p) => ({ ...p, chartType: t }))
                  }
                  yColumnsCount={config.yColumns.length}
                />
              )}
              {tab === "style" && (
                <ChartCustomizer
                  config={config}
                  yColumns={config.yColumns}
                  onChange={(u) => setConfig((p) => ({ ...p, ...u }))}
                />
              )}
            </div>
          </div>
          <div className="cc-editor-preview">
            {canPreview ? (
              <ChartPreview data={data} config={config} />
            ) : (
              <div className="cc-editor-preview-empty">
                <span>📊</span>
                <p>Выберите столбцы</p>
              </div>
            )}
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
            ✓ Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChartEditor;
