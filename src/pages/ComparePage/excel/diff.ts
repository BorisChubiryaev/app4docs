import type { CellPrimitive } from "../../../utils/excelCell";
import type { ExcelSheet } from "../../../types/sheet.types";

export type DiffKind = "modified" | "added" | "removed";

export interface CompareOptions {
  ignoreCase: boolean;
  /** Обрезать пробелы по краям и схлопывать повторные пробелы. */
  ignoreSpaces: boolean;
  /**
   * Сопоставлять строки по содержимому: удалённая или вставленная строка
   * не сдвигает сравнение всех следующих. false — строка N с строкой N.
   */
  alignRows: boolean;
}

/** Строка сравнения: номер строки в файле 1 и в файле 2 (null — её там нет). */
export interface AlignedRow {
  a: number | null;
  b: number | null;
}

/** Различие в ячейке. r — номер строки сравнения, c — колонка (0-based). */
export interface CellDiff {
  r: number;
  c: number;
  kind: DiffKind;
}

export interface DiffResult {
  diffs: CellDiff[];
  rows: AlignedRow[];
  rowCount: number;
  colCount: number;
  counts: Record<DiffKind, number>;
  /** Целиком удалённые / добавленные строки */
  rowsRemoved: number;
  rowsAdded: number;
  /** Строки, которые остались, но стоят под другим номером */
  shifted: number;
}

const comparable = (
  v: CellPrimitive | undefined,
  opts: Pick<CompareOptions, "ignoreCase" | "ignoreSpaces">,
): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (opts.ignoreSpaces) s = s.replace(/\s+/g, " ").trim();
  if (opts.ignoreCase) s = s.toLowerCase();
  return s;
};

// ─────────────────────────── Выравнивание строк ───────────────────────────

type Pair = [number, number];

/** Наибольшая общая подпоследовательность для небольшого участка (ДП). */
function lcsSmall(a: number[], b: number[], a0: number, a1: number, b0: number, b1: number): Pair[] {
  const n = a1 - a0;
  const m = b1 - b0;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[a0 + i] === b[b0 + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) {
      out.push([a0 + i, b0 + j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * Совпадающие строки двух списков (patience diff): общее начало и конец,
 * затем строки, уникальные в обоих файлах, как опорные точки, и рекурсия
 * между ними. Работает и на сотнях тысяч строк, не требуя квадратной памяти.
 */
function matchRows(a: number[], b: number[]): Pair[] {
  const out: Pair[] = [];
  const solve = (a0: number, a1: number, b0: number, b1: number) => {
    // общее начало
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) out.push([a0++, b0++]);
    // общий конец
    const tail: Pair[] = [];
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) tail.push([--a1, --b1]);
    if (a0 < a1 && b0 < b1) {
      if ((a1 - a0) * (b1 - b0) <= 4_000_000) {
        out.push(...lcsSmall(a, b, a0, a1, b0, b1));
      } else {
        // Уникальные в обоих участках строки
        const cntA = new Map<number, number>();
        const cntB = new Map<number, number>();
        const posB = new Map<number, number>();
        for (let i = a0; i < a1; i++) cntA.set(a[i], (cntA.get(a[i]) ?? 0) + 1);
        for (let j = b0; j < b1; j++) {
          cntB.set(b[j], (cntB.get(b[j]) ?? 0) + 1);
          posB.set(b[j], j);
        }
        const cand: Pair[] = [];
        for (let i = a0; i < a1; i++) {
          if (cntA.get(a[i]) === 1 && cntB.get(a[i]) === 1) cand.push([i, posB.get(a[i])!]);
        }
        // Наибольшая возрастающая по B подпоследовательность (терпеливая сортировка)
        const tails: number[] = [];
        const prev = new Int32Array(cand.length).fill(-1);
        for (let k = 0; k < cand.length; k++) {
          let lo = 0;
          let hi = tails.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cand[tails[mid]][1] < cand[k][1]) lo = mid + 1;
            else hi = mid;
          }
          if (lo > 0) prev[k] = tails[lo - 1];
          tails[lo] = k;
        }
        const anchors: Pair[] = [];
        for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) anchors.push(cand[k]);
        anchors.reverse();
        if (!anchors.length) {
          // Опор нет (всё повторяется или всё разное) — по порядку
          const n = Math.min(a1 - a0, b1 - b0);
          for (let k = 0; k < n; k++) if (a[a0 + k] === b[b0 + k]) out.push([a0 + k, b0 + k]);
        } else {
          let pa = a0;
          let pb = b0;
          for (const [ia, ib] of anchors) {
            solve(pa, ia, pb, ib);
            out.push([ia, ib]);
            pa = ia + 1;
            pb = ib + 1;
          }
          solve(pa, a1, pb, b1);
        }
      }
    }
    for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]);
  };
  solve(0, a.length, 0, b.length);
  return out;
}

/** Доля совпадающих непустых ячеек двух строк (0..1). */
const similarity = (ra: string[], rb: string[]): number => {
  const n = Math.max(ra.length, rb.length);
  let filled = 0;
  let same = 0;
  for (let c = 0; c < n; c++) {
    const x = ra[c] ?? "";
    const y = rb[c] ?? "";
    if (x === "" && y === "") continue;
    filled++;
    if (x === y) same++;
  }
  return filled ? same / filled : 1;
};

