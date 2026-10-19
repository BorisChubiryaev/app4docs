import React from "react";
import type { ParsedData } from "../types";

interface Props {
  data: ParsedData;
  maxRows?: number;
}

const DataPreviewTable: React.FC<Props> = ({ data, maxRows = 10 }) => {
  const rows = data.rows.slice(0, maxRows);
  return (
    <div className="cc-data-preview">
      <h3 className="cc-data-preview-title">
        Исходные данные
        <span className="cc-data-preview-count">
          {data.totalRows}×{data.headers.length}
        </span>
      </h3>
      <div className="cc-table-container">
        <table className="cc-data-table">
          <thead>
            <tr>
              {data.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {data.headers.map((h) => {
                  const v = r[h];
                  return typeof v === "number" ? (
                    <td key={h} className="num">
                      {v.toLocaleString("ru-RU", { maximumFractionDigits: 6 })}
                    </td>
                  ) : (
                    <td key={h}>{v != null && v !== "" ? String(v) : "—"}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.totalRows > maxRows && (
        <p className="cc-data-preview-more">
          Показано {maxRows} из {data.totalRows}
        </p>
      )}
    </div>
  );
};

export default DataPreviewTable;
