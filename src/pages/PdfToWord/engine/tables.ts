// Таблицы с нарисованными границами.
//
// Горизонтальные и вертикальные линии группируются по положению, связные
// группы (линии реально пересекаются) — отдельные таблицы. Сетка — все
// позиции линий; объединённые ячейки — там, где между соседними ячейками
// нет линии (её отсутствие и есть объединение в Word/Excel).

import type { Box, FillRect, Item, Seg } from "./types";

const TOL = 2; // пт: линии ближе — одна линия

interface Cluster {
  pos: number;
  color: string;
  width: number;
  spans: [number, number][];
  from: number;
  to: number;
}

function cluster(segs: Seg[]): Cluster[] {
  const sorted = [...segs].sort((a, b) => a.pos - b.pos);
  const out: Cluster[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.pos - last.pos <= TOL) {
      last.spans.push([s.a, s.b]);
      last.from = Math.min(last.from, s.a);
      last.to = Math.max(last.to, s.b);
    } else out.push({ pos: s.pos, spans: [[s.a, s.b]], from: s.a, to: s.b, color: s.color, width: s.width });
  }
  // Слить перекрывающиеся куски линии
  for (const c of out) {
    c.spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const sp of c.spans) {
      const m = merged[merged.length - 1];
      if (m && sp[0] <= m[1] + TOL) m[1] = Math.max(m[1], sp[1]);
      else merged.push([sp[0], sp[1]]);
    }
    c.spans = merged;
  }
  return out;
}

/** Доля отрезка [a,b], покрытая линией. */
function coverage(c: Cluster, a: number, b: number): number {
  if (b <= a) return 1;
  let s = 0;
  for (const [x, y] of c.spans) s += Math.max(0, Math.min(b, y + TOL) - Math.max(a, x - TOL));
  return Math.min(1, s / (b - a));
}

const near = (from: number, to: number, p: number) => p >= from - TOL && p <= to + TOL;

export interface RawCell {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  covered: boolean;
  items: Item[];
  box: Box;
  shading: string | null;
}

export interface RawTable extends Box {
  borderColor: string;
  borderWidth: number;
  colXs: number[];
  rowYs: number[];
  cells: RawCell[][];
}

