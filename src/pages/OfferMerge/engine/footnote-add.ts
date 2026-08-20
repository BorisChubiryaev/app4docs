// Добавление НОВОЙ сноски. Сноски Word нумеруются по порядку ссылок
// <w:footnoteReference> в теле, поэтому достаточно вставить новую ссылку в
// нужном месте и добавить элемент <w:footnote> — последующие сноски
// перенумеровываются автоматически.
import { renderInsertRuns } from "./render";
import type { BuildOptions } from "./types";

/** Максимальный внутренний id сноски (для генерации нового уникального id). */
export function maxFootnoteId(footnotesXml: string): number {
  const ids = [...footnotesXml.matchAll(/<w:footnote\b[^>]*\bw:id="(-?\d+)"/g)].map((m) =>
    parseInt(m[1], 10),
  );
  return ids.length ? Math.max(...ids) : 1;
}

/** rPr рана-ссылки на сноску (берём из первой такой ссылки в теле). */
export function footnoteRefRunRpr(documentXml: string): string {
  const m = documentXml.match(
    /<w:r\b[^>]*>((?:<w:rPr>[\s\S]*?<\/w:rPr>)?)(?:(?!<\/w:r>)[\s\S])*?<w:footnoteReference/,
  );
  return m && m[1] ? m[1] : '<w:rPr><w:rStyle w:val="af4"/><w:vertAlign w:val="superscript"/></w:rPr>';
}

/** Ран-ссылка на новую сноску для вставки в тело. */
export function buildFootnoteReferenceRun(id: number, rPr: string): string {
  return `<w:r>${rPr}<w:footnoteReference w:id="${id}"/></w:r>`;
}

/** Элемент <w:footnote> с выделенным текстом. */
export function buildFootnoteElement(id: number, text: string, opts: BuildOptions): string {
  const body = renderInsertRuns(" " + text.trim(), opts);
  return (
    `<w:footnote w:id="${id}">` +
    `<w:p><w:pPr><w:pStyle w:val="af2"/><w:jc w:val="both"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="af4"/></w:rPr><w:footnoteRef/></w:r>` +
    `${body}</w:p></w:footnote>`
  );
}

/** Добавить элемент сноски перед закрывающим тегом. */
export function appendFootnoteElement(footnotesXml: string, element: string): string {
  return footnotesXml.replace(/<\/w:footnotes>\s*$/, element + "</w:footnotes>");
}
