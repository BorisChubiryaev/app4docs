// pages/PdfToWord/PdfToWord.tsx
import React, { useState, useRef, useCallback } from "react";
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  ImageRun,
  PageBreak,
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";

import { PdfToWordInstructionsModal } from "./components/PdfToWordInstructionsModal";

import PageShell from "../../components/PageShell";
import "./PdfToWord.css";

import pdfWorkerContent from "pdfjs-dist/build/pdf.worker.mjs?raw";
const workerBlob = new Blob([pdfWorkerContent], {
  type: "application/javascript",
});
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

// ==================== ТИПЫ ====================

type ConvertMode = "pdf-to-word" | "word-to-pdf";
type ImageMode = "extract" | "render" | "none";
type FileStatus = "pending" | "converting" | "done" | "error";

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  stage: string;
  resultBlob: Blob | null;
  resultSize: number;
  errorMessage: string;
  pageCount: number;
  extraInfo: string;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  isBold: boolean;
  isItalic: boolean;
}
interface TextLine {
  y: number;
  items: TextItem[];
  fontSize: number;
  minX: number;
  maxX: number;
}
interface TextParagraph {
  lines: TextLine[];
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  isListItem: boolean;
  listMarker: string;
  indentLevel: number;
}
interface ExtractedImage {
  data: Uint8Array;
  width: number;
  height: number;
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
}
interface PageDimensions {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  contentWidth: number;
}
interface PageContent {
  paragraphs: TextParagraph[];
  images: ExtractedImage[];
  pageDims: PageDimensions;
}

// ==================== ОБЩИЕ УТИЛИТЫ ====================

const genId = () =>
  Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pluralFiles(n: number): string {
  if (n === 1) return "файл";
  if (n >= 2 && n <= 4) return "файла";
  return "файлов";
}

// ==================== PDF → WORD УТИЛИТЫ ====================

function detectBold(fn: string): boolean {
  const l = fn.toLowerCase();
  return l.includes("bold") || l.includes("black") || l.includes("heavy");
}
function detectItalic(fn: string): boolean {
  const l = fn.toLowerCase();
  return l.includes("italic") || l.includes("oblique");
}
function getFontSize(t: number[], h: number): number {
  let s = Math.max(Math.abs(t[3]), Math.abs(t[0]));
  if (s < 1 && h > 0) s = h;
  if (s < 4) s = 12;
  return Math.round(s * 10) / 10;
}

async function extractTextItems(page: pdfjs.PDFPageProxy): Promise<TextItem[]> {
  const tc = await page.getTextContent();
  return (tc.items as any[])
    .filter((i) => i.str || i.str === " ")
    .map((i) => ({
      str: i.str,
      x: Math.round(i.transform[4] * 100) / 100,
      y: Math.round(i.transform[5] * 100) / 100,
      width: Math.round((i.width || 0) * 100) / 100,
      height: i.height || getFontSize(i.transform, i.height),
      fontSize: getFontSize(i.transform, i.height),
      fontName: i.fontName || "",
      isBold: detectBold(i.fontName || ""),
      isItalic: detectItalic(i.fontName || ""),
    }));
}

function groupIntoLines(items: TextItem[]): TextLine[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const item of sorted) {
    const tol = Math.max(item.fontSize * 0.4, 2);
    const m = lines.find((l) => Math.abs(l.y - item.y) < tol);
    if (m) {
      m.items.push(item);
      m.y = m.items.reduce((s, i) => s + i.y, 0) / m.items.length;
    } else
      lines.push({
        y: item.y,
        items: [item],
        fontSize: item.fontSize,
        minX: item.x,
        maxX: item.x + item.width,
      });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.minX = Math.min(...l.items.map((i) => i.x));
    l.maxX = Math.max(...l.items.map((i) => i.x + i.width));
    l.fontSize = modeNum(l.items.map((i) => i.fontSize));
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

function buildLineText(line: TextLine): { runs: TextItem[]; text: string } {
  if (!line.items.length) return { runs: [], text: "" };
  const result: TextItem[] = [];
  for (let i = 0; i < line.items.length; i++) {
    const cur = line.items[i];
    if (i > 0) {
      const prev = line.items[i - 1];
      const gap = cur.x - (prev.x + prev.width);
      const sw = cur.fontSize * 0.25;
      if (gap > sw) {
        const n = Math.max(1, Math.round(gap / (sw * 1.5)));
        result.push({
          ...cur,
          str: n > 3 ? "\t" : " ".repeat(n),
          isBold: false,
          isItalic: false,
        });
      } else if (
        gap > 0.5 &&
        !cur.str.startsWith(" ") &&
        !prev.str.endsWith(" ")
      ) {
        result.push({ ...cur, str: " ", isBold: false, isItalic: false });
      }
    }
    result.push(cur);
  }
  return { runs: result, text: result.map((r) => r.str).join("") };
}

function detectPageDims(
  lines: TextLine[],
  vp: { width: number; height: number },
): PageDimensions {
  if (!lines.length)
    return {
      width: vp.width,
      height: vp.height,
      marginLeft: 72,
      marginRight: 72,
      contentWidth: vp.width - 144,
    };
  const minX = Math.min(...lines.map((l) => l.minX));
  const maxX = Math.max(...lines.map((l) => l.maxX));
  return {
    width: vp.width,
    height: vp.height,
    marginLeft: Math.max(0, minX),
    marginRight: Math.max(0, vp.width - maxX),
    contentWidth: maxX - minX,
  };
}

function detectAlignment(
  line: TextLine,
  pd: PageDimensions,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  const lc = (line.minX + line.maxX) / 2,
    pc = pd.width / 2;
  const lm = line.minX - pd.marginLeft,
    rm = pd.width - pd.marginRight - line.maxX;
  if (Math.abs(lc - pc) < pd.contentWidth * 0.05 && lm > 20 && rm > 20)
    return AlignmentType.CENTER;
  if (rm < 10 && lm > 50) return AlignmentType.RIGHT;
  if ((line.maxX - line.minX) / pd.contentWidth > 0.9)
    return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function detectListItem(text: string) {
  for (const p of [/^[\s]*([•●○◦▪▫–—-])\s+/, /^[\s]*([*+])\s+/]) {
    const m = text.match(p);
    if (m) return { isListItem: true, marker: m[1] };
  }
  for (const p of [/^[\s]*(\d{1,3})[.)]\s+/, /^[\s]*([a-zа-яё])[.)]\s+/i]) {
    const m = text.match(p);
    if (m) return { isListItem: true, marker: m[1] };
  }
  return { isListItem: false, marker: "" };
}

