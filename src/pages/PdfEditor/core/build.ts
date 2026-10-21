// Сборка итогового PDF из страниц PDF Studio.
//
// Порядок для каждой страницы:
//   1. копия исходной страницы (формы заполнены и впечатаны) или растр —
//      если на странице есть вымарывание или выбрано максимальное сжатие;
//   2. поворот;
//   3. невидимый текст распознанного скана и аннотации — в системе
//      страницы «как в редакторе» (собственный поворот без пользовательского);
//   4. обрезка полей и вписывание в A4 — в итоговой ориентации;
//   5. номера страниц и водяной знак — в итоговой ориентации.
import { degrees, PDFDocument, type PDFPage } from "pdf-lib";
import type { Annotation } from "../components/PageAnnotator";
import { drawAnnotations, drawInvisibleText, drawPageNumber, drawWatermark } from "./draw";
import { fillAndFlatten } from "./forms";
import { fontsFor } from "./fonts";
import { apply, displayFrame, inFrame, invert, mul, normRot, type Mat } from "./geometry";
import { outsideBoxes, pageWords, rasterize, type NormBox } from "./raster";
import { MM, pageKey, type BuildOptions, type PageItem } from "./types";

const A4 = { w: 595.28, h: 841.89 };

const clone = (buf: ArrayBuffer) => buf.slice(0);

export const redactBoxes = (anns?: Annotation[]): NormBox[] =>
  (anns || []).filter((a): a is Extract<Annotation, { type: "redact" }> => a.type === "redact");

export async function buildPdf(items: PageItem[], opts: BuildOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const fonts = fontsFor(out);
  const isRaster = (it: PageItem) => !!opts.raster || redactBoxes(it.annotations).length > 0;

  // ── 1. Копии страниц: один copyPages на исходный файл, чтобы общие
  // ресурсы (шрифты, картинки) не дублировались для каждой страницы.
  const copied = new Map<number, PDFPage[]>();
  for (const fileId of new Set(items.filter((it) => !isRaster(it)).map((it) => it.fileId))) {
    const src = opts.files[fileId];
    if (!src) continue;
    try {
      const doc = await PDFDocument.load(clone(src.arrayBuffer), { ignoreEncryption: true });
      if (src.formValues && Object.keys(src.formValues).length) {
        try {
          await fillAndFlatten(doc, src.formValues, fontsFor(doc));
        } catch (err) {
          console.warn("Не удалось заполнить форму:", err);
        }
      }
      const indices = items.filter((it) => it.fileId === fileId && !isRaster(it)).map((it) => it.pageIndex);
      copied.set(fileId, await out.copyPages(doc, indices));
    } catch (err) {
      console.error(`Ошибка копирования страниц «${src.fileName}»:`, err);
    }
  }

  type Placed = { item: PageItem; page: PDFPage; raster: boolean };
  const placed: Placed[] = [];
  for (const item of items) {
    const userRot = normRot(item.rotation ?? 0);
    if (isRaster(item)) {
      const src = opts.files[item.fileId];
      if (!src?.pdf) continue;
      try {
        const pg = await src.pdf.getPage(item.pageIndex + 1);
        const boxes = redactBoxes(item.annotations);
        const quality = opts.raster?.quality ?? 0.9;
        // Вымарывание без сжатия — 200 точек на дюйм; сжатие — 90…131
        const dpi = opts.raster ? Math.round(72 + quality * 60) : 200;
        const r = await rasterize(pg, dpi, opts.raster ? quality : 0.9, boxes);
        const page = out.addPage([r.width, r.height]);
        const img = await out.embedJpg(r.jpeg);
        page.drawImage(img, { x: 0, y: 0, width: r.width, height: r.height });
        if (userRot) page.setRotation(degrees(userRot));
        // Текст остаётся искомым — кроме вымаранных слов
        const ocr = opts.ocr?.get(pageKey(item.fileId, item.pageIndex));
        const words = outsideBoxes(ocr ?? (await pageWords(pg)), boxes, r.width, r.height);
        drawInvisibleText(page, displayFrame(page, 0), words, await fonts.regular());
        placed.push({ item, page, raster: true });
      } catch (err) {
        console.warn("Ошибка растеризации страницы:", err);
      }
      continue;
    }
    const page = copied.get(item.fileId)?.shift();
    if (!page) continue;
    if (userRot) page.setRotation(degrees((page.getRotation().angle + userRot) % 360));
    out.addPage(page);
    placed.push({ item, page, raster: false });
  }

  if (opts.transform) await opts.transform(out);

  // ── 3. Распознанный текст и аннотации
  for (const { item, page, raster } of placed) {
    const ownRot = page.getRotation().angle - (item.rotation ?? 0);
    const frame0 = displayFrame(page, ownRot);
    const ocr = opts.ocr?.get(pageKey(item.fileId, item.pageIndex));
    if (ocr && !raster) drawInvisibleText(page, frame0, ocr, await fonts.regular());
    if (item.annotations?.length) await drawAnnotations(out, page, frame0, item.annotations, fonts);
  }

  // ── 4. Обрезка и A4
  const pages = out.getPages();
  for (let i = 0; i < placed.length; i++) {
    const { item } = placed[i];
    let page = pages[i];
    if (item.crop) cropPage(page, item.crop);
    if (item.fitA4) {
      page = await fitToA4(out, page, i);
      pages[i] = page;
    }
  }

  // ── 5. Номера страниц и водяной знак
  const total = pages.length;
  const wm = opts.watermark?.enabled && opts.watermark.text.trim() ? opts.watermark : null;
  const pn = opts.pageNumbers?.enabled ? opts.pageNumbers : null;
  if (wm || pn) {
    const regular = pn ? await fonts.regular() : null;
    const bold = wm ? await fonts.bold() : null;
    pages.forEach((page, i) => {
      const frame = displayFrame(page, page.getRotation().angle);
      if (wm && bold) drawWatermark(page, frame, wm, bold);
      if (pn && regular) drawPageNumber(page, frame, pn, i + 1, total, regular);
    });
  }
  return out.save();
}

