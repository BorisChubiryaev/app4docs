import React, { useState } from "react";
import type { ChartConfig, ParsedData } from "../types";
import { EXPORT_FORMATS } from "../utils/constants";
import { exportToPng, exportToSvg, exportToHtml } from "../utils/exportUtils";

interface Props {
  chartRef: React.RefObject<HTMLDivElement>;
  config: ChartConfig;
  data: ParsedData;
  onBack: () => void;
}

const ExportPanel: React.FC<Props> = ({ chartRef, config, data, onBack }) => {
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileName = config.title || "chart";

  const handleExport = async (type: string) => {
    setExporting(type);
    setExportError(null);

    try {
      switch (type) {
        case "png":
          if (chartRef.current) {
            await exportToPng(chartRef.current, fileName);
          }
          break;
        case "svg":
          if (chartRef.current) {
            await exportToSvg(chartRef.current, fileName);
          }
          break;
        case "html":
          exportToHtml(config, data, fileName);
          break;
      }
    } catch (err: any) {
      setExportError(err.message || "Ошибка экспорта");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="cc-export-panel">
      <h4 className="cc-customizer-group-title">📦 Экспорт графика</h4>

      {exportError && <div className="cc-export-error">⚠️ {exportError}</div>}

      <div className="cc-export-grid">
        {EXPORT_FORMATS.map((format) => (
          <button
            key={format.type}
            className={`cc-export-card ${exporting === format.type ? "exporting" : ""}`}
            onClick={() => handleExport(format.type)}
            disabled={exporting !== null}
          >
            <span className="cc-export-icon">{format.icon}</span>
            <span className="cc-export-label">{format.label}</span>
            <span className="cc-export-desc">{format.description}</span>
            {exporting === format.type && <div className="cc-export-spinner" />}
          </button>
        ))}
      </div>

      <div className="cc-nav-buttons">
        <button className="cc-button cc-button-secondary" onClick={onBack}>
          ← Назад
        </button>
      </div>
    </div>
  );
};

export default ExportPanel;