function detectIndent(line: TextLine, pd: PageDimensions): number {
  const indent = line.minX - pd.marginLeft;
  return indent < 15 ? 0 : Math.min(Math.floor(indent / 36), 5);
}

function modeNum(arr: number[]): number {
  if (!arr.length) return 12;
  const c = new Map<number, number>();
  let mc = 0,
    mv = arr[0];
  for (const v of arr) {
    const r = Math.round(v),
      n = (c.get(r) || 0) + 1;
    c.set(r, n);
    if (n > mc) {
      mc = n;
      mv = r;
    }
  }
  return mv;
}

function medianNum(arr: number[]): number {
  if (!arr.length) return 12;
  const s = [...arr].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function groupIntoParagraphs(
  lines: TextLine[],
  pd: PageDimensions,
): TextParagraph[] {
  if (!lines.length) return [];
  const paras: TextParagraph[] = [],
    bodyFS = modeNum(lines.map((l) => l.fontSize));
  const gaps: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const g = lines[i].y - lines[i + 1].y;
    if (g > 0 && g < 100) gaps.push(g);
  }
  const typGap = gaps.length > 0 ? medianNum(gaps) : bodyFS * 1.5;
  let cur: TextParagraph | null = null;
  for (const line of lines) {
    const { text } = buildLineText(line);
    if (!text.trim()) {
      if (cur) {
        paras.push(cur);
        cur = null;
      }
      continue;
    }
    const al = detectAlignment(line, pd),
      { isListItem, marker } = detectListItem(text);
    const il = detectIndent(line, pd);
    const isH =
      line.fontSize > bodyFS * 1.15 ||
      (line.items.every((i) => i.isBold) && line.items.length > 0);
    let startNew = !cur;
    if (cur && !startNew) {
      const prev = cur.lines[cur.lines.length - 1],
        vg = prev.y - line.y;
      if (
        vg > typGap * 1.8 ||
        Math.abs(line.fontSize - cur.fontSize) > 1.5 ||
        al !== cur.alignment ||
        isListItem ||
        cur.isListItem ||
        isH ||
        cur.fontSize > bodyFS * 1.15 ||
        cur.isBold ||
        (il > 0 && cur.indentLevel === 0 && line.minX - pd.marginLeft > 20)
      )
        startNew = true;
    }
    if (startNew) {
      if (cur) paras.push(cur);
      cur = {
        lines: [line],
        fontSize: line.fontSize,
        isBold: line.items.every((i) => i.isBold),
        isItalic: line.items.every((i) => i.isItalic),
        alignment: al,
        isListItem,
        listMarker: marker,
        indentLevel: il,
      };
    } else cur!.lines.push(line);
  }
  if (cur) paras.push(cur);
  return paras;
}

function getHeadingLevel(
  fs: number,
  bodyFS: number,
  bold: boolean,
): HeadingLevel | null {
  const r = fs / bodyFS;
  if (r >= 2.0) return HeadingLevel.HEADING_1;
  if (r >= 1.6) return HeadingLevel.HEADING_2;
  if (r >= 1.3) return HeadingLevel.HEADING_3;
  if (r >= 1.15 && bold) return HeadingLevel.HEADING_4;
  if (bold && r >= 1.05) return HeadingLevel.HEADING_5;
  return null;
}

