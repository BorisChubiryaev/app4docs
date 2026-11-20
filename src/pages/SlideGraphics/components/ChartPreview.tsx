import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { SAFE_LIGHT } from "../core/render";
import type { ChartSketch } from "../core/presentation";

export default function ChartPreview({ chart }: { chart: ChartSketch }) {
  const { rows, kind, series } = chart;
  const category = { dataKey: "category", tick: { fontSize: 11, fill: "var(--ink)" }, tickLine: false };
  const color = (i: number) => SAFE_LIGHT[i % SAFE_LIGHT.length];
  const horizontal = kind === "bar";
  return <figure className="sg-chart-sketch">
    <figcaption>Эскиз по данным диаграммы</figcaption>
    <ResponsiveContainer width="100%" height={150}>
      {kind === "pie" || kind === "ring" ? (
        <PieChart><Pie data={rows} dataKey="s0" nameKey="category" innerRadius={kind === "ring" ? "45%" : 0} isAnimationActive={false}>
          {rows.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Pie></PieChart>
      ) : kind === "line" ? (
        <LineChart data={rows}><XAxis {...category} /><YAxis width={48} />
          {series.map((name, i) => <Line key={i} name={name} dataKey={"s" + i} stroke={color(i)} dot={false} strokeWidth={2} isAnimationActive={false} />)}
        </LineChart>
      ) : (
        <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"}>
          {horizontal ? <XAxis type="number" /> : <XAxis {...category} />}
          {horizontal ? <YAxis type="category" {...category} /> : <YAxis width={48} />}
          {series.map((name, i) => <Bar key={i} name={name} dataKey={"s" + i} stackId={chart.stacked ? "stack" : undefined} fill={color(i)} isAnimationActive={false} />)}
        </BarChart>
      )}
    </ResponsiveContainer>
  </figure>;
}
