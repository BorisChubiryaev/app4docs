// PDF → Word: весь конвейер.
//   1) первый проход по тексту всех страниц — найти колонтитулы (одни и те
//      же строки у края большинства страниц);
//   2) постранично: извлечение (extract) → раскладка (layout); отрисовка
//      страницы живёт только пока разбирается её страница;
//   3) склейка абзацев и таблиц, перешедших на следующую страницу,
//      разрывы страниц там, где страница в PDF кончилась раньше времени;
//   4) сборка .docx (docx.ts).

import * as pdfjs from "pdfjs-dist";
import { extractPage, renderPage, visibleTextShare } from "./extract";
import { appendLine, edgeLines, groupLines, hfKey, isDesignCandidate, layoutDesignPage, layoutPage, lineRuns, PAGE_NO_RE, lineText, type Line } from "./layout";
import { buildDocx } from "./docx";
import type { Align, Block, Box, HeaderFooter, ImageBlock, Item, PageLayout, PageRaw, ParaBlock, TableBlock } from "./types";

export interface ConvertResult {
  blob: Blob;
  pages: number;
  paragraphs: number;
  tables: number;
  images: number;
  /** Страницы без текстового слоя (сканы). */
  scannedPages: number;
  /** Страницы, перенесённые макетом (фон + текст в рамках). */
  designPages: number;
}

/**
 * auto — документы потоком, макеты (презентации, буклеты) — фоном с рамками;
 * flow — всё потоком (удобно править); exact — всё макетом (как в PDF).
 */
export type LayoutMode = "auto" | "flow" | "exact";

export interface ConvertOptions {
  /** Распознавание текста на сканах; без него скан вставляется картинкой. */
  ocr?: (canvas: HTMLCanvasElement, page: number, onProgress: (p: number) => void) => Promise<PageRaw["items"] | null>;
  onProgress: (done: number, total: number, stage: string) => void;
  layout?: LayoutMode;
  password?: string;
}

/** PDF защищён паролем (нужен или неверный). */
export class PdfPasswordError extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? "Неверный пароль к PDF." : "PDF защищён паролем.");
    this.name = "PdfPasswordError";
  }
}


async function blobBytes(c: HTMLCanvasElement, type: string, q?: number): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Вырезать область отрисованной страницы как картинку для Word. */
async function cropImage(raw: PageRaw, b: Box, forceJpeg = false): Promise<ImageBlock | null> {
  const s = raw.scale;
  const x0 = Math.max(0, Math.floor(b.x0 * s));
  const x1 = Math.min(raw.canvas.width, Math.ceil(b.x1 * s));
  const y0 = Math.max(0, Math.floor((raw.height - b.y1) * s));
  const y1 = Math.min(raw.canvas.height, Math.ceil((raw.height - b.y0) * s));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(raw.canvas, x0, y0, w, h, 0, 0, w, h);
  // Фото — JPEG (в разы меньше), схемы и графики — PNG (чёткие линии)
  const px = ctx.getImageData(0, 0, w, h).data;
  const colors = new Set<number>();
  const step = Math.max(4, Math.floor((w * h) / 20000)) * 4;
  for (let i = 0; i < px.length && colors.size < 3000; i += step) colors.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
  const photo = forceJpeg || colors.size >= 3000;
  const data = await blobBytes(c, photo ? "image/jpeg" : "image/png", photo ? 0.9 : undefined);
  if (!data) return null;
  return {
    kind: "image",
    data,
    type: photo ? "jpg" : "png",
    width: w / s,
    height: h / s,
    align: "left",
    indentLeft: b.x0,
    top: b.y1,
    bottom: b.y0,
    page: raw.index,
  };
}

const firstBlock = (p: PageLayout): Block | undefined => p.zones[0]?.blocks[0];
const lastBlock = (p: PageLayout): Block | undefined => {
  const z = p.zones[p.zones.length - 1];
  return z?.blocks[z.blocks.length - 1];
};

const sameStyleRun = (a: ParaBlock, b: ParaBlock) => {
  const ra = a.runs[a.runs.length - 1];
  const rb = b.runs[0];
  return ra && rb && Math.abs(ra.size - rb.size) < 0.6 && ra.font === rb.font;
};

/** Абзац, разорванный границей страниц. */
function continuesPara(prev: ParaBlock, next: ParaBlock): boolean {
  if (prev.heading || next.heading || !prev.lastLineFull || prev.endsSentence) return false;
  if (next.firstLine > 2 || next.align === "center" || prev.align === "center") return false;
  return sameStyleRun(prev, next);
}

/** Таблица, продолжающаяся на следующей странице: те же столбцы. */
function continuesTable(prev: TableBlock, next: TableBlock): boolean {
  if (prev.colWidths.length !== next.colWidths.length || prev.borders !== next.borders) return false;
  return prev.colWidths.every((w, i) => Math.abs(w - next.colWidths[i]) < 3) && Math.abs(prev.x0 - next.x0) < 4;
}

