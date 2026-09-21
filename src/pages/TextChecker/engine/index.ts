// Сборка правил в один проход + применение исправлений.

import type { CheckOptions, Issue, RuleContext } from "./types";
import { splitSentences, tokenize } from "./tokenize";
import { typographyRules } from "./typography";
import { punctuationRules } from "./punctuation";
import { grammarRules } from "./grammar";
import { styleRules } from "./style";
import { makeIssue } from "./helpers";

export * from "./types";
export { splitSentences, tokenize } from "./tokenize";

const SEVERITY_RANK = { error: 0, warning: 1, hint: 2 } as const;

/** Прогоняет все включённые правила (без орфографии — она в воркере). */
export function runRules(text: string, options: CheckOptions): Issue[] {
  if (!text.trim()) return [];

  const ctx: RuleContext = {
    text,
    tokens: tokenize(text),
    sentences: splitSentences(text),
    options,
  };

  const issues: Issue[] = [];
  if (options.typography) issues.push(...typographyRules(ctx));
  if (options.punctuation) issues.push(...punctuationRules(ctx));
  if (options.grammar) issues.push(...grammarRules(ctx));
  if (options.style) issues.push(...styleRules(ctx));

  return sortIssues(dedupe(issues));
}

/** Превращает неизвестные слова из воркера в замечания. */
export function spellingIssues(
  text: string,
  unknown: Array<{ word: string; start: number; end: number }>,
): Issue[] {
  return unknown.map((item) => ({
    ...makeIssue({
      start: item.start,
      end: item.end,
      category: "spelling",
      severity: "error",
      ruleId: "unknown-word",
      title: "Слова нет в словаре",
      message:
        "Возможно, опечатка. Если слово написано верно (термин, фамилия, название), добавьте его в личный словарь — оно перестанет подчёркиваться.",
      text,
      suggestions: [],
      autoFix: false,
    }),
    suggestionsPending: true,
  }));
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      a.start - b.start ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.end - a.end,
  );
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  });
}

/**
 * Оставляет только непересекающиеся замечания — для подсветки.
 * Приоритет: более «уверенное» и более раннее.
 */
export function nonOverlapping(issues: Issue[]): Issue[] {
  const result: Issue[] = [];
  let lastEnd = -1;
  for (const issue of sortIssues(issues)) {
    if (issue.start < lastEnd) continue;
    if (issue.end <= issue.start) continue;
    result.push(issue);
    lastEnd = issue.end;
  }
  return result;
}

/** Заменяет фрагмент [start, end) на value. */
export function applyFix(text: string, issue: Issue, value: string): string {
  return text.slice(0, issue.start) + value + text.slice(issue.end);
}

/**
 * Применяет все автоисправимые замечания за один проход.
 * Идём с конца, чтобы смещения не «поехали»; пересекающиеся пропускаем.
 */
export function applyAllFixes(text: string, issues: Issue[]): { text: string; applied: number } {
  const fixable = nonOverlapping(
    issues.filter((issue) => issue.autoFix && issue.suggestions.length > 0),
  );

  let result = text;
  let applied = 0;
  for (const issue of [...fixable].reverse()) {
    // Страховка: фрагмент мог измениться после ручных правок.
    if (result.slice(issue.start, issue.end) !== issue.fragment) continue;
    result = result.slice(0, issue.start) + issue.suggestions[0].value + result.slice(issue.end);
    applied += 1;
  }

  return { text: result, applied };
}

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  /** Время чтения в минутах (180 слов в минуту). */
  readingMinutes: number;
}

export function textStats(text: string): TextStats {
  const tokens = tokenize(text);
  const words = tokens.filter((t) => t.kind === "word").length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words,
    sentences: splitSentences(text).length,
    paragraphs,
    readingMinutes: Math.max(1, Math.round(words / 180)),
  };
}
