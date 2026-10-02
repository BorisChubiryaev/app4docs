// Сжатие PDF без растеризации страниц: пережимаем только встроенные
// изображения (уменьшаем разрешение и перекодируем в JPEG), а текст,
// шрифты и векторная графика остаются как есть — текст можно выделять,
// искать и копировать.
//
// Поддерживаются самые частые виды картинок: JPEG (DCTDecode) и
// несжатые/Flate растровые 8 бит в RGB или оттенках серого (так хранятся
// PNG и большинство сканов). CMYK, JPEG 2000, чёрно-белые факс-сканы
// (CCITT/JBIG2), маски и картинки с палитрой не трогаем — у них либо нет
// выигрыша, либо высок риск испортить цвета.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";

export interface ImageCompressOptions {
  /** Качество JPEG 0..1. */
  quality: number;
  /** Максимальное разрешение картинки относительно размера страницы. */
  maxDpi: number;
}

export interface ImageCompressStats {
  /** Всего растровых изображений в документе. */
  total: number;
  /** Сколько удалось пережать с выигрышем. */
  recompressed: number;
}

// Мелочь (иконки, логотипы) не трогаем: выигрыш копеечный, а риск
// заметных артефактов на контрастной графике выше.
const MIN_BYTES = 16 * 1024;
const MIN_PIXELS = 160 * 160;
// Заменяем, только если новый вариант заметно меньше.
const MIN_GAIN = 0.9;

const N = (s: string) => PDFName.of(s);

/** Число цветовых компонент: 1 (серый), 3 (RGB) или null — не поддерживаем. */
const componentsOf = (cs: unknown): 1 | 3 | null => {
  if (cs === N("DeviceRGB") || cs === N("CalRGB")) return 3;
  if (cs === N("DeviceGray") || cs === N("CalGray")) return 1;
  if (cs instanceof PDFArray && cs.lookup(0) === N("ICCBased")) {
    const icc = cs.lookup(1);
    const n =
      icc instanceof PDFRawStream ? icc.dict.lookup(N("N")) : undefined;
    if (n instanceof PDFNumber) {
      if (n.asNumber() === 3) return 3;
      if (n.asNumber() === 1) return 1;
    }
  }
  return null;
};

const filtersOf = (dict: PDFDict): string[] => {
  const f = dict.lookup(N("Filter"));
  // decodeText() — имя без ведущего «/» (asString() вернул бы «/DCTDecode»).
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) {
    return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : "?"));
  }
  return [];
};

const num = (dict: PDFDict, key: string): number | undefined => {
  const v = dict.lookup(N(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
};

/** Снимает PNG-предиктор (Predictor 10–15) со строк растра. */
const unpredictPng = (
  data: Uint8Array,
  rowBytes: number,
  bpp: number,
  height: number,
): Uint8Array | null => {
  const stride = rowBytes + 1;
  if (data.length < stride * height) return null;
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const type = data[y * stride];
    const src = y * stride + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - rowBytes + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - rowBytes + x - bpp] : 0;
      let v: number;
      switch (type) {
        case 0:
          v = raw;
          break;
        case 1:
          v = raw + a;
          break;
        case 2:
          v = raw + b;
          break;
        case 3:
          v = raw + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          return null;
      }
      out[dst + x] = v & 0xff;
    }
  }
  return out;
};

