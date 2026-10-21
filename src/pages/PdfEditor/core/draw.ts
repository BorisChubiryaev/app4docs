// Рисование поверх страницы: аннотации редактора, невидимый текст,
// номера страниц и водяной знак. Всё — в системе отображаемой страницы
// (см. geometry.ts), текст — настоящим шрифтом, а не картинкой.
import {
  beginText,
  closePath,
  degrees,
  endText,
  fill,
  lineTo,
  moveTo,
  PDFHexString,
  rgb,
  setCharacterSqueeze,
  setFillingColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  LineCapStyle,
  LineJoinStyle,
  TextRenderingMode,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { Annotation } from "../components/PageAnnotator";
import type { Fonts } from "./fonts";
import { inFrame, type Frame } from "./geometry";
import type { PageNumbersOptions, TextWord, WatermarkOptions } from "./types";

export const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  );
};

async function toPng(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function embedImage(doc: PDFDocument, dataUrl: string) {
  try {
    if (dataUrl.startsWith("data:image/png")) return await doc.embedPng(dataUrl);
    if (/^data:image\/jpe?g/.test(dataUrl)) return await doc.embedJpg(dataUrl);
  } catch {
    /* ниже — через canvas */
  }
  return doc.embedPng(await toPng(dataUrl));
}

/** Разбить текст на строки по ширине (переносы по словам, длинные слова — по буквам). */
export function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  for (const para of (text || "").split("\n")) {
    let cur = "";
    for (const word of para.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (width(test) <= maxW || !cur) {
        cur = test;
      } else {
        out.push(cur);
        cur = word;
      }
      // слово длиннее строки — режем по буквам
      while (width(cur) > maxW && cur.length > 1) {
        let k = cur.length - 1;
        while (k > 1 && width(cur.slice(0, k)) > maxW) k--;
        out.push(cur.slice(0, k));
        cur = cur.slice(k);
      }
    }
    out.push(cur);
  }
  return out;
}

const polyline = (page: PDFPage, pts: { x: number; y: number }[], color: string, w: number) => {
  if (pts.length < 2) return;
  const c = hexToRgb(color);
  page.pushOperators(
    setStrokingColor(c),
    setLineWidth(w),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    moveTo(pts[0].x, pts[0].y),
    ...pts.slice(1).map((p) => lineTo(p.x, p.y)),
    stroke(),
  );
};

/**
 * Аннотации редактора. Координаты аннотаций — доли страницы, отсчёт от
 * левого верхнего угла (как в редакторе).
 */
export async function drawAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  frame: Frame,
  anns: Annotation[],
  fonts: Fonts,
) {
  const { W, H, m } = frame;
  const X = (x: number) => x * W;
  const Y = (y: number) => H - y * H;
  // Картинки и шрифты встраиваем до того, как открыть кадр рисования
  const images = new Map<string, Awaited<ReturnType<typeof embedImage>>>();
  for (const a of anns) {
    if (a.type === "image" && !images.has(a.dataUrl)) {
      try {
        images.set(a.dataUrl, await embedImage(doc, a.dataUrl));
      } catch (err) {
        console.warn("Не удалось вставить картинку-аннотацию:", err);
      }
    }
  }
  const font = anns.some((a) => a.type === "text") ? await fonts.regular() : null;

  inFrame(page, m, () => {
    for (const a of anns) {
      if (a.type === "highlight") {
        page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w * W, height: a.h * H, color: hexToRgb(a.color), opacity: 0.35 });
      } else if (a.type === "redact") {
        page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w * W, height: a.h * H, color: rgb(0, 0, 0) });
      } else if (a.type === "rect") {
        page.drawRectangle({
          x: X(a.x),
          y: Y(a.y + a.h),
          width: a.w * W,
          height: a.h * H,
          borderColor: hexToRgb(a.color),
          borderWidth: a.strokeWidth,
        });
      } else if (a.type === "line" || a.type === "arrow") {
        const s = { x: X(a.x1), y: Y(a.y1) };
        const e = { x: X(a.x2), y: Y(a.y2) };
        if (a.type === "line") {
          polyline(page, [s, e], a.color, a.strokeWidth);
          continue;
        }
        // Наконечник как в редакторе: треугольник 8×6 толщин линии
        const ang = Math.atan2(e.y - s.y, e.x - s.x);
        const len = Math.min(8 * a.strokeWidth, Math.hypot(e.x - s.x, e.y - s.y));
        const half = 3 * a.strokeWidth;
        const bx = e.x - len * Math.cos(ang);
        const by = e.y - len * Math.sin(ang);
        polyline(page, [s, { x: bx, y: by }], a.color, a.strokeWidth);
        const nx = -Math.sin(ang) * half;
        const ny = Math.cos(ang) * half;
        page.pushOperators(
          setFillingColor(hexToRgb(a.color)),
          moveTo(e.x, e.y),
          lineTo(bx + nx, by + ny),
          lineTo(bx - nx, by - ny),
          closePath(),
          fill(),
        );
      } else if (a.type === "draw") {
        polyline(page, a.points.map((p) => ({ x: X(p.x), y: Y(p.y) })), a.color, a.strokeWidth);
      } else if (a.type === "image") {
        const img = images.get(a.dataUrl);
        if (img) page.drawImage(img, { x: X(a.x), y: Y(a.y + a.h), width: a.w * W, height: a.h * H });
      } else if (a.type === "text" && font) {
        const size = a.fontSize * H;
        const lineH = size * 1.2;
        const lines = wrapText(a.text, font, size, Math.max(a.w * W, size));
        // Как в редакторе (line-height 1.2): глифы по центру строки.
        // Метрики Liberation Sans/Arial: подъём 0.905, спуск 0.212 кегля
        const top = Y(a.y);
        const lead = (lineH - size * (0.905 + 0.212)) / 2;
        lines.forEach((ln, i) => {
          if (!ln) return;
          const baseline = top - i * lineH - lead - size * 0.905;
          page.drawText(ln, { x: X(a.x), y: baseline, size, font, color: hexToRgb(a.color) });
        });
      }
    }
  });
}