/** Обрезать поля (мм) со сторон страницы в её итоговой ориентации. */
function cropPage(page: PDFPage, crop: NonNullable<PageItem["crop"]>) {
  const { W, H, m } = displayFrame(page, page.getRotation().angle);
  const l = Math.max(0, crop.left) * MM;
  const r = Math.max(0, crop.right) * MM;
  const t = Math.max(0, crop.top) * MM;
  const b = Math.max(0, crop.bottom) * MM;
  if (l + r > W - 36 || t + b > H - 36) return; // не оставляем пустую полоску
  const p1 = apply(m, l, b);
  const p2 = apply(m, W - r, H - t);
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  page.setCropBox(x, y, Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
}

/** Вписать страницу в A4 той же ориентации, по центру, с сохранением пропорций. */
async function fitToA4(doc: PDFDocument, page: PDFPage, index: number): Promise<PDFPage> {
  const box = page.getCropBox();
  const { W, H, m } = displayFrame(page, page.getRotation().angle);
  const [aw, ah] = W > H ? [A4.h, A4.w] : [A4.w, A4.h];
  if (Math.abs(W - aw) < 1 && Math.abs(H - ah) < 1) return page;
  const embedded = await doc.embedPage(page, {
    left: box.x,
    bottom: box.y,
    right: box.x + box.width,
    top: box.y + box.height,
  });
  const s = Math.min(aw / W, ah / H);
  const place: Mat = [s, 0, 0, s, (aw - W * s) / 2, (ah - H * s) / 2];
  // Форма страницы (0..w × 0..h) → собственные координаты → экран → лист A4
  const toUser: Mat = [1, 0, 0, 1, box.x, box.y];
  const total = mul(place, mul(invert(m), toUser));
  const np = doc.insertPage(index, [aw, ah]);
  inFrame(np, total, () => np.drawPage(embedded, { x: 0, y: 0 }));
  doc.removePage(index + 1);
  return np;
}
