// Детерминированный парсер инструкций из документов «Изменения».
//
// Формулировки в нормативных документах устойчивы, но не единообразны: один и
// тот же смысл записывают то «Пункт 4.8 изложить в следующей редакции», то
// «изложить п. 4.8 в следующей редакции», то «Изложить п. 7.7.2. Оферты…».
// Поэтому разбор идёт не одним всеобъемлющим шаблоном, а набором правил,
// которые пробуются по очереди; всё, что не распозналось, помечается как
// требующее ручной обработки — молча терять правки нельзя, оператор должен
// увидеть каждую строку исходного документа.
import { ACTION_VERBS, OBJECTS } from "./lexicon";
import { parseInstruction, type Ctx, type Draft } from "./parse-instruction";
import type { Operation } from "./types";

let idc = 0;
function nid(src: string) {
  idc += 1;
  return `${src}#${idc}`;
}
export function resetIds() {
  idc = 0;
}

/** Больше стольких абзацев одна инструкция не занимает даже в худшем случае. */
const MAX_MERGE = 12;

function tidy(s: string): string {
  return s.replace(/\u00A0/g, " ").trim().replace(/\s+/g, " ");
}

/** Опечатки, встречающиеся в исходных документах, чинятся до разбора. */
function fixTypos(s: string): string {
  return s
    .replace(/(\d)\.\.(\d)/g, "$1.$2") // «п.6..10»
    .replace(/следующе\s+редакции/gi, "следующей редакции");
}

/** Баланс «ёлочек» в строке: >0 — кавычка осталась незакрытой. */
function quoteDepth(s: string): number {
  let d = 0;
  for (const ch of s) {
    if (ch === "«") d++;
    else if (ch === "»") d--;
  }
  return d;
}

/**
 * Инструкция часто занимает несколько абзацев: директива заканчивается
 * двоеточием, а новая редакция идёт отдельными абзацами. Признак продолжения —
 * незакрытая «ёлочка» (перечень ККИП в преамбуле тянется на пять абзацев) либо
 * двоеточие в конце и «ёлочка» в начале следующего абзаца.
 */
