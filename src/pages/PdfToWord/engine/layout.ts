// Раскладка страницы PDF в блоки Word: абзацы, таблицы, картинки.
//
// В PDF нет абзацев — только фрагменты текста с координатами. Здесь:
//   1) таблицы с линиями (tables.ts) и рисунки (графики, схемы) убираются
//      из потока текста; подчёркивания, зачёркивания, маркеры списков и
//      плашки под текстом становятся свойствами текста;
//   2) находятся колонки (вертикальные «коридоры» без текста), чтобы
//      читать каждую колонку сверху вниз, а не строки поперёк страницы;
//   3) строки склеиваются в абзацы по межстрочному шагу, отступам и
//      «короткой» последней строке; переносы слов «дого-/вор» склеиваются;
//   4) выравнивание, отступы, интервалы и заголовки определяются по
//      геометрии строк;
//   5) строки с одинаково выровненными «столбиками» текста становятся
//      таблицей без рамок.

import type { Align, Block, Box, CellBlock, ImageBlock, Item, PageLayout, PageRaw, ParaBlock, Run, Seg, TabStop, TableBlock, Zone } from "./types";
import { detectRuledTables, type RawTable } from "./tables";

// ── Утилиты ──

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))];
};
const mode = (xs: number[]) => {
  const m = new Map<number, number>();
  let best = xs[0] ?? 0;
  let n = 0;
  for (const x of xs) {
    const k = Math.round(x * 2) / 2;
    const c = (m.get(k) ?? 0) + 1;
    m.set(k, c);
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
};
const inside = (b: Box, x: number, y: number, pad = 0) => x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
const itemBox = (it: Item): Box => ({ x0: it.x, x1: it.x + it.width, y0: it.y - it.size * 0.22, y1: it.y + it.size * 0.78 });
const center = (it: Item) => ({ x: it.x + it.width / 2, y: it.y + it.size * 0.3 });

export const SENTENCE_END = /[.!?:;…»"”)\]]$/u;
const BULLET_RE = /^([•●○◦▪▫■□►▸‣⁃∙·\-–—*✓✔➢➤])(\s+|$)/u;
const NUMBER_RE = /^((?:\d{1,3}\.){1,4}\d{0,3}\)?|\d{1,3}\)|[a-zа-яё]\)|[IVXLC]{1,5}\.)(\s+|$)/iu;

// ── Строки ──

export interface Line {
  items: Item[];
  y: number;
  x0: number;
  x1: number;
  size: number;
  top: number;
  bottom: number;
}

function makeLine(items: Item[]): Line {
  items.sort((a, b) => a.x - b.x);
  const main = items.filter((i) => !i.script);
  const base = main.length ? main : items;
  const size = Math.max(...base.map((i) => i.size));
  const y = median(base.map((i) => i.y));
  return {
    items,
    y,
    size,
    x0: Math.min(...items.map((i) => i.x)),
    x1: Math.max(...items.map((i) => i.x + i.width)),
    top: Math.max(...items.map((i) => i.y + i.size * 0.78)),
    bottom: Math.min(...items.map((i) => i.y - i.size * 0.22)),
  };
}

/** Фрагменты → строки по базовой линии; индексы (меньший кегль, сдвиг вверх) — в свою строку. */
export function groupLines(items: Item[]): Line[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    let row: Item[] | undefined;
    for (let k = rows.length - 1; k >= Math.max(0, rows.length - 4); k--) {
      const r = rows[k];
      const ry = median(r.map((i) => i.y));
      const rs = Math.max(...r.map((i) => i.size));
      if (Math.abs(ry - it.y) < Math.max(1.5, Math.min(rs, it.size) * 0.35)) {
        row = r;
        break;
      }
    }
    if (row) row.push(it);
    else rows.push([it]);
  }
  let lines = rows.map(makeLine);
  // Индексы: мелкий фрагмент чуть выше/ниже строки и вплотную к ней
  const merged = new Set<Line>();
  for (const small of lines) {
    if (small.items.length > 3) continue;
    for (const big of lines) {
      if (big === small || merged.has(big) || small.size > big.size * 0.85) continue;
      const dy = small.y - big.y;
      if (Math.abs(dy) > big.size * 0.55) continue;
      const near = small.x0 <= big.x1 + 2 && small.x1 >= big.x0 - 2;
      if (!near) continue;
      for (const it of small.items) it.script = dy > 0 ? "super" : "sub";
      big.items.push(...small.items);
      merged.add(small);
      Object.assign(big, makeLine(big.items));
      break;
    }
  }
  lines = lines.filter((l) => !merged.has(l));
  return lines.sort((a, b) => b.y - a.y || a.x0 - b.x0);
}

/** Куски строки, разделённые большими промежутками (столбики, табуляция). */
function fragments(line: Line, minGap: number): Item[][] {
  const out: Item[][] = [[line.items[0]]];
  for (let i = 1; i < line.items.length; i++) {
    const prev = line.items[i - 1];
    const it = line.items[i];
    if (it.x - (prev.x + prev.width) > Math.max(minGap, line.size * 2)) out.push([it]);
    else out[out.length - 1].push(it);
  }
  return out;
}

// ── Текст строки → куски с оформлением ──

const sameStyle = (a: Run, b: Item) =>
  a.font === b.font &&
  Math.abs(a.size - b.size) < 0.6 &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.color === b.color &&
  !!a.underline === !!b.underline &&
  !!a.strike === !!b.strike &&
  a.script === b.script;

export function lineRuns(line: Line, tabs: { x: number; tab: boolean }[] = []): Run[] {
  const runs: Run[] = [];
  let lastEnd = -Infinity;
  for (const it of line.items) {
    let text = it.str;
    if (runs.length) {
      const gap = it.x - lastEnd;
      const tab = tabs.find((t) => Math.abs(t.x - it.x) < 1);
      if (tab?.tab) text = "\t" + text.replace(/^\s+/, "");
      else if (gap > it.size * 0.15 && !/\s$/.test(runs[runs.length - 1].text) && !/^\s/.test(text)) text = " " + text;
    }
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, it)) last.text += text;
    else if (last && /^\s+$/.test(text.slice(0, 1)) && text.trim() && sameStyle({ ...last, script: it.script }, it)) last.text += text;
    else
      runs.push({
        text,
        font: it.font,
        size: it.size,
        bold: it.bold,
        italic: it.italic,
        color: it.color,
        underline: it.underline,
        strike: it.strike,
        script: it.script,
      });
    lastEnd = it.x + it.width;
  }
  return runs;
}

