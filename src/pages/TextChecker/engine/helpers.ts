// Мелкие утилиты, общие для всех правил.

import type { Issue, IssueCategory, IssueSeverity, Suggestion } from "./types";

interface IssueInit {
  start: number;
  end: number;
  category: IssueCategory;
  severity: IssueSeverity;
  ruleId: string;
  title: string;
  message: string;
  text: string;
  suggestions?: Suggestion[];
  autoFix?: boolean;
}

/** Создаёт замечание с идентификатором, стабильным между проверками. */
export function makeIssue(init: IssueInit): Issue {
  const fragment = init.text.slice(init.start, init.end);
  return {
    id: `${init.ruleId}:${init.start}:${init.end}`,
    start: init.start,
    end: init.end,
    category: init.category,
    severity: init.severity,
    ruleId: init.ruleId,
    title: init.title,
    message: init.message,
    fragment,
    suggestions: init.suggestions ?? [],
    autoFix: init.autoFix ?? false,
  };
}

/** Находится ли позиция внутри ссылки, e-mail или пути к файлу. */
export function insideUrl(text: string, pos: number): boolean {
  let start = pos;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  let end = pos;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  const chunk = text.slice(start, end);
  return /(https?:\/\/|www\.|@|\.(?:ru|com|org|net|рф|txt|pdf|docx?|xlsx?|png|jpg)\b|\\|\/)/i.test(chunk);
}

/** Первая буква — заглавная. */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
