// Тот же шрифт, которым текст попадёт в PDF, — чтобы переносы строк в
// редакторе совпадали с итоговым файлом.
import regularUrl from "../../../assets/fonts/LiberationSans-Regular.ttf?inline";

let added = false;

export function ensureStudioFont() {
  if (added || typeof FontFace === "undefined") return;
  added = true;
  try {
    const face = new FontFace("PdfStudioSans", `url(${regularUrl})`);
    face.load().then((f) => document.fonts.add(f)).catch(() => undefined);
  } catch {
    /* остаётся Arial — у него те же метрики */
  }
}

export const STUDIO_FONT = `"PdfStudioSans", "Liberation Sans", Arial, sans-serif`;