function mergeUnits(paras: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    let cur = paras[i];
    let taken = 0;
    while (i + 1 < paras.length && taken < MAX_MERGE) {
      const next = paras[i + 1];
      const unclosed = quoteDepth(cur) > 0;
      const colonThenQuote = /:$/.test(cur) && /^«/.test(next);
      if (!unclosed && !colonThenQuote) break;
      // Незакрытая кавычка в одном абзаце (в документах это бывает) не должна
      // засасывать весь остаток документа: следующая директива важнее.
      if (unclosed && !colonThenQuote && startsNewDirective(next)) break;
      cur = cur + " " + next;
      i++;
      taken++;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Абзац начинается как новая директива, а не как продолжение редакции.
 *
 * Проверка нужна из-за незакрытых кавычек в исходных документах: без неё
 * «Сноску 32 после слов «ООО СК «Сбербанк Страхование» дополнить…» тянет за
 * собой следующую инструкцию, и обе правки достаются одной сноске.
 *
 * Признак — первое слово абзаца: либо глагол-директива, либо объект правки
 * (пункт, сноска, абзац, преамбула). Список берётся из словаря, а не из
 * отдельного перечня, чтобы расширялся вместе с ним.
 */
function startsNewDirective(text: string): boolean {
  if (/^(?:в\s+раздел|в\s+приложени|внести)/i.test(text)) return true;
  const firstWord = text.match(/^[А-Яа-яЁёA-Za-z]+/);
  if (!firstWord) return false;
  const w = firstWord[0].toLowerCase();
  return (
    ACTION_VERBS.some((v) => w.startsWith(v.stem)) || OBJECTS.some((o) => w.startsWith(o.stem))
  );
}

// ── контекст разбора ────────────────────────────────────────────────────────

/**
 * Заголовок раздела/приложения: задаёт контекст для следующих строк, сам
 * правкой не является. Отличаем по отсутствию глагола-директивы: «В разделе 6
 * «ПРАВА…»:» — заголовок, а «В п.6.7 … дополнить фразой» — уже правка.
 */
function asContextLine(text: string, ctx: Ctx): boolean {
  if (/(изложить|дополнить|исключить|заменить|добавить|удалить)/i.test(text)) return false;
  const sec = text.match(/^В\s+раздел[а-я]*\s+(\d+)\s*(?:«([^»]*)»)?/i);
  if (sec) {
    ctx.section = sec[1];
    ctx.sectionTitle = sec[2] ?? undefined;
    ctx.appendix = undefined;
    return true;
  }
  const app = text.match(/^В\s+приложени[а-я]*\s*№?\s*(\d+)/i);
  if (app) {
    ctx.appendix = app[1];
    ctx.section = undefined;
    return true;
  }
  return false;
}

// ── сборка операций ─────────────────────────────────────────────────────────

function toOperation(d: Draft, text: string, sourceDoc: string): Operation {
  return {
    id: nid(sourceDoc),
    sourceDoc,
    type: d.type,
    target: d.target,
    anchor: d.anchor,
    find: d.find,
    payload: d.payload,
    sentenceIndex: d.sentenceIndex,
    paragraphIndex: d.paragraphIndex,
    rows: d.rows,
    rowNumbers: d.rowNumbers,
    rowRange: d.rowRange,
    note: d.note,
    renumberFootnotes: /перенумерац\w*\s+сносок|и\s+сносок/i.test(text),
    renumberPoints: /перенумерац\w*\s+пункт|изменением\s+нумерации/i.test(text),
    rawText: text,
    confidence: d.confidence,
    warnings: d.warnings,
  };
}


// ── табличные правила ───────────────────────────────────────────────────────
//
// Правки приложений разбираются отдельно: их «текст» лежит не в кавычках, а в
// таблице документа «Изменения», и слотовый разбор тут не помощник.

type TableRule = (text: string, ctx: Ctx, tables: string[][][]) => Draft[] | null;

function appendixIn(text: string): string | null {
  const m = text.match(/приложени[а-я]*\s*№?\s*(\d+)/i);
  return m ? m[1] : null;
}

/** Приложение N: пункты 17, 24, … изложить в следующей редакции + таблица. */
const ruleAppendixRows: TableRule = (text, ctx, tables) => {
  if (!/приложени/i.test(text) || !/изложить в следующей редакции/i.test(text)) return null;
  if (!/пункт[ыа]?\s+\d+\s*,/i.test(text)) return null;
  const appendix = appendixIn(text) ?? ctx.appendix ?? "?";
  const tp = text.match(/таблиц[ыи]?\s*п\.?\s*(\d+)/i);
  const iP = text.search(/пункт[ыа]?/i);
  const iI = text.search(/изложить/i);
  const seg = text.slice(iP, iI).replace(/таблиц[ыи]?\s*п\.?\s*\d+/gi, "");
  const rowNumbers = (seg.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  const want = new Set(rowNumbers);
  let rows: string[][] = [];
  for (const tbl of tables) {
    const hit = tbl.filter((r) => want.has(parseInt((r[0] || "").trim(), 10)));
    if (hit.length > rows.length) rows = hit.map((r) => r.map((c) => c.trim()));
  }
  return [
    {
      type: "replace_table_rows",
      target: { kind: "appendix_table", appendix, point: tp ? tp[1] : undefined },
      rows,
      rowNumbers,
      confidence: rows.length ? 0.8 : 0.4,
      warnings: rows.length ? undefined : ["новые данные строк не найдены в документе"],
    },
  ];
};

/** Изложить Приложение N в алфавитном порядке. */
const ruleSortAlpha: TableRule = (text) => {
  if (!/алфавитн/i.test(text) || !/приложени/i.test(text) || /Дополнить/i.test(text)) return null;
  return [
    {
      type: "sort_table_alpha",
      target: { kind: "appendix_table", appendix: appendixIn(text) ?? "1" },
      confidence: 0.8,
    },
  ];
};

/** Дополнить Приложение N пунктом следующего содержания (строка таблицы). */
const ruleAppendixNewRow: TableRule = (text, _ctx, tables) => {
  if (!/Дополнить\s+Приложени/i.test(text)) return null;
  if (!/пункт(?:ом)?\s+следующего содержания/i.test(text)) return null;
  const appendix = appendixIn(text) ?? "1";
  let rows: string[][] = [];
  for (const tbl of tables) {
    const cand = tbl.filter((r) => r.some((c) => c.trim())).map((r) => r.map((c) => c.trim()));
    if (cand.length <= 3 && cand.some((r) => r.some((c) => /(ООО|АО|АНО|ПАО)/.test(c)))) rows = cand;
  }
  return [
    {
      type: /алфавитн/i.test(text) ? "insert_table_row_alpha" : "append_table_rows",
      target: { kind: "appendix_table", appendix },
      rows,
      confidence: rows.length ? 0.75 : 0.4,
      warnings: rows.length ? undefined : ["данные новой строки не найдены в документе"],
    },
  ];
};

/** Дополнить таблицу в п. K Приложения N строками X–Y. */
const ruleAppendRowsRange: TableRule = (text, _ctx, tables) => {
  const m = text.match(
    /Дополнить таблицу[\s\S]*?Приложени[а-я]*\s*№?\s*(\d+)[\s\S]*?строками\s+(\d+)\s*[-–—]\s*(\d+)/i,
  );
  if (!m) return null;
  const from = parseInt(m[2], 10);
  const to = parseInt(m[3], 10);
  let rows: string[][] = [];
  for (const tbl of tables) {
    const hit = tbl.filter((r) => {
      const n = parseInt((r[0] || "").trim(), 10);
      return n >= from && n <= to;
    });
    if (hit.length) {
      rows = hit.map((r) => r.map((c) => c.trim()));
      break;
    }
  }
  return [
    {
      type: "append_table_rows",
      target: { kind: "appendix_table", appendix: m[1], point: "3" },
      rows,
      rowRange: { from, to },
      confidence: rows.length ? 0.8 : 0.4,
      warnings: rows.length ? undefined : ["строки таблицы не найдены в документе"],
    },
  ];
};

const TABLE_RULES: TableRule[] = [
  ruleAppendixRows,
  ruleSortAlpha,
  ruleAppendixNewRow,
  ruleAppendRowsRange,
];

/** Похоже ли, что абзац вообще содержит правку (а не шапку документа). */
function looksLikeInstruction(text: string): boolean {
  if (text.length < 15) return false;
  return /(изложить|изложи|дополнить|дополни|исключить|заменить|замени|добавить|добави|удалить|удали|включить|сформулировать|признать утратившим)/i.test(
    text,
  );
}

/**
 * Где начинается собственно перечень правок.
 *
 * Заголовок пишут в обоих порядках: «Внести в Приложение № 7 … следующие
 * изменения:» и «В Приложение 7 … внести следующие изменения:». Привязка к
 * началу абзаца отсекала второй вариант целиком, поэтому ищем сочетание слов
 * где угодно в абзаце.
 */
function instructionsStart(paras: string[]): number {
  return paras.findIndex((p) => /внести/i.test(p) && /изменени/i.test(p));
}

/**
 * К чему адресован документ: к Оферте (Приложение 7) или к другому документу.
 *
 * Если заголовка нет вовсе, считаем документ адресованным Оферте. Обратное
 * умолчание опаснее: одна неузнанная строка-заголовок превращала весь документ
 * в список «внесите вручную», и правки молча не применялись. Здесь же ошибка
 * видна сразу — правки просто не найдут своих мест.
 */
function detectScope(header: string | null): { scope: Ctx["scope"]; note?: string } {
  if (header === null) return { scope: "offer" };
  if (/приложени[ея]\s*№?\s*7|оферт/i.test(header)) return { scope: "offer" };
  return {
    scope: "other",
    note:
      "документ изменяет не Оферту (Приложение 7), а другой раздел Альбома форм — " +
      "правку нужно внести вручную в соответствующий документ",
  };
}

export function parseInstructionsOffline(
  rawParas: string[],
  docTables: string[][][],
  sourceDoc: string,
): Operation[] {
  const paras = rawParas.map((p) => fixTypos(tidy(p))).filter(Boolean);
  const start = instructionsStart(paras);
  const { scope, note } = detectScope(start >= 0 ? paras[start] : null);
  const ctx: Ctx = { scope, scopeNote: note };
  const units = mergeUnits(paras.slice(start + 1));

  const ops: Operation[] = [];
  for (const text of units) {
    if (asContextLine(text, ctx)) continue;
    if (!looksLikeInstruction(text)) continue;

    // Документ адресован не Оферте — правки не применяем, но и не теряем.
    if (ctx.scope === "other") {
      ops.push(
        toOperation(
          {
            type: "manual",
            target: { kind: "point", point: "—" },
            note: ctx.scopeNote,
            confidence: 0.6,
            warnings: [ctx.scopeNote ?? ""],
          },
          text,
          sourceDoc,
        ),
      );
      continue;
    }

    // Сначала таблицы приложений: их содержимое лежит вне текста инструкции.
    let drafts: Draft[] | null = null;
    for (const rule of TABLE_RULES) {
      const res = rule(text, ctx, docTables);
      if (res && res.length) {
        drafts = res;
        break;
      }
    }
    // Затем общий разбор по слотам.
    if (!drafts) drafts = parseInstruction(text, ctx);

    if (drafts && drafts.length) {
      for (const d of drafts) ops.push(toOperation(d, text, sourceDoc));
      continue;
    }
    // Ничего не подошло — правка всё равно должна дойти до оператора.
    ops.push(
      toOperation(
        {
          type: "manual",
          target: { kind: "point", point: "—" },
          note: "формулировка не распознана автоматически",
          confidence: 0.3,
          warnings: ["формулировка не распознана — внесите правку вручную"],
        },
        text,
        sourceDoc,
      ),
    );
  }
  return ops;
}
