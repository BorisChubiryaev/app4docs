// Распознавание сканов для PDF с поиском: движок тот же, что в конвертере
// документов (Tesseract, офлайн), но без выравнивания наклона — слова
// должны лечь ровно на свои места исходной страницы.
import { renderToCanvas } from "./raster";
import type { TextWord } from "./types";

/** Есть ли у страницы свой текстовый слой. */
export async function hasTextLayer(page: any): Promise<boolean> {
  const content = await page.getTextContent();
  let chars = 0;
  for (const it of content.items as any[]) chars += (it.str || "").replace(/\s+/g, "").length;
  return chars >= 8;
}

export async function recognize(
  page: any,
  onProgress: (stage: string, fraction: number) => void,
): Promise<TextWord[]> {
  const { recognizePage } = await import("../../PdfToWord/engine/ocr");
  const base = page.getViewport({ scale: 1 });
  // Около 300 точек на дюйм для A4
  const scale = Math.min(4.2, 3000 / Math.max(base.width, base.height));
  const canvas = await renderToCanvas(page, scale);
  const realScale = canvas.width / base.width;
  try {
    const res = await recognizePage(canvas, realScale, base.height, onProgress, false);
    return res.items.map((it) => ({ str: it.str, x: it.x, y: it.y, width: it.width, size: it.size }));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
