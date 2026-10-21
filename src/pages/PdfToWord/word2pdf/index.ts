// Word → PDF прямо в браузере.
//
// 1) Документ раскладывается docx-preview — с размерами страниц и полями из
//    .docx, шрифтами, цветами, таблицами, списками, колонтитулами. Поля
//    номера страницы (PAGE, NUMPAGES) заранее заменяются метками и потом
//    подставляются на каждой странице.
// 2) Страницы режутся здесь: блоки переносятся по одному; таблица делится
//    по строкам (с повтором строк-шапок, отмеченных в Word), длинный абзац —
//    по строкам текста; заголовок не остаётся последним на странице.
// 3) Каждая страница рисуется самим браузером (SVG foreignObject — точнее,
//    чем html2canvas; он остаётся запасным вариантом) и кладётся в PDF.
//    Поверх — невидимый текстовый слой: в PDF работают поиск и копирование.

import JSZip from "jszip";
import jsPDF from "jspdf";
import { renderAsync } from "docx-preview";
import fontUrl from "./LiberationSans-Regular.ttf?inline";

const PX2PT = 72 / 96;

// ── Подготовка .docx ──

/** Поля номера страницы → метки {PAGE} / {NUMPAGES}. */
function replacePageFields(xml: string): string {
  // Простые поля: <w:fldSimple w:instr=" PAGE ">…</w:fldSimple>
  xml = xml.replace(/<w:fldSimple\b[^>]*w:instr="\s*(PAGE|NUMPAGES|SECTIONPAGES)\b[^"]*"[^>]*>([\s\S]*?)<\/w:fldSimple>/g, (_m, kind: string) => {
    const tag = kind === "PAGE" ? "{PAGE}" : "{NUMPAGES}";
    return `<w:r><w:t>${tag}</w:t></w:r>`;
  });
  // Сложные поля: от fldChar begin до fldChar end (могут быть в разных
  // фрагментах текста — замена остаётся сбалансированной по тегам)
  return xml.replace(/<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*\/>([\s\S]*?)<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>/g, (m, inner: string) => {
    if (/w:fldCharType="begin"/.test(inner)) return m; // вложенные поля не трогаем
    const instr = [...inner.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g)].map((x) => x[1]).join("").trim();
    const kind = instr.match(/^(PAGE|NUMPAGES|SECTIONPAGES)\b/)?.[1];
    if (!kind) return m;
    return `<w:t>${kind === "PAGE" ? "{PAGE}" : "{NUMPAGES}"}</w:t>`;
  });
}

/** Сколько строк-шапок (повторяемых на каждой странице) у каждой таблицы — по порядку. */
function headerRowCounts(documentXml: string): number[] {
  const out: number[] = [];
  const doc = new DOMParser().parseFromString(documentXml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  for (const tbl of Array.from(doc.getElementsByTagNameNS(W, "tbl"))) {
    let n = 0;
    for (const tr of Array.from(tbl.children).filter((c) => c.localName === "tr")) {
      const pr = Array.from(tr.children).find((c) => c.localName === "trPr");
      const h = pr && Array.from(pr.children).find((c) => c.localName === "tblHeader");
      if (h && h.getAttributeNS(W, "val") !== "0" && h.getAttributeNS(W, "val") !== "false") n++;
      else break;
    }
    out.push(n);
  }
  return out;
}

async function prepareDocx(data: ArrayBuffer): Promise<{ docx: ArrayBuffer; headerRows: number[] }> {
  const zip = await JSZip.loadAsync(data);
  let headerRows: number[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (name === "word/document.xml") headerRows = headerRowCounts(xml);
    zip.file(name, replacePageFields(xml));
  }
  return { docx: await zip.generateAsync({ type: "arraybuffer" }), headerRows };
}

// ── Страницы ──

interface PageEl {
  el: HTMLElement;
  article: HTMLElement;
  /** Высота области текста, px. */
  avail: number;
}

const isHeading = (el: Element) => /\bdocx_(heading\d|title|subtitle)\b/i.test(el.className) || /^H[1-6]$/.test(el.tagName);

function px(v: string): number {
  return parseFloat(v) || 0;
}

/** Последняя строка, которая помещается в `limit` (px от верха статьи): символ, с которого начинать перенос. */
function splitPoint(block: HTMLElement, artTop: number, limit: number): { node: Text; offset: number } | null {
  const D = block.ownerDocument;
  const walker = D.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = D.createRange();
  let first: { node: Text; offset: number } | null = null;
  let lastTop = -Infinity;
  let firstLine = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) continue;
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect();
      if (!r.height) continue;
      if (r.top > lastTop + 1) {
        // Новая строка
        if (!firstLine && r.bottom - artTop > limit) {
          first = { node: n, offset: i };
          return first;
        }
        firstLine = false;
        lastTop = r.top;
      }
    }
  }
  return null;
}

