// Локация абзаца-цели для операции «изложить в новой редакции».
//
// ПРИНЦИП: находим цель ТОЛЬКО по надёжному признаку и НИКОГДА не «угадываем»
// нечётким совпадением — иначе можно молча испортить не тот пункт. Если
// уверенной цели нет, возвращаем null (движок честно сообщит «не найдено»,
// а оператор увидит это в предпросмотре).
//
// Признаки по приоритету:
//   • термин — абзац, ТЕКСТ которого начинается с имени термина;
//   • пункт/пункт приложения — номер (восстановленный из автонумерации или
//     литеральный) В ПРЕДЕЛАХ нужного раздела/приложения.
import { indexNumberedParagraphs, findByNumber, normNumber } from "./numbering";
import type { NumberedPara } from "./numbering";
import type { Operation } from "./types";

export interface ParaSpan {
  start: number;
  end: number;
  inner: string;
}

function normText(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}
function span(p: NumberedPara): ParaSpan {
  return { start: p.start, end: p.end, inner: p.inner };
}

/** Начало раздела/приложения (для сужения поиска по номеру). */
function regionStart(index: NumberedPara[], op: Operation): number {
  if (op.target.kind !== "appendix_point") return 0;
  const m = op.rawText.match(/Приложени[а-я]*\s*№?\s*\d+[^«]*«([^»]{6,}?)»/i);
  if (m) {
    const want = normText(m[1]).slice(0, 40);
    const hit = index.find((p) => normText(p.text).includes(want));
    if (hit) return hit.start;
  }
  return 0;
}

/** Литеральный номер в начале абзаца («2.2.», «1.4.») в пределах региона. */
function findByLiteralNumber(index: NumberedPara[], point: string, from: number): ParaSpan | null {
  const want = normNumber(point);
  const re = new RegExp("^\\s*" + want.replace(/\./g, "\\.") + "\\.?(?!\\d)");
  for (const p of index) {
    if (p.start < from) continue;
    if (re.test(p.text)) return span(p);
  }
  return null;
}

/** Найти абзац-цель для замены. Возвращает span либо null (без «угадывания»). */
export function locateReplaceParagraph(
  documentXml: string,
  numberingXml: string | null,
  op: Operation,
): ParaSpan | null {
  const index = indexNumberedParagraphs(documentXml, numberingXml);

  // Термин — строго по имени (номер термина по разным редакциям «плавает»,
  // а новая редакция может содержать другое имя, поэтому по номеру не ищем).
  if (op.target.kind === "term") {
    if (!op.target.term) return null;
    const want = normText(op.target.term);
    const hit = index.find((p) => normText(p.text).startsWith(want));
    return hit ? span(hit) : null;
  }

  // Пункт / пункт приложения — по номеру в пределах раздела.
  if (op.target.kind === "point" || op.target.kind === "appendix_point") {
    const point = op.target.point;
    const from = regionStart(index, op);
    const byNum = findByNumber(index, point, from);
    if (byNum) return span(byNum);
    const byLit = findByLiteralNumber(index, point, from);
    if (byLit) return byLit;
  }

  return null;
}
