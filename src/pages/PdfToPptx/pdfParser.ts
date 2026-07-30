// src/apps/PdfToPptx/pdfParser.ts

import * as pdfjsLib from 'pdfjs-dist';
import type {
  ParsedPage,
  ExtractedTextBlock,
  ExtractedImage,
  ConversionProgress,
} from './types';

import pdfWorkerContent from 'pdfjs-dist/build/pdf.worker.mjs?raw';

const workerBlob = new Blob([pdfWorkerContent], {
  type: "application/javascript",
});
const workerBlobUrl = URL.createObjectURL(workerBlob);
pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;

const PT_PER_INCH = 72;

function ptToInch(v: number): number {
  return v / PT_PER_INCH;
}

/** Создаёт независимую копию ArrayBuffer */
function cloneBuffer(buf: ArrayBuffer): ArrayBuffer {
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buf));
  return copy;
}

/* ------------------------------------------------------------------ */
/*  Рендер фона страницы                                              */
/* ------------------------------------------------------------------ */
async function renderPageBackground(
  pdfBytes: Uint8Array,   // <-- принимаем Uint8Array, не ArrayBuffer
  pageNum: number,
  scale: number,
): Promise<string> {
  // Каждый раз создаём свежую копию данных для pdf.js
  const freshCopy = new Uint8Array(pdfBytes.length);
  freshCopy.set(pdfBytes);

  const pdf = await pdfjsLib.getDocument({
    data: freshCopy,
    verbosity: 0,
  }).promise;

  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();
  pdf.destroy();
  return dataUrl;
}

/* ------------------------------------------------------------------ */
/*  Извлечение текста с точными координатами                          */
/* ------------------------------------------------------------------ */
interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
  dir: string;
}

function cleanFontName(raw: string): string {
  if (!raw) return 'Arial';
  let s = raw.replace(/^[A-Z]{6}\+/, '');
  s = s
    .replace(
      /[-,](Bold|Italic|Regular|Medium|Light|Oblique|SemiBold|ExtraBold|BoldItalic|BoldOblique|Condensed|Narrow|Black|Heavy|Thin|Book|Roman|Demi|Ultra)/gi,
      '',
    )
    .trim();

  const map: Record<string, string> = {
    timesnewroman: 'Times New Roman',
    times: 'Times New Roman',
    arial: 'Arial',
    helvetica: 'Arial',
    helveticaneue: 'Arial',
    courier: 'Courier New',
    couriernew: 'Courier New',
    calibri: 'Calibri',
    cambria: 'Cambria',
    verdana: 'Verdana',
    georgia: 'Georgia',
    tahoma: 'Tahoma',
    trebuchetms: 'Trebuchet MS',
    segoeui: 'Segoe UI',
  };
  const key = s.toLowerCase().replace(/[\s\-_]/g, '');
  return map[key] || s || 'Arial';
}