/** Разрезать абзац: всё начиная с точки уходит в новый элемент. */
function splitParagraph(block: HTMLElement, at: { node: Text; offset: number }): HTMLElement {
  const range = block.ownerDocument.createRange();
  range.setStart(at.node, at.offset);
  range.setEndAfter(block.lastChild!);
  const rest = block.cloneNode(false) as HTMLElement;
  rest.appendChild(range.extractContents());
  rest.style.textIndent = "0";
  rest.style.marginTop = "0";
  rest.style.paddingTop = "0";
  // Последняя строка первой части — не «последняя строка абзаца»: при
  // выравнивании по ширине она тоже растягивается
  if (block.ownerDocument.defaultView!.getComputedStyle(block).textAlign === "justify") block.style.textAlignLast = "justify";
  block.style.marginBottom = "0";
  block.style.paddingBottom = "0";
  // Маркер списка не повторяем во второй части
  rest.classList.forEach((c) => {
    if (/^docx-num-/.test(c)) rest.classList.remove(c);
  });
  rest.style.listStyle = "none";
  return rest;
}

/** Разрезать таблицу по строкам; вторая часть получает копию строк-шапок. */
function splitTable(table: HTMLTableElement, artTop: number, limit: number, headerRows: number): HTMLTableElement | null {
  const rows = Array.from(table.rows);
  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getBoundingClientRect().bottom - artTop <= limit) k = i;
    else break;
  }
  if (k < headerRows || k >= rows.length - 1) return null;
  const rest = table.cloneNode(false) as HTMLTableElement;
  const colgroup = table.querySelector(":scope > colgroup");
  if (colgroup) rest.appendChild(colgroup.cloneNode(true));
  const body = rows[0].parentElement === table ? rest : rest.appendChild(rows[0].parentElement!.cloneNode(false));
  for (let i = 0; i < headerRows; i++) body.appendChild(rows[i].cloneNode(true));
  for (let i = k + 1; i < rows.length; i++) body.appendChild(rows[i]);
  rest.dataset.headerRows = String(headerRows);
  return rest;
}

