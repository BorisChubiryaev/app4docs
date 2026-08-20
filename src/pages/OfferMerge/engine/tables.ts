// Операции над таблицами Приложений Оферты: поиск нужной таблицы, добавление
// строк и ЗАМЕНА существующих строк по их номеру (первая ячейка).
import { escapeXml, decodeXml } from "./ooxml";
import { renderInsertRuns } from "./render";
import type { BuildOptions } from "./types";

const WT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

export interface TableSpan {
  start: number;
  end: number;
  inner: string; // весь <w:tbl>…</w:tbl>
}

/** Смещение заголовка приложения в документе. */
function appendixHeadingOffset(documentXml: string, appendix: string): number {
  const anchors =
    appendix === "2"
      ? ["Способы и особенности реализации Бесшовного", "Приложение № 2", "Приложение №2"]
      : [`Приложение № ${appendix}`, `Приложение №${appendix}`, "Компании информационного партнерства"];
  for (const a of anchors) {
    const p = documentXml.indexOf(a);
    if (p >= 0) return p;
  }
  return 0;
}

/** Найти таблицу приложения (первая <w:tbl> после его заголовка). */
export function findAppendixTable(documentXml: string, appendix: string): TableSpan | null {
  const from = appendixHeadingOffset(documentXml, appendix);
  const start = documentXml.indexOf("<w:tbl>", from);
  if (start < 0) return null;
  const endTag = documentXml.indexOf("</w:tbl>", start);
  if (endTag < 0) return null;
  const end = endTag + "</w:tbl>".length;
  return { start, end, inner: documentXml.slice(start, end) };
}

function cellText(tcXml: string): string {
  // Раны <w:t> внутри ячейки — непрерывный текст, склеиваем без пробелов
  // (иначе число «28», разбитое на раны «2» и «8», превратится в «2 8»).
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((m = WT_RE.exec(tcXml)) !== null) parts.push(decodeXml(m[1]));
  return parts.join("").replace(/\s+/g, " ").trim();
}

function tcPr(tcXml: string): string {
  const m = tcXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  return m ? m[0] : "";
}

/** Пересобрать <w:tc> с новым текстом (выделенным). */
function setCell(tcXml: string, text: string, opts: BuildOptions): string {
  return `<w:tc>${tcPr(tcXml)}<w:p>${renderInsertRuns(text, opts)}</w:p></w:tc>`;
}

function rowCells(trXml: string): string[] {
  return trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
}
function rowPr(trXml: string): string {
  const m = trXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);
  return m ? m[0] : "";
}

/**
 * Заменить строки таблицы по номеру в первой ячейке. Возвращает новый XML
 * таблицы, список заменённых и не найденных номеров, и предупреждения.
 */
export function replaceRowsByNumber(
  tableInner: string,
  rowsByNumber: Map<number, string[]>,
  opts: BuildOptions,
): { xml: string; replaced: number[]; missing: number[]; warnings: string[] } {
  const replaced: number[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();

  const xml = tableInner.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => {
    const cells = rowCells(tr);
    if (cells.length === 0) return tr;
    // Строгое совпадение: первая ячейка — ровно номер строки (без «хвостов»),
    // и каждая строка заменяется только один раз (без «съезжания» на соседние).
    const first = cellText(cells[0]).trim();
    if (!/^\d+$/.test(first)) return tr;
    const num = parseInt(first, 10);
    if (!rowsByNumber.has(num) || seen.has(num)) return tr;
    const newCells = rowsByNumber.get(num)!;
    seen.add(num);
    replaced.push(num);
    if (newCells.length !== cells.length) {
      warnings.push(`строка ${num}: столбцов в правке ${newCells.length}, в таблице ${cells.length} — проверьте разметку`);
    }
    // Первую ячейку (номер) оставляем, остальные заменяем позиционно.
    const rebuilt = cells.map((tc, i) => {
      if (i === 0) return tc;
      if (i < newCells.length) return setCell(tc, newCells[i], opts);
      return tc;
    });
    return `<w:tr>${rowPr(tr)}${rebuilt.join("")}</w:tr>`;
  });

  const missing = [...rowsByNumber.keys()].filter((n) => !seen.has(n));
  return { xml, replaced, missing, warnings };
}

/** Построить <w:tr> для новой строки (используется при добавлении). */
export function buildRow(cells: string[], opts: BuildOptions): string {
  const tcs = cells
    .map((c) => `<w:tc><w:tcPr/><w:p>${renderInsertRuns(c, opts)}</w:p></w:tc>`)
    .join("");
  return `<w:tr>${tcs}</w:tr>`;
}

export { escapeXml };