const runsText = (runs: Run[]) => runs.map((r) => r.text).join("");

/** Склеить строку абзаца с предыдущей: перенос «дого-» + «вор», иначе пробел. */
export function appendLine(runs: Run[], next: Run[]) {
  if (!next.length) return;
  const last = runs[runs.length - 1];
  const nextText = runsText(next);
  if (last) {
    last.text = last.text.replace(/­$/, "");
    if (/[a-zа-яё]-$/iu.test(last.text) && /^[a-zа-яё]/u.test(nextText) && !/^(и|или|то|либо|нибудь|таки)\b/u.test(nextText)) {
      last.text = last.text.slice(0, -1);
    } else if (!/\s$/.test(last.text) && !/^\s/.test(nextText) && !/[­]$/.test(last.text)) {
      last.text += " ";
    }
  }
  for (const r of next) {
    const l = runs[runs.length - 1];
    if (l && l.font === r.font && Math.abs(l.size - r.size) < 0.6 && l.bold === r.bold && l.italic === r.italic && l.color === r.color && !!l.underline === !!r.underline && !!l.strike === !!r.strike && l.script === r.script)
      l.text += r.text;
    else runs.push({ ...r });
  }
}

// ── Абзацы ──

interface Flow {
  left: number;
  right: number;
  bodySize: number;
  /** Межстрочный шаг на 1 пт кегля. */
  pitchRatio: number;
}

const firstWordWidth = (line: Line) => {
  const it = line.items[0];
  const word = it.str.trim().split(/\s+/)[0] ?? "";
  const chars = Math.max(1, it.str.length);
  return (it.width * word.length) / chars;
};

const isCentered = (l: Line, f: Flow) => {
  const w = f.right - f.left;
  const c = (l.x0 + l.x1) / 2;
  return Math.abs(c - (f.left + f.right) / 2) < Math.max(3, w * 0.025) && l.x0 > f.left + l.size && l.x1 < f.right - l.size;
};

const allBold = (l: Line) => l.items.every((i) => i.bold || !i.str.trim());

function markerOf(line: Line): { marker: string; textX: number } | null {
  const first = line.items[0];
  const s = first.str.trimStart();
  const m = s.match(BULLET_RE) ?? s.match(NUMBER_RE);
  if (!m) return null;
  // Начало текста после маркера: следующий фрагмент или расчёт по ширине
  let textX: number;
  if (m[0].length >= s.length && line.items[1]) textX = line.items[1].x;
  else textX = first.x + (first.width * m[0].length) / Math.max(1, first.str.length);
  return { marker: m[1], textX };
}

/** Начинает ли строка новый абзац относительно текущего. */
function breaksBefore(cur: Line[], line: Line, f: Flow): boolean {
  const prev = cur[cur.length - 1];
  const gap = prev.y - line.y;
  if (gap <= 0) return true;
  const pitch = cur.length >= 2 ? (cur[0].y - prev.y) / (cur.length - 1) : f.pitchRatio * Math.max(prev.size, line.size);
  if (gap > pitch * 1.3 + 0.5) return true;
  if (Math.abs(line.size - prev.size) > 1) return true;
  const mk = markerOf(line);
  if (mk && (SENTENCE_END.test(runsText(lineRuns(prev)).trim()) || prev.x1 < f.right - prev.size * 3)) return true;
  // Предыдущая строка закончилась раньше, чем могла бы: следующее слово
  // поместилось бы — значит, там конец абзаца
  const centered = isCentered(prev, f);
  const room = centered ? f.right - f.left - (prev.x1 - prev.x0) : f.right - prev.x1;
  if (room > firstWordWidth(line) + prev.size * 0.6 + 2) return true;
  // Красная строка: строка начинается правее продолжения абзаца
  if (cur.length >= 2) {
    const contX = cur[1].x0;
    if (line.x0 > contX + line.size * 0.6) return true;
    if (line.x0 < contX - line.size * 0.6 && !markerOf(cur[0])) return true;
  }
  return false;
}

