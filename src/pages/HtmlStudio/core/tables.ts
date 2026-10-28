// Таблица HTML ↔ сетка для редактирования: текст ячеек, добавление и
// удаление строк и столбцов. Оформление сохраняется: новые строки и
// столбцы — копии соседних.
import type { Cell } from "./data";

export interface TableGrid {
  header: string[];
  rows: Cell[][];
  /** Первая строка таблицы — заголовки */
  hasHeader: boolean;
  /** Есть объединённые ячейки — структуру (строки/столбцы) меняем осторожно */
  merged: boolean;
}

const rowsOf = (t: HTMLTableElement) => Array.from(t.rows);
const cellText = (c: HTMLTableCellElement) => (c.innerText ?? c.textContent ?? "").replace(/\s+\n/g, "\n").trim();

export function readTable(t: HTMLTableElement): TableGrid {
  const rows = rowsOf(t);
  const merged = rows.some((r) => Array.from(r.cells).some((c) => c.colSpan > 1 || c.rowSpan > 1));
  const first = rows[0];
  const hasHeader = !!first && (first.parentElement?.tagName === "THEAD" || Array.from(first.cells).every((c) => c.tagName === "TH"));
  const w = Math.max(0, ...rows.map((r) => r.cells.length));
  const grid = rows.map((r) => Array.from({ length: w }, (_, i) => (r.cells[i] ? cellText(r.cells[i]) : "")));
  return {
    header: hasHeader ? grid[0] : Array.from({ length: w }, (_, i) => `Столбец ${i + 1}`),
    rows: hasHeader ? grid.slice(1) : grid,
    hasHeader,
    merged,
  };
}

const setText = (c: HTMLTableCellElement, v: string) => {
  if (cellText(c) === v) return; // не трогаем — сохраняем вложенное оформление
  // Простая ячейка — меняем текст в самом глубоком текстовом элементе
  const only = c.children.length === 1 && c.children[0].children.length === 0 ? c.children[0] : null;
  (only ?? c).textContent = v;
};

/** Записать сетку в таблицу. */
export function writeTable(t: HTMLTableElement, header: string[], rows: Cell[][], hasHeader: boolean) {
  const doc = t.ownerDocument;
  const all = [...(hasHeader ? [header] : []), ...rows].map((r) => r.map((v) => (v === null ? "" : String(v))));
  const w = Math.max(1, ...all.map((r) => r.length));
  let trs = rowsOf(t);
  // Столбцы
  for (const tr of trs) {
    while (tr.cells.length > w) tr.deleteCell(tr.cells.length - 1);
    while (tr.cells.length < w) {
      const last = tr.cells[tr.cells.length - 1];
      tr.appendChild(last ? (last.cloneNode(false) as HTMLElement) : doc.createElement("td"));
    }
  }
  // Строки: лишние удаляем, недостающие — копии последней строки тела
  while (trs.length > all.length) {
    trs[trs.length - 1].remove();
    trs = rowsOf(t);
  }
  while (trs.length < all.length) {
    const model = trs[trs.length - 1];
    let row: HTMLTableRowElement;
    if (model && !(hasHeader && trs.length === 1)) {
      row = model.cloneNode(true) as HTMLTableRowElement;
      model.parentElement!.appendChild(row);
    } else {
      const body = t.tBodies[0] ?? t.appendChild(doc.createElement("tbody"));
      row = body.insertRow();
      for (let i = 0; i < w; i++) row.insertCell();
    }
    trs = rowsOf(t);
  }
  trs.forEach((tr, ri) => Array.from(tr.cells).forEach((c, ci) => setText(c, all[ri][ci] ?? "")));
}

/** Таблица в TSV (для копирования в Excel). */
export const toTsv = (header: string[], rows: Cell[][]) =>
  [header, ...rows].map((r) => r.map((v) => (v === null ? "" : String(v).replace(/[\t\n]/g, " "))).join("\t")).join("\n");

/** Разбор вставки из Excel / CSV. */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const sep = t.includes("\t") ? "\t" : (t.split("\n")[0].match(/;/g)?.length ?? 0) > (t.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}
