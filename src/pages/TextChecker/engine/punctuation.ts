// Пунктуация по правилам. Полный разбор предложения здесь невозможен,
// поэтому правила намеренно «осторожные»: очевидные случаи помечаются
// ошибкой с автозаменой, спорные — подсказкой без автозамены.

import type { ConjRule } from "./lexicon";
import {
  ADVERBIAL_PARTICIPLES,
  COORD_CONJUNCTIONS,
  INTRO_AMBIGUOUS,
  INTRO_STRICT,
  PREPOSITIONS,
  RELATIVE_PRONOUN,
  SUBORDINATE_CONJUNCTIONS,
} from "./lexicon";
import type { Issue, RuleContext, Sentence, Token } from "./types";
import { makeIssue } from "./helpers";
import { hasPunctAfter, hasPunctBefore } from "./tokenize";

export function punctuationRules(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];

  for (const sentence of ctx.sentences) {
    const consumed = new Set<number>();
    issues.push(...introRules(ctx, sentence, consumed));
    issues.push(...conjunctionRules(ctx, sentence, consumed));
    issues.push(...relativeRules(ctx, sentence, consumed));
    issues.push(...participleRules(ctx, sentence, consumed));
    issues.push(...comparisonRules(ctx, sentence, consumed));
    issues.push(...dashBeforeEtoRule(ctx, sentence));
  }

  issues.push(...addressRules(ctx.text));
  return issues;
}

/* ─────────────── Вспомогательное ─────────────── */

/** Слово предложения по порядковому номеру (0 — первое слово). */
function wordAt(sentence: Sentence, index: number): Token | undefined {
  const tokenIndex = sentence.words[index];
  return tokenIndex === undefined ? undefined : sentence.tokens[tokenIndex];
}

/**
 * Пытается найти фразу (одно или несколько слов) начиная со слова index.
 * Возвращает номер последнего слова фразы или null.
 */
function matchPhrase(sentence: Sentence, index: number, phrase: string): number | null {
  const parts = phrase.split(" ");
  for (let k = 0; k < parts.length; k += 1) {
    const token = wordAt(sentence, index + k);
    if (!token || token.lower !== parts[k]) return null;
  }
  return index + parts.length - 1;
}

/** Диапазон текста фразы от слова from до слова to включительно. */
function phraseRange(sentence: Sentence, from: number, to: number) {
  const first = wordAt(sentence, from)!;
  const last = wordAt(sentence, to)!;
  return { start: first.start, end: last.end };
}

function markConsumed(consumed: Set<number>, from: number, to: number) {
  for (let i = from; i <= to; i += 1) consumed.add(i);
}

/** Запятая перед словом: диапазон захватывает пробелы слева. */
function commaBefore(text: string, wordStart: number) {
  let start = wordStart;
  while (start > 0 && /[ \t\u00a0]/.test(text[start - 1])) start -= 1;
  return { start, end: wordStart, value: ", " };
}

/* ─────────────── Вводные слова ─────────────── */

function introRules(ctx: RuleContext, sentence: Sentence, consumed: Set<number>): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];
  const groups: Array<{ list: string[]; strict: boolean }> = [
    { list: INTRO_STRICT, strict: true },
    { list: INTRO_AMBIGUOUS, strict: false },
  ];

  const ordered = groups.flatMap((g) =>
    [...g.list].sort((a, b) => b.split(" ").length - a.split(" ").length).map((phrase) => ({ phrase, strict: g.strict })),
  );

  for (let i = 0; i < sentence.words.length; i += 1) {
    if (consumed.has(i)) continue;

    for (const { phrase, strict } of ordered) {
      const end = matchPhrase(sentence, i, phrase);
      if (end === null) continue;

      const range = phraseRange(sentence, i, end);
      const atStart = i === 0;
      const fragment = text.slice(range.start, range.end);

      if (atStart) {
        if (hasPunctAfter(text, range.end)) break;
        issues.push(
          makeIssue({
            start: range.start,
            end: range.end,
            category: "punctuation",
            severity: strict ? "error" : "hint",
            ruleId: strict ? "intro-start" : "intro-start-maybe",
            title: "Вводное слово без запятой",
            message: strict
              ? `«${fragment}» в начале предложения — вводное слово, после него ставится запятая.`
              : `«${fragment}» может быть вводным словом. Если это так, нужна запятая; если это член предложения («значит» = «означает»), запятая не нужна.`,
            text,
            suggestions: [{ value: `${fragment},` }],
            autoFix: strict,
          }),
        );
        markConsumed(consumed, i, end);
        break;
      }

      const needBefore = !hasPunctBefore(text, range.start);
      const needAfter = !hasPunctAfter(text, range.end);
      if (!needBefore && !needAfter) break;

      let start = range.start;
      if (needBefore) {
        while (start > 0 && /[ \t\u00a0]/.test(text[start - 1])) start -= 1;
      }
      const value = `${needBefore ? ", " : ""}${fragment}${needAfter ? "," : ""}`;

      issues.push(
        makeIssue({
          start,
          end: range.end,
          category: "punctuation",
          severity: strict ? "warning" : "hint",
          ruleId: strict ? "intro-inline" : "intro-inline-maybe",
          title: "Вводное слово не обособлено",
          message: strict
            ? `«${fragment}» в середине предложения выделяется запятыми с двух сторон.`
            : `«${fragment}» бывает и вводным словом, и членом предложения. В роли вводного — обособляется запятыми.`,
          text,
          suggestions: [{ value }],
          autoFix: false,
        }),
      );
      markConsumed(consumed, i, end);
      break;
    }
  }

  return issues;
}

