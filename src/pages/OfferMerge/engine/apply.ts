// Детерминированное применение структурных операций к Оферте.
// Текст берётся ТОЛЬКО из операций (payload/rows) — движок не «сочиняет».
import type { DocxParts } from "./docx";
import { saveDocx } from "./docx";
import { indexFootnotes, findFootnoteById, allFootnotes } from "./offer-index";
import {
  insertAfterAnchor,
  insertBeforeAnchor,
  replacePhraseRuns,
  phraseOccurrenceAfter,
  countPhrase,
  paragraphText,
} from "./ooxml";
import {
  locateReplaceParagraph,
  locatePointInsertion,
  locatePointSpan,
  locatePointBlock,
  locateByTextPrefix,
  appendixOffset,
} from "./locate";
import type { ParaSpan } from "./locate";
import { findAppendixTable, replaceRows, buildRow } from "./tables";
import {
  sortTableAlphabetically,
  alphabeticalPosition,
  setRowNumber,
  parseRows,
  findExistingRow,
} from "./alpha-sort";
import {
  maxFootnoteId,
  footnoteRefRunRpr,
  buildFootnoteReferenceRun,
  buildFootnoteElement,
  appendFootnoteElement,
} from "./footnote-add";
import { renderInsertRuns, renderDeleteRuns, resetInsCounter } from "./render";
import type { ApplyResult, BuildOptions, Operation } from "./types";

/** Заменить содержимое сноски (все раны) на новый текст, сохранив маркер. */
function replaceFootnoteBody(inner: string, text: string, opts: BuildOptions): string {
  // Оставляем служебный первый ран со ссылкой-номером, если он есть; иначе
  // просто заменяем все текстовые раны одним выделенным.
  const runs = renderInsertRuns(text, opts);
  const ref = inner.match(/<w:r\b[^>]*>[\s\S]*?<w:footnoteRef\s*\/>[\s\S]*?<\/w:r>/);
  const firstP = inner.match(/<w:p\b[^>]*>/);
  const open = firstP ? firstP[0] : "<w:p>";
  const pPr = inner.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  return `${open}${pPr ? pPr[0] : ""}${ref ? ref[0] : ""}${runs}</w:p>`;
}

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

/** Снять внешние кавычки-«ёлочки», если инструкция дала payload целиком в них. */
function stripOuterQuotes(text: string): string {
  const t = text.trim();
  if (t.startsWith("«") && t.endsWith("»")) return t.slice(1, -1);
  return t;
}

/** Собрать выделенные раны абзаца; для термина ведущее слово — жирным. */
function buildParagraphRuns(body: string, termLike: boolean, opts: BuildOptions): string {
  if (termLike) {
    const dashIdx = body.search(/\s[–—-]\s/);
    if (dashIdx > 0) {
      const term = body.slice(0, dashIdx);
      const rest = body.slice(dashIdx);
      return (
        renderInsertRuns(term, opts).replace("<w:rPr>", "<w:rPr><w:b/>") +
        renderInsertRuns(rest, opts)
      );
    }
  }
  return renderInsertRuns(body, opts);
}

/** Раны со ссылками на сноски — их нельзя терять при замене абзаца. */
function footnoteRefRuns(pXml: string): string {
  const runs = pXml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? [];
  return runs.filter((r) => /<w:footnoteReference\b/.test(r)).join("");
}

/** С какого места документа искать цель: пункт приложения — ниже его заголовка. */
function searchFrom(op: Operation, document: string): number {
  return op.target.kind === "appendix_point" || op.target.kind === "appendix_table"
    ? appendixOffset(document, op.target.appendix)
    : 0;
}

/** Номер пункта, на который направлена операция (если он есть). */
function opPoint(op: Operation): string | null {
  if (op.target.kind === "point" || op.target.kind === "appendix_point") return op.target.point;
  if (op.target.kind === "term" && op.target.point) return op.target.point;
  return null;
}

/**
 * Порядковый номер в человеческом виде: 1 — первый, −1 — последний.
 * Отрицательные значения считаются с конца, как в срезах.
 */
