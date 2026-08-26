// Универсальный декодер входных форматов в растровые canvas'ы.
// Всё работает целиком в браузере — без бэкенда и без интернета
// (библиотеки бандлятся в приложение через Vite).
//
// Поддерживаемый ввод:
//   • SVG (файл или код)
//   • растровые: PNG, JPEG, GIF, BMP, WebP, а также всё, что умеет <img>
//   • PDF — через pdfjs-dist (каждая страница → отдельный растр)
//   • PSD (Adobe Photoshop) — через ag-psd (сведённое изображение)

import * as pdfjs from "pdfjs-dist";
import pdfWorkerContent from "pdfjs-dist/build/pdf.worker.mjs?raw";

// Инициализация воркера pdfjs так же, как в остальных инструментах проекта.
const workerBlob = new Blob([pdfWorkerContent], {
  type: "application/javascript",
});
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export interface DecodedRaster {
  /** Растр исходного изображения (в оригинальном разрешении). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Имя для отображения/скачивания (без расширения). */
  name: string;
  /**
   * Исходный SVG-код, если источник векторный. Позволяет при экспорте
   * рендерить SVG сразу в целевом разрешении (без потери чёткости),
   * а не масштабировать заранее растеризованный битмап.
   */
  svgCode?: string;
}

/** Тип, к которому мы свели входной файл. */
export type SourceKind = "svg" | "raster" | "pdf" | "psd" | "unknown";

const RASTER_EXT = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "apng"];

export function detectKind(file: File): SourceKind {
  const ext = file.name.toLowerCase().split(".").pop() || "";
  const type = file.type.toLowerCase();

  if (type.includes("svg") || ext === "svg") return "svg";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (
    type === "image/vnd.adobe.photoshop" ||
    type === "application/x-photoshop" ||
    ext === "psd" ||
    ext === "psb"
  )
    return "psd";
  if (type.startsWith("image/") || RASTER_EXT.includes(ext)) return "raster";
  return "unknown";
}

/** Список принимаемых расширений/типов — для input[accept] и подсказок. */
export const ACCEPTED_INPUT =
  ".svg,.png,.jpg,.jpeg,.gif,.bmp,.webp,.avif,.pdf,.psd,.psb,image/*,application/pdf";

export const SUPPORTED_INPUT_LABEL =
  "SVG, PNG, JPG, GIF, BMP, WebP, PDF, PSD";

const readAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });

const readAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsArrayBuffer(file);
  });

const loadImageEl = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = url;
  });

function imageToCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Пытаемся определить «естественный» размер SVG из кода. */
export function getSvgIntrinsicSize(svgCode: string): {
  width: number;
  height: number;
} {
  try {
    const doc = new DOMParser().parseFromString(svgCode, "image/svg+xml");
    const el = doc.querySelector("svg");
    if (el) {
      const wAttr = el.getAttribute("width");
      const hAttr = el.getAttribute("height");
      const w = wAttr ? parseFloat(wAttr) : NaN;
      const h = hAttr ? parseFloat(hAttr) : NaN;
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: w, height: h };
      }
      const viewBox = el.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          return { width: parts[2], height: parts[3] };
        }
      }
    }
  } catch {
    /* игнорируем — вернём дефолт */
  }
  return { width: 1024, height: 1024 };
}

/** Рендер SVG-кода в canvas заданного (или естественного) размера. */
export async function decodeSvgCode(
  svgCode: string,
  targetName = "svg",
  scale = 1,
): Promise<DecodedRaster> {
  const { width, height } = getSvgIntrinsicSize(svgCode);
  const blob = new Blob([svgCode], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageEl(url);
    const w = (img.naturalWidth || width) * scale;
    const h = (img.naturalHeight || height) * scale;
    const canvas = imageToCanvas(img, w, h);
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      name: targetName,
      svgCode,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Загружает SVG-код как <img> (вектор). drawImage такого источника
 * рендерит SVG в целевом размере отрисовки — чётко на любом разрешении.
 */
/**
 * Гарантирует, что корневой <svg> имеет явные width/height. Без этого
 * некоторые браузеры считают intrinsic-размер нулевым, и drawImage такого
 * источника ничего не рисует.
 */
function ensureSvgHasSize(svgCode: string): string {
  try {
    const doc = new DOMParser().parseFromString(svgCode, "image/svg+xml");
    const el = doc.querySelector("svg");
    if (!el) return svgCode;
    const hasW = el.getAttribute("width");
    const hasH = el.getAttribute("height");
    if (hasW && hasH) return svgCode;
    const { width, height } = getSvgIntrinsicSize(svgCode);
    if (!hasW) el.setAttribute("width", String(width));
    if (!hasH) el.setAttribute("height", String(height));
    return new XMLSerializer().serializeToString(el);
  } catch {
    return svgCode;
  }
}

export async function loadSvgImage(svgCode: string): Promise<HTMLImageElement> {
  const normalized = ensureSvgHasSize(svgCode);
  const blob = new Blob([normalized], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const img = await loadImageEl(url);
  // SVG может дорастеризовываться при drawImage, поэтому отзываем URL
  // с задержкой, а не сразу после загрузки.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return img;
}

async function decodeRasterFile(file: File): Promise<DecodedRaster[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = imageToCanvas(img, w, h);
    return [
      {
        canvas,
        width: canvas.width,
        height: canvas.height,
        name: stripExt(file.name),
      },
    ];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeSvgFile(file: File): Promise<DecodedRaster[]> {
  const code = await readAsText(file);
  const raster = await decodeSvgCode(code, stripExt(file.name));
  return [raster];
}

async function decodePdfFile(
  file: File,
  renderScale = 2,
): Promise<DecodedRaster[]> {
  const data = await readAsArrayBuffer(file);
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: DecodedRaster[] = [];
  const base = stripExt(file.name);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    // Белый фон, чтобы прозрачные PDF корректно ложились на растр.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    out.push({
      canvas,
      width: canvas.width,
      height: canvas.height,
      name: doc.numPages > 1 ? `${base}_p${p}` : base,
    });
  }
  return out;
}

async function decodePsdFile(file: File): Promise<DecodedRaster[]> {
  const { readPsd } = await import("ag-psd");
  const buffer = await readAsArrayBuffer(file);
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipThumbnail: true,
  });
  const src = psd.canvas;
  if (!src) {
    throw new Error("Не удалось прочитать растр из PSD");
  }
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(src as unknown as CanvasImageSource, 0, 0);
  return [
    {
      canvas,
      width: canvas.width,
      height: canvas.height,
      name: stripExt(file.name),
    },
  ];
}

export function stripExt(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

/**
 * Универсальный декодер: любой поддерживаемый файл → массив растров.
 * PDF раскладывается постранично, остальное — по одному растру.
 */
export async function decodeFile(file: File): Promise<DecodedRaster[]> {
  const kind = detectKind(file);
  switch (kind) {
    case "svg":
      return decodeSvgFile(file);
    case "pdf":
      return decodePdfFile(file);
    case "psd":
      return decodePsdFile(file);
    case "raster":
      return decodeRasterFile(file);
    default:
      // Последняя попытка — вдруг браузер всё же нарисует.
      return decodeRasterFile(file);
  }
}