/* ─────────────── Союзы ─────────────── */

function conjunctionRules(ctx: RuleContext, sentence: Sentence, consumed: Set<number>): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];
  const rules: Array<ConjRule & { kind: "sub" | "coord" }> = [
    ...SUBORDINATE_CONJUNCTIONS.map((r) => ({ ...r, kind: "sub" as const })),
    ...COORD_CONJUNCTIONS.map((r) => ({ ...r, kind: "coord" as const })),
  ].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);

  for (let i = 1; i < sentence.words.length; i += 1) {
    if (consumed.has(i)) continue;

    for (const rule of rules) {
      const end = matchPhrase(sentence, i, rule.phrase);
      if (end === null) continue;

      const prev = wordAt(sentence, i - 1);
      const next = wordAt(sentence, end + 1);
      if (prev && rule.skipPrev?.includes(prev.lower)) break;
      if (next && rule.skipNext?.includes(next.lower)) break;
      // Последнее слово предложения союзом быть не может.
      if (!next && rule.kind === "sub") break;

      const range = phraseRange(sentence, i, end);
      if (hasPunctBefore(text, range.start)) {
        markConsumed(consumed, i, end);
        break;
      }

      const fragment = text.slice(range.start, range.end);
      const insert = commaBefore(text, range.start);

      issues.push(
        makeIssue({
          start: insert.start,
          end: range.end,
          category: "punctuation",
          severity: rule.severity,
          ruleId: rule.kind === "sub" ? "comma-subordinate" : "comma-coordinate",
          title: "Пропущена запятая",
          message:
            rule.note ??
            (rule.kind === "sub"
              ? `Перед союзом «${fragment}» начинается придаточная часть — нужна запятая.`
              : `Перед союзом «${fragment}» ставится запятая.`),
          text,
          suggestions: [{ value: `, ${fragment}` }],
          autoFix: rule.severity === "error",
        }),
      );
      markConsumed(consumed, i, end);
      break;
    }
  }

  return issues;
}

/* ─────────────── «который» ─────────────── */

function relativeRules(ctx: RuleContext, sentence: Sentence, consumed: Set<number>): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  for (let i = 1; i < sentence.words.length; i += 1) {
    if (consumed.has(i)) continue;
    const token = wordAt(sentence, i)!;
    if (!RELATIVE_PRONOUN.test(token.lower)) continue;

    // Если перед союзным словом стоит предлог, запятая идёт перед предлогом.
    let anchor = token;
    let anchorIndex = i;
    const prev = wordAt(sentence, i - 1);
    if (prev && PREPOSITIONS.has(prev.lower)) {
      anchor = prev;
      anchorIndex = i - 1;
    }
    if (anchorIndex === 0) continue;
    if (hasPunctBefore(text, anchor.start)) continue;

    const fragment = text.slice(anchor.start, token.end);
    const insert = commaBefore(text, anchor.start);

    issues.push(
      makeIssue({
        start: insert.start,
        end: token.end,
        category: "punctuation",
        severity: "error",
        ruleId: "comma-relative",
        title: "Пропущена запятая перед придаточным",
        message: `Придаточное определительное со словом «${token.text}» отделяется запятой${anchor !== token ? " — она ставится перед предлогом" : ""}.`,
        text,
        suggestions: [{ value: `, ${fragment}` }],
        autoFix: true,
      }),
    );
    markConsumed(consumed, anchorIndex, i);
  }

  return issues;
}

/* ─────────────── Деепричастные обороты ─────────────── */

function participleRules(ctx: RuleContext, sentence: Sentence, consumed: Set<number>): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];
  const ordered = [...ADVERBIAL_PARTICIPLES].sort(
    (a, b) => b.split(" ").length - a.split(" ").length,
  );

  for (let i = 0; i < sentence.words.length; i += 1) {
    if (consumed.has(i)) continue;

    for (const phrase of ordered) {
      const end = matchPhrase(sentence, i, phrase);
      if (end === null) continue;

      const range = phraseRange(sentence, i, end);
      const fragment = text.slice(range.start, range.end);

      if (i === 0) {
        issues.push(
          makeIssue({
            start: range.start,
            end: range.end,
            category: "punctuation",
            severity: "hint",
            ruleId: "participle-start",
            title: "Деепричастный оборот в начале",
            message: `Оборот «${fragment} …» обособляется: поставьте запятую там, где он заканчивается. Границу оборота программа определить не может — проверьте вручную.`,
            text,
          }),
        );
      } else if (!hasPunctBefore(text, range.start)) {
        const insert = commaBefore(text, range.start);
        issues.push(
          makeIssue({
            start: insert.start,
            end: range.end,
            category: "punctuation",
            severity: "warning",
            ruleId: "participle-inline",
            title: "Оборот не обособлен",
            message: `Перед деепричастным оборотом «${fragment} …» нужна запятая. Не забудьте закрыть оборот запятой в конце.`,
            text,
            suggestions: [{ value: `, ${fragment}` }],
            autoFix: false,
          }),
        );
      }

      markConsumed(consumed, i, end);
      break;
    }
  }

  return issues;
}