/** Абзац из строк. */
function buildPara(lines: Line[], f: Flow, page: number): ParaBlock {
  const first = lines[0];
  const last = lines[lines.length - 1];
  const w = f.right - f.left;
  let align: Align = "left";
  if (lines.every((l) => isCentered(l, f))) align = "center";
  else if (lines.every((l) => l.x1 > f.right - 2) && first.x0 > f.left + w * 0.25) align = "right";
  else if (lines.length >= 2 && lines.slice(0, -1).every((l) => l.x1 > f.right - Math.max(2, l.size * 0.5))) align = "justify";

  // Номер или маркер — список, только если текст после него выровнен
  // отдельно (выступ) или отбит заметным промежутком; «1.1. Текст…» с
  // переносом под номер — обычный абзац
  let mk = markerOf(first);
  if (mk && !BULLET_RE.test(first.items[0].str.trimStart())) {
    const hanging = lines.length >= 2 && Math.min(...lines.slice(1).map((l) => l.x0)) > first.x0 + first.size * 0.8;
    const markerEnd = first.items[0].x + first.items[0].width;
    const spaced = first.items.length > 1 && first.items[0].str.trim() === mk.marker && mk.textX - markerEnd > first.size * 0.6;
    if (!hanging && !spaced) mk = null;
  }
  const contX = lines.length >= 2 ? Math.min(...lines.slice(1).map((l) => l.x0)) : mk ? mk.textX : first.x0;
  let indentLeft = align === "center" || align === "right" ? 0 : Math.max(0, contX - f.left);
  let firstLine = align === "center" || align === "right" ? 0 : first.x0 - contX;
  const tabs: TabStop[] = [];
  const tabXs: { x: number; tab: boolean }[] = [];
  if (mk && align !== "center" && align !== "right") {
    // Маркер списка с выступом: «1.<tab>текст» — текст выровнен по отступу
    indentLeft = Math.max(0, (lines.length >= 2 ? contX : mk.textX) - f.left);
    firstLine = first.x0 - (f.left + indentLeft);
    if (firstLine > -2) firstLine = Math.min(firstLine, 0);
    // Явная позиция табуляции на отступе — текст после маркера встанет ровно
    if (firstLine < 0) tabs.push({ type: "left", pos: indentLeft });
  }

  // Большие промежутки в строке — табуляция (формы «г. Москва ....... 15 марта»)
  for (const l of lines) {
    for (let i = 1; i < l.items.length; i++) {
      const prev = l.items[i - 1];
      const it = l.items[i];
      const gap = it.x - (prev.x + prev.width);
      if (gap > Math.max(l.size * 2.5, 18)) {
        const atRight = i === l.items.length - 1 || l.items.slice(i).every((k) => k.x < f.right);
        const endsAtRight = l.x1 > f.right - 2 && atRight && l.items.slice(i).reduce((s, k) => s + k.width, 0) < w * 0.5;
        if (endsAtRight) tabs.push({ type: "right", pos: f.right - f.left });
        else tabs.push({ type: "left", pos: it.x - f.left });
        tabXs.push({ x: it.x, tab: true });
      }
    }
  }

  const runs: Run[] = [];
  lines.forEach((l, i) => {
    const r = lineRuns(l, tabXs);
    if (i === 0) {
      runs.push(...r);
      if (mk && align !== "center" && align !== "right" && runs.length) {
        // Пробел после маркера → табуляция до отступа
        const t = runs[0].text;
        const k = t.trimStart().indexOf(mk.marker) + (t.length - t.trimStart().length) + mk.marker.length;
        runs[0].text = t.slice(0, k) + "\t" + t.slice(k).replace(/^\s+/, "");
      }
    } else appendLine(runs, r);
  });
  for (const r of runs) r.text = r.text.replace(/­/g, "");
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");

  const pitch = lines.length >= 2 ? (first.y - last.y) / (lines.length - 1) : 0;
  const size = mode(lines.flatMap((l) => l.items.map((i) => i.size)));
  const lineSpacing = pitch ? Math.min(3, Math.max(0.8, Math.round((pitch / (size * 1.15)) * 20) / 20)) : 1;

  const text = runsText(runs).trim();
  let heading: ParaBlock["heading"] = 0;
  const ratio = size / f.bodySize;
  const boldAll = lines.every(allBold);
  if (lines.length <= 3 && text.length < 200 && !/[.,;]$/.test(text)) {
    if (ratio >= 1.6) heading = 1;
    else if (ratio >= 1.25) heading = 2;
    else if ((ratio >= 1.1 && boldAll) || (boldAll && lines.length <= 2 && text.length < 120 && /^[\dA-ZА-ЯЁIVX]/u.test(text) && !mk)) heading = 3;
  }
  return {
    kind: "para",
    runs,
    align,
    indentLeft: Math.round(indentLeft * 2) / 2,
    firstLine: Math.round(firstLine * 2) / 2,
    indentRight: 0,
    spaceBefore: 0,
    lineSpacing,
    heading,
    tabs,
    shading: null,
    top: first.top,
    bottom: last.bottom,
    page,
    lastLineFull: last.x1 > f.right - Math.max(last.size * 3, 12),
    endsSentence: SENTENCE_END.test(text),
    bodyX: contX,
  };
}

function makeFlow(lines: Line[], left?: number, right?: number): Flow {
  const sizes = lines.flatMap((l) => l.items.map((i) => i.size));
  const bodySize = mode(sizes) || 11;
  const ratios: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    if (Math.abs(lines[i].size - lines[i - 1].size) < 0.6 && d > 0 && d < lines[i].size * 2.2) ratios.push(d / lines[i].size);
  }
  const L = left ?? quantile(lines.map((l) => l.x0), 0.1);
  const longs = lines.map((l) => l.x1);
  const R = right ?? (longs.length ? quantile(longs, 0.9) : L + 100);
  return { left: L, right: Math.max(R, L + 10), bodySize, pitchRatio: median(ratios) || 1.2 };
}

/** Строки → абзацы (с интервалами перед ними). */
export function linesToParas(lines: Line[], page: number, left?: number, right?: number, flowIn?: Flow): ParaBlock[] {
  if (!lines.length) return [];
  const f = flowIn ?? makeFlow(lines, left, right);
  const groups: Line[][] = [];
  for (const l of lines) {
    const cur = groups[groups.length - 1];
    if (cur && !breaksBefore(cur, l, f)) cur.push(l);
    else groups.push([l]);
  }
  return groups.map((g) => buildPara(g, f, page));
}

// ── Таблицы без рамок: строки с одинаковыми «столбиками» ──

interface PlainTable {
  lines: Line[];
  cols: number[];
}

function findPlainTables(lines: Line[]): PlainTable[] {
  const out: PlainTable[] = [];
  const frag = lines.map((l) => fragments(l, 14));
  let i = 0;
  while (i < lines.length) {
    if (frag[i].length < 2) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && frag[j + 1].length >= 2 && lines[j].y - lines[j + 1].y < lines[j].size * 2.6) j++;
    const n = j - i + 1;
    if (n >= 3) {
      // Столбцы — начала кусков, совпадающие у большинства строк
      const starts = frag.slice(i, j + 1).flatMap((fs) => fs.map((f) => f[0].x));
      starts.sort((a, b) => a - b);
      const cols: number[] = [];
      for (const x of starts) {
        if (cols.length && x - cols[cols.length - 1] < 6) continue;
        const support = frag.slice(i, j + 1).filter((fs) => fs.some((f) => Math.abs(f[0].x - x) < 6)).length;
        if (support >= Math.max(2, n * 0.6)) cols.push(x);
      }
      // Каждый кусок должен начинаться у одного из столбцов (или быть выровнен вправо)
      const ok =
        cols.length >= 2 &&
        frag.slice(i, j + 1).every((fs) =>
          fs.every((f, k) => {
            const x = f[0].x;
            const right = f[f.length - 1].x + f[f.length - 1].width;
            return cols.some((c) => Math.abs(c - x) < 6) || (k > 0 && cols.some((c, ci) => ci > 0 && x > c - 6 && (cols[ci + 1] === undefined || right < cols[ci + 1])));
          }),
        );
      if (ok) {
        out.push({ lines: lines.slice(i, j + 1), cols });
        i = j + 1;
        continue;
      }
    }
    i = j + 1;
  }
  return out;
}