function pickIndex(wanted: number, length: number): number {
  return wanted < 0 ? length + wanted : wanted - 1;
}

function ordinalWord(n: number): string {
  const names = ["первое", "второе", "третье", "четвёртое", "пятое", "шестое"];
  return n < 0 ? "последнее" : (names[n - 1] ?? `${n}-е`);
}

/**
 * Разбить текст пункта на предложения.
 *
 * Точка в «п. 5.3» или «т.д.» — не конец предложения, поэтому границей
 * считаем точку, за которой идёт пробел и заглавная буква либо «ёлочка».
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[«“(]?[А-ЯЁA-Z])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Заменить фрагмент документа на новый XML абзаца. */
function spliceSpan(document: string, span: ParaSpan, rebuilt: string): string {
  return document.slice(0, span.start) + rebuilt + document.slice(span.end);
}

export interface ApplyState {
  document: string;
  footnotes: string | null;
  numbering: string | null;
  styles: string | null;
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

  // ── Вставка относительно якоря ─────────────────────────────────────
  if (op.type === "insert_after" || op.type === "insert_before") {
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

    // Вставка в тело. Ищем якорь ВНУТРИ целевого пункта: фразы вроде
    // «и услуг Банка,» встречаются в Оферте многократно, и поиск по всему
    // документу молча вставил бы все правки в первое попавшееся место.
    const point = opPoint(op);
    if (point) {
      const span = locatePointSpan(state.document, state.numbering, point, state.styles, searchFrom(op, state.document));
      if (span) {
        // Уже внесено (повторный прогон, или правка была в предыдущей
        // редакции) — не дублируем текст. Проверяем именно СВЯЗКУ «якорь +
        // вставка»: короткая вставка вроде предлога «с» встречается в пункте
        // где угодно, и проверка по одному payload'у ложно срабатывала.
        const plain = paragraphText(span.inner).replace(/\s+/g, " ");
        const already = (op.anchor + " " + op.payload).replace(/[«»\s]+/g, " ").trim();
        if (already.length > 4 && plain.replace(/[«»\s]+/g, " ").includes(already)) {
          return {
            operationId: op.id,
            ok: true,
            message: `п. ${point}: текст уже присутствует — правка не требуется`,
            orderKey: span.start,
          };
        }
        const insertAt = op.type === "insert_before" ? insertBeforeAnchor : insertAfterAnchor;
        const inside = insertAt(span.inner, op.anchor, runs);
        if (inside.ok) {
          state.document = spliceSpan(state.document, span, inside.xml);
          return {
            operationId: op.id,
            ok: true,
            message: `п. ${point}: вставлено ${op.type === "insert_before" ? "перед" : "после"} слов${op.type === "insert_before" ? "ами" : ""} «${op.anchor.slice(0, 40)}»`,
            orderKey: span.start,
          };
        }
      }
    }
    // В пункте якоря нет (номера пунктов в разных редакциях расходятся).
    // Тогда опираемся на содержимое — но только если оно однозначно.
    const hits = countPhrase(state.document, op.anchor);
    if (hits === 0)
      return fail(
        `якорь «${op.anchor.slice(0, 60)}» не найден${point ? ` ни в п. ${point}, ни в остальном тексте` : ""}`,
      );
    if (hits > 1)
      return fail(
        `якорь «${op.anchor.slice(0, 40)}» встречается в Оферте ${hits} раз, ` +
          `а п. ${point ?? "?"} по этому номеру не найден — куда вставлять, определить нельзя`,
      );
    const res = (op.type === "insert_before" ? insertBeforeAnchor : insertAfterAnchor)(
      state.document,
      op.anchor,
      runs,
    );
    if (!res.ok) return fail(res.message);
    state.document = res.xml;
    return {
      operationId: op.id,
      ok: true,
      message: point
        ? `вставлено по содержимому (пункт с номером ${point} не найден, якорь в тексте единственный)`
        : "вставлено в текст",
      orderKey: res.orderKey,
    };
  }

