// Обнаружение таблиц в PDF по геометрии линий сетки — без OCR и без ИИ.
//
// Word/LibreOffice при печати в PDF рисуют границы таблицы не векторными
// линиями, а тонкими закрашенными прямоугольниками (одна ячейка границы —
// один такой прямоугольник в операторе constructPath). Это даёт координаты
// сетки таблицы напрямую из потока операторов страницы: горизонтальные
// «линии» — широкие и тонкие по высоте прямоугольники, вертикальные —
// узкие и высокие. Сгруппировав их по позиции, получаем реальные границы
// строк/столбцов и можем достоверно восстановить таблицу — вместо того,
// чтобы (как раньше) резать текст по Y-координате построчно и превращать
// содержимое ячеек нескольких столбцов в один нечитаемый абзац.
//
// Ограничения (честно, не пытаемся угадать сверх этого):
//   • работает для таблиц, у которых границы ДЕЙСТВИТЕЛЬНО нарисованы
//     (подавляющее большинство таблиц из Word/LibreOffice/1С — да);
//   • таблицы без единой видимой линии (только пробелами/табуляцией)
//     этим способом не ловятся — для них по-прежнему работает обычный
//     построчный разбор;
//   • объединение ячеек внутри строки распознаётся (её просто ограничивают
//     не все столбцы), а если разметка сетки отличается от строки к
//     строке — берётся общая сетка по всей таблице (в подавляющем
//     большинстве документов сетка равномерна);
//   • таблица, разбитая PDF на две страницы, восстанавливается как две
//     отдельные таблицы (как и весь остальной постраничный разбор здесь).
import * as pdfjs from "pdfjs-dist";

export interface TableTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface DetectedTable {
  x0: number;
  x1: number;
  /** Верх таблицы (PDF Y растёт вверх, поэтому y1 — большее значение). */
  y1: number;
  y0: number;
  /** Границы столбцов по X, по возрастанию; длина = число столбцов + 1. */
  colXs: number[];
  /** Границы строк по Y, по убыванию (сверху вниз); длина = число строк + 1. */
  rowYs: number[];
  /** Текст ячеек [строка][столбец], возможно многострочный (через \n). */
  cells: string[][];
}

interface Seg {
  /** Для горизонтального сегмента — x0/x1, для вертикального — y0/y1. */
  a: number;
  b: number;
  /** Для горизонтального — y сегмента, для вертикального — x. */
  pos: number;
}

const LINE_MAX_THICKNESS = 2.5; // pt — толще уже похоже на закраску ячейки
const MIN_LINE_LENGTH = 5; // pt — короче похоже на точку в углу пересечения
const CLUSTER_TOL = 1.6; // pt — линии ближе этого считаем одной и той же

/** m2 применяется первым, затем m1 (как в PDF: конкатенация CTM). */
export function mulMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Извлечь тонкие прямоугольники-«линии» сетки из списка операторов страницы.
 * Учитывает текущую CTM (save/restore/transform) — таблица может лежать
 * внутри вложенного графического состояния.
 */
function extractGridSegments(ol: {
  fnArray: number[];
  argsArray: unknown[];
}): { hSegs: Seg[]; vSegs: Seg[] } {
  const hSegs: Seg[] = [];
  const vSegs: Seg[] = [];
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === pdfjs.OPS.transform) {
      ctm = mulMatrix(ctm, ol.argsArray[i] as number[]);
    } else if (fn === pdfjs.OPS.constructPath) {
      // args = [minorOpsArray, coordsArray, bbox]; bbox — [x0,y0,x1,y1] в
      // пространстве, действовавшем на момент вызова (до текущей CTM).
      const args = ol.argsArray[i] as unknown[];
      const bbox = args[2] as ArrayLike<number> | undefined;
      if (!bbox || bbox.length < 4) continue;
      const corners: [number, number][] = [
        applyMatrix(ctm, bbox[0], bbox[1]),
        applyMatrix(ctm, bbox[2], bbox[1]),
        applyMatrix(ctm, bbox[2], bbox[3]),
        applyMatrix(ctm, bbox[0], bbox[3]),
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 0.01 || h < 0.01) continue;
      if (h <= LINE_MAX_THICKNESS && w >= MIN_LINE_LENGTH && w > h * 3) {
        hSegs.push({ a: x0, b: x1, pos: (y0 + y1) / 2 });
      } else if (w <= LINE_MAX_THICKNESS && h >= MIN_LINE_LENGTH && h > w * 3) {
        vSegs.push({ a: y0, b: y1, pos: (x0 + x1) / 2 });
      }
    }
  }
  return { hSegs, vSegs };
}

interface LineCluster {
  pos: number;
  /** Объединённый охват вдоль линии (x-диапазон для hLine, y — для vLine). */
  spanFrom: number;
  spanTo: number;
}

/** Сгруппировать сегменты по позиции (с допуском) и объединить их охват. */
function clusterSegments(segs: Seg[]): LineCluster[] {
  const sorted = [...segs].sort((a, b) => a.pos - b.pos);
  const clusters: LineCluster[] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && s.pos - last.pos <= CLUSTER_TOL) {
      // Взвешенное смещение позиции почти не влияет на итог — оставляем
      // позицию первой линии кластера, чтобы не «плыть» на длинной сетке.
      last.spanFrom = Math.min(last.spanFrom, s.a);
      last.spanTo = Math.max(last.spanTo, s.b);
    } else {
      clusters.push({ pos: s.pos, spanFrom: s.a, spanTo: s.b });
    }
  }
  return clusters;
}