/**
 * Участок «удалено в 1 / добавлено во 2» между совпавшими строками:
 * похожие строки (половина ячеек и больше совпадает) ставим друг против
 * друга как изменённые, остальные — удалёнными и добавленными.
 */
function pairGap(ga: number[], gb: number[], cellsA: string[][], cellsB: string[][], out: AlignedRow[]) {
  const n = ga.length;
  const m = gb.length;
  if (!n || !m) {
    for (const a of ga) out.push({ a, b: null });
    for (const b of gb) out.push({ a: null, b });
    return;
  }
  if (n * m > 250_000) {
    // Большой участок — по порядку (как раньше)
    for (let k = 0; k < Math.max(n, m); k++) out.push({ a: ga[k] ?? null, b: gb[k] ?? null });
    return;
  }
  const MIN = 0.5;
  const w = m + 1;
  const score = new Float64Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = similarity(cellsA[ga[i]], cellsB[gb[j]]);
      const pair = s >= MIN ? score[(i + 1) * w + j + 1] + s : -1;
      score[i * w + j] = Math.max(pair, score[(i + 1) * w + j], score[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = similarity(cellsA[ga[i]], cellsB[gb[j]]);
    if (s >= MIN && score[i * w + j] === score[(i + 1) * w + j + 1] + s) {
      out.push({ a: ga[i++], b: gb[j++] });
    } else if (score[(i + 1) * w + j] >= score[i * w + j + 1]) {
      out.push({ a: ga[i++], b: null });
    } else {
      out.push({ a: null, b: gb[j++] });
    }
  }
  while (i < n) out.push({ a: ga[i++], b: null });
  while (j < m) out.push({ a: null, b: gb[j++] });
}

export function alignRows(cellsA: string[][], cellsB: string[][]): AlignedRow[] {
  // Строка → номер её содержимого (одинаковые строки — один номер)
  const ids = new Map<string, number>();
  const key = (cells: string[]) => {
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    const k = cells.slice(0, end).join("\u0001");
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    return id;
  };
  const a = cellsA.map(key);
  const b = cellsB.map(key);
  const matches = matchRows(a, b);
  const out: AlignedRow[] = [];
  let pa = 0;
  let pb = 0;
  const flush = (ea: number, eb: number) => {
    const ga: number[] = [];
    const gb: number[] = [];
    for (let i = pa; i < ea; i++) ga.push(i);
    for (let j = pb; j < eb; j++) gb.push(j);
    pairGap(ga, gb, cellsA, cellsB, out);
  };
  for (const [ia, ib] of matches) {
    flush(ia, ib);
    out.push({ a: ia, b: ib });
    pa = ia + 1;
    pb = ib + 1;
  }
  flush(a.length, b.length);
  return out;
}

// ─────────────────────────── Сравнение листов ───────────────────────────

/**
 * Сравнение двух листов. Различия упорядочены по строкам сравнения,
 * затем по колонкам — на этом держится построение списка строк в UI.
 */
export const compareSheets = (a: ExcelSheet, b: ExcelSheet, opts: CompareOptions): DiffResult => {
  const colCount = Math.max(a.colCount, b.colCount);
  const cellsOf = (s: ExcelSheet) => {
    const out: string[][] = [];
    for (let r = 0; r < s.rowCount; r++) {
      const row = s.rows[r];
      const cells: string[] = [];
      if (row) for (let c = 0; c < row.length; c++) cells.push(comparable(row[c], opts));
      out.push(cells);
    }
    return out;
  };
  const cellsA = cellsOf(a);
  const cellsB = cellsOf(b);

  const rows: AlignedRow[] = opts.alignRows
    ? alignRows(cellsA, cellsB)
    : Array.from({ length: Math.max(a.rowCount, b.rowCount) }, (_, r) => ({
        a: r < a.rowCount ? r : null,
        b: r < b.rowCount ? r : null,
      }));

  const diffs: CellDiff[] = [];
  const counts: Record<DiffKind, number> = { modified: 0, added: 0, removed: 0 };
  let rowsRemoved = 0;
  let rowsAdded = 0;
  let shifted = 0;
  const empty: string[] = [];
  rows.forEach((row, r) => {
    if (opts.alignRows) {
      if (row.b === null) rowsRemoved++;
      else if (row.a === null) rowsAdded++;
      else if (row.a !== row.b) shifted++;
    }
    const ra = row.a === null ? empty : cellsA[row.a];
    const rb = row.b === null ? empty : cellsB[row.b];
    const cols = Math.max(ra.length, rb.length);
    for (let c = 0; c < cols; c++) {
      const va = ra[c] ?? "";
      const vb = rb[c] ?? "";
      if (va === vb) continue;
      const kind: DiffKind = va === "" ? "added" : vb === "" ? "removed" : "modified";
      diffs.push({ r, c, kind });
      counts[kind]++;
    }
  });

  return { diffs, rows, rowCount: rows.length, colCount, counts, rowsRemoved, rowsAdded, shifted };
};
