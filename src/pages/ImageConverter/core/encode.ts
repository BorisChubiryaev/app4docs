// Энкодеры canvas → Blob для растровых выходных форматов.
// PNG/JPEG/WebP кодирует сам браузер; BMP и ICO собираем вручную,
// чтобы не тянуть зависимости и работать полностью офлайн.

export type ImageFormat = "png" | "jpeg" | "webp" | "bmp" | "ico";

export interface FormatInfo {
  id: ImageFormat;
  label: string;
  ext: string;
  mime: string;
  /** Поддерживает ли формат прозрачность. */
  alpha: boolean;
  /** Есть ли у формата настройка качества (lossy). */
  quality: boolean;
}

export const IMAGE_FORMATS: FormatInfo[] = [
  { id: "png", label: "PNG", ext: "png", mime: "image/png", alpha: true, quality: false },
  { id: "jpeg", label: "JPEG", ext: "jpg", mime: "image/jpeg", alpha: false, quality: true },
  { id: "webp", label: "WEBP", ext: "webp", mime: "image/webp", alpha: true, quality: true },
  { id: "bmp", label: "BMP", ext: "bmp", mime: "image/bmp", alpha: false, quality: false },
  { id: "ico", label: "ICO", ext: "ico", mime: "image/x-icon", alpha: true, quality: false },
];

export function getFormatInfo(format: ImageFormat): FormatInfo {
  return IMAGE_FORMATS.find((f) => f.id === format) || IMAGE_FORMATS[0];
}

/** Проверка поддержки WebP-кодирования конкретным браузером. */
export function isWebpEncodingSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Не удалось закодировать в ${mime}`));
      },
      mime,
      quality,
    );
  });

/** BMP (24-bit, BI_RGB, bottom-up). Альфа не поддерживается — фон уже подложен. */
function encodeBmp(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Нет 2D-контекста для BMP");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buf = new ArrayBuffer(fileSize);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // BITMAPFILEHEADER
  dv.setUint8(0, 0x42); // 'B'
  dv.setUint8(1, 0x4d); // 'M'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(6, 0, true);
  dv.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // положительная высота → bottom-up
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true); // BI_RGB
  dv.setUint32(34, pixelArraySize, true);
  dv.setInt32(38, 2835, true); // ~72 DPI
  dv.setInt32(42, 2835, true);
  dv.setUint32(46, 0, true);
  dv.setUint32(50, 0, true);

  for (let y = 0; y < height; y++) {
    // строки пишутся снизу вверх
    const srcY = height - 1 - y;
    let pos = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 4;
      bytes[pos++] = data[i + 2]; // B
      bytes[pos++] = data[i + 1]; // G
      bytes[pos++] = data[i]; // R
    }
    // остаток строки уже нулевой (padding)
  }

  return new Blob([buf], { type: "image/bmp" });
}

/** Уменьшает canvas до квадрата не больше maxSize (для иконок). */
function fitForIcon(canvas: HTMLCanvasElement, maxSize = 256): HTMLCanvasElement {
  const size = Math.min(maxSize, Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const scale = Math.min(size / canvas.width, size / canvas.height);
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
  }
  return out;
}

/** ICO с встроенным PNG (поддерживается Windows Vista+ и всеми браузерами). */
async function encodeIco(canvas: HTMLCanvasElement): Promise<Blob> {
  const icon = fitForIcon(canvas, 256);
  const pngBlob = await canvasToBlob(icon, "image/png");
  const png = new Uint8Array(await pngBlob.arrayBuffer());

  const header = new ArrayBuffer(6 + 16);
  const dv = new DataView(header);
  // ICONDIR
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type: icon
  dv.setUint16(4, 1, true); // count
  // ICONDIRENTRY
  dv.setUint8(6, icon.width >= 256 ? 0 : icon.width); // 0 == 256
  dv.setUint8(7, icon.height >= 256 ? 0 : icon.height);
  dv.setUint8(8, 0); // color count
  dv.setUint8(9, 0); // reserved
  dv.setUint16(10, 1, true); // planes
  dv.setUint16(12, 32, true); // bit count
  dv.setUint32(14, png.length, true); // bytes in resource
  dv.setUint32(18, 6 + 16, true); // offset

  return new Blob([header, png], { type: "image/x-icon" });
}

/**
 * Кодирует canvas в выбранный формат. `quality` (0..1) применяется к JPEG/WebP.
 * Для форматов без альфы вызывающий код должен заранее подложить фон.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  quality = 0.92,
): Promise<Blob> {
  switch (format) {
    case "png":
      return canvasToBlob(canvas, "image/png");
    case "jpeg":
      return canvasToBlob(canvas, "image/jpeg", quality);
    case "webp":
      return canvasToBlob(canvas, "image/webp", quality);
    case "bmp":
      return encodeBmp(canvas);
    case "ico":
      return encodeIco(canvas);
    default:
      return canvasToBlob(canvas, "image/png");
  }
}