function createTextRuns(para: TextParagraph, bodyFS: number): TextRun[] {
  const runs: TextRun[] = [],
    isH = getHeadingLevel(para.fontSize, bodyFS, para.isBold);
  for (let li = 0; li < para.lines.length; li++) {
    const { runs: lr } = buildLineText(para.lines[li]);
    if (li > 0)
      runs.push(
        new TextRun({
          text: " ",
          size: Math.round(para.fontSize * 2),
          font: "Calibri",
        }),
      );
    let grp: {
      text: string;
      isBold: boolean;
      isItalic: boolean;
      fontSize: number;
    } | null = null;
    for (const item of lr) {
      if (item.str === " " || item.str === "\t") {
        if (grp) grp.text += item.str;
        else
          grp = {
            text: item.str,
            isBold: item.isBold,
            isItalic: item.isItalic,
            fontSize: item.fontSize,
          };
        continue;
      }
      if (
        grp &&
        grp.isBold === item.isBold &&
        grp.isItalic === item.isItalic &&
        Math.abs(grp.fontSize - item.fontSize) < 1
      ) {
        grp.text += item.str;
      } else {
        if (grp?.text)
          runs.push(
            new TextRun({
              text: grp.text,
              bold: grp.isBold || undefined,
              italics: grp.isItalic || undefined,
              size: isH ? undefined : Math.round(grp.fontSize * 2),
              font: "Calibri",
            }),
          );
        grp = {
          text: item.str,
          isBold: item.isBold,
          isItalic: item.isItalic,
          fontSize: item.fontSize,
        };
      }
    }
    if (grp?.text)
      runs.push(
        new TextRun({
          text: grp.text,
          bold: grp.isBold || undefined,
          italics: grp.isItalic || undefined,
          size: isH ? undefined : Math.round(grp.fontSize * 2),
          font: "Calibri",
        }),
      );
  }
  return runs;
}

// ========== Изображения из PDF ==========

function getImgTimeout(
  page: pdfjs.PDFPageProxy,
  id: string,
  ms = 3000,
): Promise<any> {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    try {
      (page as any).objs.get(id, (d: any) => {
        clearTimeout(t);
        res(d || null);
      });
    } catch {
      clearTimeout(t);
      res(null);
    }
  });
}

async function imgToPng(d: any): Promise<Uint8Array | null> {
  try {
    const c = document.createElement("canvas"),
      ctx = c.getContext("2d");
    if (!ctx || !d.width || !d.height || d.width * d.height > 25_000_000)
      return null;
    c.width = d.width;
    c.height = d.height;
    if (d.bitmap) {
      ctx.drawImage(d.bitmap, 0, 0);
    } else if (d.data) {
      const px = d.data,
        k = d.kind;
      let rgba: Uint8ClampedArray;
      if (k === 3 || px.length === d.width * d.height * 4)
        rgba = new Uint8ClampedArray(px.buffer || px);
      else if (k === 2 || px.length === d.width * d.height * 3) {
        rgba = new Uint8ClampedArray(d.width * d.height * 4);
        for (let j = 0; j < d.width * d.height; j++) {
          rgba[j * 4] = px[j * 3];
          rgba[j * 4 + 1] = px[j * 3 + 1];
          rgba[j * 4 + 2] = px[j * 3 + 2];
          rgba[j * 4 + 3] = 255;
        }
      } else if (px.length === d.width * d.height) {
        rgba = new Uint8ClampedArray(d.width * d.height * 4);
        for (let j = 0; j < d.width * d.height; j++) {
          rgba[j * 4] = px[j];
          rgba[j * 4 + 1] = px[j];
          rgba[j * 4 + 2] = px[j];
          rgba[j * 4 + 3] = 255;
        }
      } else return null;
      ctx.putImageData(new ImageData(rgba, d.width, d.height), 0, 0);
    } else return null;
    const blob = await new Promise<Blob | null>((r) =>
      c.toBlob((b) => r(b), "image/png"),
    );
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function mulT(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function extractImagesFromPage(
  page: pdfjs.PDFPageProxy,
): Promise<ExtractedImage[]> {
  const imgs: ExtractedImage[] = [];
  try {
    const ol = await page.getOperatorList();
    const ts: number[][] = [];
    let ct = [1, 0, 0, 1, 0, 0];
    const ops: { name: string; transform: number[] }[] = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i],
        args = ol.argsArray[i];
      if (fn === pdfjs.OPS.save) ts.push([...ct]);
      else if (fn === pdfjs.OPS.restore && ts.length) ct = ts.pop()!;
      else if (fn === pdfjs.OPS.transform) ct = mulT(ct, args as number[]);
      else if (
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintJpegXObject
      ) {
        const dw = Math.abs(ct[0]),
          dh = Math.abs(ct[3]);
        if (dw >= 10 && dh >= 10)
          ops.push({ name: args[0] as string, transform: [...ct] });
      }
    }
    const results = await Promise.allSettled(
      ops.slice(0, 50).map(async (op) => {
        const d = await getImgTimeout(page, op.name, 3000);
        if (!d) return null;
        const png = await imgToPng(d);
        if (!png) return null;
        return {
          data: png,
          width: d.width || Math.abs(op.transform[0]),
          height: d.height || Math.abs(op.transform[3]),
          x: op.transform[4],
          y: op.transform[5],
          displayWidth: Math.abs(op.transform[0]),
          displayHeight: Math.abs(op.transform[3]),
        } as ExtractedImage;
      }),
    );
    for (const r of results)
      if (r.status === "fulfilled" && r.value) imgs.push(r.value);
  } catch (e) {
    console.warn("Img extract err:", e);
  }
  return imgs;
}

async function renderPageAsImage(
  page: pdfjs.PDFPageProxy,
  scale = 2.0,
): Promise<ExtractedImage | null> {
  try {
    const vp = page.getViewport({ scale }),
      c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((r) =>
      c.toBlob((b) => r(b), "image/png", 0.92),
    );
    if (!blob) return null;
    const ovp = page.getViewport({ scale: 1.0 });
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width: vp.width,
      height: vp.height,
      x: 0,
      y: ovp.height,
      displayWidth: ovp.width,
      displayHeight: ovp.height,
    };
  } catch {
    return null;
  }
}

