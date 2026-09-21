// Правила оформления: пробелы, знаки, кавычки, тире, раскладка.
// Это самая «механическая» часть проверки — здесь почти нет спорных случаев,
// поэтому большинство правил помечены как автоисправимые.

import type { Issue, RuleContext } from "./types";
import { makeIssue, insideUrl, capitalize } from "./helpers";
import { isCyrillic, isLatin } from "./tokenize";
import { LATIN_TO_CYRILLIC, CYRILLIC_TO_LATIN, REPEAT_ALLOWED } from "./lexicon";

export function typographyRules(ctx: RuleContext): Issue[] {
  const { text } = ctx;
  const issues: Issue[] = [];

  issues.push(...spacesRules(text));
  issues.push(...dashRules(text));
  if (ctx.options.typographyQuotes) issues.push(...quoteRules(text));
  issues.push(...duplicateRules(text));
  issues.push(...layoutRules(ctx));
  issues.push(...capitalRules(ctx));
  issues.push(...hyphenParticleRules(text));

  return issues;
}

/* ─────────────── Пробелы ─────────────── */

function spacesRules(text: string): Issue[] {
  const issues: Issue[] = [];

  // Пробел перед знаком препинания. Если сразу за знаком идёт слово
  // («слово ,слово»), исправляем обе ошибки одной заменой.
  for (const m of text.matchAll(/([ \t]+)([,.;:!?…])/g)) {
    const start = m.index!;
    if (insideUrl(text, start)) continue;
    const end = start + m[0].length;
    const glued = /[А-Яа-яЁёA-Za-z]/.test(text[end] ?? "");
    issues.push(
      makeIssue({
        start,
        end,
        category: "typography",
        severity: "error",
        ruleId: "space-before-punct",
        title: "Лишний пробел перед знаком",
        message: `Знак «${m[2]}» пишется слитно с предыдущим словом${glued ? ", а после него нужен пробел" : ""}.`,
        text,
        suggestions: [{ value: glued ? `${m[2]} ` : m[2] }],
        autoFix: true,
      }),
    );
  }

  // Нет пробела после знака препинания.
  for (const m of text.matchAll(/([,;:!?])(?=[А-Яа-яЁёA-Za-z])/g)) {
    const start = m.index!;
    if (insideUrl(text, start)) continue;
    // Случай «слово ,слово» уже разобран правилом выше.
    if (/[ \t]/.test(text[start - 1] ?? "")) continue;
    issues.push(
      makeIssue({
        start,
        end: start + 1,
        category: "typography",
        severity: "error",
        ruleId: "space-after-punct",
        title: "Нужен пробел после знака",
        message: `После «${m[1]}» ставится пробел.`,
        text,
        suggestions: [{ value: `${m[1]} `, label: `${m[1]}␣` }],
        autoFix: true,
      }),
    );
  }

  // Нет пробела после точки перед новым предложением.
  for (const m of text.matchAll(/([А-Яа-яЁё]{3,})\.(?=[А-ЯЁ][а-яё])/g)) {
    const start = m.index! + m[1].length;
    if (insideUrl(text, start)) continue;
    issues.push(
      makeIssue({
        start,
        end: start + 1,
        category: "typography",
        severity: "error",
        ruleId: "space-after-period",
        title: "Нужен пробел после точки",
        message: "Между предложениями ставится пробел.",
        text,
        suggestions: [{ value: ". ", label: ".␣" }],
        autoFix: true,
      }),
    );
  }

  // Несколько пробелов подряд.
  for (const m of text.matchAll(/(?<=\S)[ \t]{2,}(?=\S)/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "double-space",
        title: "Двойной пробел",
        message: "Между словами достаточно одного пробела.",
        text,
        suggestions: [{ value: " ", label: "один пробел" }],
        autoFix: true,
      }),
    );
  }

  // Пробел после открывающей и перед закрывающей скобкой/кавычкой.
  for (const m of text.matchAll(/([(«[])[ \t]+/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "space-after-open",
        title: "Лишний пробел после открывающего знака",
        message: `После «${m[1]}» пробел не нужен.`,
        text,
        suggestions: [{ value: m[1] }],
        autoFix: true,
      }),
    );
  }

  for (const m of text.matchAll(/[ \t]+([)»\]])/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "space-before-close",
        title: "Лишний пробел перед закрывающим знаком",
        message: `Перед «${m[1]}» пробел не нужен.`,
        text,
        suggestions: [{ value: m[1] }],
        autoFix: true,
      }),
    );
  }

  // Пробелы в конце строки.
  for (const m of text.matchAll(/[ \t]+$/gm)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "hint",
        ruleId: "trailing-space",
        title: "Пробелы в конце строки",
        message: "Невидимые пробелы в конце строки мешают вёрстке.",
        text,
        suggestions: [{ value: "", label: "удалить" }],
        autoFix: true,
      }),
    );
  }

  // Повтор знаков препинания.
  for (const m of text.matchAll(/([,;:])\1+/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "repeated-punct",
        title: "Знак повторяется",
        message: `Подряд идущие «${m[1]}» — опечатка.`,
        text,
        suggestions: [{ value: m[1] }],
        autoFix: true,
      }),
    );
  }

  // Многоточие из трёх точек.
  for (const m of text.matchAll(/\.{3,}/g)) {
    const start = m.index!;
    if (insideUrl(text, start)) continue;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "hint",
        ruleId: "ellipsis",
        title: "Многоточие одним знаком",
        message: "Типографски правильный знак — «…» вместо трёх точек.",
        text,
        suggestions: [{ value: "…" }],
        autoFix: false,
      }),
    );
  }

  return issues;
}

