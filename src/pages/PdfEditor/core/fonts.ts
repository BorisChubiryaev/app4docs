// Шрифты для текста, который PDF Studio добавляет в документ: подписи,
// номера страниц, водяной знак, невидимый слой распознанного текста.
// Liberation Sans (SIL OFL) совпадает по метрикам с Arial; оставлены только
// латиница, кириллица и типографские знаки — по ~47 КБ на начертание.
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import regularUrl from "../../../assets/fonts/LiberationSans-Regular.ttf?inline";
import boldUrl from "../../../assets/fonts/LiberationSans-Bold.ttf?inline";

const decode = (dataUrl: string) => {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export type Fonts = { regular(): Promise<PDFFont>; bold(): Promise<PDFFont> };

/** Шрифты встраиваются в документ только при первом обращении. */
export function fontsFor(doc: PDFDocument): Fonts {
  doc.registerFontkit(fontkit);
  let regular: Promise<PDFFont> | null = null;
  let bold: Promise<PDFFont> | null = null;
  return {
    regular: () => (regular ??= doc.embedFont(decode(regularUrl))),
    bold: () => (bold ??= doc.embedFont(decode(boldUrl))),
  };
}