// ========== Сборка DOCX ==========

function createImgParagraph(img: ExtractedImage, maxW: number): Paragraph {
  let w = img.displayWidth,
    h = img.displayHeight;
  if (w > maxW) {
    h = h * (maxW / w);
    w = maxW;
  }
  w = Math.max(Math.min(w, 750), 20);
  h = Math.max(Math.min(h, 750), 20);
  if (h > 750) {
    w = w * (750 / h);
    h = 750;
  }
  return new Paragraph({
    children: [
      new ImageRun({
        data: img.data,
        transformation: { width: Math.round(w), height: Math.round(h) },
        type: "png",
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
  });
}

function mergeContent(
  paras: TextParagraph[],
  images: ExtractedImage[],
  bodyFS: number,
  pd: PageDimensions,
): Paragraph[] {
  const items: {
    y: number;
    type: "t" | "i";
    tp?: TextParagraph;
    img?: ExtractedImage;
  }[] = [];
  for (const p of paras)
    items.push({ y: p.lines.length > 0 ? p.lines[0].y : 0, type: "t", tp: p });
  for (const img of images)
    items.push({ y: img.y + img.displayHeight, type: "i", img });
  items.sort((a, b) => b.y - a.y);
  const result: Paragraph[] = [],
    maxW = pd.contentWidth || 500;
  for (const item of items) {
    if (item.type === "t" && item.tp) {
      const tr = createTextRuns(item.tp, bodyFS);
      if (!tr.length) continue;
      if (item.tp.isListItem && item.tp.listMarker)
        tr.unshift(
          new TextRun({
            text: item.tp.listMarker + "  ",
            size: Math.round(item.tp.fontSize * 2),
            font: "Calibri",
          }),
        );
      const hl = getHeadingLevel(item.tp.fontSize, bodyFS, item.tp.isBold);
      const ind = item.tp.indentLevel * convertInchesToTwip(0.5);
      const opts: any = {
        children: tr,
        alignment: item.tp.alignment,
        spacing: { after: hl ? 200 : 120, before: hl ? 240 : 0, line: 276 },
      };
      if (hl) opts.heading = hl;
      if (ind > 0) opts.indent = { left: ind };
      result.push(new Paragraph(opts));
    } else if (item.type === "i" && item.img)
      result.push(createImgParagraph(item.img, maxW));
  }
  return result;
}

// ========== Конвертация одного PDF в Word ==========

async function convertOnePdfToWord(
  file: File,
  imgMode: ImageMode,
  onProgress: (current: number, total: number, stage: string) => void,
): Promise<{ blob: Blob; pages: number; paragraphs: number; images: number }> {
  const ab = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: ab }).promise;
  const total = doc.numPages;
  const allFS: number[] = [],
    pagesData: PageContent[] = [];
  let totalImgs = 0;

  for (let i = 1; i <= total; i++) {
    onProgress(i, total, `Страница ${i}/${total}`);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1.0 });
    const ti = await extractTextItems(page);
    const lines = groupIntoLines(ti);
    const pd = detectPageDims(lines, { width: vp.width, height: vp.height });
    const paras = groupIntoParagraphs(lines, pd);
    for (const p of paras) for (const l of p.lines) allFS.push(l.fontSize);
    let images: ExtractedImage[] = [];
    if (imgMode === "extract") {
      try {
        images = await extractImagesFromPage(page);
        totalImgs += images.length;
      } catch {}
    } else if (imgMode === "render") {
      const r = await renderPageAsImage(page, 2.0);
      if (r) {
        images = [r];
        totalImgs++;
      }
    }
    pagesData.push({ paragraphs: paras, images, pageDims: pd });
    await new Promise((r) => setTimeout(r, 0));
  }

  const bodyFS = allFS.length > 0 ? modeNum(allFS) : 12;
  onProgress(total, total, "Сборка Word...");

  const allP: Paragraph[] = [];
  let totalP = 0;
  for (let i = 0; i < pagesData.length; i++) {
    const { paragraphs, images, pageDims } = pagesData[i];
    const dp = mergeContent(paragraphs, images, bodyFS, pageDims);
    allP.push(...dp);
    totalP += dp.length;
    if (i < pagesData.length - 1 && dp.length > 0)
      allP.push(new Paragraph({ children: [new PageBreak()] }));
  }
  if (!allP.length)
    allP.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "(Пустой документ)",
            italics: true,
            color: "999999",
          }),
        ],
      }),
    );

  const wordDoc = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: bodyFS * 2 } } },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: allP,
      },
    ],
  });
  const blob = await Packer.toBlob(wordDoc);
  return { blob, pages: total, paragraphs: totalP, images: totalImgs };
}

// ==================== WORD → PDF УТИЛИТЫ (ИСПРАВЛЕННЫЕ) ====================

async function wordToHtml(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer: ab },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "b => strong",
        "i => em",
        "u => u",
        "strike => s",
      ],
      convertImage: mammoth.images.imgElement((image) =>
        image
          .read("base64")
          .then((buf) => ({ src: `data:${image.contentType};base64,${buf}` })),
      ),
    },
  );
  return result.value;
}

/**
 * ИСПРАВЛЕННАЯ генерация PDF — рендерим постранично, не режем картинки
 */
