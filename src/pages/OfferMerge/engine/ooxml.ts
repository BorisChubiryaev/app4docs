// Низкоуровневые операции над OOXML (WordprocessingML).
//
// Правки Оферты выполняются ХИРУРГИЧЕСКИ над сырой XML-строкой document.xml /
// footnotes.xml, без полного разбора и пересборки дерева. Так исходный
// юридический документ (сотни КБ) сохраняется байт-в-байт всюду, кроме
// точечно изменённых мест.

/** Экранирование текста для вставки в <w:t>. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Обратное преобразование XML-сущностей в текст. */
export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** rPr для «выделения цветом» — красный шрифт EE0000, как в образце Оферты. */
export function colorRunProps(color = "EE0000"): string {
  return `<w:rPr><w:color w:val="${color}"/></w:rPr>`;
}

/** Собрать один текстовый run с заданными свойствами. */
export function makeRun(text: string, rPr = ""): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** Токен-run с его границами и текстом. */
interface RunToken {
  start: number; // индекс начала <w:r> в xml
  end: number; // индекс сразу после </w:r>
  full: string;
  text: string; // декодированный видимый текст рана (конкатенация w:t)
  simple: boolean; // ровно один <w:t> и нет иных текстовых узлов (можно точно резать)
  rPr: string; // сырой <w:rPr>…</w:rPr> или ""
  tAttrs: string; // атрибуты тега <w:t …>
}

const RUN_RE = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const WT_RE = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RPR_RE = /^<w:r(?:\s[^>]*)?>(\s*<w:rPr>[\s\S]*?<\/w:rPr>)?/;

function tokenizeRuns(xml: string): RunToken[] {
  const tokens: RunToken[] = [];
  let m: RegExpExecArray | null;
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(xml)) !== null) {
    const full = m[0];
    const start = m.index;
    const end = start + full.length;
    const texts: string[] = [];
    let wt: RegExpExecArray | null;
    WT_RE.lastIndex = 0;
    let tAttrs = "";
    let wtCount = 0;
    while ((wt = WT_RE.exec(full)) !== null) {
      texts.push(decodeXml(wt[2]));
      tAttrs = wt[1] || "";
      wtCount++;
    }
    // «Сложные» узлы, мешающие точной резке (табы, разрывы, картинки).
    const hasOther = /<w:(tab|br|drawing|object|footnoteReference|endnoteReference)\b/.test(full);
    const rprMatch = full.match(RPR_RE);
    const rPr = rprMatch && rprMatch[1] ? rprMatch[1] : "";
    tokens.push({
      start,
      end,
      full,
      text: texts.join(""),
      simple: wtCount === 1 && !hasOther,
      rPr,
      tAttrs,
    });
  }
  return tokens;
}

/** Позиция символа: индекс рана и смещение внутри его текста. */
interface CharPos {
  runIdx: number;
  offInRun: number;
}

/**
 * Найти якорную фразу в тексте набора ранов, игнорируя ВСЕ пробелы
 * (в документах встречается «СК «Сбербанк» и «СК«Сбербанк» — без пробела).
 * Возвращает позицию ПОСЛЕДНЕГО символа якоря либо null.
 */
function isIgnorable(ch: string): boolean {
  // Пробелы и кавычки-«ёлочки» игнорируем при сопоставлении: в инструкции
  // « » служат разделителями фразы, а в тексте — ещё и кавычками, и эти
  // роли часто совпадают на одном символе.
  return /\s/.test(ch) || ch === "«" || ch === "»";
}

function findAnchorEnd(tokens: RunToken[], anchor: string): CharPos | null {
  const chars: { ch: string; pos: CharPos }[] = [];
  tokens.forEach((t, runIdx) => {
    for (let i = 0; i < t.text.length; i++) {
      const ch = t.text[i];
      if (isIgnorable(ch)) continue;
      chars.push({ ch: ch.toLowerCase(), pos: { runIdx, offInRun: i } });
    }
  });
  const flat = chars.map((c) => c.ch).join("");
  const needle = Array.from(anchor)
    .filter((ch) => !isIgnorable(ch))
    .join("")
    .toLowerCase();
  if (!needle) return null;
  const idx = flat.indexOf(needle);
  if (idx < 0) return null;
  return chars[idx + needle.length - 1].pos;
}

export interface InsertResult {
  xml: string;
  ok: boolean;
  message: string;
  /** Позиция вставки в исходном xml (для сортировки по порядку Оферты). */
  orderKey: number;
}

