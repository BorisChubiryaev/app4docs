// Открытие и сохранение: картинки, PSD со слоями, PDF/SVG (через декодер
// конвертера изображений), проект редактора (.cvxproj — zip со слоями) и
// экспорт в PNG/JPEG/WebP/PSD.

import JSZip from "jszip";
import type { BlendMode, DocState, Layer, TextProps } from "./types";
import { canvasFromImageFit, createCanvas, ctx2d, getImageData, loadImageFile } from "./canvas";
import { composite, layerPixels, makeLayer, renderText } from "./doc";

const RASTER_EXT = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "ico"];

export const OPEN_ACCEPT = ".png,.jpg,.jpeg,.gif,.bmp,.webp,.avif,.psd,.svg,.pdf,.cvxproj,image/*";

const ext = (name: string) => name.toLowerCase().split(".").pop() || "";

export const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || "Изображение";

// ── PSD ──

const PSD_BLEND: Record<string, BlendMode> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};
const BLEND_PSD: Record<string, string> = Object.fromEntries(Object.entries(PSD_BLEND).map(([k, v]) => [v, k]));

interface PsdLayerLike {
  name?: string;
  canvas?: HTMLCanvasElement;
  left?: number;
  top?: number;
  opacity?: number;
  hidden?: boolean;
  blendMode?: string;
  children?: PsdLayerLike[];
  mask?: { canvas?: HTMLCanvasElement; left?: number; top?: number; defaultColor?: number; disabled?: boolean };
}

/** Маска PSD (яркость) → наша маска (альфа) в системе координат слоя. */
function psdMaskToAlpha(m: NonNullable<PsdLayerLike["mask"]>, layer: Layer): HTMLCanvasElement | null {
  if (!m.canvas) return null;
  const out = createCanvas(layer.canvas.width, layer.canvas.height);
  const ctx = ctx2d(out);
  // За пределами маски — цвет по умолчанию (0 — скрыто, 255 — видно)
  if (m.defaultColor) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  const src = getImageData(m.canvas);
  for (let i = 0; i < src.data.length; i += 4) {
    src.data[i + 3] = src.data[i];
    src.data[i] = src.data[i + 1] = src.data[i + 2] = 0;
  }
  const tmp = createCanvas(m.canvas.width, m.canvas.height);
  ctx2d(tmp).putImageData(src, 0, 0);
  const dx = (m.left ?? 0) - layer.x;
  const dy = (m.top ?? 0) - layer.y;
  ctx.clearRect(dx, dy, tmp.width, tmp.height);
  ctx.drawImage(tmp, dx, dy);
  return out;
}

async function openPsd(file: File): Promise<DocState> {
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true });
  const layers: Layer[] = [];
  const walk = (list: PsdLayerLike[] | undefined, hiddenParent: boolean) => {
    for (const l of list ?? []) {
      if (l.children) {
        walk(l.children, hiddenParent || !!l.hidden);
        continue;
      }
      if (!l.canvas) continue;
      const layer = makeLayer(l.canvas, l.name || `Слой ${layers.length + 1}`, {
        x: l.left ?? 0,
        y: l.top ?? 0,
        opacity: l.opacity ?? 1,
        visible: !(l.hidden || hiddenParent),
        blend: PSD_BLEND[l.blendMode ?? "normal"] ?? "source-over",
      });
      if (l.mask) {
        layer.mask = psdMaskToAlpha(l.mask, layer);
        layer.maskEnabled = !l.mask.disabled;
      }
      layers.push(layer);
    }
  };
  walk(psd.children as PsdLayerLike[], false);
  if (!layers.length && psd.canvas) layers.push(makeLayer(psd.canvas, "Фон"));
  if (!layers.length) throw new Error("В PSD не нашлось слоёв с изображением.");
  return { width: psd.width, height: psd.height, layers, activeId: layers[layers.length - 1].id, selection: null, editMask: false };
}

export async function savePsd(s: DocState): Promise<Blob> {
  const { writePsd } = await import("ag-psd");
  const children = s.layers.map((l) => ({
    name: l.name,
    // Маски «запекаем» в пиксели: так файл одинаково откроется в любом редакторе
    canvas: layerPixels(l),
    left: l.x,
    top: l.y,
    opacity: l.opacity,
    hidden: !l.visible,
    blendMode: (BLEND_PSD[l.blend] ?? "normal") as "normal",
  }));
  const buf = writePsd({ width: s.width, height: s.height, canvas: composite(s), children }, { generateThumbnail: true });
  return new Blob([buf], { type: "image/vnd.adobe.photoshop" });
}