/**
 * Невидимый текст поверх скана: его можно найти, выделить и скопировать.
 * Ширина слова подгоняется к распознанной (горизонтальным масштабом).
 */
export function drawInvisibleText(page: PDFPage, frame: Frame, words: TextWord[], font: PDFFont) {
  if (!words.length) return;
  const key = page.node.newFontDictionary(font.name, font.ref);
  inFrame(page, frame.m, () => {
    const ops = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of words) {
      const str = w.str.replace(/\s+/g, " ").trim();
      if (!str || w.size <= 0) continue;
      const natural = font.widthOfTextAtSize(str, w.size);
      const squeeze = natural > 0 ? Math.max(1, Math.min(1000, (w.width / natural) * 100)) : 100;
      ops.push(
        setFontAndSize(key, w.size),
        setCharacterSqueeze(Number(squeeze.toFixed(2))),
        setTextMatrix(1, 0, 0, 1, w.x, w.y),
        // Пробел после слова — чтобы при копировании слова не слипались
        showText(font.encodeText(`${str} `) as PDFHexString),
      );
    }
    ops.push(endText());
    page.pushOperators(...ops);
  });
}

export function drawPageNumber(
  page: PDFPage,
  frame: Frame,
  opts: PageNumbersOptions,
  n: number,
  total: number,
  font: PDFFont,
) {
  const label = opts.format.replace("{n}", String(n)).replace("{total}", String(total));
  const { W, H } = frame;
  const tw = font.widthOfTextAtSize(label, opts.size);
  const cap = font.heightAtSize(opts.size, { descender: false });
  const margin = Math.min(24, H * 0.04 + 6);
  let x = W / 2 - tw / 2;
  let y = margin;
  if (opts.position.includes("top")) y = H - margin - cap;
  if (opts.position.includes("left")) x = margin;
  if (opts.position.includes("right")) x = W - margin - tw;
  inFrame(page, frame.m, () => {
    page.drawText(label, { x, y, size: opts.size, font, color: hexToRgb(opts.color) });
  });
}

export function drawWatermark(page: PDFPage, frame: Frame, opts: WatermarkOptions, font: PDFFont) {
  const { W, H } = frame;
  const text = opts.text.trim();
  if (!text) return;
  const angle = Math.atan2(H, W) * (180 / Math.PI);
  const rad = (angle * Math.PI) / 180;
  // Не шире 85% диагонали страницы
  let size = opts.size;
  const diag = Math.hypot(W, H);
  const tw0 = font.widthOfTextAtSize(text, size);
  if (tw0 > diag * 0.85) size *= (diag * 0.85) / tw0;
  const tw = font.widthOfTextAtSize(text, size);
  const cap = font.heightAtSize(size, { descender: false }) * 0.72;
  const x = W / 2 - (tw / 2) * Math.cos(rad) + (cap / 2) * Math.sin(rad);
  const y = H / 2 - (tw / 2) * Math.sin(rad) - (cap / 2) * Math.cos(rad);
  inFrame(page, frame.m, () => {
    page.drawText(text, { x, y, size, font, color: hexToRgb(opts.color), opacity: opts.opacity, rotate: degrees(angle) });
  });
}