  // ── Замена пункта / термина / пункта приложения ────────────────────
  if (op.type === "replace") {
    if (op.payload === undefined) return fail("нет текста замены");
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    // Цель ищем по НОМЕРУ пункта/имени термина и разделу (а не по новому тексту).
    let byPrefix = false;
    let para = locateReplaceParagraph(state.document, state.numbering, op, state.styles);
    if (!para && op.target.kind !== "preamble") {
      // Номер не нашёлся — пробуем опознать пункт по началу его текста.
      para = locateByTextPrefix(
        state.document,
        state.numbering,
        body,
        state.styles,
        opPoint(op) ?? undefined,
      );
      byPrefix = !!para;
    }
    if (!para) {
      let what = "пункт";
      if (op.target.kind === "term") what = `термин «${op.target.term}»`;
      else if (op.target.kind === "appendix_point")
        what = `пункт ${op.target.point} Приложения №${op.target.appendix}`;
      else if (op.target.kind === "point") what = `пункт ${op.target.point}`;
      return fail(`${what} не найден в документе — проверьте, что правка применима к этой редакции`);
    }

    const newRuns = buildParagraphRuns(body, op.target.kind === "term", opts);
    // Ссылки на сноски живут в ранах абзаца: заменив раны целиком, мы бы
    // осиротили сноски и сломали их сквозную нумерацию.
    const keptRefs = footnoteRefRuns(para.inner);
    const rebuilt = replaceParagraphRuns(para.inner, newRuns + keptRefs);
    state.document = spliceSpan(state.document, para, rebuilt);
    return {
      operationId: op.id,
      ok: true,
      message:
        "пункт изложен в новой редакции" +
        (byPrefix
          ? " (пункт с указанным номером не найден — опознан по началу текста, сверьте место правки)"
          : "") +
        (keptRefs ? " (ссылки на сноски сохранены — проверьте их уместность)" : ""),
      orderKey: para.start,
    };
  }

  // ── Добавление НОВОГО пункта (нумерация сдвигается автоматически) ───
  if (op.type === "insert_point") {
    if (op.payload === undefined) return fail("нет текста нового пункта");
    const point = opPoint(op);
    if (!point) return fail("не указан номер нового пункта");
    const loc = locatePointInsertion(state.document, state.numbering, point, state.styles);
    if (!loc) return fail(`не найдено место для нового пункта ${point} (раздел/соседний пункт)`);
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    // Новый абзац наследует стиль/нумерацию (numPr) соседнего пункта — тогда
    // Word сам присвоит номер и перенумерует последующие.
    const pPr = extractPPr(loc.span.inner);
    const isTermLike = /\s[–—-]\s/.test(body.slice(0, 80));
    const runs = buildParagraphRuns(body, isTermLike, opts);
    const newPara = `<w:p>${pPr}${runs}</w:p>`;
    const at = loc.mode === "before" ? loc.span.start : loc.span.end;
    state.document = state.document.slice(0, at) + newPara + state.document.slice(at);
    return {
      operationId: op.id,
      ok: true,
      message: `добавлен пункт ${point} (последующие перенумеруются автоматически)`,
      orderKey: at,
    };
  }

