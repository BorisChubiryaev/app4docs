// Предпросмотр «мест правок»: для каждой операции — фрагмент реального текста
// Оферты с окружающим контекстом и подсвеченной вставкой/новой редакцией.
// Работает на извлечённых строках (без мутации документа).
import { paragraphs, xmlText } from "./text";
import { indexFootnotes, findFootnoteById, allFootnotes } from "./offer-index";
import { locateReplaceParagraph, locatePointInsertion } from "./locate";
import { findAppendixTable } from "./tables";
import { sortTableAlphabetically, alphabeticalPosition, findExistingRow } from "./alpha-sort";
import type { Operation } from "./types";

export interface PreviewSnippet {
  ok: boolean;
  kind: "insert" | "replace" | "table" | "manual" | "none";
  before?: string;
  removed?: string; // старая редакция (для замены)
  hit?: string; // подсвеченный вставленный/новый текст
  after?: string;
  note?: string;
  /** false — правка НЕ будет применена (напр. запись уже есть). */
  willApply?: boolean;
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

/** Построить предпросмотр одной операции по извлечённым строкам Оферты. */
export function previewOperation(
  documentXml: string,
  footnotesXml: string | null,
  op: Operation,
  numberingXml: string | null = null,
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
    const span = locateReplaceParagraph(documentXml, numberingXml, op);
    const old = span ? xmlText(span.inner) : null;
    return {
      ok: !!old,
      kind: "replace",
      removed: old ? head(old, CTX * 2) : undefined,
      hit: body,
      note: old ? undefined : "исходный пункт не найден (проверьте номер/раздел)",
    };
  }

  // ── Добавление нового пункта ──
  if (op.type === "insert_point" && op.payload !== undefined) {
    const point = op.target.kind === "point" || op.target.kind === "appendix_point" ? op.target.point : "";
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    const loc = locatePointInsertion(documentXml, numberingXml, point);
    const near = loc ? xmlText(loc.span.inner) : null;
    return {
      ok: !!loc,
      kind: "insert",
      hit: body,
      after: near ? ` ${loc!.mode === "before" ? "перед" : "после"}: ${head(near, CTX)}` : undefined,
      note: loc ? `новый пункт ${point} — последующие перенумеруются` : "место вставки не найдено",
    };
  }

  // ── Добавление новой сноски ──
  if (op.type === "add_footnote" && op.payload !== undefined) {
    const point = op.target.kind === "point" || op.target.kind === "appendix_point" ? op.target.point : "";
    return {
      ok: !!op.anchor,
      kind: "insert",
      before: op.anchor ? `после слов «${op.anchor.replace(/[«»]/g, "")}» ` : "",
      hit: `[новая сноска] ${op.payload}`,
      note: op.anchor
        ? `новая сноска${point && point !== "?" ? ` к п. ${point}` : ""} — нумерация сносок сдвигается`
        : "не найдены слова-якорь",
    };
  }

  // ── Замена сноски целиком ──
  if (op.type === "replace_footnote" && op.payload !== undefined) {
    let old: string | null = null;
    if (op.target.kind === "footnote" && footnotesXml) {
      const idx = indexFootnotes(documentXml);
      const id = idx.displayToId.get(op.target.number);
      const fn = id !== undefined ? findFootnoteById(footnotesXml, id) : null;
      if (fn) old = xmlText(fn.inner);
    }
    return {
      ok: !!old,
      kind: "replace",
      removed: old ? head(old, CTX * 2) : undefined,
      hit: op.payload,
      note: old ? "сноска" : "сноска не найдена",
    };
  }

  // ── Замена существующих строк таблицы ──
  if (op.type === "replace_table_rows") {
    const nums = op.rowNumbers?.join(", ") ?? "";
    const app = op.target.kind === "appendix_table" ? op.target.appendix : "?";
    return {
      ok: !!op.rows && op.rows.length > 0,
      kind: "table",
      hit: `изменяет строки ${nums} в таблице Приложения №${app}`,
      after: op.rows && op.rows[0] ? `напр.: ${head(op.rows[0].filter(Boolean).slice(0, 3).join(" · "), CTX)}` : undefined,
      note: op.rows && op.rows.length ? `строк с данными: ${op.rows.length}` : "новые данные строк не найдены",
    };
  }

  // ── Алфавитная пересортировка ──
  if (op.type === "sort_table_alpha") {
    const app = op.target.kind === "appendix_table" ? op.target.appendix : "1";
    const table = findAppendixTable(documentXml, app);
    if (!table) return { ok: false, kind: "none", note: `таблица Приложения №${app} не найдена` };
    const res = sortTableAlphabetically(table.inner, op.nameColumn ?? 1);
    if ("error" in res) return { ok: false, kind: "none", note: res.error };
    const sample = res.moves
      .slice(0, 4)
      .map((mv) => `${mv.name.slice(0, 26)}: ${mv.from}→${mv.to}`)
      .join("; ");
    return {
      ok: true,
      kind: "table",
      hit:
        res.moves.length === 0
          ? `Приложение №${app} уже в алфавитном порядке`
          : `сортировка Приложения №${app}: переместится строк ${res.moves.length} из ${res.order.length}`,
      after: sample ? `напр.: ${sample}` : undefined,
      note: res.warnings.join("; ") || undefined,
    };
  }

  // ── Вставка строки по алфавиту ──
  if (op.type === "insert_table_row_alpha") {
    const app = op.target.kind === "appendix_table" ? op.target.appendix : "1";
    const table = findAppendixTable(documentXml, app);
    const nameCol = op.nameColumn ?? 1;
    if (!table || !op.rows || op.rows.length === 0)
      return { ok: false, kind: "none", note: "не найдены таблица или данные новой строки" };
    const names = op.rows.map((r) => r[nameCol] ?? "").filter(Boolean);
    const dups = names
      .map((n) => ({ n, dup: findExistingRow(table.inner, n, nameCol) }))
      .filter((x) => x.dup);
    const parts = names
      .filter((n) => !dups.some((d) => d.n === n))
      .map((n) => `${n} → позиция ${alphabeticalPosition(table.inner, n, nameCol)}`);
    if (parts.length === 0 && dups.length > 0) {
      return {
        ok: false,
        kind: "none",
        note: `уже есть в Приложении №${app}: ${dups
          .map((d) => `${d.n} (строка ${d.dup!.number})`)
          .join("; ")} — добавление не требуется`,
        willApply: false,
      };
    }
    return {
      ok: parts.length > 0,
      kind: "table",
      hit: `добавление в Приложение №${app} по алфавиту`,
      after:
        parts.join("; ") +
        (dups.length ? ` · пропустим (уже есть): ${dups.map((d) => d.n).join("; ")}` : ""),
      note: "нумерация последующих строк обновится",
    };
  }

  // ── Требует ручной обработки ──
  if (op.type === "manual") {
    return { ok: false, kind: "manual", hit: op.note ?? "требует ручной обработки" };
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
