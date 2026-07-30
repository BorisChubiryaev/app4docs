// src/apps/PdfToPptx/pptxBuilder.ts

import PptxGenJS from "pptxgenjs";
import type { ParsedPage, ConversionProgress } from "./types";

export async function buildPptx(
  pages: ParsedPage[],
  onProgress: (p: ConversionProgress) => void,
): Promise<Blob> {
  const pptx = new PptxGenJS();

  if (pages.length === 0) throw new Error("No pages");

  // Размер слайда по первой странице
  const slideW = pages[0].widthInches;
  const slideH = pages[0].heightInches;

  pptx.defineLayout({ name: "PDF", width: slideW, height: slideH });
  pptx.layout = "PDF";

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    onProgress({
      stage: "building",
      currentPage: i + 1,
      totalPages: pages.length,
      message: `Создание слайда ${i + 1}/${pages.length}...`,
      percent: 90 + (i / pages.length) * 8,
    });

    const slide = pptx.addSlide();

    // Масштаб если страница другого размера
    const sx = slideW / page.widthInches;
    const sy = slideH / page.heightInches;

    // 1) Фоновое изображение — полная копия страницы
    if (page.backgroundDataUrl) {
      slide.addImage({
        data: page.backgroundDataUrl,
        x: 0,
        y: 0,
        w: slideW,
        h: slideH,
      });
    }

    // 2) Изображения — поверх фона, точные координаты
    //    Пользователь сможет их двигать/удалять
    const images = page.elements.filter((e) => e.type === "image");
    for (const img of images) {
      if (img.type !== "image") continue;

      const x = Math.max(0, img.x * sx);
      const y = Math.max(0, img.y * sy);
      let w = img.width * sx;
      let h = img.height * sy;

      // Не выходим за границы слайда
      if (x + w > slideW) w = slideW - x;
      if (y + h > slideH) h = slideH - y;

      if (w > 0.05 && h > 0.05) {
        slide.addImage({
          data: img.dataUrl,
          x,
          y,
          w,
          h,
        });
      }
    }

    // 3) Текстовые блоки — редактируемые, поверх всего
    const texts = page.elements.filter((e) => e.type === "text");
    for (const txt of texts) {
      if (txt.type !== "text") continue;

      const x = Math.max(0, txt.x * sx);
      const y = Math.max(0, txt.y * sy);
      let w = Math.max(0.3, txt.width * sx);
      let h = Math.max(0.15, txt.height * sy);

      if (x >= slideW || y >= slideH) continue;
      if (x + w > slideW) w = slideW - x;
      if (y + h > slideH) h = slideH - y;

      const fontSize = Math.max(4, Math.min(96, txt.fontSize));

      slide.addText(txt.text, {
        x,
        y,
        w,
        h,
        fontSize,
        fontFace: txt.fontFamily,
        bold: txt.bold,
        italic: txt.italic,
        color: txt.color || "000000",
        transparency: 0,
        valign: "top",
        margin: 0,
        wrap: true,
        shrinkText: false,
        lineSpacingMultiple: 1.0,
        paraSpaceBefore: 0,
        paraSpaceAfter: 0,
        rotate: txt.rotation || 0,
        fill: { type: "none" as const }, // Прозрачный фон у текстового блока
        line: { width: 0 } as any,
      });
    }

    await new Promise((r) => setTimeout(r, 10));
  }

  onProgress({
    stage: "building",
    currentPage: pages.length,
    totalPages: pages.length,
    message: "Генерация файла...",
    percent: 98,
  });

  return (await pptx.write({ outputType: "blob" })) as Blob;
}