function plainTableBlock(t: PlainTable, page: number, right: number): TableBlock {
  const cols = t.cols;
  const C = cols.length;
  const rows: CellBlock[][] = t.lines.map((l) => {
    const cells: Item[][] = Array.from({ length: C }, () => []);
    for (const it of l.items) {
      let c = 0;
      for (let k = 0; k < C; k++) if (it.x >= cols[k] - 6) c = k;
      cells[c].push(it);
    }
    return cells.map((its) => ({
      rowSpan: 1,
      colSpan: 1,
      covered: false,
      paras: its.length ? linesToParas(groupLines(its), page, its[0].x, its[its.length - 1].x + its[its.length - 1].width) : [],
      images: [],
      shading: null,
      vAlign: "top" as const,
    }));
  });
  const colWidths = cols.map((x, k) => (k + 1 < C ? cols[k + 1] - x : Math.max(30, right - x)));
  const maxX = Math.max(...t.lines.map((l) => l.x1));
  colWidths[C - 1] = Math.max(colWidths[C - 1], maxX - cols[C - 1] + 6);
  return {
    kind: "table",
    colWidths,
    // Высота строки — шаг между строками таблицы в PDF
    rowHeights: t.lines.map((l, i) => {
      const next = t.lines[i + 1] ?? t.lines[i - 1];
      const d = next ? Math.abs(l.y - next.y) : l.size * 1.3;
      return Math.max(l.size * 1.1, Math.min(d, l.size * 2.5));
    }),
    rows,
    borders: false,
    headerRows: t.lines[0].items.every((i) => i.bold) && t.lines.length > 2 ? 1 : 0,
    x0: cols[0],
    top: t.lines[0].top,
    bottom: t.lines[t.lines.length - 1].bottom,
    page,
  };
}

// ── Таблицы с рамками → блоки ──

function ruledTableBlock(t: RawTable, page: number): TableBlock {
  const rows = t.cells.map((row) =>
    row.map((cell): CellBlock => {
      const pad = 1.5;
      const lines = groupLines(cell.items);
      const paras = linesToParas(lines, page, cell.box.x0 + pad, cell.box.x1 - pad);
      let vAlign: CellBlock["vAlign"] = "top";
      if (lines.length) {
        const topGap = cell.box.y1 - lines[0].top;
        const botGap = lines[lines.length - 1].bottom - cell.box.y0;
        if (topGap > 6 && Math.abs(topGap - botGap) < Math.max(3, (topGap + botGap) * 0.2)) vAlign = "center";
        else if (topGap > botGap + 10) vAlign = "bottom";
      }
      for (const p of paras) {
        // Внутри ячейки абзацы прижимаем к её левому краю
        p.indentLeft = Math.max(0, Math.min(p.indentLeft, 30));
        p.spaceBefore = 0;
      }
      return {
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        covered: cell.covered,
        paras,
        images: [],
        shading: cell.shading,
        vAlign,
      };
    }),
  );
  // Строки-заголовки: жирные или залитые строки сверху
  let headerRows = 0;
  for (let r = 0; r < Math.min(3, t.cells.length - 1); r++) {
    const cells = t.cells[r].filter((c) => !c.covered);
    const its = cells.flatMap((c) => c.items);
    const bold = its.length > 0 && its.every((i) => i.bold);
    const shaded = cells.length > 0 && cells.every((c) => c.shading);
    if (bold || shaded) headerRows = r + 1;
    else break;
  }
  if (headerRows >= t.cells.length) headerRows = 0;
  return {
    kind: "table",
    colWidths: t.colXs.slice(1).map((x, i) => x - t.colXs[i]),
    rowHeights: t.rowYs.slice(1).map((y, i) => t.rowYs[i] - y),
    rows,
    borders: true,
    borderColor: t.borderColor,
    borderWidth: t.borderWidth,
    headerRows,
    x0: t.x0,
    top: t.y1,
    bottom: t.y0,
    page,
  };
}

// ── Колонки ──

interface ColumnZone {
  y0: number;
  y1: number;
  /** Границы колонок по X: [левый край, промежуток1, …, правый край]. */
  splits: number[];
}

