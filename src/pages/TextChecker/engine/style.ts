// Стиль: канцелярит, плеоназмы, слишком длинные предложения.
// Все замечания — подсказки: это вопрос вкуса, а не правил.

import type { Issue, RuleContext } from "./types";
import { makeIssue } from "./helpers";
import { CLICHES, PLEONASMS } from "./lexicon";

/** С какого числа слов предложение считается тяжёлым. */
const LONG_SENTENCE_WORDS = 35;

export function styleRules(ctx: RuleContext): Issue[] {
  const { text } = ctx;
  const lower = text.toLowerCase();
  const issues: Issue[] = [];

  for (const { pattern, replacement, hint } of CLICHES) {
    pattern.lastIndex = 0;
    for (const m of lower.matchAll(pattern)) {
      const start = m.index!;
      issues.push(
        makeIssue({
          start,
          end: start + m[0].length,
          category: "style",
          severity: "hint",
          ruleId: "cliche",
          title: hint,
          message: `Оборот «${text.slice(start, start + m[0].length)}» утяжеляет текст. Короче: «${replacement}».`,
          text,
          suggestions: [{ value: replacement }],
          autoFix: false,
        }),
      );
    }
  }

  for (const { pattern, replacement } of PLEONASMS) {
    pattern.lastIndex = 0;
    for (const m of lower.matchAll(pattern)) {
      const start = m.index!;
      issues.push(
        makeIssue({
          start,
          end: start + m[0].length,
          category: "style",
          severity: "hint",
          ruleId: "pleonasm",
          title: "Плеоназм",
          message: `«${text.slice(start, start + m[0].length)}» — избыточное сочетание, достаточно «${replacement}».`,
          text,
          suggestions: [{ value: replacement }],
          autoFix: false,
        }),
      );
    }
  }

  for (const sentence of ctx.sentences) {
    if (sentence.words.length < LONG_SENTENCE_WORDS) continue;
    issues.push(
      makeIssue({
        start: sentence.start,
        end: Math.min(sentence.end, sentence.start + 60),
        category: "style",
        severity: "hint",
        ruleId: "long-sentence",
        title: `Длинное предложение — ${sentence.words.length} слов`,
        message:
          "Читателю тяжело удерживать мысль длиннее 30–35 слов. Попробуйте разбить предложение на два.",
        text,
      }),
    );
  }

  return issues;
}