export function detectRuledTables(
  hSegs: Seg[],
  vSegs: Seg[],
  items: Item[],
  fills: FillRect[],
): { tables: RawTable[]; used: Set<number> } {
  const hs = cluster(hSegs);
  const vs = cluster(vSegs);
  const hComp = new Array(hs.length).fill(-1);
  const vComp = new Array(vs.length).fill(-1);
  const connects = (h: Cluster, v: Cluster) => near(h.from, h.to, v.pos) && near(v.from, v.to, h.pos);
  const comps: { h: Cluster[]; v: Cluster[] }[] = [];
  for (let i = 0; i < hs.length; i++) {
    if (hComp[i] >= 0) continue;
    const id = comps.length;
    const comp = { h: [] as Cluster[], v: [] as Cluster[] };
    const queue = [i];
    hComp[i] = id;
    while (queue.length) {
      const h = hs[queue.pop()!];
      comp.h.push(h);
      for (let j = 0; j < vs.length; j++) {
        if (vComp[j] >= 0 || !connects(h, vs[j])) continue;
        vComp[j] = id;
        comp.v.push(vs[j]);
        for (let k = 0; k < hs.length; k++) {
          if (hComp[k] >= 0 || !connects(hs[k], vs[j])) continue;
          hComp[k] = id;
          queue.push(k);
        }
      }
    }
    comps.push(comp);
  }

  const tables: RawTable[] = [];
  const used = new Set<number>();
  for (const comp of comps) {
    if (comp.h.length < 2 || comp.v.length < 2) continue;
    const rowsC = [...comp.h].sort((a, b) => b.pos - a.pos);
    const colsC = [...comp.v].sort((a, b) => a.pos - b.pos);
    const rowYs = rowsC.map((c) => c.pos);
    const colXs = colsC.map((c) => c.pos);
    const R = rowYs.length - 1;
    const C = colXs.length - 1;
    // Слишком мелкая «сетка» — это рисунок (например, клеточки графика)
    if (R * C > 4000) continue;
    const x0 = colXs[0];
    const x1 = colXs[C];
    const y1 = rowYs[0];
    const y0 = rowYs[R];
    if (x1 - x0 < 8 || y1 - y0 < 4) continue;

    // Есть ли линия между ячейками
    const vLine = (r: number, c: number) => coverage(colsC[c], rowYs[r + 1], rowYs[r]) >= 0.6;
    const hLine = (r: number, c: number) => coverage(rowsC[r], colXs[c], colXs[c + 1]) >= 0.6;

    // Объединение ячеек без линии между ними
    const parent = Array.from({ length: R * C }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const unite = (a: number, b: number) => {
      parent[find(a)] = find(b);
    };
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        if (c + 1 < C && !vLine(r, c + 1)) unite(r * C + c, r * C + c + 1);
        if (r + 1 < R && !hLine(r + 1, c)) unite(r * C + c, (r + 1) * C + c);
      }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < R * C; i++) {
      const g = find(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(i);
    }
    const cells: RawCell[][] = Array.from({ length: R }, (_, r) =>
      Array.from({ length: C }, (_, c) => ({
        r,
        c,
        rowSpan: 1,
        colSpan: 1,
        covered: false,
        items: [] as Item[],
        box: { x0: colXs[c], x1: colXs[c + 1], y0: rowYs[r + 1], y1: rowYs[r] },
        shading: null as string | null,
      })),
    );
    for (const members of groups.values()) {
      if (members.length === 1) continue;
      const rs = members.map((i) => Math.floor(i / C));
      const cs = members.map((i) => i % C);
      const r0 = Math.min(...rs);
      const r1 = Math.max(...rs);
      const c0 = Math.min(...cs);
      const c1 = Math.max(...cs);
      // Объединение должно быть прямоугольным, иначе ячейки оставляем как есть
      if ((r1 - r0 + 1) * (c1 - c0 + 1) !== members.length) continue;
      const head = cells[r0][c0];
      head.rowSpan = r1 - r0 + 1;
      head.colSpan = c1 - c0 + 1;
      head.box = { x0: colXs[c0], x1: colXs[c1 + 1], y0: rowYs[r1 + 1], y1: rowYs[r0] };
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) cells[r][c].covered = true;
    }
    const headOf = (r: number, c: number): RawCell => {
      if (!cells[r][c].covered) return cells[r][c];
      for (let rr = r; rr >= 0; rr--)
        for (let cc = c; cc >= 0; cc--) {
          const h = cells[rr][cc];
          if (!h.covered && rr + h.rowSpan > r && cc + h.colSpan > c) return h;
        }
      return cells[r][c];
    };

    // Текст — в ячейку по центру фрагмента
    for (const it of items) {
      const cx = it.x + it.width / 2;
      const cy = it.y + it.size * 0.3;
      if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) continue;
      let c = colXs.findIndex((x, i) => i < C && cx >= x - 1 && cx < colXs[i + 1] + 1);
      let r = rowYs.findIndex((y, i) => i < R && cy <= y + 1 && cy > rowYs[i + 1] - 1);
      if (c < 0 || r < 0) continue;
      c = Math.min(c, C - 1);
      r = Math.min(r, R - 1);
      headOf(r, c).items.push(it);
      used.add(it.idx);
    }

    // Заливка ячеек
    for (const row of cells)
      for (const cell of row) {
        if (cell.covered) continue;
        const b = cell.box;
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        for (const f of fills) {
          const ix = Math.max(0, Math.min(b.x1, f.x1) - Math.max(b.x0, f.x0));
          const iy = Math.max(0, Math.min(b.y1, f.y1) - Math.max(b.y0, f.y0));
          if (ix * iy >= area * 0.6) cell.shading = f.color;
        }
      }
    // Цвет и толщина рамки — самые частые у линий таблицы
    const lines = [...comp.h, ...comp.v];
    const freq = new Map<string, number>();
    for (const l of lines) freq.set(l.color, (freq.get(l.color) ?? 0) + 1);
    const borderColor = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "000000";
    const widths = lines.map((l) => l.width).sort((a, b) => a - b);
    tables.push({ x0, x1, y0, y1, colXs, rowYs, cells, borderColor, borderWidth: widths[Math.floor(widths.length / 2)] || 0.75 });
  }
  return { tables, used };
}