function extractTextBlocks(
  items: RawTextItem[],
  styles: Record<string, any>,
  pageHeightPt: number,
): ExtractedTextBlock[] {
  const blocks: ExtractedTextBlock[] = [];

  for (const item of items) {
    if (!item.str || item.str.trim().length === 0) continue;

    const [scaleX, skewX, skewY, scaleY, tx, ty] = item.transform;
    const fontSize = Math.abs(scaleY) || Math.abs(scaleX) || 12;
    const xPt = tx;
    const yPt = pageHeightPt - ty;
    const widthPt = Math.max(item.width, fontSize * 0.5);
    const heightPt = fontSize * 1.3;

    const style = styles[item.fontName] || {};
    const fontNameRaw = item.fontName || style.fontFamily || '';
    const bold =
      /bold/i.test(fontNameRaw) || /bold/i.test(style.fontFamily || '');
    const italic =
      /italic|oblique/i.test(fontNameRaw) ||
      /italic/i.test(style.fontFamily || '');

    let rotation = 0;
    if (Math.abs(skewX) > 0.01 || Math.abs(skewY) > 0.01) {
      rotation = Math.atan2(skewX, scaleX) * (180 / Math.PI);
    }

    blocks.push({
      type: 'text',
      text: item.str,
      x: ptToInch(xPt),
      y: ptToInch(yPt),
      width: ptToInch(widthPt),
      height: ptToInch(heightPt),
      fontSize: fontSize * 0.75,
      fontFamily: cleanFontName(fontNameRaw),
      bold,
      italic,
      color: '000000',
      rotation,
    });
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Группировка строчных элементов в текстовые блоки                  */
/* ------------------------------------------------------------------ */
function groupIntoBlocks(items: ExtractedTextBlock[]): ExtractedTextBlock[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) < 0.02) return a.x - b.x;
    return dy;
  });

  const groups: ExtractedTextBlock[][] = [];
  let currentGroup: ExtractedTextBlock[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const sameLine = Math.abs(curr.y - prev.y) < 0.05;
    const consecutive =
      sameLine && Math.abs(curr.x - (prev.x + prev.width)) < 0.15;

    const nextLine =
      !sameLine &&
      Math.abs(curr.y - prev.y) < prev.height * 1.8 &&
      Math.abs(curr.x - currentGroup[0].x) < 0.5;

    if (consecutive || nextLine) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  return groups.map((group) => {
    const minX = Math.min(...group.map((g) => g.x));
    const minY = Math.min(...group.map((g) => g.y));
    const maxX = Math.max(...group.map((g) => g.x + g.width));
    const maxY = Math.max(...group.map((g) => g.y + g.height));

    const lines: { y: number; items: ExtractedTextBlock[] }[] = [];
    for (const item of group) {
      const existingLine = lines.find((l) => Math.abs(l.y - item.y) < 0.05);
      if (existingLine) {
        existingLine.items.push(item);
      } else {
        lines.push({ y: item.y, items: [item] });
      }
    }
    lines.sort((a, b) => a.y - b.y);

    const text = lines
      .map((line) => {
        line.items.sort((a, b) => a.x - b.x);
        return line.items.map((it) => it.text).join('');
      })
      .join('\n');

    const first = group[0];

    return {
      type: 'text' as const,
      text,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      fontSize: first.fontSize,
      fontFamily: first.fontFamily,
      bold: first.bold,
      italic: first.italic,
      color: first.color,
      rotation: first.rotation,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Извлечение изображений с позициями через operator list             */
/* ------------------------------------------------------------------ */
async function extractImages(
  page: any,
  pageHeightPt: number,
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];

  try {
    const ops = await page.getOperatorList();
    const { OPS } = pdfjsLib;

    const ctmStack: number[][] = [[1, 0, 0, 1, 0, 0]];

    const multiplyMatrix = (a: number[], b: number[]): number[] => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];

    const getCurrentCTM = () => ctmStack[ctmStack.length - 1];

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];

      switch (fn) {
        case OPS.save:
          ctmStack.push([...getCurrentCTM()]);
          break;

        case OPS.restore:
          if (ctmStack.length > 1) ctmStack.pop();
          break;

        case OPS.transform: {
          const newCTM = multiplyMatrix(getCurrentCTM(), args as number[]);
          ctmStack[ctmStack.length - 1] = newCTM;
          break;
        }

        case OPS.paintImageXObject:
        case OPS.paintJpegXObject: {
          const imgName = args[0];
          const ctm = getCurrentCTM();

          try {
            const imgData = await new Promise<any>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error('timeout')),
                8000,
              );
              page.objs.get(imgName, (data: any) => {
                clearTimeout(timeout);
                resolve(data);
              });
            });

            if (!imgData || (!imgData.data && !imgData.bitmap)) break;

            const canvas = document.createElement('canvas');
            const w = imgData.width;
            const h = imgData.height;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;

            if (imgData.bitmap) {
              ctx.drawImage(imgData.bitmap, 0, 0);
            } else if (imgData.data) {
              let imgArray: Uint8ClampedArray;
              if (imgData.data instanceof Uint8ClampedArray) {
                imgArray = imgData.data;
              } else {
                imgArray = new Uint8ClampedArray(imgData.data);
              }

              if (imgArray.length === w * h * 3) {
                const rgba = new Uint8ClampedArray(w * h * 4);
                for (let p = 0; p < w * h; p++) {
                  rgba[p * 4] = imgArray[p * 3];
                  rgba[p * 4 + 1] = imgArray[p * 3 + 1];
                  rgba[p * 4 + 2] = imgArray[p * 3 + 2];
                  rgba[p * 4 + 3] = 255;
                }
                imgArray = rgba;
              }

              if (imgArray.length === w * h * 4) {
                const imageData = new ImageData(imgArray, w, h);
                ctx.putImageData(imageData, 0, 0);
              } else {
                canvas.width = 0;
                break;
              }
            }

            const dataUrl = canvas.toDataURL('image/png');
            canvas.width = 0;
            canvas.height = 0;

            if (w < 4 || h < 4) break;

            const imgWidthPt = Math.abs(ctm[0]) || w;
            const imgHeightPt = Math.abs(ctm[3]) || h;
            const imgXPt = ctm[4];
            const imgYPt = pageHeightPt - ctm[5] - Math.abs(ctm[3]);

            images.push({
              type: 'image',
              dataUrl,
              x: ptToInch(imgXPt),
              y: ptToInch(imgYPt),
              width: ptToInch(imgWidthPt),
              height: ptToInch(imgHeightPt),
            });
          } catch {
            // skip
          }
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Image extraction error:', err);
  }

  return images;
}

