// Разбор PDF в ту же модель «абзацы и таблицы», что и .docx (wordCompare).
// Благодаря этому PDF сравнивается и с PDF, и с Word-документом тем же
// движком: например, подписанный PDF с исходным договором в .docx.
//
// PDF не хранит абзацев — только строки текста с координатами. Поэтому:
//   1) элементы текста собираются в строки по Y;
//   2) таблицы с нарисованными границами восстанавливаются по сетке линий
//      (detectTables из PDF → Word) — так они совпадают с таблицами .docx;
//   3) строки склеиваются в абзацы по межстрочному интервалу, отступам,
//      нумерации пунктов и «короткой» последней строке абзаца;
//   4) колонтитулы и номера страниц (повторяются на каждой странице)
//      отбрасываются, переносы слов «до-/говор» склеиваются.
// Скан без текстового слоя распознать нельзя — сообщаем об этом прямо.

import * as pdfjs from "pdfjs-dist";
import { pdfWorkerUrl } from "../../utils/pdfWorker";
import { detectTables, type TableTextItem } from "../PdfToWord/tableDetect";
import type { DocBlock, WordDocModel } from "./wordCompare";

if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
}

interface PageBlock {
  /** Верх блока (Y растёт вверх) — по нему блоки упорядочиваются. */
  top: number;
  block?: DocBlock;
  lines?: Line[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Элементы текста страницы с размером шрифта. */
async function pageItems(page: pdfjs.PDFPageProxy): Promise<TableTextItem[]> {
  const tc = await page.getTextContent();
  const out: TableTextItem[] = [];
  for (const raw of tc.items) {
    if (!("str" in raw)) continue;
    const it = raw as { str: string; transform: number[]; width: number; height: number };
    if (!it.str) continue;
    const t = it.transform;
    const size = Math.hypot(t[2], t[3]) || it.height || 10;
    out.push({ str: it.str, x: t[4], y: t[5], width: it.width || 0, height: it.height || size, fontSize: size });
  }
  return out;
}

/** Склейка элементов в строки (по Y), внутри строки — по X с пробелами по зазорам. */
function toLines(items: TableTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TableTextItem[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) < Math.max(2, it.fontSize * 0.45));
    if (row) row.push(it);
    else rows.push([it]);
  }
  return rows
    .map((r) => {
      r.sort((a, b) => a.x - b.x);
      let text = "";
      let lastEnd = -Infinity;
      for (const it of r) {
        const gap = it.x - lastEnd;
        if (text && gap > it.fontSize * 0.18 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
        text += it.str;
        lastEnd = it.x + it.width;
      }
      return {
        text: text.replace(/\s+/g, " ").trim(),
        x0: r[0].x,
        x1: Math.max(...r.map((i) => i.x + i.width)),
        y: r[0].y,
        size: median(r.map((i) => i.fontSize)),
      };
    })
    .filter((l) => l.text.length > 0);
}

// Номер страницы в колонтитуле: «5», «- 5 -», «Стр. 5», «Страница 5 из 12», «5/12»
const PAGE_NO_RE = /^[-–—\s]*(?:стр\.?|страница|page)?\s*\d{1,4}(?:\s*(?:из|of|\/)\s*\d{1,4})?[-–—\s]*$/iu;
// Начало пункта: «1.», «2.3.», «4)», «а)», «•», «—»
const ITEM_START_RE = /^(?:\d+(?:\.\d+)*[.)]|[IVXLCDM]+\.|[a-zа-яё]\)|[•·▪◦‣–—-])\s/iu;
const SENTENCE_END_RE = /[.:;!?»"”)]$/u;

/** Крайние строки страницы (до двух сверху и снизу) — кандидаты в колонтитулы. */
function edgeLines(lines: Line[], height: number): Line[] {
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  const top = sorted.slice(0, 2).filter((l) => l.y > height * 0.85);
  const bottom = sorted.slice(-2).filter((l) => l.y < height * 0.15);
  return [...top, ...bottom];
}

/** Ключ колонтитула: текст без цифр + положение на странице (колонтитул стоит на месте). */
// Цифры обобщаем только в коротких строках («Страница 3 из 10», «Договор № 15 · 2026»):
// длинная строка с номером пункта — это текст, а не колонтитул.
const hfKey = (l: Line) =>
  `${(l.text.length <= 40 ? l.text.replace(/\d+/g, "#") : l.text).toLowerCase()}@${Math.round(l.y / 3)}`;

/** Колонтитулы: одна и та же крайняя строка на одном месте у большинства страниц. */
function headerFooterKeys(pages: { lines: Line[]; height: number }[]): Set<string> {
  const keys = new Set<string>();
  if (pages.length < 2) return keys;
  const count = new Map<string, number>();
  for (const p of pages) {
    for (const k of new Set(edgeLines(p.lines, p.height).map(hfKey))) count.set(k, (count.get(k) ?? 0) + 1);
  }
  for (const [k, n] of count) if (n >= Math.max(2, Math.ceil(pages.length * 0.6))) keys.add(k);
  return keys;
}

export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<WordDocModel> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages: { lines: Line[]; tables: { top: number; rows: string[][] }[]; height: number; page: number }[] = [];
  let chars = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const items = await pageItems(page);
    chars += items.reduce((s, i) => s + i.str.trim().length, 0);
    let flow = items;
    const tables: { top: number; rows: string[][] }[] = [];
    try {
      const ops = await page.getOperatorList();
      const found = detectTables(ops, items);
      if (found.usedItemIndexes.size) flow = items.filter((_, i) => !found.usedItemIndexes.has(i));
      for (const t of found.tables)
        tables.push({ top: t.y1, rows: t.cells.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim())) });
    } catch {
      /* без таблиц — весь текст пойдёт абзацами */
    }
    pages.push({ lines: toLines(flow), tables, height: vp.height, page: n });
    page.cleanup();
  }
  await doc.destroy();

  if (chars === 0)
    throw new Error(
      "в PDF нет текстового слоя (скан или картинка) — сравнить текст нельзя. Нужен PDF, сохранённый из Word/1С, или распознанный (OCR).",
    );

  const hf = headerFooterKeys(pages);
  const blocks: DocBlock[] = [];
  let paragraphCount = 0;
  let tableCount = 0;

  // Текущий собираемый абзац (может продолжаться на следующей странице)
  const st: { cur: { text: string; page: number } | null; prev: Line | null; prevRight: number } = {
    cur: null,
    prev: null,
    prevRight: 0,
  };
  const flush = () => {
    if (st.cur && st.cur.text.trim()) {
      blocks.push({ kind: "paragraph", text: st.cur.text.trim(), page: st.cur.page });
      paragraphCount++;
    }
    st.cur = null;
    st.prev = null;
  };

  for (const p of pages) {
    const edges = new Set(edgeLines(p.lines, p.height));
    const lines = p.lines.filter((l) => {
      if (!edges.has(l)) return true;
      return !PAGE_NO_RE.test(l.text) && !hf.has(hfKey(l));
    });

    // Типичные параметры страницы: межстрочный шаг, левое поле, ширина текста
    const steps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const d = lines[i - 1].y - lines[i].y;
      if (d > 0 && d < lines[i].size * 3) steps.push(d);
    }
    const step = median(steps) || 14;
    const left = median(lines.map((l) => l.x0));
    const right = Math.max(...lines.map((l) => l.x1), 0);

    // Блоки страницы по порядку сверху вниз: строки и таблицы вперемешку
    const items: PageBlock[] = [
      ...lines.map((l) => ({ top: l.y, lines: [l] })),
      ...p.tables.map((t) => ({ top: t.top, block: { kind: "table" as const, rows: t.rows } })),
    ].sort((a, b) => b.top - a.top);

    for (const it of items) {
      if (it.block) {
        flush();
        blocks.push(it.block);
        tableCount++;
        continue;
      }
      const l = it.lines![0];
      const pl = st.prev;
      let startNew = !st.cur;
      if (st.cur && pl) {
        const gap = pl.y - l.y;
        const samePage = gap > 0;
        if (samePage) {
          if (gap > step * 1.45) startNew = true; // пустая строка между абзацами
          // Новый пункт («2.1.», «а)», «—») — только после законченной фразы:
          // иначе это перенос строки, начавшийся с тире или числа
          else if (ITEM_START_RE.test(l.text) && /[.:;!?]$/u.test(pl.text)) startNew = true;
          else if (l.x0 > left + l.size * 1.2 && pl.x0 <= left + l.size * 0.5) startNew = true; // красная строка
          else if (SENTENCE_END_RE.test(pl.text) && pl.x1 < right - l.size * 4) startNew = true; // короткая последняя строка
          else if (Math.abs(l.size - pl.size) > 1.5) startNew = true; // смена кегля (заголовок)
        } else {
          // Переход на новую страницу: продолжаем абзац, если последняя строка
          // предыдущей страницы не закончила фразу, заполнена до правого поля
          // и кегль тот же (иначе это заголовок или конец абзаца)
          startNew =
            SENTENCE_END_RE.test(pl.text) ||
            pl.x1 < st.prevRight - l.size * 4 ||
            Math.abs(l.size - pl.size) > 1.5;
        }
      }
      if (startNew || !st.cur) {
        flush();
        st.cur = { text: l.text, page: p.page };
      } else {
        const c = st.cur;
        // Перенос слова: «дого-» + «вор» → «договор»
        if (/[a-zа-яё]-$/iu.test(c.text) && /^[a-zа-яё]/u.test(l.text)) c.text = c.text.slice(0, -1) + l.text;
        else c.text += " " + l.text;
      }
      st.prev = l;
      st.prevRight = right;
    }
  }
  flush();

  return { blocks, paragraphCount, tableCount };
}
