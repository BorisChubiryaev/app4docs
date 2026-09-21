// Разбор текста на токены и предложения. Все координаты — смещения в
// исходной строке, чтобы подсветка и автозамены работали по одному тексту.

import type { Sentence, Token } from "./types";
import { ABBREVIATIONS } from "./lexicon";

const WORD_CHAR = /[A-Za-zА-Яа-яЁё]/;
const DIGIT = /[0-9]/;

/** Разбивает текст на слова, числа, знаки и пробелы. */
export function tokenize(text: string, offset = 0): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (start: number, end: number, kind: Token["kind"]) => {
    const raw = text.slice(start, end);
    tokens.push({
      text: raw,
      lower: raw.toLowerCase(),
      start: start + offset,
      end: end + offset,
      kind,
    });
  };

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      const start = i;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      push(start, i, "space");
      continue;
    }

    if (WORD_CHAR.test(ch)) {
      const start = i;
      i += 1;
      while (i < text.length) {
        const c = text[i];
        // Дефис и апостроф считаем частью слова («что-то», «д’Артаньян»),
        // но только если за ними снова идёт буква.
        if (WORD_CHAR.test(c) || DIGIT.test(c)) {
          i += 1;
        } else if ((c === "-" || c === "’" || c === "'") && WORD_CHAR.test(text[i + 1] ?? "")) {
          i += 1;
        } else {
          break;
        }
      }
      push(start, i, "word");
      continue;
    }

    if (DIGIT.test(ch)) {
      const start = i;
      while (i < text.length && /[0-9.,:%\-–]/.test(text[i]) && !(text[i] === "." && !DIGIT.test(text[i + 1] ?? ""))) {
        i += 1;
      }
      if (i === start) i += 1;
      push(start, i, "number");
      continue;
    }

    push(i, i + 1, "punct");
    i += 1;
  }

  return tokens;
}

/** true, если слово написано только кириллицей. */
export function isCyrillic(word: string): boolean {
  return /^[А-Яа-яЁё][А-Яа-яЁё\-’']*$/.test(word);
}

/** true, если слово написано только латиницей. */
export function isLatin(word: string): boolean {
  return /^[A-Za-z][A-Za-z\-’']*$/.test(word);
}

const SENTENCE_END = /[.!?…]/;

/**
 * Делит текст на предложения. Учитывает сокращения («т. д.», «руб.»),
 * инициалы («И. И. Иванов»), нумерацию списков («1. Пункт») и переносы строк.
 */
export function splitSentences(text: string): Sentence[] {
  const result: Sentence[] = [];
  let start = 0;
  let i = 0;

  const flush = (end: number) => {
    const raw = text.slice(start, end);
    if (raw.trim().length === 0) {
      start = end;
      return;
    }
    // Обрезаем ведущие пробелы, чтобы координаты предложения были «по тексту».
    const lead = raw.length - raw.trimStart().length;
    const realStart = start + lead;
    const realEnd = start + raw.trimEnd().length;
    const body = text.slice(realStart, realEnd);
    const tokens = tokenize(body, realStart);
    result.push({
      text: body,
      start: realStart,
      end: realEnd,
      tokens,
      words: tokens.reduce<number[]>((acc, t, idx) => {
        if (t.kind === "word") acc.push(idx);
        return acc;
      }, []),
    });
    start = end;
  };

  while (i < text.length) {
    const ch = text[i];

    // Двойной перевод строки — гарантированная граница (абзац).
    if (ch === "\n") {
      const nextNl = text.indexOf("\n", i + 1);
      if (nextNl === i + 1 || /^\s*\n/.test(text.slice(i + 1))) {
        flush(i + 1);
        i += 1;
        continue;
      }
    }

    if (SENTENCE_END.test(ch)) {
      // Захватываем группу знаков: «?!», «...»
      let end = i + 1;
      while (end < text.length && SENTENCE_END.test(text[end])) end += 1;

      if (ch === "." && isAbbreviationDot(text, i)) {
        i = end;
        continue;
      }

      // Закрывающие кавычки и скобки остаются в предложении.
      while (end < text.length && /["»)\]]/.test(text[end])) end += 1;

      const rest = text.slice(end);
      // Точка в середине слова («сайт.рф») — не граница.
      if (/^[^\s]/.test(rest) && !/^\s/.test(rest) && rest.length > 0 && !/^\n/.test(rest)) {
        i = end;
        continue;
      }

      flush(end);
      i = end;
      continue;
    }

    i += 1;
  }

  flush(text.length);
  return result;
}

/** Точка после сокращения или инициала, а не конец предложения. */
function isAbbreviationDot(text: string, dotIndex: number): boolean {
  let j = dotIndex - 1;
  let word = "";
  while (j >= 0 && WORD_CHAR.test(text[j])) {
    word = text[j] + word;
    j -= 1;
  }
  if (!word) return false;

  // Инициал: одна заглавная буква («И. И. Иванов»).
  if (word.length === 1 && word === word.toUpperCase()) return true;
  // Известное сокращение: «т. д.», «руб.», «ул.».
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** Символ перед позицией, пропуская пробелы. Пустая строка — начало текста. */
export function prevNonSpaceChar(text: string, pos: number): string {
  let i = pos - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  return i >= 0 ? text[i] : "";
}

/** Есть ли запятая/тире/скобка непосредственно перед позицией. */
export function hasPunctBefore(text: string, pos: number): boolean {
  const ch = prevNonSpaceChar(text, pos);
  return ch === "" || /[,;:—–\-([«"…!?.]/.test(ch);
}

/** Есть ли запятая (или конец предложения) сразу после позиции. */
export function hasPunctAfter(text: string, pos: number): boolean {
  let i = pos;
  while (i < text.length && /[ \t]/.test(text[i])) i += 1;
  if (i >= text.length) return true;
  return /[,;:—–.!?)»\n]/.test(text[i]);
}
