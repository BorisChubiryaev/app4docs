import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { SAFE_LIGHT } from "../core/render";
import type { ChartSketch } from "../core/presentation";

export default function ChartPreview({ chart }: { chart: ChartSketch }) {
  const { rows, kind, series } = chart;
  const tick = { fontSize: 11, fill: "#475569" };
  const category = { dataKey: "category", tick, tickLine: false };
  const color = (i: number) => SAFE_LIGHT[i % SAFE_LIGHT.length];
  const horizontal = kind === "bar";
  return <div className="sg-pptx-chart">
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
      {kind === "pie" || kind === "ring" ? (
        <PieChart accessibilityLayer={false}><Pie data={rows} dataKey="s0" nameKey="category" innerRadius={kind === "ring" ? "45%" : 0} isAnimationActive={false}>
          {rows.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Pie></PieChart>
      ) : kind === "line" ? (
        <LineChart accessibilityLayer={false} data={rows}><XAxis {...category} /><YAxis width="auto" tick={tick} />
          {series.map((name, i) => <Line key={i} name={name} dataKey={"s" + i} stroke={color(i)} dot={false} strokeWidth={2} isAnimationActive={false} />)}
        </LineChart>
      ) : (
        <BarChart accessibilityLayer={false} data={rows} layout={horizontal ? "vertical" : "horizontal"}>
          {horizontal ? <XAxis type="number" tick={tick} /> : <XAxis {...category} />}
          {horizontal ? <YAxis type="category" {...category} /> : <YAxis width="auto" tick={tick} />}
          {series.map((name, i) => <Bar key={i} name={name} dataKey={"s" + i} stackId={chart.stacked ? "stack" : undefined} fill={color(i)} isAnimationActive={false} />)}
        </BarChart>
      )}
    </ResponsiveContainer>
  </div>;
}
