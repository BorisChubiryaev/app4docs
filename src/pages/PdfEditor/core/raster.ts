// Страница → картинка (для вымарывания и максимального сжатия) и
// текст страницы из pdf.js, чтобы картинка осталась с поиском по тексту.
import * as pdfjs from "pdfjs-dist";
import type { TextWord } from "./types";

/** Прямоугольник в долях страницы, отсчёт от левого верхнего угла. */
export type NormBox = { x: number; y: number; w: number; h: number };

export async function renderToCanvas(page: any, scale: number, maxSide = 6000): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const s = Math.min(scale, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: s });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // С учётом значений полей формы, введённых в PDF Studio
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE }).promise;
  return canvas;
}

/**
 * Растр страницы (с её собственным поворотом) с закрашенными областями.
 * Закрашивание идёт по пикселям: то, что было под ними, в файл не попадает.
 */
export async function rasterize(
  page: any,
  dpi: number,
  quality: number,
  boxes: NormBox[],
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const canvas = await renderToCanvas(page, dpi / 72, 4096);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (const b of boxes) {
    ctx.fillRect(
      Math.floor(b.x * canvas.width) - 1,
      Math.floor(b.y * canvas.height) - 1,
      Math.ceil(b.w * canvas.width) + 2,
      Math.ceil(b.h * canvas.height) + 2,
    );
  }
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", quality),
  );
  canvas.width = 0;
  canvas.height = 0;
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: base.width, height: base.height };
}

/** Слова текстового слоя страницы в системе отображаемой страницы (Y вверх). */
export async function pageWords(page: any): Promise<TextWord[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const words: TextWord[] = [];
  for (const it of content.items as any[]) {
    const str: string = it.str ?? "";
    if (!str.trim()) continue;
    const t = pdfjs.Util.transform(viewport.transform, it.transform);
    // Только горизонтальный текст: повёрнутые надписи редки
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.05) continue;
    const size = Math.hypot(t[2], t[3]);
    const width = (it.width || 0) * (viewport.scale || 1);
    if (!size || !width) continue;
    const x0 = t[4];
    const y = viewport.height - t[5];
    // Делим фрагмент на слова пропорционально числу символов
    const per = width / str.length;
    let i = 0;
    for (const part of str.split(/(\s+)/)) {
      if (part.trim()) words.push({ str: part, x: x0 + i * per, y, width: part.length * per, size });
      i += part.length;
    }
  }
  return words;
}

/** Слова, не задетые закрашенными областями. */
export function outsideBoxes(words: TextWord[], boxes: NormBox[], W: number, H: number): TextWord[] {
  if (!boxes.length) return words;
  return words.filter((w) => {
    const x0 = w.x / W;
    const x1 = (w.x + w.width) / W;
    const top = (H - (w.y + w.size * 0.8)) / H;
    const bottom = (H - (w.y - w.size * 0.2)) / H;
    return !boxes.some((b) => x1 > b.x && x0 < b.x + b.w && bottom > b.y && top < b.y + b.h);
  });
}