/* ─────────────── Тире и дефисы ─────────────── */

function dashRules(text: string): Issue[] {
  const issues: Issue[] = [];

  // Дефис вместо тире между словами.
  for (const m of text.matchAll(/(?<=[^\s-])[ \u00a0]+(-{1,2})[ \u00a0]+(?=\S)/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "hyphen-as-dash",
        title: "Дефис вместо тире",
        message:
          "Между словами ставится длинное тире «—», дефис используется только внутри слов («кто-то»).",
        text,
        suggestions: [{ value: " — ", label: "— (тире)" }],
        autoFix: true,
      }),
    );
  }

  // Тире без пробелов.
  for (const m of text.matchAll(/(?<=[А-Яа-яЁёA-Za-z0-9])—(?=[А-Яа-яЁёA-Za-z])|(?<=[А-Яа-яЁёA-Za-z])—(?=[А-Яа-яЁёA-Za-z0-9])/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + 1,
        category: "typography",
        severity: "warning",
        ruleId: "dash-spacing",
        title: "Тире без пробелов",
        message: "Длинное тире отбивается пробелами с обеих сторон.",
        text,
        suggestions: [{ value: " — ", label: "␣—␣" }],
        autoFix: true,
      }),
    );
  }

  // Диапазон чисел: «5-10» → «5–10» (короткое тире).
  for (const m of text.matchAll(/(?<=\d)\s*-\s*(?=\d)/g)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "hint",
        ruleId: "number-range-dash",
        title: "Диапазон чисел",
        message: "В диапазоне чисел ставится короткое тире без пробелов: «5–10».",
        text,
        suggestions: [{ value: "–", label: "– (короткое тире)" }],
        autoFix: false,
      }),
    );
  }

  return issues;
}

/* ─────────────── Кавычки ─────────────── */

function quoteRules(text: string): Issue[] {
  const issues: Issue[] = [];
  let open = true;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    if (insideUrl(text, i)) continue;

    const value = open ? "«" : "»";
    issues.push(
      makeIssue({
        start: i,
        end: i + 1,
        category: "typography",
        severity: "warning",
        ruleId: "straight-quotes",
        title: "Прямые кавычки",
        message: "В русском тексте используются кавычки-ёлочки: «пример».",
        text,
        suggestions: [{ value }],
        autoFix: true,
      }),
    );
    open = !open;
  }

  // Непарные кавычки и скобки.
  issues.push(...balanceIssue(text, "«", "»", "Непарная кавычка"));
  issues.push(...balanceIssue(text, "(", ")", "Непарная скобка"));

  return issues;
}

function balanceIssue(text: string, openCh: string, closeCh: string, title: string): Issue[] {
  const stack: number[] = [];
  const issues: Issue[] = [];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === openCh) stack.push(i);
    else if (text[i] === closeCh) {
      if (stack.length === 0) {
        issues.push(
          makeIssue({
            start: i,
            end: i + 1,
            category: "typography",
            severity: "error",
            ruleId: "unbalanced",
            title,
            message: `Закрывающий знак «${closeCh}» есть, а открывающего «${openCh}» нет.`,
            text,
          }),
        );
      } else {
        stack.pop();
      }
    }
  }

  for (const pos of stack) {
    issues.push(
      makeIssue({
        start: pos,
        end: pos + 1,
        category: "typography",
        severity: "error",
        ruleId: "unbalanced",
        title,
        message: `Знак «${openCh}» открыт, но не закрыт «${closeCh}».`,
        text,
      }),
    );
  }

  return issues;
}

/* ─────────────── Повторы слов ─────────────── */

function duplicateRules(text: string): Issue[] {
  const issues: Issue[] = [];
  const re = /(?<![А-Яа-яЁёA-Za-z-])([А-Яа-яЁёA-Za-z]{2,})(\s+)\1(?![А-Яа-яЁёA-Za-z-])/gi;

  for (const m of text.matchAll(re)) {
    const word = m[1].toLowerCase();
    if (REPEAT_ALLOWED.has(word)) continue;
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "typography",
        severity: "error",
        ruleId: "duplicate-word",
        title: "Слово повторяется дважды",
        message: `«${m[1]}» идёт подряд два раза.`,
        text,
        suggestions: [{ value: m[1] }],
        autoFix: true,
      }),
    );
  }

  return issues;
}

/* ─────────────── Смешанная раскладка ─────────────── */