/** Найти зоны многоколоночной вёрстки по вертикальным «коридорам» без текста. */
function findColumnZones(items: Item[], left: number, right: number): ColumnZone[] {
  const W = right - left;
  if (W < 150 || items.length < 20) return [];
  const boxes = items.map(itemBox);
  const lineKey = (it: Item) => Math.round(it.y);
  const cands: { g: number; y0: number; y1: number; score: number }[] = [];
  for (let g = left + W * 0.2; g <= right - W * 0.2; g += 2) {
    const crossing = boxes.filter((b) => b.x0 < g && b.x1 > g);
    // Строка, у которой слова слева и справа от g стоят вплотную (обычный
    // пробел между словами), тоже перекрывает «коридор»
    const byLine = new Map<number, { l: number; r: number; y0: number; y1: number; size: number }>();
    items.forEach((it, i) => {
      const b = boxes[i];
      const k = lineKey(it);
      const e = byLine.get(k) ?? { l: -Infinity, r: Infinity, y0: b.y0, y1: b.y1, size: it.size };
      if (b.x1 <= g) e.l = Math.max(e.l, b.x1);
      if (b.x0 >= g) e.r = Math.min(e.r, b.x0);
      e.y0 = Math.min(e.y0, b.y0);
      e.y1 = Math.max(e.y1, b.y1);
      byLine.set(k, e);
    });
    for (const e of byLine.values()) if (isFinite(e.l) && isFinite(e.r) && e.r - e.l < Math.max(10, e.size * 1.25)) crossing.push({ x0: e.l, x1: e.r, y0: e.y0, y1: e.y1 });
    // Вертикальные отрезки без пересечений
    const blockers = crossing.map((b) => [b.y0, b.y1] as [number, number]).sort((a, b) => b[1] - a[1]);
    const ys = [Infinity, ...blockers.flatMap((b) => [b[1], b[0]]), -Infinity];
    for (let k = 0; k + 1 < ys.length; k += 2) {
      const yTop = Math.min(ys[k], 1e6);
      const yBot = Math.max(ys[k + 1], -1e6);
      if (yTop - yBot < 40) continue;
      const leftLines = new Set<number>();
      const rightLines = new Set<number>();
      const rightStart = new Map<number, number>();
      let lInk = 0,
        rInk = 0;
      let lTop = -Infinity,
        lBot = Infinity,
        rTop = -Infinity,
        rBot = Infinity;
      items.forEach((it, i) => {
        const b = boxes[i];
        if (b.y1 > yTop || b.y0 < yBot) return;
        if (b.x1 <= g - 4) {
          lInk += it.width;
          leftLines.add(lineKey(it));
          lTop = Math.max(lTop, b.y1);
          lBot = Math.min(lBot, b.y0);
        } else if (b.x0 >= g + 4) {
          rInk += it.width;
          rightLines.add(lineKey(it));
          rightStart.set(lineKey(it), Math.min(rightStart.get(lineKey(it)) ?? Infinity, b.x0));
          rTop = Math.max(rTop, b.y1);
          rBot = Math.min(rBot, b.y0);
        }
      });
      if (leftLines.size < 4 || rightLines.size < 4) continue;
      // Колонки текста заполнены по ширине; у таблицы между столбиками пусто
      if (lInk / (leftLines.size * (g - left)) < 0.5 || rInk / (rightLines.size * (right - g)) < 0.5) continue;
      // Правая колонка начинается ровно с одного края; случайный «коридор»
      // из пробелов выровненного текста — с разных мест
      const starts = [...rightStart.values()];
      const m0 = median(starts);
      if (starts.filter((x) => Math.abs(x - m0) < 2).length < starts.length * 0.7) continue;
      const zTop = Math.max(lTop, rTop);
      const zBot = Math.min(lBot, rBot);
      const span = Math.max(lTop, rTop) - Math.min(lBot, rBot);
      // Обе колонки должны занимать значительную общую высоту
      if (zTop - zBot < span * 0.5) continue;
      cands.push({ g, y0: Math.min(lBot, rBot), y1: Math.max(lTop, rTop), score: Math.min(leftLines.size, rightLines.size) });
    }
  }
  if (!cands.length) return [];
  cands.sort((a, b) => b.score - a.score);
  const zones: ColumnZone[] = [];
  for (const c of cands) {
    if (zones.some((z) => !(c.y1 < z.y0 || c.y0 > z.y1))) continue;
    // Центр коридора: все допустимые g этой зоны
    const same = cands.filter((d) => Math.abs(d.y0 - c.y0) < 5 && Math.abs(d.y1 - c.y1) < 5 && Math.abs(d.g - c.g) < W * 0.3);
    const gs = same.map((d) => d.g).sort((a, b) => a - b);
    // Только непрерывный кусок вокруг лучшего g
    let lo = c.g;
    let hi = c.g;
    for (const g of gs) if (g >= lo - 2.5 && g <= hi + 2.5) {
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    zones.push({ y0: c.y0, y1: c.y1, splits: [left, (lo + hi) / 2, right] });
  }
  // Третья колонка: ищем коридор в каждой половине
  for (const z of zones) {
    const extra: number[] = [];
    for (let k = 0; k + 1 < z.splits.length; k++) {
      const sub = items.filter((it) => it.y >= z.y0 - 1 && it.y <= z.y1 + 1 && it.x >= z.splits[k] - 1 && it.x + it.width <= z.splits[k + 1] + 1);
      const inner = findColumnZones(sub, z.splits[k] + (k ? 4 : 0), z.splits[k + 1] - 4);
      const best = inner.find((iz) => iz.y1 - iz.y0 > (z.y1 - z.y0) * 0.7);
      if (best) extra.push(best.splits[1]);
    }
    z.splits = [...z.splits, ...extra].sort((a, b) => a - b);
  }
  return zones.sort((a, b) => b.y1 - a.y1);
}

// ── Макет: презентации, буклеты, страницы с фоном ──

/**
 * Страница-макет: фон или крупные плашки/картинки под текстом. Такую страницу
 * нельзя честно уложить в поток Word — фон пропадёт, белый текст окажется
 * на белом. Её переносим «фон + текст в рамках».
 */
export function isDesignCandidate(raw: PageRaw): boolean {
  const area = raw.width * raw.height;
  const big = [...raw.fills, ...raw.shapes, ...raw.images].some((b) => (b.x1 - b.x0) * (b.y1 - b.y0) > area * 0.45);
  const chars = raw.items.reduce((s, i) => s + i.str.length, 0);
  if (!chars) return false;
  const under = [...raw.fills, ...raw.images.filter((im) => !im.fullPage), ...raw.shapes.filter((s) => s.kind === "fill")].filter(
    (b) => (b.x1 - b.x0) * (b.y1 - b.y0) > 400,
  );
  let onTop = 0;
  for (const it of raw.items) {
    const c = center(it);
    if (under.some((b) => inside(b, c.x, c.y))) onTop += it.str.length;
  }
  return big || onTop > chars * 0.3;
}

export function layoutDesignPage(raw: PageRaw, background: ImageBlock | null): PageLayout {
  // Куски строк (две колонки на одной высоте — разные блоки)
  const pieces: Line[] = [];
  for (const l of groupLines(raw.items)) for (const f of fragments(l, 14)) pieces.push(makeLine(f));
  pieces.sort((a, b) => b.top - a.top || a.x0 - b.x0);
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      const gap = a.bottom - b.top;
      if (gap > Math.max(a.size, b.size) * 0.9) continue;
      if (gap < -Math.max(a.size, b.size) * 0.5) continue; // на одной высоте — рядом стоящие блоки
      const ratio = Math.max(a.size, b.size) / Math.min(a.size, b.size);
      if (ratio > 1.6) continue;
      const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const aligned = Math.abs(a.x0 - b.x0) < 3 || Math.abs(a.x1 - b.x1) < 3 || Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < 3;
      if (overlapX > Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.3 || aligned) parent[find(j)] = find(i);
    }
  const groups = new Map<number, Line[]>();
  pieces.forEach((p, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  });
  const frames = [...groups.values()].map((ls) => {
    ls.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const x0 = Math.min(...ls.map((l) => l.x0));
    const x1 = Math.max(...ls.map((l) => l.x1));
    const top = Math.max(...ls.map((l) => l.top));
    const bottom = Math.min(...ls.map((l) => l.bottom));
    const paras = linesToParas(ls, raw.index, x0, x1);
    let prev: number | null = null;
    for (const p of paras) {
      if (prev !== null) {
        const size = p.runs[0]?.size ?? 11;
        const extra = prev - p.top - (size * 1.15 * p.lineSpacing - size);
        p.spaceBefore = extra < 1.5 ? 0 : Math.round(extra);
      }
      p.heading = 0;
      prev = p.bottom;
    }
    // Запас по ширине: шрифты Word чуть шире — иначе строки переносятся иначе
    const w = x1 - x0;
    const slack = Math.min(w * 0.12 + 6, raw.width - w);
    const align = paras[0]?.align ?? "left";
    const shift = align === "center" ? slack / 2 : align === "right" ? slack : 0;
    const fx = Math.max(0, Math.min(raw.width - (w + slack), x0 - shift));
    return { x: fx, y: Math.max(0, raw.height - top - 1), width: w + slack, height: top - bottom + 2, paras };
  });
  return {
    index: raw.index,
    width: raw.width,
    height: raw.height,
    margins: { left: 0, right: 0, top: 0, bottom: 0 },
    zones: [],
    contentBottom: 0,
    design: { background, frames },
  };
}

