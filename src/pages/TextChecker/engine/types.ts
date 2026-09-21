// Общие типы движка проверки текста.
// Движок полностью offline: правила выполняются в браузере, орфография —
// по словарю Hunspell в веб-воркере. Внешние сервисы не вызываются.

/** Группа, к которой относится замечание. */
export type IssueCategory =
  | "spelling"
  | "punctuation"
  | "grammar"
  | "typography"
  | "style";

/**
 * Уверенность правила:
 * error — ошибка почти наверняка, можно исправлять автоматически;
 * warning — скорее всего ошибка, но бывают исключения;
 * hint — подсказка «проверьте это место», решение за человеком.
 */
export type IssueSeverity = "error" | "warning" | "hint";

/** Вариант исправления: чем заменить фрагмент [start, end). */
export interface Suggestion {
  /** Текст замены (может быть пустым — тогда фрагмент удаляется). */
  value: string;
  /** Подпись кнопки, если сам текст замены нечитаем (пробелы и т. п.). */
  label?: string;
}

/** Одно найденное замечание. */
export interface Issue {
  id: string;
  /** Смещение начала фрагмента в тексте. */
  start: number;
  /** Смещение конца фрагмента (не включительно). */
  end: number;
  category: IssueCategory;
  severity: IssueSeverity;
  /** Идентификатор правила — используется для «не показывать это правило». */
  ruleId: string;
  /** Короткий заголовок: «Пропущена запятая». */
  title: string;
  /** Объяснение правила человеческим языком. */
  message: string;
  /** Фрагмент текста на момент проверки (для карточки и для игнорирования). */
  fragment: string;
  suggestions: Suggestion[];
  /** Участвует ли замечание в режиме «Исправить всё». */
  autoFix: boolean;
  /** Подсказки подгружаются лениво (орфография). */
  suggestionsPending?: boolean;
}

/** Слово / знак / пробел с координатами в исходном тексте. */
export interface Token {
  text: string;
  lower: string;
  start: number;
  end: number;
  kind: "word" | "number" | "punct" | "space";
}

/** Предложение с координатами и собственными токенами. */
export interface Sentence {
  text: string;
  start: number;
  end: number;
  tokens: Token[];
  /** Индексы токенов-слов внутри tokens. */
  words: number[];
}

/** Всё, что нужно правилу для работы. */
export interface RuleContext {
  text: string;
  tokens: Token[];
  sentences: Sentence[];
  options: CheckOptions;
}

/** Настройки проверки (управляются переключателями в интерфейсе). */
export interface CheckOptions {
  spelling: boolean;
  punctuation: boolean;
  grammar: boolean;
  typography: boolean;
  style: boolean;
  /** Предпочитать «ё» и кавычки-ёлочки. */
  typographyQuotes: boolean;
}

export const DEFAULT_OPTIONS: CheckOptions = {
  spelling: true,
  punctuation: true,
  grammar: true,
  typography: true,
  style: true,
  typographyQuotes: true,
};

/** Правило — чистая функция: текст на входе, замечания на выходе. */
export type Rule = (ctx: RuleContext) => Issue[];

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  spelling: "Орфография",
  punctuation: "Пунктуация",
  grammar: "Грамматика",
  typography: "Оформление",
  style: "Стиль",
};

export const CATEGORY_ICONS: Record<IssueCategory, string> = {
  spelling: "🔤",
  punctuation: "✒️",
  grammar: "📐",
  typography: "🎯",
  style: "✨",
};

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  error: "Ошибка",
  warning: "Сомнительно",
  hint: "Подсказка",
};