const cellText = (t: TableBlock, r: number) =>
  t.rows[r]
    .map((c) => c.paras.map((p) => p.runs.map((x) => x.text).join("")).join(" "))
    .join("|")
    .replace(/\s+/g, " ")
    .trim();

function headerFooterFrom(lines: Line[], page: number, total: number, width: number): HeaderFooter | null {
  if (!lines.length) return null;
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  return {
    lines: sorted.map((l) => {
      const runs = lineRuns(l).map((r) => ({ ...r }));
      for (const r of runs)
        r.text = r.text.replace(/\d+/g, (d) => (Number(d) === page ? "{PAGE}" : Number(d) === total && total !== page ? "{NUMPAGES}" : d));
      const c = (l.x0 + l.x1) / 2;
      const align: Align = Math.abs(c - width / 2) < width * 0.06 ? "center" : l.x0 > width * 0.5 ? "right" : "left";
      return { runs, align };
    }),
  };
}

export async function convertPdfToDocx(data: ArrayBuffer, title: string, opts: ConvertOptions): Promise<ConvertResult> {
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password: opts.password }).promise;
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new PdfPasswordError(!!opts.password);
    throw e;
  }
  const mode = opts.layout ?? "auto";
  const total = doc.numPages;
  try {
    // ── Проход 1: колонтитулы и страницы без текста ──
    const counts = new Map<string, number>();
    const textless = new Set<number>();
    for (let i = 1; i <= total; i++) {
      opts.onProgress(i - 1, total * 2, `Анализ страниц: ${i} из ${total}`);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: Item[] = [];
      (tc.items as { str?: string; transform?: number[]; width?: number }[]).forEach((it, idx) => {
        if (!it.str?.trim() || !it.transform) return;
        const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width ?? 0, idx, font: "", size, bold: false, italic: false, color: null });
      });
      if (!items.length) textless.add(i - 1);
      const keys = new Set(edgeLines(groupLines(items), vp.height).map((l) => hfKey(l, vp.height)));
      for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
      page.cleanup();
    }
    const hfKeys = new Set<string>();
    if (total >= 2) for (const [k, n] of counts) if (n >= Math.max(2, Math.ceil((total - textless.size) * 0.6))) hfKeys.add(k);

    // ── Проход 2: страницы ──
    const pages: PageLayout[] = [];
    let headerHF: HeaderFooter | null = null;
    let footerHF: HeaderFooter | null = null;
    const fontChars = new Map<string, number>();
    const sizeChars = new Map<number, number>();
    let scanned = 0;
    let designed = 0;
    for (let i = 1; i <= total; i++) {
      opts.onProgress(total + i - 1, total * 2, `Страница ${i} из ${total}`);
      const page = await doc.getPage(i);
      let raw = await extractPage(page, i - 1);
      if (textless.has(i - 1) || (raw.items.length === 0 && raw.images.some((im) => im.fullPage))) {
        scanned++;
        const ocrItems = opts.ocr ? await opts.ocr(raw.canvas, i, () => undefined) : null;
        if (ocrItems && ocrItems.length) {
          raw = { ...raw, items: ocrItems, images: raw.images.filter((im) => !im.fullPage) };
        } else {
          // Скан без распознавания — страница целиком картинкой
          const img = await cropImage(raw, { x0: 0, y0: 0, x1: raw.width, y1: raw.height });
          pages.push({
            index: i - 1,
            width: raw.width,
            height: raw.height,
            margins: { left: 0, right: 0, top: 0, bottom: 0 },
            zones: img ? [{ columns: 1, gap: 0, blocks: [img] }] : [],
            contentBottom: 0,
          });
          page.cleanup();
          continue;
        }
      }
      // Макет: фон — страница без текста, текст — рамки на своих местах
      if (mode !== "flow" && raw.items.length && (mode === "exact" || isDesignCandidate(raw))) {
        const clean = await renderPage(page, raw.scale, true);
        const visible = visibleTextShare(raw, clean);
        const ocrLayer = visible < 0.15 && raw.images.some((im) => im.fullPage);
        if (ocrLayer) {
          // Скан с распознанным невидимым текстом — текст потоком, без картинки скана
          raw = { ...raw, images: raw.images.filter((im) => !im.fullPage) };
          for (const it of raw.items) it.color = null;
        } else {
          const bgRaw = { ...raw, canvas: clean };
          const bg = await cropImage(bgRaw, { x0: 0, y0: 0, x1: raw.width, y1: raw.height }, true);
          pages.push(layoutDesignPage(raw, bg));
          designed++;
          raw.canvas.width = clean.width = 0;
          page.cleanup();
          continue;
        }
        clean.width = 0;
      }
      for (const it of raw.items) {
        const n = it.str.length;
        fontChars.set(it.font, (fontChars.get(it.font) ?? 0) + n);
        sizeChars.set(it.size, (sizeChars.get(it.size) ?? 0) + n);
      }
      const lay = await layoutPage(raw, { hfKeys, cropImage });
      const top = lay.hfLines.filter((l) => l.y > raw.height / 2);
      const bot = lay.hfLines.filter((l) => l.y <= raw.height / 2);
      // Колонтитул берём со второй страницы, если есть: на первой часто свой
      if (top.length && (!headerHF || i === 2)) headerHF = headerFooterFrom(top, i, total, raw.width);
      if (bot.length && (!footerHF || i === 2)) footerHF = headerFooterFrom(bot, i, total, raw.width);
      pages.push(lay);
      // Отрисовка страницы больше не нужна
      raw.canvas.width = 0;
      raw.canvas.height = 0;
      page.cleanup();
      await new Promise((r) => setTimeout(r, 0));
    }

    // ── Документ: поля, шрифт, склейка страниц ──
    const withText = pages.filter((p) => p.zones.some((z) => z.blocks.length) && p.margins.left > 0);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // Поля — по самым «полным» страницам: страница, кончившаяся раньше,
    // или с отступом у всего текста поля не задаёт
    const low = (xs: number[]) => {
      if (!xs.length) return 72;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor((s.length - 1) * 0.2)];
    };
    const margins = {
      left: clamp(low(withText.map((p) => p.margins.left)), 14, 160),
      right: clamp(low(withText.map((p) => p.margins.right)), 14, 160),
      top: clamp(low(withText.map((p) => p.margins.top)), 14, 160),
      bottom: clamp(low(withText.map((p) => p.margins.bottom)), 14, 160),
    };
    // Содержимое шире полей документа на отдельной странице — сдвигаем отступы
    for (const p of pages) {
      const dl = p.margins.left - margins.left;
      if (Math.abs(dl) < 0.5 || p.margins.left === 0) continue;
      for (const z of p.zones)
        for (const b of z.blocks) {
          if (z.columns > 1) continue;
          if (b.kind === "para") {
            b.indentLeft = Math.max(0, b.indentLeft + dl);
            b.tabs = b.tabs.map((t) => ({ ...t, pos: t.pos + dl }));
          } else if (b.kind === "table") b.x0 = Math.max(0, b.x0 + dl);
          else if (b.align === "left") b.indentLeft = Math.max(0, b.indentLeft + dl);
        }
    }

    for (let k = 1; k < pages.length; k++) {
      const prevP = pages[k - 1];
      const p = pages[k];
      const a = lastBlock(prevP);
      const b = firstBlock(p);
      if (!a || !b) continue;
      if (a.kind === "para" && b.kind === "para" && continuesPara(a, b)) {
        appendLine(a.runs, b.runs);
        a.lastLineFull = b.lastLineFull;
        a.endsSentence = b.endsSentence;
        p.zones[0].blocks.shift();
        continue;
      }
      if (a.kind === "table" && b.kind === "table" && continuesTable(a, b)) {
        // Повтор шапки на новой странице не дублируем
        let skip = 0;
        while (skip < a.headerRows && skip < b.rows.length && cellText(a, skip) === cellText(b, skip)) skip++;
        a.rows.push(...b.rows.slice(skip));
        a.rowHeights.push(...b.rowHeights.slice(skip));
        p.zones[0].blocks.shift();
        continue;
      }
      // Страница в PDF кончилась заметно раньше — значит, там был разрыв
      const free = prevP.contentBottom - margins.bottom;
      if (free > prevP.height * 0.22 && prevP.width === p.width) b.pageBreakBefore = true;
    }

    // Первый абзац страницы в PDF стоит у верхнего поля, а в Word — после
    // предыдущей страницы: даём ему обычный для таких абзацев интервал
    const typical = new Map<number, number[]>();
    for (const p of pages)
      for (const z of p.zones)
        z.blocks.forEach((b, i) => {
          if (i > 0 && b.kind === "para" && b.spaceBefore > 0) typical.set(b.heading, [...(typical.get(b.heading) ?? []), b.spaceBefore]);
        });
    for (let k = 1; k < pages.length; k++) {
      const b = firstBlock(pages[k]);
      if (!b || b.pageBreakBefore || b.page !== pages[k].index) continue;
      if (b.kind === "para" && b.spaceBefore === 0) {
        const xs = (typical.get(b.heading) ?? []).sort((x, y) => x - y);
        if (xs.length) b.spaceBefore = xs[Math.floor(xs.length / 2)];
      }
    }

    const bodyFont = [...fontChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Times New Roman";
    const bodySize = [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
    // Номер страницы без текста колонтитула («5») — тоже в колонтитул
    const blob = await buildDocx(pages, { bodyFont, bodySize, margins, header: headerHF, footer: footerHF, title });

    let paragraphs = 0;
    let tables = 0;
    let images = 0;
    for (const p of pages) {
      if (p.design) paragraphs += p.design.frames.reduce((s, f) => s + f.paras.length, 0);
      for (const z of p.zones)
        for (const b of z.blocks) {
          if (b.kind === "para") paragraphs++;
          else if (b.kind === "table") tables++;
          else images++;
        }
    }
    opts.onProgress(total * 2, total * 2, "Готово");
    return { blob, pages: total, paragraphs, tables, images, scannedPages: scanned, designPages: designed };
  } finally {
    await doc.destroy();
  }
}

export { renderPage, PAGE_NO_RE, lineText };
