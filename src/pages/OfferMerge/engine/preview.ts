// Предпросмотр «мест правок»: для каждой операции — фрагмент реального текста
// Оферты с окружающим контекстом и подсвеченной вставкой/новой редакцией.
// Работает на извлечённых строках (без мутации документа).
import { paragraphs, xmlText } from "./text";
import { indexFootnotes, findFootnoteById, allFootnotes } from "./offer-index";
import type { Operation } from "./types";

export interface PreviewSnippet {
  ok: boolean;
  kind: "insert" | "replace" | "table" | "none";
  before?: string;
  removed?: string; // старая редакция (для замены)
  hit?: string; // подсвеченный вставленный/новый текст
  after?: string;
  note?: string;
}

const CTX = 160; // сколько символов контекста показывать с каждой стороны

function ignorable(ch: string): boolean {
  return /\s/.test(ch) || ch === "«" || ch === "»";
}

function normalize(s: string): string {
  return Array.from(s)
    .filter((ch) => !ignorable(ch))
    .join("")
    .toLowerCase();
}

/** Индекс последнего символа якоря в исходной строке (игнорируя пробелы/«»). */
function anchorEndIndex(plain: string, anchor: string): number {
  const map: number[] = [];
  let flat = "";
  for (let i = 0; i < plain.length; i++) {
    if (ignorable(plain[i])) continue;
    map.push(i);
    flat += plain[i].toLowerCase();
  }
  const needle = normalize(anchor);
  if (!needle) return -1;
  const idx = flat.indexOf(needle);
  if (idx < 0) return -1;
  let end = map[idx + needle.length - 1];
  // Захватить закрывающую » сразу после якоря (пропуская пробелы).
  let j = end + 1;
  while (j < plain.length && (plain[j] === "»" || /\s/.test(plain[j]))) {
    if (plain[j] === "»") {
      end = j;
      break;
    }
    j++;
  }
  return end;
}

function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "");
}
function stripOuterQuotes(text: string): string {
  const t = text.trim();
  return t.startsWith("«") && t.endsWith("»") ? t.slice(1, -1) : t;
}
function tail(s: string, n: number): string {
  return s.length > n ? "…" + s.slice(s.length - n) : s;
}
function head(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

/** Построить предпросмотр одной операции по извлечённым строкам Оферты. */
export function previewOperation(
  documentXml: string,
  footnotesXml: string | null,
  op: Operation,
): PreviewSnippet {
  // ── Вставка после якоря ──
  if (op.type === "insert_after" && op.anchor && op.payload !== undefined) {
    if (op.target.kind === "footnote" && footnotesXml) {
      const idx = indexFootnotes(documentXml);
      const id = idx.displayToId.get(op.target.number);
      const candidates =
        id !== undefined
          ? [findFootnoteById(footnotesXml, id), ...allFootnotes(footnotesXml)]
          : allFootnotes(footnotesXml);
      for (const b of candidates) {
        if (!b) continue;
        const plain = xmlText(b.inner);
        const end = anchorEndIndex(plain, op.anchor);
        if (end >= 0) {
          return {
            ok: true,
            kind: "insert",
            before: tail(plain.slice(0, end + 1), CTX),
            hit: op.payload,
            after: head(plain.slice(end + 1), CTX),
            note: `сноска № ${op.target.number}`,
          };
        }
      }
      return { ok: false, kind: "none", note: `сноска № ${op.target.number}: место не найдено` };
    }
    // Вставка в тело
    const paras = paragraphs(documentXml);
    const na = normalize(op.anchor);
    const p = paras.find((x) => normalize(x).includes(na));
    if (p) {
      const end = anchorEndIndex(p, op.anchor);
      if (end >= 0) {
        return {
          ok: true,
          kind: "insert",
          before: tail(p.slice(0, end + 1), CTX),
          hit: op.payload,
          after: head(p.slice(end + 1), CTX),
        };
      }
    }
    return { ok: false, kind: "none", note: "место вставки не найдено" };
  }

  // ── Замена (термин / пункт / пункт приложения) ──
  if (op.type === "replace" && op.payload !== undefined) {
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    let locator = "";
    if (op.target.kind === "term") locator = op.target.term || firstWords(body, 2);
    else locator = firstWords(body, 5);
    const nl = normalize(locator);
    const paras = paragraphs(documentXml);
    const old =
      paras.find((x) => normalize(x).startsWith(nl)) ??
      paras.find((x) => normalize(x).includes(nl));
    return {
      ok: !!old,
      kind: "replace",
      removed: old ? head(old, CTX * 2) : undefined,
      hit: body,
      note: old ? undefined : "исходный пункт не найден (проверьте ориентир)",
    };
  }

  // ── Строки таблицы ──
  if (op.type === "append_table_rows" && op.rows) {
    const first = op.rows[0]?.filter(Boolean).slice(0, 3).join(" · ");
    return {
      ok: op.rows.length > 0,
      kind: "table",
      hit: `+${op.rows.length} строк(и) в таблицу`,
      after: first ? `например: ${head(first, CTX)}` : undefined,
      note: op.rowRange ? `строки ${op.rowRange.from}–${op.rowRange.to}` : undefined,
    };
  }

  return { ok: false, kind: "none", note: "нет данных для предпросмотра" };
}
