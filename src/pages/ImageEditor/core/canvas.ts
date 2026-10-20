// Мелкие помощники для работы с canvas.

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d", { willReadFrequently: false })!;
}

/** Контекст для частого чтения пикселей (getImageData). */
export function ctxRead(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d", { willReadFrequently: true })!;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function filledCanvas(w: number, h: number, color: string): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

export function getImageData(c: HTMLCanvasElement): ImageData {
  return ctxRead(c).getImageData(0, 0, c.width, c.height);
}

export function canvasFromImageData(img: ImageData): HTMLCanvasElement {
  const c = createCanvas(img.width, img.height);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

export function canvasFromImage(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = createCanvas(img.width, img.height);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

let uid = 0;
export const newId = () => `l${Date.now().toString(36)}${(uid++).toString(36)}`;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

/** Загрузка файла-картинки в canvas (для форматов, которые понимает браузер). */
export async function loadImageFile(file: Blob): Promise<HTMLCanvasElement> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file);
      const c = canvasFromImage(bmp);
      bmp.close();
      return c;
    } catch {
      /* попробуем через <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return canvasFromImage(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Площадь непрозрачных пикселей — ограничивающий прямоугольник. */
export function alphaBounds(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const { data, width, height } = getImageData(c);
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
