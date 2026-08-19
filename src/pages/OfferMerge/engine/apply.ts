// Детерминированное применение структурных операций к Оферте.
// Текст берётся ТОЛЬКО из операций (payload/rows) — движок не «сочиняет».
import type { DocxParts } from "./docx";
import { saveDocx } from "./docx";
import { indexFootnotes, findFootnoteById, allFootnotes } from "./offer-index";
import { insertAfterAnchor, findParagraphStartingWith } from "./ooxml";
import { renderInsertRuns, renderTableRow, resetInsCounter } from "./render";
import type { ApplyResult, BuildOptions, Operation } from "./types";

/** Извлечь <w:pPr>…</w:pPr> из начала абзаца (стиль/нумерация сохраняются). */
function extractPPr(pXml: string): string {
  const m = pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : "";
}

/** Заменить все раны абзаца на новые, сохранив pPr. */
function replaceParagraphRuns(pXml: string, newRuns: string): string {
  const pPr = extractPPr(pXml);
  const openMatch = pXml.match(/^<w:p(?:\s[^>]*)?>/);
  const open = openMatch ? openMatch[0] : "<w:p>";
  return `${open}${pPr}${newRuns}</w:p>`;
}

/** Убрать ведущий номер пункта («2.44.», «7.6 ») — он даётся автонумерацией. */
function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "");
}

/** Первые N значимых слов текста — для локации абзаца по началу редакции. */
function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

/** Снять внешние кавычки-«ёлочки», если инструкция дала payload целиком в них. */
function stripOuterQuotes(text: string): string {
  const t = text.trim();
  if (t.startsWith("«") && t.endsWith("»")) return t.slice(1, -1);
  return t;
}

export interface ApplyState {
  document: string;
  footnotes: string | null;
}