/**
 * Вставить готовые раны `newRuns` СРАЗУ ПОСЛЕ якорной фразы `anchor`.
 * Ран, где заканчивается якорь, при необходимости разрезается, чтобы
 * выделение встало ровно после нужных слов.
 */
export function insertAfterAnchor(
  xml: string,
  anchor: string,
  newRuns: string,
): InsertResult {
  const tokens = tokenizeRuns(xml);
  const end = findAnchorEnd(tokens, anchor);
  if (!end) {
    return { xml, ok: false, message: `якорь не найден: «${anchor}»`, orderKey: -1 };
  }
  const tok = tokens[end.runIdx];
  let cut = end.offInRun + 1; // режем после последнего символа якоря
  // Проскочить закрывающие » (и пробелы перед ними), чтобы вставка встала
  // ПОСЛЕ кавычки, а не внутри неё: «…Страхование»‹сюда›.
  while (cut < tok.text.length && (tok.text[cut] === "»" || /\s/.test(tok.text[cut]))) {
    if (tok.text[cut] === "»") {
      cut++;
      break;
    }
    cut++;
  }

  if (tok.simple) {
    const before = tok.text.slice(0, cut);
    const after = tok.text.slice(cut);
    const tAttrs = tok.tAttrs || ' xml:space="preserve"';
    const rebuilt =
      `<w:r>${tok.rPr}<w:t${tAttrs}>${escapeXml(before)}</w:t></w:r>` +
      newRuns +
      (after.length
        ? `<w:r>${tok.rPr}<w:t${tAttrs}>${escapeXml(after)}</w:t></w:r>`
        : "");
    const newXml = xml.slice(0, tok.start) + rebuilt + xml.slice(tok.end);
    return { xml: newXml, ok: true, message: "вставлено после якоря", orderKey: tok.start };
  }

  // Сложный ран — вставляем после него целиком (выделение чуть менее точное).
  const newXml = xml.slice(0, tok.end) + newRuns + xml.slice(tok.end);
  return {
    xml: newXml,
    ok: true,
    message: "вставлено после рана (ран сложный, резка пропущена)",
    orderKey: tok.end,
  };
}

/**
 * Найти абзац <w:p>, содержащий заданную литеральную фразу, и вернуть его
 * границы + позицию. Используется для замены/локации пунктов и терминов.
 */
export function findParagraphContaining(
  xml: string,
  phrase: string,
  from = 0,
): { start: number; end: number; inner: string } | null {
  const needle = phrase.replace(/\s+/g, "");
  const pRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  pRe.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const texts: string[] = [];
    let wt: RegExpExecArray | null;
    WT_RE.lastIndex = 0;
    while ((wt = WT_RE.exec(m[0])) !== null) texts.push(decodeXml(wt[2]));
    const flat = texts.join("").replace(/\s+/g, "");
    if (flat.includes(needle)) {
      return { start: m.index, end: m.index + m[0].length, inner: m[0] };
    }
  }
  return null;
}

/**
 * Найти абзац, чей видимый текст НАЧИНАЕТСЯ с заданного префикса
 * (без учёта пробелов и ведущей автонумерации). Точнее, чем «содержит»:
 * пункты вроде 2.44/1.2 нумеруются автоматически, поэтому опираемся на
 * начало текста пункта (термин, первые слова редакции).
 */
export function findParagraphStartingWith(
  xml: string,
  prefix: string,
): { start: number; end: number; inner: string } | null {
  const needle = prefix.replace(/\s+/g, "");
  if (!needle) return null;
  const pRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  let fallback: { start: number; end: number; inner: string } | null = null;
  while ((m = pRe.exec(xml)) !== null) {
    const texts: string[] = [];
    let wt: RegExpExecArray | null;
    WT_RE.lastIndex = 0;
    while ((wt = WT_RE.exec(m[0])) !== null) texts.push(decodeXml(wt[2]));
    const flat = texts.join("").replace(/\s+/g, "");
    if (flat.startsWith(needle)) {
      return { start: m.index, end: m.index + m[0].length, inner: m[0] };
    }
    if (!fallback && flat.includes(needle)) {
      fallback = { start: m.index, end: m.index + m[0].length, inner: m[0] };
    }
  }
  return fallback;
}

/** Собрать весь видимый текст абзаца. */
export function paragraphText(pXml: string): string {
  const texts: string[] = [];
  let wt: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((wt = WT_RE.exec(pXml)) !== null) texts.push(decodeXml(wt[2]));
  return texts.join("");
}