  // ── Добавить НОВУЮ сноску (нумерация сносок сдвигается автоматически) ─
  if (op.type === "add_footnote") {
    if (!state.footnotes) return fail("в документе нет блока сносок");
    if (op.payload === undefined || !op.anchor) return fail("нет якоря или текста сноски");
    const id = maxFootnoteId(state.footnotes) + 1;
    const refRun = buildFootnoteReferenceRun(id, footnoteRefRunRpr(state.document));
    // Вставляем ссылку после якоря — по возможности внутри нужного пункта.
    let inserted = false;
    const point =
      op.target.kind === "point" || op.target.kind === "appendix_point" ? op.target.point : undefined;
    if (point) {
      const loc = locatePointInsertion(state.document, state.numbering, point, state.styles);
      if (loc) {
        const res = insertAfterAnchor(loc.span.inner, op.anchor, refRun);
        if (res.ok) {
          state.document =
            state.document.slice(0, loc.span.start) + res.xml + state.document.slice(loc.span.end);
          inserted = true;
        }
      }
    }
    if (!inserted) {
      const res = insertAfterAnchor(state.document, op.anchor, refRun);
      if (!res.ok) return fail(`якорь «${op.anchor}» для сноски не найден`);
      state.document = res.xml;
    }
    state.footnotes = appendFootnoteElement(state.footnotes, buildFootnoteElement(id, op.payload, opts));
    const orderKey = state.document.indexOf(`<w:footnoteReference w:id="${id}"`);
    return {
      operationId: op.id,
      ok: true,
      message: "добавлена сноска (последующие сноски перенумеруются автоматически)",
      orderKey: orderKey >= 0 ? orderKey : 0,
    };
  }

  // ── Замена сноски целиком ──────────────────────────────────────────
  if (op.type === "replace_footnote") {
    if (op.target.kind !== "footnote") return fail("цель не является сноской");
    if (op.payload === undefined) return fail("нет текста замены");
    if (!state.footnotes) return fail("в документе нет сносок");
    const idx = indexFootnotes(state.document);
    const id = idx.displayToId.get(op.target.number);
    const fn = id !== undefined ? findFootnoteById(state.footnotes, id) : null;
    if (!fn) return fail(`сноска № ${op.target.number} не найдена`);
    const rebuilt = replaceFootnoteBody(fn.inner, op.payload, opts);
    state.footnotes =
      state.footnotes.slice(0, fn.start) +
      state.footnotes.slice(fn.start).replace(fn.inner, rebuilt);
    return {
      operationId: op.id,
      ok: true,
      message: `сноска № ${op.target.number}: изложена в новой редакции`,
      orderKey: idx.displayToBodyPos.get(op.target.number) ?? fn.start,
    };
  }

  // ── Добавление строк в таблицу приложения ──────────────────────────
  if (op.type === "append_table_rows") {
    if (!op.rows || op.rows.length === 0) return fail("нет строк для добавления");
    const appendix = op.target.kind === "appendix_table" ? op.target.appendix : "2";
    const table = findAppendixTable(state.document, appendix);
    if (!table) return fail(`таблица Приложения №${appendix} не найдена`);
    const tblEnd = table.end - "</w:tbl>".length;
    const rowsXml = op.rows.map((r) => buildRow(r, opts)).join("");
    state.document = state.document.slice(0, tblEnd) + rowsXml + state.document.slice(tblEnd);
    return { operationId: op.id, ok: true, message: `добавлено строк: ${op.rows.length}`, orderKey: table.start };
  }

  // ── Замена существующих строк таблицы ──────────────────────────────
  if (op.type === "replace_table_rows") {
    if (!op.rows || op.rows.length === 0) return fail("нет данных строк для замены");
    const appendix = op.target.kind === "appendix_table" ? op.target.appendix : "2";
    const table = findAppendixTable(state.document, appendix);
    if (!table) return fail(`таблица Приложения №${appendix} не найдена`);
    const nameCol = op.nameColumn ?? 1;
    const reps = op.rows.map((cells, i) => ({
      number: parseInt((cells[0] || "").trim(), 10) || op.rowNumbers?.[i] || 0,
      cells,
    }));
    const res = replaceRows(table.inner, reps, opts, nameCol);
    state.document =
      state.document.slice(0, table.start) + res.xml + state.document.slice(table.end);

    const moved = res.replaced.filter((r) => r.byName && r.atRow !== r.number);
    const details: string[] = [];
    if (moved.length)
      details.push(
        `сопоставлено по наименованию (номер в правке отличается): ${moved
          .map((r) => `${r.name.slice(0, 24)} №${r.number}→№${r.atRow}`)
          .slice(0, 4)
          .join(", ")}${moved.length > 4 ? ` и ещё ${moved.length - 4}` : ""}`,
      );
    if (res.missing.length)
      details.push(`не найдены: ${res.missing.map((m) => m.name || `№${m.number}`).join(", ")}`);
    if (res.warnings.length) details.push(res.warnings.slice(0, 2).join("; "));

    return {
      operationId: op.id,
      ok: res.replaced.length > 0,
      message:
        `заменено строк: ${res.replaced.length}/${reps.length} в Приложении №${appendix}` +
        (details.length ? `; ${details.join("; ")}` : ""),
      orderKey: table.start,
    };
  }

