// Сборка выделенного контента для итоговой Оферты в трёх режимах:
//  - color   : красный шрифт (как в образце);
//  - tracked : рецензирование Word (<w:ins>);
//  - both    : красный шрифт внутри <w:ins>.
import { escapeXml } from "./ooxml";
import type { BuildOptions, HighlightMode } from "./types";

let insCounter = 90000;
export function resetInsCounter() {
  insCounter = 90000;
}
function nextInsId() {
  return insCounter++;
}

function runRPr(mode: HighlightMode, color: string): string {
  return mode === "tracked" ? "" : `<w:rPr><w:color w:val="${color}"/></w:rPr>`;
}

/** Один или несколько выделенных ранов для вставки текста. */
export function renderInsertRuns(text: string, opts: BuildOptions): string {
  const mode = opts.highlightMode ?? "color";
  const color = opts.highlightColor ?? "EE0000";
  const author = opts.author ?? "genOferta";
  const date = "2026-01-01T00:00:00Z";
  const run = `<w:r>${runRPr(mode, color)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  if (mode === "color") return run;
  // tracked | both — оборачиваем в <w:ins>
  return `<w:ins w:id="${nextInsId()}" w:author="${escapeXml(author)}" w:date="${date}">${run}</w:ins>`;
}

/** Свойства выделения для ячеек новых строк таблицы. */
export function cellRunProps(opts: BuildOptions): string {
  const mode = opts.highlightMode ?? "color";
  const color = opts.highlightColor ?? "EE0000";
  return mode === "tracked" ? "" : `<w:rPr><w:color w:val="${color}"/></w:rPr>`;
}

/** Построить <w:tr> для новой строки таблицы (по числу колонок образца). */
export function renderTableRow(cells: string[], opts: BuildOptions): string {
  const rPr = cellRunProps(opts);
  const tcs = cells
    .map(
      (c) =>
        `<w:tc><w:tcPr/><w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(c)}</w:t></w:r></w:p></w:tc>`,
    )
    .join("");
  return `<w:tr>${tcs}</w:tr>`;
}