async function htmlToPdf(
  html: string,
  onProgress?: (p: number) => void,
): Promise<{ blob: Blob; pageCount: number }> {
  // Размеры A4 в пикселях при 96 DPI
  const PAGE_WIDTH_PX = 595;
  const PAGE_HEIGHT_PX = 842;
  const MARGIN_PX = 50;
  const CONTENT_HEIGHT_PX = PAGE_HEIGHT_PX - MARGIN_PX * 2; // 742

  // 1. Создаём контейнер с фиксированной шириной A4
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH_PX}px;background:#fff;z-index:-9999;`;
  container.innerHTML = `
    <div id="__pdf_render_root" style="
      font-family:'Times New Roman','Calibri','Arial',serif;
      font-size:12pt;line-height:1.6;color:#000;background:#fff;
      width:${PAGE_WIDTH_PX}px;padding:${MARGIN_PX}px;
      box-sizing:border-box;word-wrap:break-word;
    ">
      <style>
        h1{font-size:22pt;font-weight:bold;margin:20px 0 10px;page-break-after:avoid}
        h2{font-size:17pt;font-weight:bold;margin:16px 0 8px;page-break-after:avoid}
        h3{font-size:14pt;font-weight:bold;margin:14px 0 6px;page-break-after:avoid}
        h4{font-size:12pt;font-weight:bold;margin:12px 0 4px;page-break-after:avoid}
        p{margin:0 0 8px;text-align:justify}
        ul,ol{margin:6px 0;padding-left:24px}
        li{margin:3px 0}
        table{border-collapse:collapse;width:100%;margin:10px 0}
        td,th{border:1px solid #333;padding:5px 7px;font-size:11pt}
        th{background:#f0f0f0;font-weight:bold}
        img{max-width:100%;height:auto;margin:6px 0;page-break-inside:avoid}
        strong,b{font-weight:bold}em,i{font-style:italic}
        u{text-decoration:underline}s{text-decoration:line-through}
        a{color:#0563C1;text-decoration:underline}
        blockquote{margin:10px 0;padding:6px 14px;border-left:3px solid #ccc;color:#555}
      </style>
      ${html}
    </div>
  `;
  document.body.appendChild(container);

  try {
    // Ждём загрузки картинок
    const imgs = container.querySelectorAll("img");
    if (imgs.length > 0) {
      await Promise.allSettled(
        Array.from(imgs).map(
          (img) =>
            new Promise<void>((r) => {
              if (img.complete) r();
              else {
                img.onload = () => r();
                img.onerror = () => r();
                setTimeout(r, 3000);
              }
            }),
        ),
      );
    }
    await new Promise((r) => setTimeout(r, 150));
    onProgress?.(5);

    // 2. Получаем все дочерние блоки верхнего уровня
    const root = container.querySelector("#__pdf_render_root") as HTMLElement;
    const children = Array.from(root.children) as HTMLElement[];

    // 3. Разбиваем блоки на страницы по высоте
    type PageBlocks = { startIdx: number; endIdx: number }; // [startIdx, endIdx)
    const pageBreaks: PageBlocks[] = [];
    let currentPageStart = 0;
    let accumulatedHeight = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const rect = child.getBoundingClientRect();
      const childH = rect.height;

      // Если один блок больше страницы — он займёт свою страницу
      if (childH > CONTENT_HEIGHT_PX) {
        if (i > currentPageStart) {
          pageBreaks.push({ startIdx: currentPageStart, endIdx: i });
        }
        pageBreaks.push({ startIdx: i, endIdx: i + 1 });
        currentPageStart = i + 1;
        accumulatedHeight = 0;
        continue;
      }

      if (accumulatedHeight + childH > CONTENT_HEIGHT_PX) {
        // Текущая страница заполнена — начинаем новую
        pageBreaks.push({ startIdx: currentPageStart, endIdx: i });
        currentPageStart = i;
        accumulatedHeight = childH;
      } else {
        accumulatedHeight += childH;
      }
    }
    // Последняя страница
    if (currentPageStart < children.length) {
      pageBreaks.push({ startIdx: currentPageStart, endIdx: children.length });
    }

    if (pageBreaks.length === 0) {
      pageBreaks.push({ startIdx: 0, endIdx: children.length });
    }

    onProgress?.(15);

    // 4. Рендерим каждую «страницу» отдельно
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = 210; // мм
    const pdfH = 297; // мм
    const scale = 2;

    for (let pageIdx = 0; pageIdx < pageBreaks.length; pageIdx++) {
      const { startIdx, endIdx } = pageBreaks[pageIdx];

      if (pageIdx > 0) pdf.addPage();

      // Создаём временный контейнер только для блоков этой страницы
      const pageContainer = document.createElement("div");
      pageContainer.style.cssText = `
        position:fixed;left:-9999px;top:0;
        width:${PAGE_WIDTH_PX}px;background:#fff;z-index:-9999;
        font-family:'Times New Roman','Calibri','Arial',serif;
        font-size:12pt;line-height:1.6;color:#000;
        padding:${MARGIN_PX}px;box-sizing:border-box;
      `;

      // Копируем стили
      const styleEl = root.querySelector("style");
      if (styleEl) pageContainer.appendChild(styleEl.cloneNode(true));

      // Копируем нужные блоки
      for (let i = startIdx; i < endIdx; i++) {
        pageContainer.appendChild(children[i].cloneNode(true));
      }

      document.body.appendChild(pageContainer);

      try {
        await new Promise((r) => setTimeout(r, 50));

        const canvas = await html2canvas(pageContainer, {
          scale,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#ffffff",
          logging: false,
          width: PAGE_WIDTH_PX,
          windowWidth: PAGE_WIDTH_PX,
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        const imgW = pdfW;
        const imgH = (canvas.height * pdfW) / canvas.width;

        // Центрируем по вертикали если контент меньше страницы
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, Math.min(imgH, pdfH));
      } finally {
        document.body.removeChild(pageContainer);
      }

      onProgress?.(15 + ((pageIdx + 1) / pageBreaks.length) * 80);
    }

    onProgress?.(100);
    return { blob: pdf.output("blob"), pageCount: pageBreaks.length };
  } finally {
    document.body.removeChild(container);
  }
}

