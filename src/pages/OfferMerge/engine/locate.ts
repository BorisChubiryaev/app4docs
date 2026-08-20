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

/**
 * Найти место для ВСТАВКИ нового пункта X (напр. 2.9). Возвращает абзац-якорь
 * и режим: "before" — вставить перед ним (новый станет X), "after" — вставить
 * после предыдущего пункта (когда X ещё нет, добавляем в конец списка).
 * Поиск ведётся в пределах раздела (по номеру раздела перед первой точкой).
 */
export function locatePointInsertion(
  documentXml: string,
  numberingXml: string | null,
  point: string,
): { span: ParaSpan; mode: "before" | "after" } | null {
  const index = indexNumberedParagraphs(documentXml, numberingXml);
  const section = normNumber(point).split(".")[0];
  // Регион раздела: заголовок с номером == section (ilvl 0).
  const secHead = section ? findByNumber(index, section, 0) : null;
  const from = secHead ? secHead.start : 0;

  const exact = findByNumber(index, point, from);
  if (exact) return { span: span(exact), mode: "before" };

  // X ещё нет — ищем предыдущий номер того же уровня (X с уменьшённым хвостом).
  const parts = normNumber(point).split(".").map((n) => parseInt(n, 10));
  const last = parts[parts.length - 1];
  for (let p = last - 1; p >= 1; p--) {
    const prevNum = [...parts.slice(0, -1), p].join(".");
    const prev = findByNumber(index, prevNum, from);
    if (prev) return { span: span(prev), mode: "after" };
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
