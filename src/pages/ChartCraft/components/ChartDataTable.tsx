// Таблица данных графика — те же числа, что на графике (после группировки
// и топ-N). Нужна, чтобы значение можно было прочитать без наведения мыши
// и не полагаться только на цвет; её же можно скопировать в Excel.

import React, { useMemo, useState } from "react";
import type { ChartConfig, ColumnInfo, ParsedData } from "../types";
import { buildChartData } from "../utils/chartData";
import { formatValue, type NumberFormat } from "../utils/formatUtils";
import { plural } from "../../../utils/plural";

interface Props {
  data: ParsedData;
  columns: ColumnInfo[];
  config: ChartConfig;
}

const MAX_ROWS = 500;

const ChartDataTable: React.FC<Props> = ({ data, columns, config }) => {
  const cd = useMemo(() => buildChartData(data, config, columns), [data, config, columns]);
  const [copied, setCopied] = useState(false);
  const nfmt: NumberFormat = {
    unit: "none",
    decimals: config.decimals,
    prefix: config.prefix,
    suffix: config.suffix,
  };

  if (cd.kind === "empty") return <p className="cc-table-empty">{cd.reason}</p>;

  const headers =
    cd.kind === "scatter"
      ? [config.xColumn, ...cd.series.map((s) => s.name)]
      : [config.xColumn || "Категория", ...cd.series.map((s) => s.name)];

  const rows: (string | number | null)[][] =
    cd.kind === "scatter"
      ? cd.series.flatMap((s, si) =>
          s.points.map((p) => [p.x, ...cd.series.map((_, j) => (j === si ? p.y : null))]),
        )
      : cd.points.map((p) => [
          p.name,
          ...cd.series.map((s) => (typeof p[s.key] === "number" ? (p[s.key] as number) : null)),
        ]);

  const copy = async () => {
    // Числа — без пробелов-разделителей и с запятой: так их понимает русский Excel.
    const cell = (v: string | number | null) =>
      v === null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    const tsv = [headers, ...rows].map((r) => r.map(cell).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="cc-chart-table">
      <div className="cc-chart-table-head">
        <span>
          {rows.length} {plural(rows.length, ["строка", "строки", "строк"])}
          {config.aggregation !== "none" && cd.kind === "category" ? " · после группировки" : ""}
        </span>
        <button type="button" className="cc-link-btn" onClick={copy}>
          {copied ? "Скопировано" : "Скопировать для Excel"}
        </button>
      </div>
      <div className="cc-table-container">
        <table className="cc-data-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className={i ? "num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={j ? "num" : undefined}>
                    {j === 0 && typeof v === "string" ? v : formatValue(v, nfmt, false)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && (
        <p className="cc-data-preview-more">
          Показаны первые {MAX_ROWS} из {rows.length}
        </p>
      )}
    </div>
  );
};

export default ChartDataTable;
