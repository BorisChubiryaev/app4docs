import React from "react";
import type { ChartType } from "../types";
import { CHART_TYPE_INFO } from "../utils/constants";

interface Props {
  selectedType: ChartType;
  onChange: (t: ChartType) => void;
  yColumnsCount: number;
}

const ChartTypeSelector: React.FC<Props> = ({
  selectedType,
  onChange,
  yColumnsCount,
}) => (
  <div className="cc-type-grid">
    {CHART_TYPE_INFO.map((i) => {
      const dis = i.type === "pie" && yColumnsCount > 1;
      return (
        <button
          key={i.type}
          className={`cc-type-card ${selectedType === i.type ? "selected" : ""} ${dis ? "disabled" : ""}`}
          onClick={() => !dis && onChange(i.type)}
          disabled={dis}
        >
          <span className="cc-type-icon">{i.icon}</span>
          <span className="cc-type-label">{i.label}</span>
          <span className="cc-type-desc">{i.description}</span>
          {selectedType === i.type && <span className="cc-type-check">✓</span>}
        </button>
      );
    })}
  </div>
);

export default ChartTypeSelector;