/* ─────────────── Сравнительный оборот «как» ─────────────── */

const KAK_SKIP_NEXT = new Set([
  "можно", "минимум", "максимум", "раз", "только", "будто", "если", "следует",
  "правило", "обычно", "например", "всегда", "никогда", "говорится", "указано",
  "предусмотрено", "договорились",
]);
const KAK_SKIP_PREV = new Set(["так", "точно", "такой", "такая", "такие", "тот", "те", "и"]);

function comparisonRules(ctx: RuleContext, sentence: Sentence, consumed: Set<number>): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  for (let i = 1; i < sentence.words.length; i += 1) {
    if (consumed.has(i)) continue;
    const token = wordAt(sentence, i)!;
    if (token.lower !== "как") continue;

    const prev = wordAt(sentence, i - 1);
    const next = wordAt(sentence, i + 1);
    if (prev && KAK_SKIP_PREV.has(prev.lower)) continue;
    if (next && KAK_SKIP_NEXT.has(next.lower)) continue;
    if (hasPunctBefore(text, token.start)) continue;

    const insert = commaBefore(text, token.start);
    issues.push(
      makeIssue({
        start: insert.start,
        end: token.end,
        category: "punctuation",
        severity: "hint",
        ruleId: "comma-kak",
        title: "Проверьте запятую перед «как»",
        message:
          "Сравнительный оборот («работает, как часы») выделяется запятыми. Запятая не нужна, если «как» значит «в качестве» («работает как подрядчик») или входит в устойчивое сочетание.",
        text,
        suggestions: [{ value: `, ${token.text}` }],
        autoFix: false,
      }),
    );
    consumed.add(i);
  }

  return issues;
}

/* ─────────────── Тире перед «это» ─────────────── */

const ETO_SKIP_PREV = new Set([
  "и", "а", "но", "или", "что", "как", "всё", "все", "за", "на", "в", "о", "от",
  "для", "при", "это", "вот", "же", "ведь", "если", "когда", "чтобы",
]);

function dashBeforeEtoRule(ctx: RuleContext, sentence: Sentence): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  for (let i = 1; i < sentence.words.length; i += 1) {
    const token = wordAt(sentence, i)!;
    if (token.lower !== "это") continue;
    const prev = wordAt(sentence, i - 1)!;
    if (ETO_SKIP_PREV.has(prev.lower)) continue;
    if (hasPunctBefore(text, token.start)) continue;
    // Нужен «остаток» после «это», иначе это не связка.
    if (!wordAt(sentence, i + 1)) continue;

    let start = token.start;
    while (start > 0 && /[ \t\u00a0]/.test(text[start - 1])) start -= 1;

    issues.push(
      makeIssue({
        start,
        end: token.end,
        category: "punctuation",
        severity: "hint",
        ruleId: "dash-before-eto",
        title: "Возможно, нужно тире",
        message:
          "Перед связкой «это» между подлежащим и сказуемым ставится тире: «Договор — это соглашение сторон».",
        text,
        suggestions: [{ value: ` — ${token.text}` }],
        autoFix: false,
      }),
    );
  }

  return issues;
}

/* ─────────────── Обращения в письмах ─────────────── */

function addressRules(text: string): Issue[] {
  const issues: Issue[] = [];

  for (const m of text.matchAll(
    /^[ \t]*(Уважаем(?:ый|ая|ые)\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)(?![,!])/gm,
  )) {
    const start = m.index! + m[0].indexOf(m[1]);
    issues.push(
      makeIssue({
        start,
        end: start + m[1].length,
        category: "punctuation",
        severity: "error",
        ruleId: "address-comma",
        title: "Обращение не выделено",
        message: "Обращение отделяется запятой или восклицательным знаком: «Уважаемый Иван Иванович,».",
        text,
        suggestions: [
          { value: `${m[1]},`, label: `${m[1]},` },
          { value: `${m[1]}!`, label: `${m[1]}!` },
        ],
        autoFix: true,
      }),
    );
  }

  for (const m of text.matchAll(/^[ \t]*(Здравствуйте|Добрый день|Доброе утро|Добрый вечер)(?![,!])(?=\s+[А-ЯЁ])/gm)) {
    const start = m.index! + m[0].indexOf(m[1]);
    issues.push(
      makeIssue({
        start,
        end: start + m[1].length,
        category: "punctuation",
        severity: "error",
        ruleId: "greeting-comma",
        title: "Приветствие без запятой",
        message: "После приветствия перед обращением ставится запятая: «Здравствуйте, Иван!».",
        text,
        suggestions: [{ value: `${m[1]},` }],
        autoFix: true,
      }),
    );
  }

  return issues;
}