  // ── Пересортировка таблицы приложения по алфавиту ──────────────────
  if (op.type === "sort_table_alpha") {
    const appendix = op.target.kind === "appendix_table" ? op.target.appendix : "1";
    const table = findAppendixTable(state.document, appendix);
    if (!table) return fail(`таблица Приложения №${appendix} не найдена`);
    const res = sortTableAlphabetically(table.inner, op.nameColumn ?? 1);
    if ("error" in res) return fail(res.error);
    state.document =
      state.document.slice(0, table.start) + res.xml + state.document.slice(table.end);
    const warn = res.warnings.length ? `; ${res.warnings.join("; ")}` : "";
    return {
      operationId: op.id,
      ok: true,
      message:
        res.moves.length === 0
          ? `Приложение №${appendix}: уже в алфавитном порядке, нумерация проверена`
          : `Приложение №${appendix}: отсортировано по алфавиту, перемещено строк: ${res.moves.length}${warn}`,
      orderKey: table.start,
    };
  }

  // ── Вставка строки в таблицу по алфавиту ───────────────────────────
  if (op.type === "insert_table_row_alpha") {
    if (!op.rows || op.rows.length === 0) return fail("нет данных новой строки");
    const appendix = op.target.kind === "appendix_table" ? op.target.appendix : "1";
    const table = findAppendixTable(state.document, appendix);
    if (!table) return fail(`таблица Приложения №${appendix} не найдена`);
    const nameCol = op.nameColumn ?? 1;
    const rowsXml = table.inner.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
    const parsed = parseRows(table.inner);
    const hasHeader = !/^\d+$/.test(parsed[0]?.cells[0] ?? "");
    const headerCount = hasHeader ? 1 : 0;

    const inserted: string[] = [];
    const skipped: string[] = [];
    let out = [...rowsXml];
    for (const cells of op.rows) {
      const name = cells[nameCol] ?? "";
      if (!name.trim()) continue;
      // Защита от дубликатов: если компания уже в таблице — не добавляем.
      const dup = findExistingRow(out.slice(headerCount).join(""), name, nameCol);
      if (dup) {
        skipped.push(`${name} (уже есть, строка ${dup.number})`);
        continue;
      }
      const pos = alphabeticalPosition(
        out.slice(headerCount).join(""),
        name,
        nameCol,
      );
      out.splice(headerCount + pos - 1, 0, buildRow(cells, opts));
      inserted.push(`${name} → позиция ${pos}`);
    }
    if (inserted.length === 0) {
      return {
        operationId: op.id,
        ok: false,
        message: skipped.length
          ? `Приложение №${appendix}: пропущено — ${skipped.join("; ")}`
          : "не удалось определить наименование новой строки",
        orderKey: table.start,
      };
    }
    // Перенумеровываем весь корпус таблицы.
    out = out.map((tr, i) => (i < headerCount ? tr : setRowNumber(tr, i - headerCount + 1)));
    const firstTr = table.inner.indexOf("<w:tr");
    const rebuilt = table.inner.slice(0, firstTr) + out.join("") + "</w:tbl>";
    state.document =
      state.document.slice(0, table.start) + rebuilt + state.document.slice(table.end);
    return {
      operationId: op.id,
      ok: true,
      message:
        `Приложение №${appendix}: добавлено по алфавиту (${inserted.join("; ")}), нумерация обновлена` +
        (skipped.length ? `; пропущено: ${skipped.join("; ")}` : ""),
      orderKey: table.start,
    };
  }

