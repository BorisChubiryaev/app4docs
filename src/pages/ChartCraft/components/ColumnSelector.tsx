import React from "react";
import type { ColumnInfo } from "../types";

interface Props {
  columns: ColumnInfo[];
  xColumn: string;
  yColumns: string[];
  onChange: (xCol: string, yCols: string[]) => void;
}

const icons: Record<string, string> = {
  numeric: "🔢",
  category: "🏷️",
  date: "📅",
  unknown: "❓",
};

const ColumnSelector: React.FC<Props> = ({
  columns,
  xColumn,
  yColumns,
  onChange,
}) => (
  <div className="cc-column-selector">
    <div className="cc-field-group">
      <label className="cc-field-label">Ось X (категории)</label>
      <select
        value={xColumn}
        onChange={(e) => onChange(e.target.value, yColumns)}
        className="cc-select"
      >
        <option value="">-- Выберите --</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {icons[c.type]} {c.name} ({c.uniqueCount} уник.)
          </option>
        ))}
      </select>
    </div>
    <div className="cc-field-group">
      <label className="cc-field-label">Ось Y (значения)</label>
      <div className="cc-checkbox-grid">
        {columns
          .filter((c) => c.name !== xColumn)
          .map((col) => (
            <label
              key={col.name}
              className={`cc-checkbox-item ${yColumns.includes(col.name) ? "selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={yColumns.includes(col.name)}
                onChange={() => {
                  const ny = yColumns.includes(col.name)
                    ? yColumns.filter((c) => c !== col.name)
                    : [...yColumns, col.name];
                  onChange(xColumn, ny);
                }}
                className="cc-checkbox-input"
              />
              <div className="cc-checkbox-content">
                <span className="cc-checkbox-icon">{icons[col.type]}</span>
                <span className="cc-checkbox-name">{col.name}</span>
                <span className="cc-checkbox-type">{col.type}</span>
                {col.min !== undefined && (
                  <span className="cc-checkbox-range">
                    {col.min.toFixed(1)}–{col.max?.toFixed(1)}
                  </span>
                )}
              </div>
            </label>
          ))}
      </div>
    </div>
  </div>
);

export default ColumnSelector;