// ── Проект редактора ──

interface ProjectLayer {
  id: string;
  name: string;
  kind: "raster" | "text";
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  locked: boolean;
  maskEnabled: boolean;
  hasMask: boolean;
  text?: TextProps;
}

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Не удалось сохранить слой"))), "image/png"));

export async function saveProject(s: DocState): Promise<Blob> {
  const zip = new JSZip();
  const meta = {
    app: "convertix-image-editor",
    version: 1,
    width: s.width,
    height: s.height,
    activeId: s.activeId,
    layers: s.layers.map(
      (l): ProjectLayer => ({
        id: l.id,
        name: l.name,
        kind: l.kind,
        x: l.x,
        y: l.y,
        visible: l.visible,
        opacity: l.opacity,
        blend: l.blend,
        locked: l.locked,
        maskEnabled: l.maskEnabled,
        hasMask: !!l.mask,
        text: l.text,
      }),
    ),
  };
  zip.file("project.json", JSON.stringify(meta, null, 1));
  for (const l of s.layers) {
    zip.file(`layers/${l.id}.png`, await toPng(l.canvas));
    if (l.mask) zip.file(`masks/${l.id}.png`, await toPng(l.mask));
  }
  zip.file("preview.png", await toPng(composite(s)));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

async function openProject(file: File): Promise<DocState> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const metaFile = zip.file("project.json");
  if (!metaFile) throw new Error("Это не проект редактора (.cvxproj).");
  const meta = JSON.parse(await metaFile.async("string"));
  const layers: Layer[] = [];
  for (const m of meta.layers as ProjectLayer[]) {
    const png = zip.file(`layers/${m.id}.png`);
    if (!png) continue;
    const canvas = await loadImageFile(await png.async("blob"));
    const maskFile = m.hasMask ? zip.file(`masks/${m.id}.png`) : null;
    const mask = maskFile ? await loadImageFile(await maskFile.async("blob")) : null;
    layers.push({ ...m, canvas, mask, kind: m.kind === "text" && m.text ? "text" : "raster" });
  }
  if (!layers.length) throw new Error("В проекте нет слоёв.");
  return {
    width: meta.width,
    height: meta.height,
    layers,
    activeId: layers.some((l) => l.id === meta.activeId) ? meta.activeId : layers[layers.length - 1].id,
    selection: null,
    editMask: false,
  };
}

/** Открыть любой поддерживаемый файл как документ. */
export async function openAsDocument(file: File): Promise<DocState> {
  const e = ext(file.name);
  if (e === "cvxproj") return openProject(file);
  if (e === "psd" || e === "psb") return openPsd(file);
  const canvas = await openAsCanvas(file);
  const layer = makeLayer(canvas, "Фон");
  return { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id, selection: null, editMask: false };
}

/** Открыть файл как одну картинку (для «Поместить как слой»). */
export async function openAsCanvas(file: File): Promise<HTMLCanvasElement> {
  const e = ext(file.name);
  if (RASTER_EXT.includes(e) || (file.type.startsWith("image/") && !file.type.includes("svg"))) return loadImageFile(file);
  // SVG, PDF, PSD (сведённый) — через декодер конвертера изображений
  const { decodeFile } = await import("../../ImageConverter/core/decode");
  const pages = await decodeFile(file);
  if (!pages.length) throw new Error("Не удалось прочитать файл.");
  return canvasFromImageFit(pages[0].canvas);
}

// ── Экспорт ──

export type ExportFormat = "png" | "jpeg" | "webp" | "psd" | "cvxproj";

export async function exportImage(
  s: DocState,
  format: "png" | "jpeg" | "webp",
  quality: number,
  scale: number,
  background: string,
): Promise<Blob> {
  let c = composite(s);
  if (scale !== 1) {
    const sc = createCanvas(Math.max(1, Math.round(s.width * scale)), Math.max(1, Math.round(s.height * scale)));
    const ctx = ctx2d(sc);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, 0, 0, sc.width, sc.height);
    c = sc;
  }
  if (format === "jpeg") {
    // В JPEG нет прозрачности — подкладываем фон
    const bg = createCanvas(c.width, c.height);
    const ctx = ctx2d(bg);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, bg.width, bg.height);
    ctx.drawImage(c, 0, 0);
    c = bg;
  }
  const mime = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Браузер не смог сохранить в этом формате"))), mime, quality));
}

/** Перерисовать текстовый слой (после правки текста или параметров). */
export function textLayerCanvas(t: TextProps): HTMLCanvasElement {
  return renderText(t);
}