function paginate(stage: HTMLElement, sections: HTMLElement[], headerRowsQueue: number[]): PageEl[] {
  const pages: PageEl[] = [];
  let lastHeader: Element | null = null;
  let lastFooter: Element | null = null;
  // Номера таблиц по порядку — для строк-шапок
  const allTables = sections.flatMap((s) => Array.from(s.querySelectorAll("table")));
  allTables.forEach((t, i) => (t.dataset.headerRows = String(headerRowsQueue[i] ?? 0)));

  for (const sec of sections) {
    const cs = sec.ownerDocument.defaultView!.getComputedStyle(sec);
    const header: Element | null = sec.querySelector(":scope > header") ?? lastHeader;
    const footer: Element | null = sec.querySelector(":scope > footer") ?? lastFooter;
    // Колонтитулы наследуются от предыдущего раздела, как в Word
    lastHeader = header;
    lastFooter = footer;
    const minH = px(sec.style.minHeight) * (96 / 72) || px(cs.minHeight);
    // Небольшой запас: отрисовка через SVG может дать строки на долю пикселя выше
    const avail = minH - px(cs.paddingTop) - px(cs.paddingBottom) - Math.max(6, minH * 0.012);
    const blocks: HTMLElement[] = [];
    for (const art of Array.from(sec.querySelectorAll(":scope > article"))) blocks.push(...(Array.from(art.children) as HTMLElement[]));

    const newPage = (): PageEl => {
      const el = sec.cloneNode(false) as HTMLElement;
      el.style.height = `${minH}px`;
      el.style.minHeight = `${minH}px`;
      el.style.overflow = "hidden";
      if (header) el.appendChild(header.cloneNode(true));
      const article = sec.ownerDocument.createElement("article");
      el.appendChild(article);
      if (footer) {
        const f = footer.cloneNode(true) as HTMLElement;
        // Нижний колонтитул — у нижнего края, независимо от высоты текста
        f.style.position = "absolute";
        f.style.left = cs.paddingLeft;
        f.style.right = cs.paddingRight;
        f.style.bottom = "0";
        f.style.margin = "0";
        f.style.paddingBottom = `${Math.max(12, px(cs.paddingBottom) * 0.5)}px`;
        el.style.position = "relative";
        el.appendChild(f);
      }
      stage.appendChild(el);
      const p = { el, article, avail };
      pages.push(p);
      return p;
    };

    let page = newPage();
    const fits = () => page.article.getBoundingClientRect().height <= avail + 0.5;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      page.article.appendChild(b);
      if (fits()) continue;
      const artTop = page.article.getBoundingClientRect().top;
      const blockTop = b.getBoundingClientRect().top - artTop;
      const room = avail - blockTop;
      let rest: HTMLElement | null = null;
      if (b.tagName === "TABLE" && room > 30) rest = splitTable(b as HTMLTableElement, artTop, avail, Number(b.dataset.headerRows ?? 0));
      else if (room > 20 && b.textContent && b.textContent.trim().length > 40 && !b.querySelector("img, table, svg")) {
        const at = splitPoint(b, artTop, avail);
        if (at) rest = splitParagraph(b, at);
      }
      if (rest) {
        // Первая часть осталась здесь, остаток — на следующую страницу
        blocks.splice(i + 1, 0, rest);
        page = newPage();
        continue;
      }
      // Блок целиком — на новую страницу (если страница не пустая)
      if (page.article.children.length > 1) {
        page.article.removeChild(b);
        const moved: HTMLElement[] = [];
        // Заголовок не оставляем последним на странице
        const last = page.article.lastElementChild as HTMLElement | null;
        if (last && isHeading(last) && page.article.children.length > 1) {
          page.article.removeChild(last);
          moved.push(last);
        }
        page = newPage();
        for (const m of moved) page.article.appendChild(m);
        i--; // этот блок ещё раз — уже на новой странице (там его можно и разрезать)
      } else {
        // Блок больше страницы и не режется — уменьшаем картинки, остальное как есть
        for (const img of Array.from(b.querySelectorAll("img"))) {
          const k = avail / Math.max(1, b.getBoundingClientRect().height);
          img.style.width = `${img.getBoundingClientRect().width * k}px`;
          img.style.height = "auto";
        }
        page = newPage();
      }
    }
    // Пустая последняя страница раздела не нужна
    if (!page.article.children.length && pages.length > 1) {
      page.el.remove();
      pages.pop();
    }
  }
  return pages;
}

// ── Отрисовка страницы ──

function cssText(styleRoot: HTMLElement): string {
  return Array.from(styleRoot.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

async function rasterize(page: HTMLElement, css: string, scale: number): Promise<HTMLCanvasElement> {
  const r = page.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const clone = page.cloneNode(true) as HTMLElement;
    clone.style.margin = "0";
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" class="docx-wrapper-fo"><style>${css.replace(/</g, "\\3C ")}</style>${xhtml}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0);
    ctx.getImageData(0, 0, 1, 1); // проверка: холст не «испорчен» (Safari)
    return canvas;
  } catch {
    // Запасной путь — html2canvas
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(page, {
      window: page.ownerDocument.defaultView ?? undefined, scale, backgroundColor: "#ffffff", logging: false, useCORS: true } as Parameters<typeof html2canvas>[1]);
  }
}

// ── Текстовый слой ──

interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

function pageWords(page: HTMLElement): Word[] {
  const D = page.ownerDocument;
  const origin = page.getBoundingClientRect();
  const out: Word[] = [];
  const walker = D.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const range = D.createRange();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const parent = n.parentElement;
    if (!parent || !n.data.trim()) continue;
    const st = D.defaultView!.getComputedStyle(parent);
    if (st.visibility === "hidden" || st.display === "none") continue;
    const size = px(st.fontSize);
    for (const m of n.data.matchAll(/\S+/g)) {
      range.setStart(n, m.index!);
      range.setEnd(n, m.index! + m[0].length);
      const rects = Array.from(range.getClientRects());
      if (!rects.length) continue;
      const r0 = rects[0];
      const rl = rects[rects.length - 1];
      // Слово целиком на одной строке (переносы с дефисом — редкость)
      out.push({
        text: m[0],
        x: (r0.left - origin.left) * PX2PT,
        y: (r0.bottom - origin.top - size * 0.22) * PX2PT,
        w: (rl.right - r0.left) * PX2PT,
        size: size * PX2PT,
      });
    }
  }
  return out;
}

