import { forwardRef, useMemo, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { CategoryPoint, ChartConfig, ColumnInfo, ParsedData } from "../types";
import { buildChartData, seriesAverage } from "../utils/chartData";
import { canStack } from "../utils/constants";
import { formatPercent, formatTick, formatValue, type NumberFormat } from "../utils/formatUtils";
import { CHROME, seriesColor } from "../utils/palettes";
import {
  labelIndexes,
  makeBarShape,
  makeDot,
  makeLegend,
  makeTooltip,
  makeValueLabel,
} from "./chartParts";

interface Props {
  data: ParsedData;
  columns: ColumnInfo[];
  config: ChartConfig;
}

const ANIM = 500;
/**
 * Ширина оси значений по самой длинной подписи. Не width="auto": на
 * уменьшенном холсте (transform: scale) Recharts меряет текст в экранных
 * пикселях и обрезает «1 350» до «350».
 */
const axisWidth = (labels: string[], fs: number, title: boolean) =>
  Math.ceil(Math.max(2, ...labels.map((l) => l.length)) * fs * 0.62) + 12 + (title ? fs + 8 : 0);

const truncate = (s: unknown, n = 22) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const ChartPreview = forwardRef<HTMLDivElement, Props>(({ data, columns, config }, ref) => {
  const cd = useMemo(() => buildChartData(data, config, columns), [data, config, columns]);

  const chrome = CHROME[config.theme];
  const surface = config.backgroundColor || chrome.surface;
  const nfmt: NumberFormat = {
    unit: config.unit,
    decimals: config.decimals,
    prefix: config.prefix,
    suffix: config.suffix,
  };
  const fs = config.fontSize;
  const type = config.chartType;

  const header = (
    <>
      {config.title && (
        <h2 className="cc-chart-title" style={{ color: chrome.ink }}>
          {config.title}
        </h2>
      )}
      {config.subtitle && (
        <p className="cc-chart-subtitle" style={{ color: chrome.inkSecondary }}>
          {config.subtitle}
        </p>
      )}
    </>
  );

  if (cd.kind === "empty") {
    return (
      <div ref={ref} className="cc-chart-preview-inner" style={{ background: surface }}>
        {header}
        <div className="cc-chart-empty" style={{ color: chrome.inkSecondary }}>
          {cd.reason}
        </div>
      </div>
    );
  }

  const tick = { fontSize: fs, fill: chrome.muted };
  const legendVertical = config.legendPosition === "left" || config.legendPosition === "right";
  const legendProps = {
    layout: legendVertical ? ("vertical" as const) : ("horizontal" as const),
    verticalAlign:
      config.legendPosition === "top"
        ? ("top" as const)
        : config.legendPosition === "bottom"
          ? ("bottom" as const)
          : ("middle" as const),
    align:
      config.legendPosition === "left"
        ? ("left" as const)
        : config.legendPosition === "right"
          ? ("right" as const)
          : ("center" as const),
  };

  let chart: ReactElement;
  let note: string | null = null;

  if (cd.kind === "scatter") {
    // ── Точечная ──
    const all = cd.series.flatMap((s) => s.points);
    const names = cd.series.map((s, i) => {
      const t = cd.trends[i];
      return t ? `${s.name} · тренд R² = ${formatValue(t.r2, { ...nfmt, unit: "none", decimals: 2, prefix: "", suffix: "" })}` : s.name;
    });
    const ys = all.map((p) => p.y);
    const minY = ys.reduce((a, b) => (b < a ? b : a), 0);
    const maxY = ys.reduce((a, b) => (b > a ? b : a), 0);
    const xs = all.map((p) => p.x);
    const minX = xs.reduce((a, b) => (b < a ? b : a), Infinity);
    const maxX = xs.reduce((a, b) => (b > a ? b : a), -Infinity);
    const showLegend = config.showLegend && cd.series.length > 1;
    chart = (
      <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
        {config.showGrid && <CartesianGrid stroke={chrome.grid} />}
        <XAxis
          type="number"
          dataKey="x"
          name={config.xColumn}
          domain={["auto", "auto"]}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: chrome.axis }}
          tickFormatter={(v) => formatTick(v, nfmt)}
          height={config.xAxisLabel ? 48 : 30}
        >
          {config.xAxisLabel && (
            <Label value={config.xAxisLabel} position="insideBottom" fill={chrome.inkSecondary} fontSize={fs} />
          )}
        </XAxis>
        <YAxis
          type="number"
          dataKey="y"
          domain={[config.yMin ?? "auto", config.yMax ?? "auto"]}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={axisWidth(
            [minY, maxY, maxY * 1.2, config.yMin ?? 0, config.yMax ?? 0].map((v) => formatTick(v, nfmt)),
            fs,
            !!config.yAxisLabel,
          )}
          tickFormatter={(v) => formatTick(v, nfmt)}
        >
          {config.yAxisLabel && (
            <Label value={config.yAxisLabel} angle={-90} position="insideLeft" fill={chrome.inkSecondary} fontSize={fs} style={{ textAnchor: "middle" }} />
          )}
        </YAxis>
        <ZAxis range={[64, 64]} />
        {config.showTooltip && (
          <Tooltip
            cursor={{ stroke: chrome.axis }}
            content={makeTooltip({ chrome, surface, nfmt, percentStack: false, scatter: true, xLabel: config.xColumn })}
          />
        )}
        {showLegend && (
          <Legend {...legendProps} content={makeLegend(chrome, fs, legendVertical, new Set(), cd.series.map((x) => x.name))} />
        )}
        {cd.series.map((s, i) => (
          <Scatter
            key={s.key}
            name={names[i]}
            data={s.points}
            fill={s.color}
            isAnimationActive
            animationDuration={ANIM}
            shape={(p: unknown) => {
              const q = p as { cx?: number; cy?: number };
              return <circle cx={q.cx} cy={q.cy} r={4} fill={s.color} stroke={surface} strokeWidth={2} />;
            }}
          />
        ))}
        {cd.series.map((s, i) => {
          const t = cd.trends[i];
          if (!t || !Number.isFinite(minX)) return null;
          return (
            <ReferenceLine
              key={`t-${s.key}`}
              segment={[
                { x: minX, y: t.slope * minX + t.intercept },
                { x: maxX, y: t.slope * maxX + t.intercept },
              ]}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray="6 4"
              ifOverflow="visible"
            />
          );
        })}
      </ScatterChart>
    );
  } else {
    const { points, series } = cd;
    const isPieType = type === "pie" || type === "donut";

    if (isPieType) {
      // ── Круговая / кольцевая ──
      const key = series[0].key;
      const pieTotal = points.reduce((s, p) => s + ((p[key] as number) || 0), 0);
      const donut = type === "donut";
      const showLabels = config.valueLabels !== "none";
      chart = (
        <PieChart margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          {config.showTooltip && (
            <Tooltip content={makeTooltip({ chrome, surface, nfmt, percentStack: false, pieTotal })} />
          )}
          {config.showLegend && points.length > 1 && (
            <Legend {...legendProps} content={makeLegend(chrome, fs, legendVertical, new Set(), points.map((p) => p.name))} />
          )}
          <Pie
            data={points}
            dataKey={key}
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={donut ? "58%" : 0}
            outerRadius={showLabels ? "72%" : "82%"}
            startAngle={90}
            endAngle={-270}
            stroke={surface}
            strokeWidth={2}
            isAnimationActive
            animationDuration={ANIM}
            labelLine={showLabels ? { stroke: chrome.axis } : false}
            label={
              showLabels
                ? (p: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; percent?: number; name?: unknown }) => {
                    const R = Math.PI / 180;
                    const r = (p.outerRadius ?? 0) + 18;
                    const x = (p.cx ?? 0) + r * Math.cos(-(p.midAngle ?? 0) * R);
                    const y = (p.cy ?? 0) + r * Math.sin(-(p.midAngle ?? 0) * R);
                    return (
                      <text
                        x={x}
                        y={y}
                        fill={chrome.inkSecondary}
                        fontSize={fs}
                        textAnchor={x > (p.cx ?? 0) ? "start" : "end"}
                        dominantBaseline="central"
                      >
                        {truncate(p.name, 18)} · {formatPercent(p.percent ?? 0)}
                      </text>
                    );
                  }
                : false
            }
          >
            {points.map((p, i) => (
              <Cell
                key={p.name}
                fill={p.isOther ? chrome.neutral : seriesColor(config.theme, config.colors, i)}
              />
            ))}
            {donut && (
              <Label
                position="center"
                content={(lp) => {
                  // Recharts 3 для position="center" даёт центр области графика в x/y
                  // (он же центр кольца); cx/cy — запасной путь для полярной области.
                  const vb = (lp.viewBox ?? {}) as { cx?: number; cy?: number };
                  const cx = Number(lp.x ?? vb.cx ?? 0);
                  const cy = Number(lp.y ?? vb.cy ?? 0);
                  return (
                    <g>
                      <text x={cx} y={cy - fs * 0.6} textAnchor="middle" fontSize={fs * 1.9} fontWeight={600} fill={chrome.ink}>
                        {formatValue(pieTotal, nfmt)}
                      </text>
                      <text x={cx} y={cy + fs * 1.1} textAnchor="middle" fontSize={fs} fill={chrome.inkSecondary}>
                        Итого
                      </text>
                    </g>
                  );
                }}
              />
            )}
          </Pie>
        </PieChart>
      );
      if (cd.skippedNonPositive > 0)
        note = `Не показано на круговой: ${cd.skippedNonPositive} знач. ≤ 0 (у долей не бывает отрицательных).`;
    } else if (type === "radar") {
      // ── Радар ──
      chart = (
        <RadarChart data={points} cx="50%" cy="50%" outerRadius="72%" margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <PolarGrid stroke={chrome.grid} />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: fs, fill: chrome.inkSecondary }} tickFormatter={(v) => truncate(v, 16)} />
          <PolarRadiusAxis tick={{ fontSize: fs - 2, fill: chrome.muted }} tickFormatter={(v) => formatTick(v, nfmt)} axisLine={false} angle={90} />
          {config.showTooltip && <Tooltip content={makeTooltip({ chrome, surface, nfmt, percentStack: false })} />}
          {config.showLegend && series.length > 1 && (
            <Legend {...legendProps} content={makeLegend(chrome, fs, legendVertical, new Set(), series.map((x) => x.name))} />
          )}
          {series.map((s) => (
            <Radar
              key={s.key}
              name={s.name}
              dataKey={s.key}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.15}
              strokeWidth={config.strokeWidth}
              dot={config.showDots ? { r: 3, fill: s.color, stroke: surface, strokeWidth: 2 } : false}
              isAnimationActive
              animationDuration={ANIM}
            />
          ))}
        </RadarChart>
      );
    } else {
      // ── Декартовы: столбцы, полосы, линии, области, комбинированный ──
      const horizontal = type === "barH";
      const stacked = canStack(type) && config.stack !== "none" && series.length > 1;
      const percent = stacked && config.stack === "percent";
      const lineKeys = new Set<string>();

      let minV = Infinity;
      points.forEach((p) =>
        series.forEach((s) => {
          const v = p[s.key];
          if (typeof v === "number" && v < minV) minV = v;
        }),
      );
      const domain: [number | "auto", number | "auto"] = percent
        ? [0, 1]
        : [config.yMin ?? (minV >= 0 ? 0 : "auto"), config.yMax ?? "auto"];
      const valTick = (v: unknown) => (percent ? formatPercent(v) : formatTick(v, nfmt));
      let maxV = -Infinity;
      points.forEach((p) => {
        let sum = 0;
        series.forEach((s) => {
          const v = p[s.key];
          if (typeof v === "number") {
            sum += Math.max(0, v);
            if (v > maxV) maxV = v;
          }
        });
        if (stacked && sum > maxV) maxV = sum;
      });
      const valExtremes = percent
        ? [1]
        : [minV, maxV, maxV * 1.25, config.yMin, config.yMax, config.referenceValue].filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v),
          );
      const valAxisWidth = axisWidth(valExtremes.map(valTick), fs, !!config.yAxisLabel);

      const maxLen = points.reduce((m, p) => Math.max(m, Math.min(22, p.name.length)), 0);
      // Наклоняем подписи, только когда они не помещаются в ряд (оценка по длине).
      const rotate = !horizontal && points.length * (maxLen + 2) > 64;
      const lineLike = type === "line" || type === "area";
      const catInterval = lineLike && points.length > 24 ? ("preserveStartEnd" as const) : 0;

      // Подписи: доля для 100 %, иначе число.
      const totals = points.map((p) =>
        series.reduce((s, ser) => s + (typeof p[ser.key] === "number" ? (p[ser.key] as number) : 0), 0),
      );
      const fmtFor = (idx: number) => (v: unknown) => {
        if (percent) return typeof v === "number" && totals[idx] ? formatPercent(v / totals[idx]) : "";
        return formatValue(v, nfmt);
      };

      const colorOf = (s: (typeof series)[number]) => (pl: Record<string, unknown> | undefined) => {
        const pt = pl as CategoryPoint | undefined;
        if (pt?.isOther) return chrome.neutral;
        if (config.highlight && series.length === 1 && pt?.name !== config.highlight) return chrome.neutral;
        return s.color;
      };

      const labelsFor = (s: (typeof series)[number], kind: "bar" | "point") => {
        if (config.valueLabels === "none") return null;
        const vals = points.map((p) => (typeof p[s.key] === "number" ? (p[s.key] as number) : null));
        const show = labelIndexes(vals, config.valueLabels);
        // Значения подписываем по каждой точке отдельно — формат зависит от индекса (доля в стопке).
        return (
          <LabelList
            dataKey={s.key}
            content={(lp: unknown) => {
              const idx = (lp as { index?: number }).index ?? 0;
              return makeValueLabel({
                show,
                format: fmtFor(idx),
                fontSize: fs - 1,
                color: chrome.inkSecondary,
                horizontal,
                inside: stacked && kind === "bar" ? { fill: s.color } : undefined,
                point: kind === "point",
              })(lp);
            }}
          />
        );
      };

      const bar = (s: (typeof series)[number], i: number) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.name}
          fill={s.color}
          stackId={stacked ? "st" : undefined}
          maxBarSize={config.barSize}
          isAnimationActive
          animationDuration={ANIM}
          shape={makeBarShape({
            horizontal,
            radius: config.borderRadius,
            rounded: !stacked || i === series.length - 1,
            colorOf: colorOf(s),
            gap: stacked ? surface : undefined,
          })}
        >
          {labelsFor(s, "bar")}
        </Bar>
      );
      const line = (s: (typeof series)[number]) => {
        lineKeys.add(s.name);
        return (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            type={config.smooth ? "monotone" : "linear"}
            stroke={s.color}
            strokeWidth={config.strokeWidth}
            dot={config.showDots && points.length <= 60 ? makeDot(s.color, surface) : false}
            activeDot={{ r: 6, fill: s.color, stroke: surface, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={ANIM}
          >
            {labelsFor(s, "point")}
          </Line>
        );
      };
      const area = (s: (typeof series)[number]) => {
        lineKeys.add(s.name);
        return (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.name}
            type={config.smooth ? "monotone" : "linear"}
            stroke={s.color}
            strokeWidth={config.strokeWidth}
            fill={s.color}
            fillOpacity={stacked ? 0.35 : 0.12}
            stackId={stacked ? "st" : undefined}
            dot={config.showDots && points.length <= 60 ? makeDot(s.color, surface) : false}
            activeDot={{ r: 6, fill: s.color, stroke: surface, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={ANIM}
          >
            {!stacked && labelsFor(s, "point")}
          </Area>
        );
      };

      const refValue =
        percent || config.referenceLine === "none"
          ? null
          : config.referenceLine === "average"
            ? seriesAverage(cd)
            : config.referenceValue;
      const refLine =
        refValue !== null && Number.isFinite(refValue) ? (
          <ReferenceLine
            {...(horizontal ? { x: refValue } : { y: refValue })}
            stroke={chrome.inkSecondary}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            ifOverflow="extendDomain"
            label={{
              value: `${config.referenceLabel || (config.referenceLine === "average" ? "Среднее" : "Цель")}: ${formatValue(refValue, nfmt)}`,
              position: horizontal ? "insideTopRight" : "insideTopRight",
              fill: chrome.inkSecondary,
              fontSize: fs - 1,
            }}
          />
        ) : null;

      const catAxisTitle = config.xAxisLabel;
      const valAxisTitle = config.yAxisLabel;
      const catAxis = horizontal ? (
        <YAxis
          type="category"
          dataKey="name"
          width={axisWidth(points.map((p) => truncate(p.name, 26)), fs, !!catAxisTitle)}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: chrome.axis }}
          tickFormatter={(v) => truncate(v, 26)}
          interval={0}
        >
          {catAxisTitle && (
            <Label value={catAxisTitle} angle={-90} position="insideLeft" fill={chrome.inkSecondary} fontSize={fs} style={{ textAnchor: "middle" }} />
          )}
        </YAxis>
      ) : (
        <XAxis
          type="category"
          dataKey="name"
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: chrome.axis }}
          tickFormatter={(v) => truncate(v)}
          interval={catInterval}
          angle={rotate ? -35 : 0}
          textAnchor={rotate ? "end" : "middle"}
          height={(rotate ? Math.min(110, 18 + maxLen * fs * 0.45) : 28) + (catAxisTitle ? fs + 10 : 0)}
        >
          {catAxisTitle && (
            <Label value={catAxisTitle} position="insideBottom" fill={chrome.inkSecondary} fontSize={fs} />
          )}
        </XAxis>
      );
      const valAxis = horizontal ? (
        <XAxis
          type="number"
          domain={domain}
          tick={tick}
          tickLine={false}
          axisLine={false}
          tickFormatter={valTick}
          height={valAxisTitle ? 48 : 30}
        >
          {valAxisTitle && <Label value={valAxisTitle} position="insideBottom" fill={chrome.inkSecondary} fontSize={fs} />}
        </XAxis>
      ) : (
        <YAxis
          type="number"
          domain={domain}
          tick={tick}
          tickLine={false}
          axisLine={false}
          tickFormatter={valTick}
          width={valAxisWidth}
        >
          {valAxisTitle && (
            <Label value={valAxisTitle} angle={-90} position="insideLeft" fill={chrome.inkSecondary} fontSize={fs} style={{ textAnchor: "middle" }} />
          )}
        </YAxis>
      );

      const isBars = type === "bar" || type === "barH";
      const common = (
        <>
          {config.showGrid && (
            <CartesianGrid stroke={chrome.grid} vertical={horizontal} horizontal={!horizontal} />
          )}
          {catAxis}
          {valAxis}
          {config.showTooltip && (
            <Tooltip
              cursor={isBars || type === "composed" ? { fill: chrome.grid, fillOpacity: 0.45 } : { stroke: chrome.axis }}
              content={makeTooltip({ chrome, surface, nfmt, percentStack: percent })}
            />
          )}
          {config.showLegend && series.length > 1 && (
            <Legend {...legendProps} content={makeLegend(chrome, fs, legendVertical, lineKeys, series.map((x) => x.name))} />
          )}
          {refLine}
          {config.showBrush && !horizontal && points.length > 5 && (
            <Brush
              dataKey="name"
              height={22}
              stroke={chrome.axis}
              fill={surface}
              travellerWidth={8}
              tickFormatter={(v) => truncate(v, 14)}
            />
          )}
        </>
      );
      const margin = {
        top: config.valueLabels !== "none" ? 22 : 12,
        right: horizontal && config.valueLabels !== "none" ? 56 : 24,
        bottom: 4,
        left: 4,
      };
      const chartProps = {
        data: points,
        margin,
        stackOffset: percent ? ("expand" as const) : undefined,
      };

      // Линии нужно добавить в lineKeys до отрисовки легенды — поэтому ряды создаём заранее.
      if (type === "line") {
        const lines = series.map(line);
        chart = <LineChart {...chartProps}>{common}{lines}</LineChart>;
      } else if (type === "area") {
        const areas = series.map(area);
        chart = <AreaChart {...chartProps}>{common}{areas}</AreaChart>;
      } else if (type === "composed") {
        const marks = series.map((s, i) => (i === 0 ? bar(s, i) : line(s)));
        chart = (
          <ComposedChart {...chartProps} barGap={2}>
            {common}
            {marks}
          </ComposedChart>
        );
      } else {
        chart = (
          <BarChart {...chartProps} layout={horizontal ? "vertical" : "horizontal"} barGap={2} barCategoryGap="18%">
            {common}
            {series.map(bar)}
          </BarChart>
        );
      }
    }

    if (!note && cd.hiddenCount > 0 && !points.some((p) => p.isOther))
      note = `Не показано: ещё ${cd.hiddenCount} категорий (см. «Сколько показывать» на вкладке «Данные»).`;
  }

  return (
    <div ref={ref} className="cc-chart-preview-inner" style={{ background: surface }}>
      {header}
      <div className="cc-chart-wrapper">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
      {note && (
        <p className="cc-chart-note" style={{ color: chrome.muted }}>
          {note}
        </p>
      )}
    </div>
  );
});

ChartPreview.displayName = "ChartPreview";
export default ChartPreview;