// ========== Конвертация одного Word в PDF ==========

async function convertOneWordToPdf(
  file: File,
  onProgress: (progress: number, stage: string) => void,
): Promise<{ blob: Blob; pageCount: number }> {
  onProgress(5, "Чтение Word...");
  const html = await wordToHtml(file);
  onProgress(20, "Генерация PDF...");
  const result = await htmlToPdf(html, (p) => {
    onProgress(20 + p * 0.8, "Генерация PDF...");
  });
  return result;
}

// ==================== КОМПОНЕНТ ====================

const PdfToWord: React.FC = () => {
  const [mode, setMode] = useState<ConvertMode>("pdf-to-word");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [imageMode, setImageMode] = useState<ImageMode>("extract");
  const [error, setError] = useState("");
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptExt = mode === "pdf-to-word" ? ".pdf" : ".docx";
  const acceptLabel = mode === "pdf-to-word" ? "PDF" : "Word (.docx)";

  // ========== Файлы ==========

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const ext = mode === "pdf-to-word" ? "pdf" : "docx";
      const valid: FileItem[] = [];
      Array.from(newFiles).forEach((f) => {
        if (!f.name.toLowerCase().endsWith(`.${ext}`)) return;
        if (
          files.some((ef) => ef.file.name === f.name && ef.file.size === f.size)
        )
          return;
        valid.push({
          id: genId(),
          file: f,
          status: "pending",
          progress: 0,
          stage: "",
          resultBlob: null,
          resultSize: 0,
          errorMessage: "",
          pageCount: 0,
          extraInfo: "",
        });
      });
      if (valid.length) setFiles((prev) => [...prev, ...valid]);
      else if (newFiles.length > 0) setError(`Выберите ${acceptLabel} файлы`);
    },
    [files, mode],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));
  const clearAll = () => setFiles([]);

  const switchMode = (newMode: ConvertMode) => {
    setMode(newMode);
    setFiles([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ========== Конвертация ==========

  const updateFile = (id: string, updates: Partial<FileItem>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  };

  const convertSingle = async (item: FileItem) => {
    updateFile(item.id, {
      status: "converting",
      progress: 0,
      stage: "Запуск...",
    });

    try {
      if (mode === "pdf-to-word") {
        const result = await convertOnePdfToWord(
          item.file,
          imageMode,
          (cur, total, stage) => {
            updateFile(item.id, { progress: (cur / total) * 100, stage });
          },
        );
        updateFile(item.id, {
          status: "done",
          progress: 100,
          stage: "Готово",
          resultBlob: result.blob,
          resultSize: result.blob.size,
          pageCount: result.pages,
          extraInfo: `${result.paragraphs} абз., ${result.images} изобр.`,
        });
      } else {
        const result = await convertOneWordToPdf(item.file, (p, stage) => {
          updateFile(item.id, { progress: p, stage });
        });
        updateFile(item.id, {
          status: "done",
          progress: 100,
          stage: "Готово",
          resultBlob: result.blob,
          resultSize: result.blob.size,
          pageCount: result.pageCount,
          extraInfo: "",
        });
      }
    } catch (err: any) {
      console.error(`Error converting ${item.file.name}:`, err);
      updateFile(item.id, {
        status: "error",
        progress: 0,
        errorMessage: err.message || "Ошибка",
      });
    }
  };

  const convertAll = async () => {
    setIsConverting(true);
    setError("");
    const pending = files.filter(
      (f) => f.status === "pending" || f.status === "error",
    );
    for (const item of pending) {
      await convertSingle(item);
      await new Promise((r) => setTimeout(r, 200));
    }
    setIsConverting(false);
  };

  const retryFile = async (id: string) => {
    const item = files.find((f) => f.id === id);
    if (!item) return;
    updateFile(id, {
      status: "pending",
      progress: 0,
      errorMessage: "",
      stage: "",
    });
    setIsConverting(true);
    await convertSingle({
      ...item,
      status: "pending",
      progress: 0,
      errorMessage: "",
    });
    setIsConverting(false);
  };

  // ========== Скачивание ==========

  const downloadOne = (item: FileItem) => {
    if (!item.resultBlob) return;
    const ext = mode === "pdf-to-word" ? ".docx" : ".pdf";
    const removeExt = mode === "pdf-to-word" ? /\.pdf$/i : /\.docx?$/i;
    const name = item.file.name.replace(removeExt, ext);
    saveAs(item.resultBlob, name);
  };

  const downloadAll = async () => {
    const done = files.filter((f) => f.status === "done" && f.resultBlob);
    for (let i = 0; i < done.length; i++) {
      downloadOne(done[i]);
      if (i < done.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
  };

  // ========== Статистика ==========
  const total = files.length;
  const done = files.filter((f) => f.status === "done").length;
  const errors = files.filter((f) => f.status === "error").length;
  const pending = files.filter(
    (f) => f.status === "pending" || f.status === "converting",
  ).length;
  const hasPending = files.some(
    (f) => f.status === "pending" || f.status === "error",
  );

  return (
    <PageShell
      title="Конвертер документов"
      subtitle="PDF ↔ Word — конвертируйте в обе стороны, прямо в браузере"
      onShowInstructions={() => setIsInstructionsOpen(true)}
    >

        {/* Табы */}
        <div className="ds-tabs ds-tabs--fill">
          <button
            className={`ds-tab ${mode === "pdf-to-word" ? "ds-tab--active" : ""}`}
            onClick={() => switchMode("pdf-to-word")}
          >
            <span className="tab-label">PDF → Word</span>
          </button>
          <button
            className={`ds-tab ${mode === "word-to-pdf" ? "ds-tab--active" : ""}`}
            onClick={() => switchMode("word-to-pdf")}
          >
            <span className="tab-label">Word → PDF</span>
          </button>
        </div>

        <div className="converter-content">
          <div className="input-column">
            {/* Зона загрузки */}
            <div
              className={`glass-card upload-card ${isDragging ? "dragging" : ""}`}
            >
              <div className="upload-header">
                <div className="upload-icon">
                  <div className="icon-wrapper">
                    <span className="icon">
                      {mode === "pdf-to-word" ? "📄" : "📘"}
                    </span>
                    {total > 0 && <span className="status-icon">{total}</span>}
                  </div>
                </div>
                <div className="upload-info">
                  <h3>
                    {total === 0
                      ? `Загрузите ${acceptLabel} файлы`
                      : `${total} ${pluralFiles(total)}`}
                  </h3>
                  {total > 0 && (
                    <span className="file-details">
                      {formatSize(files.reduce((s, f) => s + f.file.size, 0))}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="upload-zone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <div className="upload-placeholder">
                  <span className="placeholder-icon">📂</span>
                  <p className="placeholder-text">
                    Перетащите {acceptExt} файлы или
                  </p>
                  <p className="placeholder-subtext">
                    Можно загрузить несколько файлов
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptExt}
                  multiple
                  onChange={handleFileInput}
                  className="file-input"
                  id="convFile"
                />
                <label htmlFor="convFile" className="glass-button primary">
                  Выбрать файлы
                </label>
              </div>
            </div>

            {/* Настройки (PDF → Word) */}
            {mode === "pdf-to-word" && (
              <div className="glass-card settings-card">
                <div className="settings-header">
                  <h3>🖼️ Изображения</h3>
                </div>
                <div className="mode-selector">
                  <button
                    className={`mode-option ${imageMode === "extract" ? "active" : ""}`}
                    onClick={() => setImageMode("extract")}
                  >
                    <span className="option-icon">🔍</span>
                    <div className="option-content">
                      <strong>Извлечь</strong>
                      <small>Отдельные картинки</small>
                    </div>
                  </button>
                  <button
                    className={`mode-option ${imageMode === "render" ? "active" : ""}`}
                    onClick={() => setImageMode("render")}
                  >
                    <span className="option-icon">📸</span>
                    <div className="option-content">
                      <strong>Снимок</strong>
                      <small>Страница целиком</small>
                    </div>
                  </button>
                  <button
                    className={`mode-option ${imageMode === "none" ? "active" : ""}`}
                    onClick={() => setImageMode("none")}
                  >
                    <span className="option-icon">📝</span>
                    <div className="option-content">
                      <strong>Без картинок</strong>
                      <small>Только текст</small>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Список файлов */}
            {files.length > 0 && (
              <div className="glass-card files-list-card">
                <div className="files-list-header">
                  <h3>📋 Файлы ({files.length})</h3>
                  <div className="files-list-actions">
                    {done > 0 && (
                      <button
                        onClick={downloadAll}
                        className="glass-button small primary"
                      >
                        📥 Скачать все
                      </button>
                    )}
                    <button
                      onClick={clearAll}
                      className="glass-button small secondary"
                    >
                      🗑️ Очистить
                    </button>
                  </div>
                </div>

                <div className="files-list">
                  {files.map((item) => (
                    <div key={item.id} className={`file-row ${item.status}`}>
                      <div className="file-row-icon">
                        {item.status === "pending" &&
                          (mode === "pdf-to-word" ? "📄" : "📘")}
                        {item.status === "converting" && (
                          <span className="file-spinner">⏳</span>
                        )}
                        {item.status === "done" && "✅"}
                        {item.status === "error" && "❌"}
                      </div>
                      <div className="file-row-info">
                        <span className="file-row-name">{item.file.name}</span>
                        <div className="file-row-details">
                          <span className="file-row-size">
                            {formatSize(item.file.size)}
                          </span>
                          {item.status === "done" && (
                            <>
                              <span className="file-row-arrow">→</span>
                              <span className="file-row-result-size">
                                {formatSize(item.resultSize)}
                              </span>
                              <span className="file-row-pages">
                                {item.pageCount} стр.
                              </span>
                              {item.extraInfo && (
                                <span className="file-row-extra">
                                  {item.extraInfo}
                                </span>
                              )}
                            </>
                          )}
                          {item.status === "converting" && (
                            <span className="file-row-progress">
                              {Math.round(item.progress)}% — {item.stage}
                            </span>
                          )}
                          {item.status === "error" && (
                            <span className="file-row-error">
                              {item.errorMessage}
                            </span>
                          )}
                        </div>
                        {item.status === "converting" && (
                          <div className="file-row-progress-bar">
                            <div
                              className="file-row-progress-fill"
                              style={{ width: `${item.progress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                      <div className="file-row-actions">
                        {item.status === "done" && (
                          <button
                            onClick={() => downloadOne(item)}
                            className="file-action-btn download"
                            title="Скачать"
                          >
                            📥
                          </button>
                        )}
                        {item.status === "error" && (
                          <button
                            onClick={() => retryFile(item.id)}
                            className="file-action-btn retry"
                            title="Повторить"
                            disabled={isConverting}
                          >
                            🔄
                          </button>
                        )}
                        <button
                          onClick={() => removeFile(item.id)}
                          className="file-action-btn remove"
                          title="Удалить"
                          disabled={item.status === "converting"}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {(done > 0 || errors > 0) && (
                  <div className="files-summary">
                    {done > 0 && (
                      <span className="summary-done">✅ {done} готово</span>
                    )}
                    {errors > 0 && (
                      <span className="summary-error">❌ {errors} ошибок</span>
                    )}
                    {pending > 0 && (
                      <span className="summary-pending">
                        ⏳ {pending} в очереди
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Кнопка */}
            <button
              onClick={convertAll}
              disabled={!hasPending || isConverting || total === 0}
              className={`glass-button compress-button ${isConverting ? "loading" : ""} ${!hasPending || total === 0 ? "disabled" : "glass-card"}`}
            >
              {isConverting ? (
                <>
                  <span className="spinner"></span>
                  <span className="button-text">
                    Конвертация... {done}/{total}
                  </span>
                </>
              ) : (
                <>
                  <span className="button-icon">🔄</span>
                  <span className="button-text">
                    {total === 0
                      ? `Загрузите ${acceptLabel} файлы`
                      : !hasPending
                        ? "Все обработаны"
                        : `Конвертировать ${files.filter((f) => f.status === "pending" || f.status === "error").length} ${pluralFiles(files.filter((f) => f.status === "pending" || f.status === "error").length)}`}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Правая колонка */}
          <div className="output-column">
            <div className="glass-card info-card">
              <h3>
                {mode === "pdf-to-word" ? "📚 PDF → Word" : "📚 Word → PDF"}
              </h3>
              <div className="info-content">
                {mode === "pdf-to-word" ? (
                  <>
                    <div className="info-item">
                      <span className="info-icon">✅</span>
                      <div className="info-text">
                        <strong>Текст с форматированием</strong>
                        <p>Жирный, курсив, заголовки, списки, отступы</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">🖼️</span>
                      <div className="info-text">
                        <strong>Изображения</strong>
                        <p>3 режима: извлечь, снимок, без картинок</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">📦</span>
                      <div className="info-text">
                        <strong>Пакетная обработка</strong>
                        <p>Загрузите несколько PDF файлов сразу</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="info-item">
                      <span className="info-icon">📘</span>
                      <div className="info-text">
                        <strong>Чтение .docx</strong>
                        <p>Текст, стили, таблицы, изображения</p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">📑</span>
                      <div className="info-text">
                        <strong>Умное разбиение</strong>
                        <p>
                          Страницы разбиваются по блокам — картинки не
                          обрезаются
                        </p>
                      </div>
                    </div>
                    <div className="info-item">
                      <span className="info-icon">📦</span>
                      <div className="info-text">
                        <strong>Пакетная обработка</strong>
                        <p>Загрузите несколько Word файлов сразу</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="info-item">
                  <span className="info-icon">⚡</span>
                  <div className="info-text">
                    <strong>Локально</strong>
                    <p>Без серверов, без интернета</p>
                  </div>
                </div>
                <div className="security-note">
                  <span className="security-icon">🔒</span>
                  <span>Файлы не покидают ваш компьютер</span>
                </div>
              </div>
            </div>

            <div className="glass-card warning-card">
              <div className="warning-banner">
                <span className="warning-icon">⚠️</span>
                <div className="warning-text">
                  {mode === "pdf-to-word" ? (
                    <>
                      <strong>Ограничения:</strong> Таблицы, колонки, формы не
                      переносятся. Отсканированные PDF требуют OCR.
                    </>
                  ) : (
                    <>
                      <strong>Поддержка:</strong> .docx (Word 2007+). SmartArt и
                      фигуры отображаются упрощённо.
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="error-alert">
            <div className="alert-content">
              <span className="alert-icon">⚠️</span>
              <div className="alert-text">
                <strong>Ошибка:</strong> {error}
              </div>
              <button onClick={() => setError("")} className="alert-close">
                ✕
              </button>
            </div>
          </div>
        )}
      <PdfToWordInstructionsModal
        isOpen={isInstructionsOpen}
        onClose={() => setIsInstructionsOpen(false)}
      />
    </PageShell>
  );
};

export default PdfToWord;