  // ── Изложить предложение или абзац пункта в новой редакции ─────────
  if (op.type === "replace_sentence" || op.type === "replace_paragraph") {
    if (op.payload === undefined) return fail("нет текста новой редакции");
    const point = opPoint(op);
    if (!point) return fail("не указан номер пункта");
    const block = locatePointBlock(
      state.document,
      state.numbering,
      point,
      state.styles,
      searchFrom(op, state.document),
    );
    const withText = block.filter((b) => paragraphText(b.inner).trim().length > 0);
    if (withText.length === 0) return fail(`пункт ${point} не найден в документе`);
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));

    // Абзац пункта: «второй абзац п. 7.6 изложить…». Отрицательный номер —
    // отсчёт с конца, так что −1 это последний абзац.
    if (op.type === "replace_paragraph") {
      const idx = pickIndex(op.paragraphIndex ?? -1, withText.length);
      const span = withText[idx];
      if (!span) return fail(`в п. ${point} нет абзаца № ${op.paragraphIndex}`);
      const keptRefs = footnoteRefRuns(span.inner);
      const old = paragraphText(span.inner).replace(/\s+/g, " ").trim();
      const runs = renderDeleteRuns(old, opts) + renderInsertRuns(" " + body, opts) + keptRefs;
      state.document = spliceSpan(state.document, span, replaceParagraphRuns(span.inner, runs));
      return {
        operationId: op.id,
        ok: true,
        message: `п. ${point}: ${ordinalWord(op.paragraphIndex ?? -1)} абзац изложен в новой редакции (абзацев в пункте: ${withText.length})`,
        orderKey: span.start,
      };
    }

    // Предложение. Первое ищем в абзаце-зачине, последнее — в завершающем
    // абзаце пункта: он может идти после перечисления подпунктов.
    const wanted = op.sentenceIndex ?? -1;
    const span = wanted === 1 ? withText[0] : withText[withText.length - 1];
    const plain = paragraphText(span.inner).replace(/\s+/g, " ").trim();
    const parts = sentences(plain);
    if (parts.length === 0) return fail(`пункт ${point} пуст`);
    const sIdx = pickIndex(wanted, parts.length);
    const oldSentence = parts[sIdx];
    if (oldSentence === undefined) return fail(`в п. ${point} нет предложения № ${wanted}`);
    if (plain.includes(body.trim())) {
      return {
        operationId: op.id,
        ok: true,
        message: `п. ${point}: новая редакция предложения уже присутствует`,
        orderKey: span.start,
      };
    }
    const runs = renderDeleteRuns(oldSentence, opts) + renderInsertRuns(" " + body, opts);
    const res = replacePhraseRuns(span.inner, oldSentence, runs);
    if (!res.ok)
      return fail(`п. ${point}: ${ordinalWord(wanted)} предложение не удалось выделить — ${res.message}`);
    state.document = spliceSpan(state.document, span, res.xml);
    return {
      operationId: op.id,
      ok: true,
      message:
        `п. ${point}: ${ordinalWord(wanted)} предложение изложено в новой редакции` +
        (block.length > 1 ? ` (пункт из ${block.length} абз.)` : ""),
      orderKey: span.start,
    };
  }

  // ── Дополнить пункт новым абзацем ──────────────────────────────────
  if (op.type === "append_paragraph") {
    if (op.payload === undefined) return fail("нет текста абзаца");
    const point = opPoint(op);
    if (!point) return fail("не указан номер пункта");
    const block = locatePointBlock(
      state.document,
      state.numbering,
      point,
      state.styles,
      searchFrom(op, state.document),
    );
    const withText = block.filter((b) => paragraphText(b.inner).trim().length > 0);
    const span = withText[withText.length - 1];
    if (!span) return fail(`пункт ${point} не найден в документе`);
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    // Абзац внутри пункта своего номера не получает, поэтому автонумерацию с
    // него снимаем — иначе Word посчитает его следующим пунктом.
    const pPr = extractPPr(span.inner).replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "");
    const newPara = `<w:p>${pPr}${renderInsertRuns(body, opts)}</w:p>`;
    state.document =
      state.document.slice(0, span.end) + newPara + state.document.slice(span.end);
    return {
      operationId: op.id,
      ok: true,
      message: `п. ${point}: добавлен абзац`,
      orderKey: span.end,
    };
  }

  // ── Дополнить пункт предложением ───────────────────────────────────
  if (op.type === "append_sentence") {
    if (op.payload === undefined) return fail("нет текста предложения");
    const point = opPoint(op);
    if (!point) return fail("не указан номер пункта");
    const block = locatePointBlock(
      state.document,
      state.numbering,
      point,
      state.styles,
      searchFrom(op, state.document),
    );
    const withText = block.filter((b) => paragraphText(b.inner).trim().length > 0);
    const span = withText[withText.length - 1];
    if (!span) return fail(`пункт ${point} не найден в документе`);
    const body = stripLeadingNumber(stripOuterQuotes(op.payload));
    const plain = paragraphText(span.inner).replace(/\s+/g, " ");
    if (plain.includes(body.trim())) {
      return {
        operationId: op.id,
        ok: true,
        message: `п. ${point}: предложение уже присутствует`,
        orderKey: span.start,
      };
    }
    const closing = span.inner.lastIndexOf("</w:p>");
    const rebuilt =
      span.inner.slice(0, closing) + renderInsertRuns(" " + body, opts) + span.inner.slice(closing);
    state.document = spliceSpan(state.document, span, rebuilt);
    return {
      operationId: op.id,
      ok: true,
      message: `п. ${point}: дополнен предложением`,
      orderKey: span.start,
    };
  }

  // ── Заменить / удалить слова внутри пункта ─────────────────────────
  if (op.type === "replace_words" || op.type === "delete_words") {
    if (!op.find) return fail("не указано, какие слова менять");
    const point = opPoint(op);
    const span = point ? locatePointSpan(state.document, state.numbering, point, state.styles, searchFrom(op, state.document)) : null;
    if (point && !span) return fail(`пункт ${point} не найден в документе`);
    const scope = span ? span.inner : state.document;
    const occurrence = op.anchor ? phraseOccurrenceAfter(scope, op.anchor, op.find) : 0;
    if (occurrence === null)
      return fail(`в п. ${point}: слова «${op.find}» после «${op.anchor}» не найдены`);
    const hits = countPhrase(scope, op.find);
    if (hits === 0) {
      // Возможно, правка уже внесена в этой редакции.
      const replacement = op.payload ? stripOuterQuotes(op.payload) : "";
      if (replacement && countPhrase(scope, replacement) > 0) {
        return {
          operationId: op.id,
          ok: true,
          message: `п. ${point}: «${replacement}» уже стоит вместо «${op.find}» — правка не требуется`,
          orderKey: span ? span.start : 0,
        };
      }
      return fail(`слова «${op.find}» не найдены${point ? ` в п. ${point}` : ""}`);
    }
    if (!span && hits > 1)
      return fail(`слова «${op.find}» встречаются ${hits} раз, а пункт не указан — правка неоднозначна`);

    const del = renderDeleteRuns(op.find, opts);
    const runs =
      op.type === "delete_words"
        ? del
        : del + renderInsertRuns(stripOuterQuotes(op.payload ?? ""), opts);
    const res = replacePhraseRuns(scope, op.find, runs, occurrence);
    if (!res.ok) return fail(res.message);
    state.document = span ? spliceSpan(state.document, span, res.xml) : res.xml;
    const many = hits > 1 && span ? ` (в пункте ${hits} вхождений, изменено одно)` : "";
    return {
      operationId: op.id,
      ok: true,
      message:
        (op.type === "delete_words"
          ? `удалены слова «${op.find}»`
          : `«${op.find}» заменено на «${stripOuterQuotes(op.payload ?? "")}»`) +
        (point ? ` в п. ${point}` : "") +
        many,
      orderKey: span ? span.start : res.orderKey,
    };
  }

  // ── Исключить пункт (последующие перенумеровываются) ───────────────
  if (op.type === "delete_point") {
    const point = opPoint(op);
    if (!point) return fail("не указан номер исключаемого пункта");
    const span = locatePointSpan(state.document, state.numbering, point, state.styles, searchFrom(op, state.document));
    if (!span) return fail(`пункт ${point} не найден в документе`);
    const plain = paragraphText(span.inner).replace(/\s+/g, " ").trim();
    // Снимаем автонумерацию: тогда Word перенумерует последующие пункты, а сам
    // текст остаётся зачёркнутым — читатель видит, что именно исключено.
    const pPr = extractPPr(span.inner).replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "");
    const openMatch = span.inner.match(/^<w:p(?:\s[^>]*)?>/);
    const open = openMatch ? openMatch[0] : "<w:p>";
    const body = stripLeadingNumber(plain);
    const rebuilt = `${open}${pPr}${renderDeleteRuns(`${point}. ${body}`, opts)}</w:p>`;
    state.document = spliceSpan(state.document, span, rebuilt);
    return {
      operationId: op.id,
      ok: true,
      message: `пункт ${point} исключён (зачёркнут, последующие перенумеровываются автоматически)`,
      orderKey: span.start,
    };
  }

  // ── Требует ручной обработки ───────────────────────────────────────
  if (op.type === "manual") {
    return fail(`требует ручной обработки: ${op.note ?? op.rawText.slice(0, 80)}`);
  }

  return fail(`тип операции не поддержан: ${op.type}`);
}

