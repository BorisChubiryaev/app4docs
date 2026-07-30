import React, { forwardRef, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  Brush,
} from "recharts";
import type { ParsedData, ChartConfig } from "../types";
import { formatNumber, formatAxisValue } from "../utils/formatUtils";

interface Props {
  data: ParsedData;
  config: ChartConfig;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="cc-custom-tooltip">
      <p className="cc-tooltip-label">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} style={{ color: e.color }} className="cc-tooltip-value">
          {e.name}: <strong>{formatNumber(e.value)}</strong>
        </p>
      ))}
    </div>
  );
};

const PieLabel = ({ name, value, cx, cy, midAngle, outerRadius }: any) => {
  const R = Math.PI / 180;
  const r = outerRadius * 1.2;
  const x = cx + r * Math.cos(-midAngle * R);
  const y = cy + r * Math.sin(-midAngle * R);
  return (
    <text
      x={x}
      y={y}
      fill="#2c3e50"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={11}
    >
      {name}: {formatNumber(value)}
    </text>
  );
};

const ChartPreview = forwardRef<HTMLDivElement, Props>(
  ({ data, config }, ref) => {
    const chartData = useMemo(() => {
      return data.rows.map((row) => {
        const item: Record<string, any> = {
          name: String(row[config.xColumn] ?? ""),
        };
        config.yColumns.forEach((col) => {
          const v = row[col];
          item[col] = typeof v === "number" ? v : Number(v) || 0;
        });
        return item;
      });
    }, [data, config.xColumn, config.yColumns]);

    const yDomain = useMemo(() => {
      let mn = Infinity;
      chartData.forEach((item) => {
        config.yColumns.forEach((col) => {
          const v = item[col];
          if (typeof v === "number" && isFinite(v) && v < mn) mn = v;
        });
      });
      return mn >= 0
        ? ([0, "auto"] as [number, string])
        : (["auto", "auto"] as [string, string]);
    }, [chartData, config.yColumns]);

    const fmt = useCallback((v: number) => formatAxisValue(v), []);
    const valFmt = (v: number) => formatNumber(v, 1);

    const lp: any = config.showLegend
      ? {
          layout:
            config.legendPosition === "left" ||
            config.legendPosition === "right"
              ? "vertical"
              : "horizontal",
          verticalAlign:
            config.legendPosition === "top"
              ? "top"
              : config.legendPosition === "bottom"
                ? "bottom"
                : "middle",
          align:
            config.legendPosition === "left"
              ? "left"
              : config.legendPosition === "right"
                ? "right"
                : "center",
        }
      : false;

    const showBrush =
      chartData.length > 15 &&
      config.chartType !== "pie" &&
      config.chartType !== "radar";

    const cart = (
      <>
        {config.showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        )}
        <XAxis
          dataKey="name"
          tick={{ fontSize: config.fontSize }}
          stroke="#7f8c8d"
          angle={chartData.length > 10 ? -45 : 0}
          textAnchor={chartData.length > 10 ? "end" : "middle"}
          height={chartData.length > 10 ? 80 : 30}
        />
        <YAxis
          tick={{ fontSize: config.fontSize }}
          stroke="#7f8c8d"
          tickFormatter={fmt}
          domain={yDomain}
          allowDataOverflow={false}
        />
        {config.showTooltip && <Tooltip content={<CustomTooltip />} />}
        {config.showLegend && <Legend {...lp} />}
        {showBrush && (
          <Brush
            dataKey="name"
            height={24}
            stroke="#667eea"
            startIndex={0}
            endIndex={Math.min(20, chartData.length - 1)}
          />
        )}
      </>
    );

    const renderChart = () => {
      switch (config.chartType) {
        case "bar":
          return (
            <BarChart data={chartData}>
              {cart}
              {config.yColumns.map((col, i) => (
                <Bar
                  key={col}
                  dataKey={col}
                  fill={config.colors[i % config.colors.length]}
                  fillOpacity={config.fillOpacity}
                  radius={[config.borderRadius, config.borderRadius, 0, 0]}
                  animationDuration={config.animationDuration}
                >
                  {config.showValues && (
                    <LabelList
                      dataKey={col}
                      position="top"
                      formatter={valFmt}
                      style={{ fontSize: config.fontSize - 2 }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          );
        case "line":
          return (
            <LineChart data={chartData}>
              {cart}
              {config.yColumns.map((col, i) => (
                <Line
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={config.colors[i % config.colors.length]}
                  strokeWidth={config.strokeWidth}
                  dot={{ r: 3 }}
                  activeDot={{ r: 6 }}
                  animationDuration={config.animationDuration}
                >
                  {config.showValues && (
                    <LabelList
                      dataKey={col}
                      position="top"
                      formatter={valFmt}
                      style={{ fontSize: config.fontSize - 2 }}
                    />
                  )}
                </Line>
              ))}
            </LineChart>
          );
        case "area":
          return (
            <AreaChart data={chartData}>
              {cart}
              {config.yColumns.map((col, i) => (
                <Area
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={config.colors[i % config.colors.length]}
                  fill={config.colors[i % config.colors.length]}
                  fillOpacity={config.fillOpacity * 0.6}
                  strokeWidth={config.strokeWidth}
                  animationDuration={config.animationDuration}
                >
                  {config.showValues && (
                    <LabelList
                      dataKey={col}
                      position="top"
                      formatter={valFmt}
                      style={{ fontSize: config.fontSize - 2 }}
                    />
                  )}
                </Area>
              ))}
            </AreaChart>
          );
        case "pie":
          return (
            <PieChart>
              {config.showTooltip && <Tooltip content={<CustomTooltip />} />}
              {config.showLegend && <Legend {...lp} />}
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                outerRadius="80%"
                dataKey={config.yColumns[0]}
                nameKey="name"
                animationDuration={config.animationDuration}
                label={config.showValues ? PieLabel : false}
              >
                {chartData.map((_, idx) => (
                  <Cell
                    key={idx}
                    fill={config.colors[idx % config.colors.length]}
                    fillOpacity={config.fillOpacity}
                  />
                ))}
              </Pie>
            </PieChart>
          );
        case "radar":
          return (
            <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="80%">
              <PolarGrid />
              <PolarAngleAxis
                dataKey="name"
                tick={{ fontSize: config.fontSize }}
              />
              <PolarRadiusAxis
                tick={{ fontSize: config.fontSize - 2 }}
                tickFormatter={fmt}
              />
              {config.showTooltip && <Tooltip content={<CustomTooltip />} />}
              {config.showLegend && <Legend {...lp} />}
              {config.yColumns.map((col, i) => (
                <Radar
                  key={col}
                  name={col}
                  dataKey={col}
                  stroke={config.colors[i % config.colors.length]}
                  fill={config.colors[i % config.colors.length]}
                  fillOpacity={config.fillOpacity * 0.4}
                  strokeWidth={config.strokeWidth}
                  animationDuration={config.animationDuration}
                />
              ))}
            </RadarChart>
          );
        case "scatter":
          return (
            <ScatterChart>
              {cart}
              {config.yColumns.map((col, i) => (
                <Scatter
                  key={col}
                  name={col}
                  data={chartData.map((d) => ({
                    x: d.name,
                    y: d[col],
                    name: d.name,
                  }))}
                  fill={config.colors[i % config.colors.length]}
                  fillOpacity={config.fillOpacity}
                  animationDuration={config.animationDuration}
                />
              ))}
            </ScatterChart>
          );
        case "composed":
          return (
            <ComposedChart data={chartData}>
              {cart}
              {config.yColumns.map((col, i) =>
                i === 0 ? (
                  <Bar
                    key={col}
                    dataKey={col}
                    fill={config.colors[i % config.colors.length]}
                    fillOpacity={config.fillOpacity}
                    radius={[config.borderRadius, config.borderRadius, 0, 0]}
                    animationDuration={config.animationDuration}
                  />
                ) : (
                  <Line
                    key={col}
                    type="monotone"
                    dataKey={col}
                    stroke={config.colors[i % config.colors.length]}
                    strokeWidth={config.strokeWidth}
                    dot={{ r: 4 }}
                    animationDuration={config.animationDuration}
                  />
                ),
              )}
            </ComposedChart>
          );
        default:
          return <BarChart data={chartData}>{cart}</BarChart>;
      }
    };

    return (
      <div
        ref={ref}
        className="cc-chart-preview-inner"
        style={{ backgroundColor: config.backgroundColor }}
      >
        {config.title && <h2 className="cc-chart-title">{config.title}</h2>}
        {config.subtitle && (
          <p className="cc-chart-subtitle">{config.subtitle}</p>
        )}
        <div className="cc-chart-wrapper">
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
);

ChartPreview.displayName = "ChartPreview";
export default ChartPreview;
