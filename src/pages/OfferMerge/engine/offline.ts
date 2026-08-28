// Детерминированный парсер инструкций из документов «Изменения».
//
// Формулировки в нормативных документах устойчивы, но не единообразны: один и
// тот же смысл записывают то «Пункт 4.8 изложить в следующей редакции», то
// «изложить п. 4.8 в следующей редакции», то «Изложить п. 7.7.2. Оферты…».
// Поэтому разбор идёт не одним всеобъемлющим шаблоном, а набором правил,
// которые пробуются по очереди; всё, что не распозналось, помечается как
// требующее ручной обработки — молча терять правки нельзя, оператор должен
// увидеть каждую строку исходного документа.
import { extractGuillemet } from "./text";
import type { Operation, OpTarget, OpType } from "./types";

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

/** Содержимое сбалансированных «…» начиная с позиции from. */
function quoted(s: string, from = 0): { text: string; end: number } | null {
  const g = extractGuillemet(s, from);
  return g ? { text: tidy(g.content), end: g.endIndex } : null;
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

/** Абзац начинается как новая директива, а не как продолжение редакции. */
function startsNewDirective(text: string): boolean {
  return /^(?:в\s+раздел|в\s+приложени|пункт\s|п\.\s?\d|изложить|дополнить|исключить|преамбул|внести)/i.test(
    text,
  );
}

// ── контекст разбора ────────────────────────────────────────────────────────

interface Ctx {
  /** Номер раздела из строки-заголовка «В разделе 6 «…»:». */
  section?: string;
  sectionTitle?: string;
  /** Номер приложения из «В приложении 1 к Договору…». */
  appendix?: string;
  /** Адресован ли документ Оферте (Приложению 7) или чему-то ещё. */
  scope: "offer" | "other";
  scopeNote?: string;
}

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

// ── разбор фрагментов инструкции ────────────────────────────────────────────

/** Номера пунктов в «шапке» инструкции: «п.9.7 и 9.8», «пунктах 1.1. и 1.2». */
function pointsIn(prefix: string): string[] {
  const marker = prefix.search(/(?:пункт|п\.)/i);
  if (marker < 0) return [];
  const seg = prefix.slice(marker);
  const nums = seg.match(/\d+(?:\.\d+)*/g) ?? [];
  return nums.map((n) => n.replace(/\.$/, "")).filter(Boolean);
}

/** Первый номер пункта в тексте («Пункт 5.3.1.2 …», «в п. 4.1.3.»). */
function firstPoint(text: string): string | null {
  const m = text.match(/(?:пункт[а-я]*|п\.)\s*(\d+(?:\.\d+)*)/i);
  return m ? m[1].replace(/\.$/, "") : null;
}

/** Номер приложения, если инструкция его называет. */
function appendixIn(text: string): string | null {
  const m = text.match(/приложени[а-я]*\s*№?\s*(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Похож ли текст на определение термина («Стороны – совместное упоминание…»)?
 * В разделе «Термины» правки адресуют пункт, но опознаётся он по имени: номера
 * терминов сдвигаются от редакции к редакции, а имя остаётся.
 */
function termName(payload: string): string | null {
  const body = payload.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "").trim();
  const dash = body.search(/\s[–—-]\s/);
  if (dash <= 0 || dash > 140) return null;
  return body.slice(0, dash).trim();
}

function targetForPoint(point: string, ctx: Ctx, text: string, payload?: string): OpTarget {
  const app = ctx.appendix ?? (/приложени/i.test(text) ? appendixIn(text) : null);
  if (app) return { kind: "appendix_point", appendix: app, point };
  const inTerms =
    point.startsWith("2.") || ctx.section === "2" || /термин/i.test(ctx.sectionTitle ?? "");
  if (inTerms && payload) {
    const term = termName(payload);
    if (term) return { kind: "term", section: ctx.section, point, term };
  }
  return {
    kind: "point",
    section: ctx.section ?? point.split(".")[0],
    point,
    heading: ctx.sectionTitle,
  };
}

// ── сборка операций ─────────────────────────────────────────────────────────

interface Draft {
  type: OpType;
  target: OpTarget;
  anchor?: string;
  find?: string;
  payload?: string;
  sentence?: "first" | "last";
  rows?: string[][];
  rowNumbers?: number[];
  rowRange?: { from: number; to: number };
  confidence: number;
  warnings?: string[];
  note?: string;
}

function toOperation(d: Draft, text: string, sourceDoc: string): Operation {
  return {
    id: nid(sourceDoc),
    sourceDoc,
    type: d.type,
    target: d.target,
    anchor: d.anchor,
    find: d.find,
    payload: d.payload,
    sentence: d.sentence,
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

// ── правила ─────────────────────────────────────────────────────────────────

type Rule = (text: string, ctx: Ctx, tables: string[][][]) => Draft[] | null;

/** Изложить сноску N в следующей редакции. */
const ruleFootnoteReplace: Rule = (text) => {
  const m = text.match(/Изложить\s+сноску\s+(\d+)/i);
  if (!m || !/следующей редакции/i.test(text)) return null;
  const q = quoted(text, text.search(/следующей редакции/i));
  return [
    {
      type: "replace_footnote",
      target: { kind: "footnote", number: parseInt(m[1], 10) },
      payload: q?.text ?? "",
      confidence: q ? 0.85 : 0.4,
      warnings: q ? undefined : ["не найден текст новой редакции сноски"],
    },
  ];
};

/** Сноску N после слов «…» дополнить … */
const ruleFootnoteInsert: Rule = (text) => {
  const m = text.match(/Сноску\s+(\d+)\s+после\s+слов\s*/i);
  if (!m) return null;
  const anchorQ = quoted(text, m.index! + m[0].length);
  if (!anchorQ) return null;
  const payloadQ = quoted(text, anchorQ.end + 1);
  return [
    {
      type: "insert_after",
      target: { kind: "footnote", number: parseInt(m[1], 10) },
      anchor: anchorQ.text,
      payload: ", " + (payloadQ?.text ?? "").replace(/\.$/, "") + ".",
      confidence: payloadQ ? 0.9 : 0.4,
    },
  ];
};

/** … дополнить сноской следующего содержания: «…» */
const ruleFootnoteAdd: Rule = (text, ctx) => {
  if (!/дополнить\s+сноской/i.test(text)) return null;
  const am = text.match(/(?:после\s+слов[а]?|к\s+слов[ауе]м?)\s*/i);
  const anchorQ = am ? quoted(text, am.index! + am[0].length) : null;
  const ci = text.search(/содержания/i);
  const payloadQ = ci >= 0 ? quoted(text, ci) : quoted(text, 0);
  const point = firstPoint(text);
  return [
    {
      type: "add_footnote",
      target: point ? targetForPoint(point, ctx, text) : { kind: "point", point: "?" },
      anchor: anchorQ?.text ?? "",
      payload: payloadQ?.text ?? "",
      confidence: anchorQ && payloadQ ? 0.8 : 0.4,
      warnings: anchorQ ? undefined : ["не найдены слова-якорь для сноски"],
    },
  ];
};

/** Преамбулу изложить в следующей редакции: «…» */
const rulePreamble: Rule = (text) => {
  if (!/^преамбул[уа]/i.test(text) || !/следующей редакции/i.test(text)) return null;
  const q = quoted(text, text.search(/следующей редакции/i));
  return [
    {
      type: "replace",
      target: { kind: "preamble" },
      payload: q?.text ?? "",
      confidence: q ? 0.85 : 0.4,
      warnings: q ? undefined : ["не найден текст новой редакции преамбулы"],
    },
  ];
};

/** Исключить п. X (с перенумерацией последующих). */
const ruleDeletePoint: Rule = (text, ctx) => {
  const m = text.match(/^(?:Исключить|Удалить)\s+(?:пункт|п\.)\s*(\d+(?:\.\d+)*)/i);
  if (!m) return null;
  const point = m[1].replace(/\.$/, "");
  return [{ type: "delete_point", target: targetForPoint(point, ctx, text), confidence: 0.85 }];
};

/** Первое/последнее предложение п. X изложить в следующей редакции: «…» */
const ruleSentence: Rule = (text, ctx) => {
  const m = text.match(
    /(Первое|Последнее)\s+предложени[ея]\s+(?:в\s+)?(?:пункт[а-я]*|п\.)\s*(\d+(?:\.\d+)*)/i,
  );
  if (!m || !/следующей редакции/i.test(text)) return null;
  const point = m[2].replace(/\.$/, "");
  const q = quoted(text, text.search(/следующей редакции/i));
  return [
    {
      type: "replace_sentence",
      target: targetForPoint(point, ctx, text),
      sentence: /Первое/i.test(m[1]) ? "first" : "last",
      payload: q?.text ?? "",
      confidence: q ? 0.85 : 0.4,
      warnings: q ? undefined : ["не найден текст новой редакции предложения"],
    },
  ];
};

/** дополнить п. X предложением в следующей редакции: «…» */
const ruleAppendSentence: Rule = (text, ctx) => {
  const m = text.match(/дополнить\s+(?:пункт|п\.)\s*(\d+(?:\.\d+)*)\.?\s*предложением/i);
  if (!m) return null;
  const point = m[1].replace(/\.$/, "");
  const q = quoted(text, m.index! + m[0].length);
  return [
    {
      type: "append_sentence",
      target: targetForPoint(point, ctx, text),
      payload: q?.text ?? "",
      confidence: q ? 0.85 : 0.4,
    },
  ];
};

/** слово «X» заменить на фразу «Y» — в одном или нескольких пунктах. */
const ruleReplaceWords: Rule = (text, ctx) => {
  const rep = text.match(/заменить\s+(?:на\s+)?(?:фраз[а-я]*|слов[а-я]*|формулировк[а-я]*)?\s*/i);
  if (!rep) return null;
  const m = text.match(/(?:слов[а-я]*|фраз[а-я]*|формулировк[а-я]*)\s*(?=«)/i);
  if (!m || m.index! > rep.index!) return null;
  const findQ = quoted(text, m.index! + m[0].length);
  if (!findQ || findQ.end > rep.index!) return null;
  const toQ = quoted(text, rep.index! + rep[0].length);
  if (!toQ) return null;
  const points = pointsIn(text.slice(0, m.index!));
  if (points.length === 0) return null;
  return points.map((point) => ({
    type: "replace_words" as OpType,
    target: targetForPoint(point, ctx, text),
    find: findQ.text,
    payload: toQ.text,
    confidence: 0.85,
  }));
};

/** после слов «A» удалить слова «B» */
const ruleDeleteWords: Rule = (text, ctx) => {
  const m = text.match(/удалить\s+(?:слов[а-я]*|фраз[а-я]*|формулировк[а-я]*)\s*(?=«)/i);
  if (!m) return null;
  const findQ = quoted(text, m.index! + m[0].length);
  if (!findQ) return null;
  const am = text.slice(0, m.index!).match(/после\s+слов[а]?\s*(?=«)/i);
  const anchorQ = am ? quoted(text, am.index! + am[0].length) : null;
  const point = firstPoint(text);
  if (!point) return null;
  return [
    {
      type: "delete_words",
      target: targetForPoint(point, ctx, text),
      find: findQ.text,
      anchor: anchorQ?.text,
      confidence: 0.85,
    },
  ];
};

/**
 * Дополнить пунктом X … : «…» — новый пункт.
 * Идёт ПОСЛЕ правила о предложении: «дополнить п. 8.5 предложением» — это
 * дополнение существующего пункта, а не новый пункт.
 */
const ruleInsertPoint: Rule = (text, ctx) => {
  const m = text.match(/Дополнить\s+(?:пункт(?:ом)?|п\.)\s*(\d+(?:\.\d+)*)/i);
  if (!m) return null;
  if (/приложени/i.test(text.slice(0, m.index!))) return null;
  const point = m[1].replace(/\.$/, "");
  const colon = text.indexOf(":", m.index!);
  const q = quoted(text, colon >= 0 ? colon : m.index! + m[0].length);
  const payload = q?.text ?? "";
  return [
    {
      type: "insert_point",
      target: targetForPoint(point, ctx, text, payload),
      payload,
      confidence: payload ? 0.8 : 0.4,
      warnings: payload ? undefined : ["не найден текст нового пункта"],
    },
  ];
};

/**
 * Изложить п. X в следующей редакции — в обоих порядках слов и с возможным
 * «Оферты» между номером и глаголом.
 */
const ruleReplacePoint: Rule = (text, ctx) => {
  if (!/следующей редакции/i.test(text)) return null;
  const direct = text.match(
    /(?:пункт|п\.)\s*(\d+(?:\.\d+)*)\.?\s*(?:Оферты\s*)?изложить\s+в\s+следующей редакции/i,
  );
  const inverted = text.match(
    /изложить\s+(?:пункт|п\.)\s*(\d+(?:\.\d+)*)\.?\s*(?:Оферты\s*)?в\s+следующей редакции/i,
  );
  const m = direct ?? inverted;
  if (!m) return null;
  const point = m[1].replace(/\.$/, "");
  const q = quoted(text, text.search(/следующей редакции/i));
  const payload = q?.text ?? "";
  return [
    {
      type: "replace",
      target: targetForPoint(point, ctx, text, payload),
      payload,
      confidence: payload ? 0.85 : 0.4,
      warnings: payload ? undefined : ["не найден текст новой редакции"],
    },
  ];
};

/**
 * после слов «A» дополнить «B» — в одной инструкции таких пар может быть
 * несколько: «после слов «X» дополнить словами «Y», после слова «Z» дополнить
 * предлогом «с»». Раньше в текст пункта уезжала вся эта фраза целиком, поэтому
 * пары разбираются по очереди.
 */
const ruleInsertAfter: Rule = (text, ctx) => {
  const point = firstPoint(text);
  if (!point) return null;
  const drafts: Draft[] = [];
  const re = /после\s+(?:слов[а]?|фразы|слова)\s*(?=«)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const anchorQ = quoted(text, m.index + m[0].length);
    if (!anchorQ) continue;
    const rest = text.slice(anchorQ.end + 1);
    const verb = rest.match(
      /^\s*,?\s*(?:дополнить|добавить)\s+(?:слов[а-я]*|фраз[а-я]*|формулировк[а-я]*|предлог[а-я]*)?\s*(?=«)/i,
    );
    if (!verb) continue;
    const payloadQ = quoted(rest, verb[0].length);
    if (!payloadQ) continue;
    drafts.push({
      type: "insert_after",
      target: targetForPoint(point, ctx, text),
      anchor: anchorQ.text,
      payload: " " + payloadQ.text,
      confidence: 0.85,
    });
    re.lastIndex = anchorQ.end + 1 + payloadQ.end;
  }
  return drafts.length ? drafts : null;
};

/** Приложение N: пункты 17, 24, … изложить в следующей редакции + таблица. */
const ruleAppendixRows: Rule = (text, ctx, tables) => {
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
const ruleSortAlpha: Rule = (text) => {
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
const ruleAppendixNewRow: Rule = (text, _ctx, tables) => {
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
const ruleAppendRowsRange: Rule = (text, _ctx, tables) => {
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

// Порядок важен: более узкие правила идут раньше общих.
const RULES: Rule[] = [
  ruleFootnoteReplace,
  ruleFootnoteInsert,
  ruleFootnoteAdd,
  rulePreamble,
  ruleDeletePoint,
  ruleSentence,
  ruleAppendSentence,
  ruleAppendixRows,
  ruleSortAlpha,
  ruleAppendixNewRow,
  ruleAppendRowsRange,
  ruleReplaceWords,
  ruleDeleteWords,
  ruleInsertPoint,
  ruleReplacePoint,
  ruleInsertAfter,
];

/** Похоже ли, что абзац вообще содержит правку (а не шапку документа). */
function looksLikeInstruction(text: string): boolean {
  if (text.length < 15) return false;
  return /(изложить|дополнить|исключить|заменить|добавить|удалить|признать утратившим)/i.test(text);
}

/** Где начинается собственно перечень правок («Внести … изменения …»). */
function instructionsStart(paras: string[]): number {
  const i = paras.findIndex((p) => /^внести[\s,]/i.test(p) && /изменени/i.test(p));
  return i >= 0 ? i : -1;
}

/** К чему адресован документ: к Оферте (Приложение 7) или к другому документу. */
function detectScope(header: string): { scope: Ctx["scope"]; note?: string } {
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
  const { scope, note } = detectScope(start >= 0 ? paras[start] : "");
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

    let matched: Draft[] | null = null;
    for (const rule of RULES) {
      const res = rule(text, ctx, docTables);
      if (res && res.length) {
        matched = res;
        break;
      }
    }
    if (matched) {
      for (const d of matched) ops.push(toOperation(d, text, sourceDoc));
      continue;
    }
    // Ничего не подошло — правка всё равно должна дойти до оператора.
    ops.push(
      toOperation(
        {
          type: "manual",
          target: { kind: "point", point: firstPoint(text) ?? "—" },
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