/**
 * Порядок применения операций. Вынесен отдельно, потому что предпросмотр
 * обязан прогонять операции в ТОМ ЖЕ порядке: иначе оператор увидит одно, а в
 * файл попадёт другое — ровно та рассинхронизация, из-за которой правка пункта
 * оказывалась в документе, но не показывалась на шаге «Проверка».
 */
export function applicationOrder(operations: Operation[]): number[] {
  const isNormalizing = (op: Operation) => op.type === "sort_table_alpha";
  const order: number[] = [];
  for (let i = 0; i < operations.length; i++) {
    if (!isNormalizing(operations[i])) order.push(i);
  }
  for (let i = 0; i < operations.length; i++) {
    if (isNormalizing(operations[i])) order.push(i);
  }
  return order;
}

/** Применить набор операций к Оферте, вернуть байты docx и отчёт. */
export async function applyOperations(
  offer: DocxParts,
  operations: Operation[],
  opts: BuildOptions,
): Promise<{ offerDocx: Uint8Array; results: ApplyResult[] }> {
  resetInsCounter();
  const state: ApplyState = {
    document: offer.document,
    footnotes: offer.footnotes,
    numbering: offer.numbering,
    styles: offer.styles,
  };
  const results: ApplyResult[] = [];
  // Порядок применения:
  //  1) В ПОРЯДКЕ ДОКУМЕНТА «Изменения», сверху вниз. Это не косметика:
  //     инструкции внутри пакета ссылаются на нумерацию, которая получается
  //     ПОСЛЕ предыдущих инструкций. Документ добавляет п. 7.3 «с последующей
  //     перенумерацией», и следующая его же строка про «п. 7.6» имеет в виду
  //     пункт, который до этой вставки был 7.5. Каждая операция ищет цель
  //     заново в текущем состоянии документа, поэтому сдвиг позиций безопасен;
  //  2) нормализующие операции (алфавитная пересортировка) — В САМОМ КОНЦЕ:
  //     они приводят таблицу в порядок уже ПОСЛЕ всех замен и добавлений
  //     строк, иначе переименованные строки нарушат алфавитный порядок.
  const order = applicationOrder(operations);

  const slots: (ApplyResult | undefined)[] = new Array(operations.length);
  for (const i of order) {
    slots[i] = applyOneOp(operations[i], state, opts);
  }
  for (const r of slots) if (r) results.push(r);
  const offerDocx = await saveDocx(offer, {
    document: state.document,
    footnotes: state.footnotes ?? undefined,
  });
  return { offerDocx, results };
}