/** Пересекаются ли (с небольшим допуском) два числовых отрезка. */
function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  const pad = 1.5;
  return aFrom - pad <= bTo && bFrom - pad <= aTo;
}

/** Компонента связности: горизонтальные и вертикальные линии, образующие сетку. */
interface GridComponent {
  hs: LineCluster[];
  vs: LineCluster[];
}

/**
 * Сгруппировать h/v-кластеры в отдельные таблицы через связность:
 * горизонтальная и вертикальная линия «связаны», если вертикальная
 * пересекает Y горизонтальной, а горизонтальная накрывает X вертикальной —
 * т.е. они реально образуют угол сетки, а не просто случайно лежат рядом.
 */
function groupIntoTables(hs: LineCluster[], vs: LineCluster[]): GridComponent[] {
  const hUsed = new Array(hs.length).fill(-1);
  const vUsed = new Array(vs.length).fill(-1);
  const components: GridComponent[] = [];

  const connects = (h: LineCluster, v: LineCluster) =>
    overlaps(h.spanFrom, h.spanTo, v.pos, v.pos) &&
    overlaps(v.spanFrom, v.spanTo, h.pos, h.pos);

  for (let hi = 0; hi < hs.length; hi++) {
    if (hUsed[hi] !== -1) continue;
    const compIdx = components.length;
    const comp: GridComponent = { hs: [], vs: [] };
    const hQueue = [hi];
    hUsed[hi] = compIdx;
    while (hQueue.length) {
      const h = hs[hQueue.pop()!];
      comp.hs.push(h);
      for (let vi = 0; vi < vs.length; vi++) {
        if (vUsed[vi] !== -1 || !connects(h, vs[vi])) continue;
        vUsed[vi] = compIdx;
        comp.vs.push(vs[vi]);
        for (let hj = 0; hj < hs.length; hj++) {
          if (hUsed[hj] !== -1 || !connects(hs[hj], vs[vi])) continue;
          hUsed[hj] = compIdx;
          hQueue.push(hj);
        }
      }
    }
    components.push(comp);
  }
  return components.filter((c) => c.hs.length >= 2 && c.vs.length >= 2);
}

/** Сгруппировать текстовые фрагменты ячейки в строки и склеить их. */
function cellText(items: TableTextItem[]): string {
  if (!items.length) return "";
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: TableTextItem[] }[] = [];
  for (const item of sorted) {
    const tol = Math.max(item.fontSize * 0.5, 2);
    const line = lines.find((l) => Math.abs(l.y - item.y) < tol);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .map((l) => {
      const its = [...l.items].sort((a, b) => a.x - b.x);
      let out = "";
      for (let i = 0; i < its.length; i++) {
        if (i > 0) {
          const prev = its[i - 1];
          const gap = its[i].x - (prev.x + prev.width);
          if (gap > its[i].fontSize * 0.2) out += " ";
        }
        out += its[i].str;
      }
      return out.trim();
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Найти таблицы на странице по геометрии сетки и распределить по их
 * ячейкам текстовые фрагменты, чьи центры попадают в границы ячейки.
 * Отдельно возвращает набор индексов items, которые вошли хотя бы в одну
 * таблицу — их нужно исключить из обычного построчного разбора страницы.
 */
export function detectTables(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  items: TableTextItem[],
): { tables: DetectedTable[]; usedItemIndexes: Set<number> } {
  const { hSegs, vSegs } = extractGridSegments(operatorList);
  const hClusters = clusterSegments(hSegs);
  const vClusters = clusterSegments(vSegs);
  const components = groupIntoTables(hClusters, vClusters);

  const tables: DetectedTable[] = [];
  const usedItemIndexes = new Set<number>();

  for (const comp of components) {
    const rowYs = [...new Set(comp.hs.map((h) => h.pos))].sort((a, b) => b - a);
    const colXs = [...new Set(comp.vs.map((v) => v.pos))].sort((a, b) => a - b);
    if (rowYs.length < 2 || colXs.length < 2) continue;

    const x0 = colXs[0];
    const x1 = colXs[colXs.length - 1];
    const y1 = rowYs[0];
    const y0 = rowYs[rowYs.length - 1];

    const rows = rowYs.length - 1;
    const cols = colXs.length - 1;
    const bucket: TableTextItem[][][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [] as TableTextItem[]),
    );

    items.forEach((item, idx) => {
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height * 0.35;
      const pad = 0.75;
      if (cx < x0 - pad || cx > x1 + pad || cy < y0 - pad || cy > y1 + pad) return;
      let col = -1;
      for (let c = 0; c < cols; c++) {
        if (cx >= colXs[c] - pad && cx < colXs[c + 1] + pad) {
          col = c;
          break;
        }
      }
      let row = -1;
      for (let r = 0; r < rows; r++) {
        if (cy <= rowYs[r] + pad && cy > rowYs[r + 1] - pad) {
          row = r;
          break;
        }
      }
      if (row < 0 || col < 0) return;
      bucket[row][col].push(item);
      usedItemIndexes.add(idx);
    });

    const cells = bucket.map((row) => row.map((cellItems) => cellText(cellItems)));
    tables.push({ x0, x1, y0, y1, colXs, rowYs, cells });
  }

  return { tables, usedItemIndexes };
}
