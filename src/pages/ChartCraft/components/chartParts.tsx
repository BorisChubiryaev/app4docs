// Детали графика: столбцы со скруглённым концом, легенда, подсказка,
// подписи значений. Текст всегда в нейтральных цветах — цвет ряда
// несёт только метка рядом (квадратик / линия), иначе светлые оттенки
// палитры нечитаемы.

import type { ChartChrome } from "../utils/palettes";
import type { NumberFormat } from "../utils/formatUtils";
import { formatPercent, formatValue } from "../utils/formatUtils";
import type { ValueLabels } from "../types";

// ── Столбец: скруглён только конец со значением, у основания — прямой ──

type End = "top" | "bottom" | "left" | "right";

function barPath(x: number, y: number, w: number, h: number, r: number, end: End): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M${x},${y}h${w}v${h}h${-w}Z`;
  switch (end) {
    case "top":
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    case "bottom":
      return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
    case "right":
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    case "left":
      return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  }
}

interface BarShapeArgs {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number | [number, number];
  payload?: Record<string, unknown>;
}

/**
 * Фабрика формы столбца. horizontal — полосы; rounded — скруглять ли конец
 * (в стопке — только у верхнего ряда); colorOf — цвет по точке (выделение,
 * «Другое»); gap — цвет поверхности для 2px-зазора между сегментами стопки.
 */
export const makeBarShape =
  (opts: {
    horizontal: boolean;
    radius: number;
    rounded: boolean;
    colorOf: (payload: Record<string, unknown> | undefined) => string;
    gap?: string;
  }) =>
  (props: unknown) => {
    const p = props as BarShapeArgs;
    let x = p.x ?? 0;
    let y = p.y ?? 0;
    let w = p.width ?? 0;
    let h = p.height ?? 0;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    if (!w || !h) return <g />;
    const v = Array.isArray(p.value) ? p.value[1] - p.value[0] : (p.value ?? 0);
    const end: End = opts.horizontal ? (v < 0 ? "left" : "right") : v < 0 ? "bottom" : "top";
    return (
      <path
        d={barPath(x, y, w, h, opts.rounded ? opts.radius : 0, end)}
        fill={opts.colorOf(p.payload)}
        stroke={opts.gap}
        strokeWidth={opts.gap ? 2 : 0}
      />
    );
  };

// ── Легенда ──

interface LegendEntry {
  value?: unknown;
  color?: string;
  type?: string;
}

export const makeLegend =
  (chrome: ChartChrome, fontSize: number, vertical: boolean, lineKeys: Set<string>, order?: string[]) =>
  ({ payload }: { payload?: readonly LegendEntry[] }) => {
    // Recharts 3 сортирует легенду по алфавиту (и линии кладёт раньше столбцов) —
    // возвращаем порядок рядов/долей как на графике.
    const items = [...(payload ?? [])];
    if (order) items.sort((a, b) => order.indexOf(String(a.value)) - order.indexOf(String(b.value)));
    return (
    <ul
      className="cc-legend"
      style={{
        flexDirection: vertical ? "column" : "row",
        alignItems: vertical ? "flex-start" : "center",
        fontSize,
        color: chrome.inkSecondary,
      }}
    >
      {items.map((e, i) => {
        const name = String(e.value ?? "");
        const isLine = lineKeys.has(name);
        return (
          <li key={`${name}-${i}`} className="cc-legend-item">
            <span
              className={isLine ? "cc-legend-line" : "cc-legend-swatch"}
              style={{ background: e.color }}
            />
            {name}
          </li>
        );
      })}
    </ul>
    );
  };

// ── Подсказка ──

interface TooltipRow {
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: Record<string, unknown>;
  dataKey?: unknown;
}

export const makeTooltip =
  (opts: {
    chrome: ChartChrome;
    surface: string;
    nfmt: NumberFormat;
    percentStack: boolean;
    /** Сумма для доли (круговая). */
    pieTotal?: number;
    xLabel?: string;
    yLabel?: string;
    scatter?: boolean;
  }) =>
  ({ active, payload, label }: { active?: boolean; payload?: readonly TooltipRow[]; label?: unknown }) => {
    if (!active || !payload?.length) return null;
    const { chrome } = opts;
    const first = payload[0];
    const title = opts.scatter
      ? `Строка ${Number(first.payload?.row ?? 0) + 2}`
      : opts.pieTotal !== undefined
        ? String(first.name ?? "")
        : String(label ?? "");
    const stackTotal = opts.percentStack
      ? payload.reduce((s, r) => {
          const raw = r.payload?.[String(r.dataKey)];
          return s + (typeof raw === "number" ? raw : 0);
        }, 0)
      : 0;
    return (
      <div
        className="cc-tooltip"
        style={{ background: opts.surface, color: chrome.ink, borderColor: chrome.axis }}
      >
        <div className="cc-tooltip-title">{title}</div>
        {opts.scatter ? (
          <>
            <div className="cc-tooltip-row">
              <span style={{ color: chrome.inkSecondary }}>{opts.xLabel}</span>
              <b>{formatValue(first.payload?.x, opts.nfmt, false)}</b>
            </div>
            <div className="cc-tooltip-row">
              <span className="cc-legend-swatch" style={{ background: first.color }} />
              <span style={{ color: chrome.inkSecondary }}>{String(first.name ?? opts.yLabel)}</span>
              <b>{formatValue(first.payload?.y, opts.nfmt, false)}</b>
            </div>
          </>
        ) : (
          payload.map((r, i) => {
            const raw = opts.percentStack ? r.payload?.[String(r.dataKey)] : r.value;
            const share =
              opts.pieTotal !== undefined && typeof r.value === "number"
                ? ` · ${formatPercent(r.value / opts.pieTotal)}`
                : opts.percentStack && typeof raw === "number" && stackTotal
                  ? ` · ${formatPercent(raw / stackTotal)}`
                  : "";
            return (
              <div key={i} className="cc-tooltip-row">
                <span
                  className="cc-legend-swatch"
                  style={{ background: r.color ?? (r.payload?.fill as string) }}
                />
                <span style={{ color: chrome.inkSecondary }}>
                  {opts.pieTotal !== undefined ? "Значение" : String(r.name ?? "")}
                </span>
                <b>
                  {formatValue(raw, opts.nfmt, false)}
                  {share}
                </b>
              </div>
            );
          })
        )}
      </div>
    );
  };

// ── Подписи значений ──

/** Индексы точек, которые подписывать: все / последняя / максимум и минимум. */
export function labelIndexes(values: (number | null)[], mode: ValueLabels): Set<number> | "all" {
  if (mode === "all") return "all";
  const idx = new Set<number>();
  if (mode === "last") {
    for (let i = values.length - 1; i >= 0; i--)
      if (values[i] !== null) {
        idx.add(i);
        break;
      }
  } else if (mode === "extremes") {
    let hi = -1;
    let lo = -1;
    values.forEach((v, i) => {
      if (v === null) return;
      if (hi < 0 || v > (values[hi] as number)) hi = i;
      if (lo < 0 || v < (values[lo] as number)) lo = i;
    });
    if (hi >= 0) idx.add(hi);
    if (lo >= 0) idx.add(lo);
  }
  return idx;
}

interface LabelArgs {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: unknown;
  index?: number;
}

/** Светлый или тёмный текст поверх заливки — по яркости заливки. */
const inkOn = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0b0b0b" : "#ffffff";
};

/**
 * Подпись значения. mode: "end" — за концом столбца/над точкой,
 * "inside" — внутри сегмента стопки (только если помещается).
 */
export const makeValueLabel =
  (opts: {
    show: Set<number> | "all";
    format: (v: unknown) => string;
    fontSize: number;
    color: string;
    horizontal?: boolean;
    inside?: { fill: string };
    point?: boolean;
  }) =>
  (props: unknown) => {
    const p = props as LabelArgs;
    const i = p.index ?? -1;
    if (opts.show !== "all" && !opts.show.has(i)) return null;
    if (p.value === null || p.value === undefined) return null;
    const vb = p.viewBox ?? p;
    let x = vb.x ?? 0;
    let y = vb.y ?? 0;
    let w = vb.width ?? 0;
    let h = vb.height ?? 0;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const text = opts.format(p.value);
    const textW = text.length * opts.fontSize * 0.58;
    const neg = typeof p.value === "number" && p.value < 0;

    if (opts.inside) {
      // Не помещается — не подписываем: значение есть в подсказке и таблице.
      const fits = opts.horizontal
        ? w >= textW + 8 && h >= opts.fontSize + 2
        : h >= opts.fontSize + 6 && w >= textW + 6;
      if (!fits) return null;
      return (
        <text
          x={x + w / 2}
          y={y + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={opts.fontSize}
          fill={inkOn(opts.inside.fill)}
        >
          {text}
        </text>
      );
    }
    if (opts.point) {
      return (
        <text
          x={x}
          y={y - 10}
          textAnchor="middle"
          fontSize={opts.fontSize}
          fill={opts.color}
        >
          {text}
        </text>
      );
    }
    if (opts.horizontal) {
      return (
        <text
          x={neg ? x - 6 : x + w + 6}
          y={y + h / 2}
          textAnchor={neg ? "end" : "start"}
          dominantBaseline="central"
          fontSize={opts.fontSize}
          fill={opts.color}
        >
          {text}
        </text>
      );
    }
    return (
      <text
        x={x + w / 2}
        y={neg ? y + h + opts.fontSize + 2 : y - 6}
        textAnchor="middle"
        fontSize={opts.fontSize}
        fill={opts.color}
      >
        {text}
      </text>
    );
  };

// ── Точка с кольцом цвета поверхности (видна на пересечении линий) ──

export const makeDot =
  (color: string, surface: string, r = 4) =>
  (props: unknown) => {
    const p = props as { cx?: number; cy?: number; value?: unknown; index?: number };
    if (p.cx === undefined || p.cy === undefined || p.value === null || p.value === undefined)
      return <g key={`d-${p.index}`} />;
    return (
      <circle
        key={`d-${p.index}`}
        cx={p.cx}
        cy={p.cy}
        r={r}
        fill={color}
        stroke={surface}
        strokeWidth={2}
      />
    );
  };