function layoutRules(ctx: RuleContext): Issue[] {
  const { text, tokens } = ctx;
  const issues: Issue[] = [];

  for (const token of tokens) {
    if (token.kind !== "word") continue;
    const hasCyr = /[А-Яа-яЁё]/.test(token.text);
    const hasLat = /[A-Za-z]/.test(token.text);
    if (!hasCyr || !hasLat) continue;

    const cyrCount = (token.text.match(/[А-Яа-яЁё]/g) ?? []).length;
    const latCount = (token.text.match(/[A-Za-z]/g) ?? []).length;
    const toCyr = cyrCount >= latCount;
    const map = toCyr ? LATIN_TO_CYRILLIC : CYRILLIC_TO_LATIN;
    const converted = [...token.text]
      .map((ch) => map[ch] ?? ch)
      .join("");
    const fixable = converted !== token.text && (toCyr ? isCyrillic(converted) : isLatin(converted));

    issues.push(
      makeIssue({
        start: token.start,
        end: token.end,
        category: "spelling",
        severity: "error",
        ruleId: "mixed-alphabet",
        title: "Латиница внутри русского слова",
        message:
          "В слове перемешаны кириллица и латиница — обычно это следствие переключения раскладки. Такие слова не находит поиск и подчёркивает Word.",
        text,
        suggestions: fixable ? [{ value: converted }] : [],
        autoFix: fixable,
      }),
    );
  }

  return issues;
}

/* ─────────────── Заглавные буквы ─────────────── */

function capitalRules(ctx: RuleContext): Issue[] {
  const { text, sentences } = ctx;
  const issues: Issue[] = [];

  for (const sentence of sentences) {
    const first = sentence.tokens.find((t) => t.kind !== "space");
    if (!first || first.kind !== "word") continue;
    if (!/^[а-яё]/.test(first.text)) continue;
    // Пункты списков («а) ...») и продолжения после двоеточия не трогаем.
    const before = text.slice(Math.max(0, sentence.start - 2), sentence.start);
    if (/[:;,-]\s*$/.test(before)) continue;
    // Маркеры списков «а)», «б.» — не предложения.
    if (first.text.length === 1 && /^[).]/.test(text.slice(first.end, first.end + 1))) continue;

    issues.push(
      makeIssue({
        start: first.start,
        end: first.end,
        category: "typography",
        severity: "warning",
        ruleId: "sentence-capital",
        title: "Предложение с маленькой буквы",
        message: "Первое слово предложения пишется с заглавной буквы.",
        text,
        suggestions: [{ value: capitalize(first.text) }],
        autoFix: true,
      }),
    );
  }

  // Точка в конце последнего абзаца. Подписи и короткие строки
  // («С уважением, Иван Петров») точкой заканчивать не обязательно.
  const trimmed = text.trimEnd();
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1).trim();
  const lastLineWords = (lastLine.match(/[А-Яа-яЁёA-Za-z]+/g) ?? []).length;
  if (trimmed.length > 40 && lastLineWords >= 5 && !/[.!?…:»)\]]$/.test(trimmed)) {
    const lastWord = /[А-Яа-яЁёA-Za-z0-9]+$/.exec(trimmed);
    if (lastWord) {
      issues.push(
        makeIssue({
          start: lastWord.index,
          end: trimmed.length,
          category: "typography",
          severity: "hint",
          ruleId: "final-period",
          title: "Нет точки в конце",
          message: "Текст заканчивается без знака препинания.",
          text,
          suggestions: [{ value: `${lastWord[0]}.` }],
          autoFix: false,
        }),
      );
    }
  }

  return issues;
}

/* ─────────────── Дефис с частицами ─────────────── */

const PRONOUN_BASE = /^(кто|что|какой|какая|какое|какие|где|когда|куда|откуда|почему|зачем|чей|чья|чьи|сколько|как|каков)$/i;

function hyphenParticleRules(text: string): Issue[] {
  const issues: Issue[] = [];

  for (const m of text.matchAll(/(?<![А-Яа-яЁё-])([А-Яа-яЁё]+)\s+(то|либо|нибудь)(?![А-Яа-яЁё-])/gi)) {
    const base = m[1];
    if (!PRONOUN_BASE.test(base)) continue;
    // «что то» в значении «что» + «то» встречается, но редко — оставляем error.
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "spelling",
        severity: "error",
        ruleId: "particle-hyphen",
        title: "Частица пишется через дефис",
        message: `Частицы «-то», «-либо», «-нибудь» присоединяются дефисом: «${base}-${m[2]}».`,
        text,
        suggestions: [{ value: `${base}-${m[2]}` }],
        autoFix: true,
      }),
    );
  }

  for (const m of text.matchAll(/(?<![А-Яа-яЁё-])(кое)\s+(кто|что|какой|какая|какие|где|когда|куда|как)(?![А-Яа-яЁё-])/gi)) {
    const start = m.index!;
    issues.push(
      makeIssue({
        start,
        end: start + m[0].length,
        category: "spelling",
        severity: "error",
        ruleId: "particle-hyphen",
        title: "«Кое-» пишется через дефис",
        message: "Приставка «кое-» присоединяется дефисом: «кое-что», «кое-где».",
        text,
        suggestions: [{ value: `${m[1]}-${m[2]}` }],
        autoFix: true,
      }),
    );
  }

  return issues;
}
