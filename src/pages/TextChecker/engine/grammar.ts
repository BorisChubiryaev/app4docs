// Грамматика: «-тся/-ться», управление падежами, часто путаемые формы.
// Правила узкие и контекстные — так они почти не дают ложных срабатываний.

import type { Issue, RuleContext, Sentence, Token } from "./types";
import { makeIssue } from "./helpers";
import { CONFUSABLES, FINITE_TRIGGERS, INFINITIVE_TRIGGERS, SOGLASNO_DATIVE } from "./lexicon";

export function grammarRules(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];

  for (const sentence of ctx.sentences) {
    issues.push(...tsyaRules(ctx, sentence));
    issues.push(...soglasnoRules(ctx, sentence));
  }

  issues.push(...confusableRules(ctx));
  return issues;
}

/* ─────────────── «-тся» и «-ться» ─────────────── */

function tsyaRules(ctx: RuleContext, sentence: Sentence): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  const wordAt = (i: number): Token | undefined => {
    const idx = sentence.words[i];
    return idx === undefined ? undefined : sentence.tokens[idx];
  };

  for (let i = 0; i < sentence.words.length; i += 1) {
    const token = wordAt(i)!;
    const lower = token.lower;
    const endsTsya = lower.endsWith("тся");
    const endsTsyaSoft = lower.endsWith("ться");
    if (!endsTsya && !endsTsyaSoft) continue;
    if (lower.length < 5) continue;

    // Слово, задающее вопрос: смотрим на одно-два слова назад, пропуская «не».
    let prev = wordAt(i - 1);
    if (prev && prev.lower === "не") prev = wordAt(i - 2);
    if (!prev) continue;

    if (endsTsya && INFINITIVE_TRIGGERS.has(prev.lower)) {
      const fixed = `${token.text.slice(0, -3)}ться`;
      issues.push(
        makeIssue({
          start: token.start,
          end: token.end,
          category: "grammar",
          severity: "error",
          ruleId: "tsya-infinitive",
          title: "Нужно «-ться»",
          message: `После «${prev.text}» глагол отвечает на вопрос «что делать?» — пишется мягкий знак: «${fixed}».`,
          text,
          suggestions: [{ value: fixed }],
          autoFix: true,
        }),
      );
      continue;
    }

    if (endsTsyaSoft && FINITE_TRIGGERS.has(prev.lower)) {
      const fixed = `${token.text.slice(0, -4)}тся`;
      issues.push(
        makeIssue({
          start: token.start,
          end: token.end,
          category: "grammar",
          severity: "error",
          ruleId: "tsya-finite",
          title: "Нужно «-тся»",
          message: `После «${prev.text}» глагол отвечает на вопрос «что делает?» — мягкий знак не нужен: «${fixed}».`,
          text,
          suggestions: [{ value: fixed }],
          autoFix: true,
        }),
      );
    }
  }

  return issues;
}

/* ─────────────── «согласно» + дательный падеж ─────────────── */

function soglasnoRules(ctx: RuleContext, sentence: Sentence): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  for (let i = 0; i < sentence.words.length - 1; i += 1) {
    const idx = sentence.words[i];
    const token = sentence.tokens[idx];
    if (token.lower !== "согласно") continue;

    const nextIdx = sentence.words[i + 1];
    const next = sentence.tokens[nextIdx];
    const fixedForm = SOGLASNO_DATIVE[next.lower];
    if (!fixedForm || fixedForm === next.lower) continue;

    issues.push(
      makeIssue({
        start: next.start,
        end: next.end,
        category: "grammar",
        severity: "error",
        ruleId: "soglasno-dative",
        title: "«Согласно» требует дательного падежа",
        message: `Правильно: «согласно ${fixedForm}» (кому? чему?), а не «согласно ${next.lower}».`,
        text,
        suggestions: [{ value: matchCase(next.text, fixedForm) }],
        autoFix: true,
      }),
    );
  }

  return issues;
}

/** Переносит регистр первой буквы с исходного слова на замену. */
function matchCase(source: string, replacement: string): string {
  if (/^[А-ЯЁ]/.test(source)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/* ─────────────── Часто путаемые формы ─────────────── */

function confusableRules(ctx: RuleContext): Issue[] {
  const { text } = ctx;
  const lower = text.toLowerCase();
  const issues: Issue[] = [];

  for (const rule of CONFUSABLES) {
    rule.pattern.lastIndex = 0;
    for (const m of lower.matchAll(rule.pattern)) {
      const start = m.index!;
      const end = start + m[0].length;
      const original = text.slice(start, end);
      const replacement = matchCase(original, rule.replacement);
      if (replacement === original) continue;

      issues.push(
        makeIssue({
          start,
          end,
          category: "grammar",
          severity: rule.severity,
          ruleId: "confusable",
          title: rule.title,
          message: rule.message,
          text,
          suggestions: rule.autoFix ? [{ value: replacement }] : [],
          autoFix: rule.autoFix,
        }),
      );
    }
  }

  return issues;
}