// ── Всё вместе ──

export async function convertDocxToPdf(file: File, onProgress: (p: number, stage: string) => void): Promise<{ blob: Blob; pageCount: number }> {
  onProgress(3, "Чтение Word…");
  const { docx, headerRows } = await prepareDocx(await file.arrayBuffer());

  // Раскладка — в отдельном iframe: без стилей приложения (шрифт, интервалы
  // body), иначе страницы, измеренные здесь, отрисовались бы иначе
  const host = document.createElement("iframe");
  host.style.cssText = "position:fixed;left:-30000px;top:0;width:3000px;height:4000px;border:0;pointer-events:none;";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  const fdoc = host.contentDocument!;
  fdoc.open();
  fdoc.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff"></body></html>');
  fdoc.close();
  const styleBox = fdoc.createElement("div");
  const body = fdoc.createElement("div");
  fdoc.body.append(styleBox, body);
  try {
    onProgress(10, "Разметка документа…");
    await renderAsync(docx, body, styleBox, {
      className: "docx",
      inWrapper: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    });
    // Ждём шрифты и картинки
    await fdoc.fonts?.ready;
    await Promise.all(
      Array.from(body.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => undefined))),
    );

    onProgress(20, "Разбивка на страницы…");
    const sections = Array.from(body.querySelectorAll(":scope > section.docx")) as HTMLElement[];
    if (!sections.length) throw new Error("Не удалось прочитать документ Word.");
    const stage = fdoc.createElement("div");
    fdoc.body.appendChild(stage);
    const pages = paginate(stage, sections, headerRows);
    for (const s of sections) s.remove();

    // Номера страниц в колонтитулах
    const total = pages.length;
    pages.forEach((p, i) => {
      const walker = fdoc.createTreeWalker(p.el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null)
        if (n.data.includes("{")) n.data = n.data.replace(/\{PAGE\}/g, String(i + 1)).replace(/\{NUMPAGES\}/g, String(total));
    });

    const css = cssText(styleBox);
    let pdf: jsPDF | null = null;
    const fontB64 = fontUrl.slice(fontUrl.indexOf(",") + 1);
    for (let i = 0; i < pages.length; i++) {
      onProgress(25 + (70 * i) / pages.length, `Страница ${i + 1} из ${pages.length}`);
      const p = pages[i];
      const r = p.el.getBoundingClientRect();
      const wPt = r.width * PX2PT;
      const hPt = r.height * PX2PT;
      const orientation = wPt > hPt ? "landscape" : "portrait";
      if (!pdf) {
        pdf = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation, compress: true });
        pdf.addFileToVFS("LiberationSans-Regular.ttf", fontB64);
        pdf.addFont("LiberationSans-Regular.ttf", "LiberationSans", "normal");
      } else pdf.addPage([wPt, hPt], orientation);
      const canvas = await rasterize(p.el, css, 2.2);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, wPt, hPt, undefined, "FAST");
      canvas.width = 0;
      // Невидимый текст — для поиска и копирования
      pdf.setFont("LiberationSans", "normal");
      for (const wd of pageWords(p.el)) {
        if (wd.size < 1) continue;
        pdf.setFontSize(wd.size);
        const natural = pdf.getTextWidth(wd.text);
        const hs = natural > 0 ? Math.max(10, Math.min(400, (wd.w / natural) * 100)) : 100;
        pdf.text(wd.text, wd.x, wd.y, { renderingMode: "invisible", horizontalScale: hs / 100 } as Parameters<jsPDF["text"]>[3]);
      }
      await new Promise((res) => setTimeout(res, 0));
    }
    onProgress(100, "Готово");
    return { blob: pdf!.output("blob"), pageCount: pages.length };
  } finally {
    if (!(globalThis as { __w2pKeep?: boolean }).__w2pKeep) host.remove();
  }
}