export function applyOneOp(
  op: Operation,
  state: ApplyState,
  opts: BuildOptions,
): ApplyResult {
  const fail = (message: string): ApplyResult => ({
    operationId: op.id,
    ok: false,
    message,
    orderKey: Number.MAX_SAFE_INTEGER,
  });

  // ── Вставка после якоря ────────────────────────────────────────────
  if (op.type === "insert_after") {
    if (!op.anchor || op.payload === undefined) return fail("нет якоря/текста");
    const runs = renderInsertRuns(op.payload, opts);

    if (op.target.kind === "footnote") {
      if (!state.footnotes) return fail("в документе нет сносок");
      const idx = indexFootnotes(state.document);
      const id = idx.displayToId.get(op.target.number);
      let note = "";
      const fn = id !== undefined ? findFootnoteById(state.footnotes, id) : null;
      // Пробуем вставить в сноску по номеру.
      if (fn) {
        const res = insertAfterAnchor(fn.inner, op.anchor, runs);
        if (res.ok) {
          state.footnotes =
            state.footnotes.slice(0, fn.start) +
            state.footnotes.slice(fn.start).replace(fn.inner, res.xml);
          return {
            operationId: op.id,
            ok: true,
            message: `сноска № ${op.target.number}: вставлено`,
            orderKey: idx.displayToBodyPos.get(op.target.number) ?? fn.start,
          };
        }
      }
      // Номер не совпал (нумерация «поехала») — ищем сноску по якорю.
      const blocks = allFootnotes(state.footnotes);
      for (const b of blocks) {
        const res = insertAfterAnchor(b.inner, op.anchor, runs);
        if (res.ok) {
          state.footnotes =
            state.footnotes.slice(0, b.start) +
            state.footnotes.slice(b.start).replace(b.inner, res.xml);
          note = ` (номер не совпал — найдено по содержимому, сноска id=${b.id})`;
          return {
            operationId: op.id,
            ok: true,
            message: `сноска № ${op.target.number}: вставлено${note}`,
            orderKey: b.start,
          };
        }
      }
      return fail(`сноска № ${op.target.number}: якорь «${op.anchor}» не найден ни по номеру, ни по содержимому`);
    }

    // Вставка в тело (пункт, приложение-пункт)
    const res = insertAfterAnchor(state.document, op.anchor, runs);
    if (!res.ok) return fail(res.message);
    state.document = res.xml;
    return { operationId: op.id, ok: true, message: "вставлено в текст", orderKey: res.orderKey };
  }

  // ── Замена пункта / термина / пункта приложения ────────────────────
  if (op.type === "replace") {
    if (op.payload === undefined) return fail("нет текста замены");
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    // Ориентир: термин целиком либо первые слова новой редакции — по началу
    // абзаца (номера пунктов в тексте автоматические, искать по ним нельзя).
    let locator = "";
    if (op.target.kind === "term") locator = op.target.term || firstWords(body, 2);
    else locator = firstWords(body, 5);
    if (!locator) return fail("нет ориентира для замены");

    const para = findParagraphStartingWith(state.document, locator);
    if (!para) return fail(`абзац, начинающийся с «${locator}», не найден`);

    let newRuns = "";
    if (op.target.kind === "term") {
      // Термин — жирным, остальное обычным; всё выделено.
      const dashIdx = body.search(/\s[–-]\s/);
      if (dashIdx > 0) {
        const term = body.slice(0, dashIdx);
        const rest = body.slice(dashIdx);
        newRuns =
          renderInsertRuns(term, opts).replace("<w:rPr>", "<w:rPr><w:b/>") +
          renderInsertRuns(rest, opts);
      } else {
        newRuns = renderInsertRuns(body, opts);
      }
    } else {
      newRuns = renderInsertRuns(body, opts);
    }
    const rebuilt = replaceParagraphRuns(para.inner, newRuns);
    state.document =
      state.document.slice(0, para.start) + rebuilt + state.document.slice(para.end);
    return { operationId: op.id, ok: true, message: "пункт изложен в новой редакции", orderKey: para.start };
  }

  // ── Добавление строк в таблицу приложения ──────────────────────────
  if (op.type === "append_table_rows") {
    if (!op.rows || op.rows.length === 0) return fail("нет строк для добавления");
    // Ищем заголовок приложения, затем первую таблицу после него.
    const heading =
      op.target.kind === "appendix_table"
        ? "Способы и особенности реализации Бесшовного"
        : "";
    let searchFrom = 0;
    if (heading) {
      const hp = state.document.indexOf(heading);
      if (hp >= 0) searchFrom = hp;
    }
    const tblStart = state.document.indexOf("<w:tbl>", searchFrom);
    if (tblStart < 0) return fail("таблица приложения не найдена");
    const tblEnd = state.document.indexOf("</w:tbl>", tblStart);
    if (tblEnd < 0) return fail("таблица не закрыта");
    const rowsXml = op.rows.map((r) => renderTableRow(r, opts)).join("");
    state.document =
      state.document.slice(0, tblEnd) + rowsXml + state.document.slice(tblEnd);
    return { operationId: op.id, ok: true, message: `добавлено строк: ${op.rows.length}`, orderKey: tblStart };
  }

  return fail(`тип операции не поддержан: ${op.type}`);
}

/** Применить набор операций к Оферте, вернуть байты docx и отчёт. */
export async function applyOperations(
  offer: DocxParts,
  operations: Operation[],
  opts: BuildOptions,
): Promise<{ offerDocx: Uint8Array; results: ApplyResult[] }> {
  resetInsCounter();
  const state: ApplyState = { document: offer.document, footnotes: offer.footnotes };
  const results: ApplyResult[] = [];
  // Применяем от конца документа к началу, чтобы смещения не «съезжали»:
  // сначала считаем orderKey каждой операции, затем применяем по убыванию.
  // Здесь применяем последовательно, а orderKey фиксируем внутри applyOne
  // на неизменённой в этот момент позиции цели.
  for (const op of operations) {
    results.push(applyOneOp(op, state, opts));
  }
  const offerDocx = await saveDocx(offer, {
    document: state.document,
    footnotes: state.footnotes ?? undefined,
  });
  return { offerDocx, results };
}
