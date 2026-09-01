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

/** Масштабирует источник в квадрат size×size с центрированием. */
function toSquare(
  source: HTMLCanvasElement,
  size: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const scale = Math.min(size / source.width, size / source.height);
    const w = source.width * scale;
    const h = source.height * scale;
    ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  }
  return out;
}

/** Стандартные размеры, вкладываемые в многоразмерный .ico. */
export const ICO_DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Собирает ICO из набора квадратных canvas'ов (каждый — отдельный размер).
 * Каждый размер хранится как встроенный PNG (Windows Vista+ и все браузеры).
 */
export async function encodeIcoFromCanvases(
  canvases: HTMLCanvasElement[],
): Promise<Blob> {
  // Сортируем по возрастанию и убираем дубли размеров.
  const uniq = new Map<number, HTMLCanvasElement>();
  for (const c of canvases) uniq.set(c.width, c);
  const entries = [...uniq.values()].sort((a, b) => a.width - b.width);

  const pngs = await Promise.all(
    entries.map(async (c) =>
      new Uint8Array(await (await canvasToBlob(c, "image/png")).arrayBuffer()),
    ),
  );

  const count = entries.length;
  const dirSize = 6 + 16 * count;
  const header = new ArrayBuffer(dirSize);
  const dv = new DataView(header);
  // ICONDIR
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type: icon
  dv.setUint16(4, count, true);

  let offset = dirSize;
  entries.forEach((c, i) => {
    const base = 6 + i * 16;
    const png = pngs[i];
    dv.setUint8(base + 0, c.width >= 256 ? 0 : c.width); // 0 == 256
    dv.setUint8(base + 1, c.height >= 256 ? 0 : c.height);
    dv.setUint8(base + 2, 0); // color count
    dv.setUint8(base + 3, 0); // reserved
    dv.setUint16(base + 4, 1, true); // planes
    dv.setUint16(base + 6, 32, true); // bit count
    dv.setUint32(base + 8, png.length, true); // bytes in resource
    dv.setUint32(base + 12, offset, true); // offset
    offset += png.length;
  });

  return new Blob([header, ...pngs], { type: "image/x-icon" });
}

/**
 * ICO из одного canvas — раскладываем на стандартные размеры,
 * чтобы иконка была пригодна для приложений и ярлыков.
 */
async function encodeIco(canvas: HTMLCanvasElement): Promise<Blob> {
  const maxSide = Math.max(canvas.width, canvas.height);
  const sizes = ICO_DEFAULT_SIZES.filter((s) => s <= Math.max(maxSide, 16));
  if (sizes.length === 0) sizes.push(Math.min(256, maxSide));
  const squares = sizes.map((s) => toSquare(canvas, s));
  return encodeIcoFromCanvases(squares);
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