// ── Страница целиком ──

export interface PageContext {
  /** Ключи строк-колонтитулов (из анализа всего документа). */
  hfKeys: Set<string>;
  /** Картинки, вырезанные из отрисованной страницы. */
  cropImage: (raw: PageRaw, b: Box) => Promise<ImageBlock | null>;
}

export const lineText = (l: Line) => runsText(lineRuns(l)).replace(/\s+/g, " ").trim();
export const hfKey = (l: Line, height: number) => {
  const t = lineText(l);
  const pos = l.y > height / 2 ? "t" : "b";
  return `${pos}:${(t.length <= 60 ? t.replace(/\d+/g, "#") : t).toLowerCase()}`;
};
export const PAGE_NO_RE = /^[-–—\s]*(?:стр\.?|страница|лист|page)?\s*\d{1,4}(?:\s*(?:из|of|\/)\s*\d{1,4})?[-–—\s]*$/iu;

/** Строки у верхнего/нижнего края — кандидаты в колонтитулы. */
export function edgeLines(lines: Line[], height: number): Line[] {
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  const top = sorted.slice(0, 3).filter((l) => l.y > height * 0.88);
  const bottom = sorted.slice(-3).filter((l) => l.y < height * 0.12);
  return [...top, ...bottom];
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const overlap = (a: Box, b: Box, pad = 0) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

export async function layoutPage(raw: PageRaw, ctx: PageContext): Promise<PageLayout & { hfLines: Line[] }> {
  const W = raw.width;
  const H = raw.height;
  let items = raw.items.filter((i) => i.str.trim());

  // 1. Колонтитулы
  const allLines = groupLines(items);
  const hfItems = new Set<Item>();
  const hfLines: Line[] = [];
  for (const l of edgeLines(allLines, H))
    if (ctx.hfKeys.has(hfKey(l, H)) || (PAGE_NO_RE.test(lineText(l)) && (l.y < H * 0.1 || l.y > H * 0.92))) {
      hfLines.push(l);
      for (const it of l.items) hfItems.add(it);
    }
  items = items.filter((i) => !hfItems.has(i));

  // 2. Таблицы с рамками
  const { tables: ruled, used } = detectRuledTables(raw.hSegs, raw.vSegs, items, raw.fills);
  items = items.filter((i) => !used.has(i.idx));
  const tableBoxes: Box[] = ruled.map((t) => ({ x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1 }));
  const inTable = (b: Box) => tableBoxes.some((t) => overlap(t, b, 1));

  // 3. Подчёркивание и зачёркивание
  const freeH: Seg[] = [];
  for (const s of raw.hSegs) {
    if (tableBoxes.some((t) => inside(t, (s.a + s.b) / 2, s.pos, 2))) continue;
    let hit = false;
    for (const it of items) {
      const ov = Math.min(s.b, it.x + it.width) - Math.max(s.a, it.x);
      if (ov < it.width * 0.6 || it.width < 1) continue;
      const d = s.pos - it.y;
      if (d <= it.size * 0.05 && d >= -it.size * 0.3) {
        it.underline = true;
        hit = true;
      } else if (d > it.size * 0.15 && d < it.size * 0.45 && s.b - s.a < it.width * 1.5 + 4) {
        it.strike = true;
        hit = true;
      }
    }
    if (!hit) freeH.push(s);
  }
  const freeV = raw.vSegs.filter((s) => !tableBoxes.some((t) => inside(t, s.pos, (s.a + s.b) / 2, 2)));

  // 4. Маркеры списков, нарисованные фигурками (кружок/квадрат слева от строки)
  const lines0 = groupLines(items);
  const shapes = raw.shapes.filter((s) => !inTable(s));
  const fills = raw.fills.filter((f) => !inTable(f));
  const consumed = new Set<object>();
  for (const sh of [...shapes, ...fills]) {
    const w = sh.x1 - sh.x0;
    const h = sh.y1 - sh.y0;
    if (w > 8 || h > 8 || w < 1.5 || h < 1.5 || Math.abs(w - h) > 2) continue;
    const cy = (sh.y0 + sh.y1) / 2;
    const line = lines0.find((l) => l.x0 > sh.x1 + 1 && l.x0 < sh.x1 + 30 && cy > l.y - l.size * 0.1 && cy < l.y + l.size * 0.8);
    if (!line) continue;
    const ref = line.items[0];
    const marker: Item = { ...ref, str: "curved" in sh && sh.curved ? "•" : "▪", x: sh.x0, width: w, idx: -1, underline: false, strike: false, script: undefined };
    items.push(marker);
    consumed.add(sh);
  }

  // 5. Плашки под текстом (одиночная заливка, внутри которой текст) — заливка абзаца
  const shadings: { box: Box; color: string }[] = [];
  for (const f of fills) {
    if (consumed.has(f)) continue;
    const textIn = items.filter((it) => inside(f, center(it).x, center(it).y));
    const others = [...shapes, ...fills].filter((o) => o !== f && !consumed.has(o) && overlap(o, f, 2));
    if (textIn.length && !others.length) {
      shadings.push({ box: f, color: f.color });
      consumed.add(f);
    }
  }

  // 6. Рисунки: оставшиеся фигуры, линии вне таблиц и картинки → области
  const prims: Box[] = [
    ...shapes.filter((s) => !consumed.has(s)),
    ...fills.filter((f) => !consumed.has(f)),
    ...freeH.map((s) => ({ x0: s.a, x1: s.b, y0: s.pos - s.width / 2, y1: s.pos + s.width / 2 })),
    ...freeV.map((s) => ({ x0: s.pos - s.width / 2, x1: s.pos + s.width / 2, y0: s.a, y1: s.b })),
  ];
  const rasterImgs = raw.images.filter((im) => !im.fullPage && !inTable(im));
  let regions: { box: Box; prims: number; raster: boolean; rule: boolean }[] = [];
  for (const p of prims) regions.push({ box: { ...p }, prims: 1, raster: false, rule: false });
  for (const im of rasterImgs) regions.push({ box: { ...im }, prims: 1, raster: true, rule: false });
  // Склеиваем близкие элементы в одну область
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < regions.length; a++)
      for (let b = a + 1; b < regions.length; b++) {
        if (overlap(regions[a].box, regions[b].box, 6)) {
          regions[a] = {
            box: union(regions[a].box, regions[b].box),
            prims: regions[a].prims + regions[b].prims,
            raster: regions[a].raster || regions[b].raster,
            rule: false,
          };
          regions.splice(b, 1);
          changed = true;
          break outer;
        }
      }
  }
  const rules: Box[] = [];
  regions = regions.filter((r) => {
    const w = r.box.x1 - r.box.x0;
    const h = r.box.y1 - r.box.y0;
    if (!r.raster && r.prims === 1 && h < 3 && w > 40) {
      rules.push(r.box); // одиночная горизонтальная линия — разделитель
      return false;
    }
    if (r.raster) return w >= 8 && h >= 8;
    return w >= 24 && h >= 16;
  });
  // Подписи внутри графика уходят в картинку вместе с ним
  const graphicBlocks: ImageBlock[] = [];
  for (const r of regions) {
    const inR = items.filter((it) => {
      const c = center(it);
      return inside(r.box, c.x, c.y, 1);
    });
    const textArea = inR.reduce((s, it) => s + it.width * it.size, 0);
    const area = (r.box.x1 - r.box.x0) * (r.box.y1 - r.box.y0);
    // Много текста — это не график, а оформленный текст: оставляем текстом
    if (!r.raster && textArea > area * 0.35) continue;
    // Подписи, выступающие за рисунок (оси, легенда), — включаем в рамку:
    // строки рядом с рисунком, целиком лежащие в его ширине
    let box = r.box;
    for (const it of inR) box = union(box, itemBox(it));
    const pageBody = mode(items.map((i) => i.size));
    for (const l of r.raster ? [] : groupLines(items)) {
      if (l.items.some((i) => inR.includes(i))) continue;
      if (l.items.some((i) => i.size > pageBody * 0.95)) continue;
      const near = (l.bottom < box.y0 && box.y0 - l.top < l.size * 1.2) || (l.top > box.y1 && l.bottom - box.y1 < l.size * 1.2);
      if (near && l.x0 >= box.x0 - 10 && l.x1 <= box.x1 + 10 && l.items.every((i) => i.str.length <= 12)) {
        inR.push(...l.items);
        for (const it of l.items) box = union(box, itemBox(it));
      }
    }
    const block = await ctx.cropImage(raw, box);
    if (!block) continue;
    graphicBlocks.push(block);
    const drop = new Set(inR);
    items = items.filter((i) => !drop.has(i));
  }

  // 7. Поля и колонки
  const contentBoxes: Box[] = [...items.map(itemBox), ...tableBoxes, ...graphicBlocks.map((g) => ({ x0: g.indentLeft, x1: g.indentLeft + g.width, y0: g.bottom, y1: g.top }))];
  const left = contentBoxes.length ? Math.min(...contentBoxes.map((b) => b.x0)) : 72;
  const right = contentBoxes.length ? Math.max(...contentBoxes.map((b) => b.x1)) : W - 72;
  const top = contentBoxes.length ? Math.max(...contentBoxes.map((b) => b.y1)) : H - 72;
  const bottom = contentBoxes.length ? Math.min(...contentBoxes.map((b) => b.y0)) : 72;

  const zonesC = findColumnZones(items, left, right);

  // Элементы потока с положением
  type El = { top: number; bottom: number; x0: number; x1: number; block?: Block; item?: Item };
  const els: El[] = [
    ...items.map((it) => {
      const b = itemBox(it);
      return { top: b.y1, bottom: b.y0, x0: b.x0, x1: b.x1, item: it };
    }),
    ...ruled.map((t) => ({ top: t.y1, bottom: t.y0, x0: t.x0, x1: t.x1, block: ruledTableBlock(t, raw.index) as Block })),
    ...graphicBlocks.map((g) => ({ top: g.top, bottom: g.bottom, x0: g.indentLeft, x1: g.indentLeft + g.width, block: g as Block })),
  ];

  // Разбить по зонам: одноколоночные полосы и многоколоночные зоны
  const zoneOf = (e: El) => zonesC.findIndex((z) => e.top <= z.y1 + 2 && e.bottom >= z.y0 - 2);
  const zones: Zone[] = [];
  const bands: { y: number; zone: number; els: El[] }[] = [];
  const sortedEls = [...els].sort((a, b) => b.top - a.top);
  for (const e of sortedEls) {
    const z = zoneOf(e);
    const lastBand = bands[bands.length - 1];
    if (lastBand && lastBand.zone === z) lastBand.els.push(e);
    else {
      const existing = z >= 0 ? bands.find((b) => b.zone === z) : undefined;
      if (existing) existing.els.push(e);
      else bands.push({ y: e.top, zone: z, els: [e] });
    }
  }

  const flowBlocks = (es: El[], fl: number, fr: number): Block[] => {
    const its = es.filter((e) => e.item).map((e) => e.item!);
    const blocks = es.filter((e) => e.block).map((e) => e.block!);
    const lines = groupLines(its);
    // Таблицы без рамок
    const plain = findPlainTables(lines);
    const plainLines = new Set(plain.flatMap((p) => p.lines));
    const restLines = lines.filter((l) => !plainLines.has(l));
    for (const p of plain) blocks.push(plainTableBlock(p, raw.index, fr));
    // Абзацы — между блоками, чтобы абзац не «перепрыгивал» таблицу
    const flow = makeFlow(restLines.length ? restLines : lines, fl, fr);
    const cuts = blocks.map((b) => (b.kind === "table" || b.kind === "image" ? b.top : 0)).sort((a, b) => b - a);
    const chunks: Line[][] = [[]];
    let ci = 0;
    for (const l of restLines) {
      while (ci < cuts.length && l.y < cuts[ci]) {
        ci++;
        chunks.push([]);
      }
      chunks[chunks.length - 1].push(l);
    }
    for (const ch of chunks) blocks.push(...linesToParas(ch, raw.index, fl, fr, flow));
    // Плашки → заливка абзацев
    for (const b of blocks)
      if (b.kind === "para") {
        const sh = shadings.find((s) => b.top <= s.box.y1 + 2 && b.bottom >= s.box.y0 - 2);
        if (sh) b.shading = sh.color;
      }
    blocks.sort((a, b) => b.top - a.top);
    // Интервал перед блоком — по фактическому промежутку
    let prevBottom: number | null = null;
    for (const b of blocks) {
      if (prevBottom !== null && b.kind === "para") {
        // Видимый промежуток минус «воздух», который Word и так даёт строке
        const size = b.runs[0]?.size ?? flow.bodySize;
        const lineH = size * 1.15 * b.lineSpacing;
        const extra = prevBottom - b.top - (lineH - size);
        b.spaceBefore = extra < 1.5 ? 0 : Math.min(72, Math.round(extra));
      } else if (prevBottom !== null) {
        const gap = prevBottom - b.top - flow.bodySize * 0.2;
        b.spaceBefore = gap < 2 ? 0 : Math.min(72, Math.round(gap));
      }
      // Горизонтальная линия под абзацем
      if (b.kind === "para") {
        const rule = rules.find((r) => r.y1 <= b.bottom + 1 && r.y1 > b.bottom - 14 && r.x0 < b.bodyX + 20);
        if (rule) {
          b.borderBottom = true;
          rules.splice(rules.indexOf(rule), 1);
        }
      }
      prevBottom = b.bottom;
    }
    // Положение картинок/таблиц относительно колонки
    for (const b of blocks) {
      if (b.kind === "image") {
        const c = b.indentLeft + b.width / 2;
        const colC = (fl + fr) / 2;
        if (Math.abs(c - colC) < (fr - fl) * 0.05) b.align = "center";
        else if (b.indentLeft + b.width > fr - 4 && b.indentLeft > fl + 20) b.align = "right";
        b.indentLeft = b.align === "left" ? Math.max(0, b.indentLeft - fl) : 0;
      } else if (b.kind === "table") b.x0 = Math.max(0, b.x0 - fl);
    }
    return blocks;
  };

  for (const band of bands) {
    if (band.zone < 0) {
      zones.push({ columns: 1, gap: 0, blocks: flowBlocks(band.els, left, right) });
      continue;
    }
    const z = zonesC[band.zone];
    const cols = z.splits.length - 1;
    const blocks: Block[] = [];
    for (let k = 0; k < cols; k++) {
      const x0 = z.splits[k];
      const x1 = z.splits[k + 1];
      const colEls = band.els.filter((e) => {
        const c = (e.x0 + e.x1) / 2;
        return c >= x0 && c < x1;
      });
      const xs = colEls.flatMap((e) => [e.x0, e.x1]);
      const cl = xs.length ? Math.min(...colEls.map((e) => e.x0)) : x0;
      const cr = xs.length ? Math.max(...colEls.map((e) => e.x1)) : x1;
      blocks.push(...flowBlocks(colEls, cl, cr));
    }
    const gapW = (right - left - cols * 0) / cols;
    zones.push({ columns: cols, gap: Math.max(12, Math.min(40, gapW * 0.08)), blocks });
  }
  // Соседние одноколоночные полосы — одна зона
  const merged: Zone[] = [];
  for (const z of zones) {
    const last = merged[merged.length - 1];
    if (last && last.columns === 1 && z.columns === 1) last.blocks.push(...z.blocks);
    else merged.push(z);
  }

  return {
    index: raw.index,
    width: W,
    height: H,
    margins: { left, right: W - right, top: H - top, bottom },
    zones: merged,
    contentBottom: bottom,
    hfLines,
  };
}