/* ------------------------------------------------------------------ */
/*  Главная функция парсинга                                          */
/* ------------------------------------------------------------------ */
export async function parsePdf(
  arrayBuffer: ArrayBuffer,
  onProgress: (p: ConversionProgress) => void,
): Promise<ParsedPage[]> {
  // Сохраняем исходные байты как Uint8Array — он НЕ detach'ится
  // при передаче в pdf.js, потому что мы каждый раз будем
  // создавать свежую копию
  const sourceBytes = new Uint8Array(cloneBuffer(arrayBuffer));

  // Открываем основной экземпляр PDF для текста и изображений
  const mainPdfData = new Uint8Array(sourceBytes.length);
  mainPdfData.set(sourceBytes);

  const pdf = await pdfjsLib.getDocument({
    data: mainPdfData,
    verbosity: 0,
  }).promise;

  const totalPages = pdf.numPages;
  const pages: ParsedPage[] = [];

  onProgress({
    stage: 'loading',
    currentPage: 0,
    totalPages,
    message: `PDF загружен: ${totalPages} стр.`,
    percent: 5,
  });

  for (let num = 1; num <= totalPages; num++) {
    const pct = 5 + ((num - 1) / totalPages) * 85;

    // --- Фон ---
    onProgress({
      stage: 'rendering',
      currentPage: num,
      totalPages,
      message: `Рендер страницы ${num}/${totalPages}...`,
      percent: pct,
    });

    // renderPageBackground получает sourceBytes и сам делает копию внутри
    const bgDataUrl = await renderPageBackground(sourceBytes, num, 3);

    // --- Текст и изображения ---
    onProgress({
      stage: 'extracting',
      currentPage: num,
      totalPages,
      message: `Извлечение объектов: ${num}/${totalPages}...`,
      percent: pct + 40 / totalPages,
    });

    const page = await pdf.getPage(num);
    const vp = page.getViewport({ scale: 1 });
    const pageWPt = vp.width;
    const pageHPt = vp.height;

    // Текст
    const textContent = await page.getTextContent();
    const rawTextBlocks = extractTextBlocks(
      textContent.items as RawTextItem[],
      textContent.styles || {},
      pageHPt,
    );
    const groupedText = groupIntoBlocks(rawTextBlocks);

    // Изображения
    const images = await extractImages(page, pageHPt);

    page.cleanup();

    pages.push({
      pageNumber: num,
      widthInches: ptToInch(pageWPt),
      heightInches: ptToInch(pageHPt),
      elements: [...groupedText, ...images],
      backgroundDataUrl: bgDataUrl,
    });

    await new Promise((r) => setTimeout(r, 30));
  }

  pdf.destroy();
  return pages;
}
