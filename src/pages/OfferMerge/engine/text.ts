// Текстовые утилиты для разбора инструкций.
import { decodeXml } from "./ooxml";

const WT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const P_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const TBL_RE = /<w:tbl>[\s\S]*?<\/w:tbl>/g;

/** Видимый текст одного абзаца/фрагмента XML. */
export function xmlText(fragment: string): string {
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((m = WT_RE.exec(fragment)) !== null) parts.push(decodeXml(m[1]));
  return parts.join("").replace(/\u00A0/g, " ").trim();
}

/** Все абзацы документа как массив строк (пустые отфильтрованы). */
export function paragraphs(documentXml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  P_RE.lastIndex = 0;
  while ((m = P_RE.exec(documentXml)) !== null) {
    const t = xmlText(m[0]);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Абзацы ВНЕ таблиц. Ячейка таблицы состоит из тех же <w:p>, поэтому обычный
 * разбор смешивает инструкции с содержимым таблиц: строка «ООО «СберЛогистика»»
 * попадает в поток инструкций и мешает склейке многоабзацных редакций.
 */
export function paragraphsOutsideTables(documentXml: string): string[] {
  const gaps: { from: number; to: number }[] = [];
  let t: RegExpExecArray | null;
  TBL_RE.lastIndex = 0;
  while ((t = TBL_RE.exec(documentXml)) !== null) {
    gaps.push({ from: t.index, to: t.index + t[0].length });
  }
  const inTable = (pos: number) => gaps.some((g) => pos >= g.from && pos < g.to);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  P_RE.lastIndex = 0;
  while ((m = P_RE.exec(documentXml)) !== null) {
    if (inTable(m.index)) continue;
    const txt = xmlText(m[0]);
    if (txt) out.push(txt);
  }
  return out;
}

/**
 * Извлечь содержимое сбалансированных кавычек-«ёлочек», начиная с позиции
 * первого «. Учитывает вложенность («ООО СК «Сбербанк Страхование»»).
 */
export function extractGuillemet(
  s: string,
  fromIndex: number,
): { content: string; endIndex: number } | null {
  const open = s.indexOf("«", fromIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "«") depth++;
    else if (s[i] === "»") {
      depth--;
      if (depth === 0) {
        return { content: s.slice(open + 1, i), endIndex: i };
      }
    }
  }
  // не закрыто — берём до конца
  return { content: s.slice(open + 1), endIndex: s.length - 1 };
}

/** Все таблицы документа как массив строк-ячеек. */
export function tables(documentXml: string): string[][][] {
  const result: string[][][] = [];
  let t: RegExpExecArray | null;
  TBL_RE.lastIndex = 0;
  while ((t = TBL_RE.exec(documentXml)) !== null) {
    const rows: string[][] = [];
    const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(t[0])) !== null) {
      const cells: string[] = [];
      const tcRe = /<w:tc>[\s\S]*?<\/w:tc>/g;
      let tc: RegExpExecArray | null;
      while ((tc = tcRe.exec(tr[0])) !== null) {
        // Ячейка нередко состоит из нескольких абзацев — наименование компании
        // и её сайт. Склеив их подряд, получаем «ООО «Ромашка»https://…»,
        // поэтому границы абзацев сохраняем переводом строки.
        const parts = (tc[0].match(P_RE) ?? []).map((x) => xmlText(x)).filter(Boolean);
        cells.push(parts.length ? parts.join("\n") : xmlText(tc[0]));
      }
      rows.push(cells);
    }
    result.push(rows);
  }
  return result;
}