/** Растровые байты (8 бит, 1 или 3 компоненты) → canvas. */
const rawToCanvas = (
  pixels: Uint8Array,
  width: number,
  height: number,
  comps: 1 | 3,
): HTMLCanvasElement | null => {
  if (pixels.length < width * height * comps) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let i = 0, j = 0; i < width * height; i++, j += comps) {
    const k = i * 4;
    if (comps === 1) {
      d[k] = d[k + 1] = d[k + 2] = pixels[j];
    } else {
      d[k] = pixels[j];
      d[k + 1] = pixels[j + 1];
      d[k + 2] = pixels[j + 2];
    }
    d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

const encodeJpeg = async (
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array | null> => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const blob: Blob | null = await new Promise((r) =>
    canvas.toBlob(r, "image/jpeg", quality),
  );
  canvas.width = canvas.height = 0;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
};

/**
 * Пережимает изображения документа на месте. Возвращает статистику.
 * Размер цели считаем от самой большой страницы: картинка не бывает
 * нужна в разрешении выше, чем вся страница при maxDpi.
 */
export const compressPdfImages = async (
  pdfDoc: PDFDocument,
  { quality, maxDpi }: ImageCompressOptions,
): Promise<ImageCompressStats> => {
  let maxPageW = 0;
  let maxPageH = 0;
  for (const p of pdfDoc.getPages()) {
    const { width, height } = p.getSize();
    maxPageW = Math.max(maxPageW, width, height);
    maxPageH = Math.max(maxPageH, Math.min(width, height));
  }
  // Сторона картинки может совпасть с любой стороной страницы (поворот).
  const maxLong = Math.ceil((maxPageW / 72) * maxDpi);
  const maxShort = Math.ceil((maxPageH / 72) * maxDpi);

  const context = pdfDoc.context;
  const images: [PDFRef, PDFRawStream][] = [];
  const masks = new Set<PDFRef>();

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.lookup(N("Subtype")) !== N("Image")) continue;
    images.push([ref, obj]);
    for (const key of ["SMask", "Mask"]) {
      const m = obj.dict.get(N(key));
      if (m instanceof PDFRef) masks.add(m);
    }
  }

  let recompressed = 0;

  for (const [ref, stream] of images) {
    // Маски должны остаться в исходном виде (DeviceGray / 1 бит).
    if (masks.has(ref)) continue;
    const dict = stream.dict;
    if (dict.lookup(N("ImageMask"))) continue;
    if (dict.lookup(N("Mask")) instanceof PDFArray) continue; // цветовой ключ
    if (dict.lookup(N("Decode"))) continue;

    const width = num(dict, "Width") ?? 0;
    const height = num(dict, "Height") ?? 0;
    const bpc = num(dict, "BitsPerComponent");
    const comps = componentsOf(dict.lookup(N("ColorSpace")));
    if (!width || !height || bpc !== 8 || !comps) continue;
    if (width * height < MIN_PIXELS || stream.contents.length < MIN_BYTES) {
      continue;
    }

    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const scale = Math.min(1, maxLong / long, maxShort / short);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));

    try {
      const filters = filtersOf(dict);
      let source: CanvasImageSource | null = null;

      if (filters.length === 1 && filters[0] === "DCTDecode") {
        source = await createImageBitmap(
          new Blob([stream.contents as BlobPart], { type: "image/jpeg" }),
        );
      } else if (filters.every((f) => f === "FlateDecode")) {
        let pixels = decodePDFRawStream(stream).decode();
        const parms = dict.lookup(N("DecodeParms"));
        const predictor =
          parms instanceof PDFDict ? parms.lookup(N("Predictor")) : undefined;
        const p = predictor instanceof PDFNumber ? predictor.asNumber() : 1;
        if (p >= 10) {
          const un = unpredictPng(pixels, width * comps, comps, height);
          if (!un) continue;
          pixels = un;
        } else if (p !== 1) {
          continue; // TIFF-предиктор — редкость, пропускаем
        }
        source = rawToCanvas(pixels, width, height, comps);
      }
      if (!source) continue;

      const jpeg = await encodeJpeg(source, tw, th, quality);
      if ("close" in source) (source as ImageBitmap).close();
      if (!jpeg || jpeg.length > stream.contents.length * MIN_GAIN) continue;

      const newDict: Record<string, unknown> = {
        Type: "XObject",
        Subtype: "Image",
        Width: tw,
        Height: th,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      };
      for (const key of ["SMask", "Interpolate", "Intent", "Metadata"]) {
        const v = dict.get(N(key));
        if (v) newDict[key] = v;
      }
      context.assign(ref, context.stream(jpeg, newDict as never));
      recompressed++;
    } catch (err) {
      console.warn("Не удалось пережать изображение:", err);
    }

    // Отдаём управление браузеру между картинками — интерфейс не замирает.
    await new Promise((r) => setTimeout(r, 0));
  }

  return { total: images.length - masks.size, recompressed };
};
