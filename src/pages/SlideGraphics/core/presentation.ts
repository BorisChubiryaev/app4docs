import type { PptxFiles, PresentationData, SlideData, TableNodeData } from "@aiden0z/pptx-renderer";
import { resolvePath } from "../../PptxRestyle/engine/pkg";
import { NS, desc, kid, kids, num, parseXml, path, textOf } from "../../PptxRestyle/engine/xml";
import type { Scene } from "./types";
import { autoMovie } from "../presentation/slideVideo";
import { readGif, type GifClip } from "../presentation/gifPlayback";

export type Rect = { x: number; y: number; w: number; h: number };
export type SourceSeries = { name: string; points: { label: string; value: number; index: number }[] };
export type SlideObject = {
  id: string;
  label: string;
  kind: "text" | "shape" | "photo" | "chart" | "table" | "video";
  box: Rect;
  rotation: number;
  text: string;
  series: SourceSeries[];
  chartTitle: string;
  chartPath?: string;
  image?: () => Promise<HTMLImageElement>;
  movie?: { part: string; duration: number; loop: boolean };
  gif?: GifClip;
  ink?: string;
  fill?: string;
  fontSize?: number;
};
export type Slide = { part: string; title: string; objects: SlideObject[]; xml: string; original: SlideData };
export type Presentation = { file: File; files: PptxFiles; model: PresentationData; slides: Slide[] };
export type NativeStyle = { text?: string; ink?: string; fill?: string; fontSize?: number };
type Edit = { id: string; slidePart: string };
export type NativeEdit = Edit & { kind: "native"; targetId: string; style: NativeStyle };
export type GraphicEdit = Edit & {
  kind: "graphic"; targetId: string | null; scene: Scene; images: HTMLImageElement[];
  box: Rect; rotation: number; behind: boolean; animated: boolean; time: number; duration: number;
};
export type ChartEdit = Edit & { kind: "chart"; targetId: string; palette: string[] };
export type SlideEdit = GraphicEdit | NativeEdit | ChartEdit;

export const objectNames: Record<SlideObject["kind"], string> = {
  text: "Текст", shape: "Фигура", photo: "Изображение", chart: "Диаграмма", table: "Таблица", video: "Видео",
};
export class PresentationError extends Error {}

function points(container: Element | null) {
  return new Map(desc(container, "pt", NS.c).map((point, ordinal) => [
    num(point, "idx") ?? ordinal, kid(point, "v", NS.c)?.textContent || "",
  ]));
}

function chartInfo(xml?: string) {
  if (!xml) return { title: "", series: [] };
  const chart = parseXml(xml);
  const title = desc(chart, "title", NS.c)[0];
  const series = desc(chart, "ser", NS.c).map((ser, i) => {
    const labels = points(kid(ser, "cat") ?? kid(ser, "xVal"));
    const values = points(kid(ser, "val") ?? kid(ser, "yVal"));
    return {
      name: desc(kid(ser, "tx"), "v", NS.c)[0]?.textContent || `Ряд ${i + 1}`,
      points: [...values].sort(([a], [b]) => a - b).flatMap(([index, raw]) =>
        raw.trim() && Number.isFinite(Number(raw))
          ? [{ index, label: labels.get(index) || String(index + 1), value: Number(raw) }] : []),
    };
  }).filter(s => s.points.length);
  return { title: title ? textOf(title).trim() : "", series };
}

function tableSeries(node: TableNodeData): SourceSeries[] {
  const rows = node.rows.map(row => row.cells.map(cell =>
    cell.textBody?.paragraphs.map(p => p.runs.map(run => run.text).join("")).join(" ").trim() ?? ""));
  const [headers, ...data] = rows;
  if (!headers || !data.length) return [];
  return headers.slice(1).flatMap((name, offset) => {
    if (!name || /^[0-9., ]+$/.test(name)) return [];
    const points = [];
    for (const [index, row] of data.entries()) {
      const value = (row[offset + 1] ?? "").replace(/\s/g, "").replace(",", ".");
      if (!row[0] || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) || !Number.isFinite(+value)) return [];
      points.push({ index, label: row[0], value: +value });
    }
    return [{ name, points }];
  });
}

const rgb = (el: Element | null) => {
  const val = path(el, "solidFill", "srgbClr")?.getAttribute("val");
  return val && /^[a-f0-9]{6}$/i.test(val) ? "#" + val : undefined;
};

export async function openPresentation(file: File): Promise<Presentation> {
  if (!/\.pptx$/i.test(file.name)) throw new PresentationError("Выберите файл PowerPoint в формате .pptx.");
  const { parseZip, buildPresentation, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
  const files = await parseZip(await file.arrayBuffer(), RECOMMENDED_ZIP_LIMITS);
  const types = parseXml(files.contentTypes);
  if (!kids(types.documentElement, "Override").some(type => type.getAttribute("ContentType") ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")) {
    throw new PresentationError("Выберите презентацию PowerPoint в формате .pptx.");
  }
  const pres = parseXml(files.presentation);
  if (pres.documentElement.namespaceURI !== NS.p) throw new PresentationError("Пересохраните файл в PowerPoint в стандартном формате .pptx.");
  const model = buildPresentation(files);
  if (!model.slides.length || !(model.width > 0 && model.height > 0)) throw new PresentationError("В файле нет слайдов для редактирования.");
  if (kids(kid(pres.documentElement, "sldIdLst"), "sldId").length !== model.slides.length) {
    throw new PresentationError("Не удалось прочитать все слайды. Пересохраните презентацию в PowerPoint.");
  }
  const photoLoaders = new Map<string, () => Promise<HTMLImageElement>>();
  const gifs = new Map<string, GifClip | undefined>();
  const slides = model.slides.map(original => {
    const part = original.slidePath;
    const xml = files.slides.get(part);
    if (!xml) throw new PresentationError("Не удалось прочитать один из слайдов.");
    const objects: SlideObject[] = [];
    let title = "";
    for (const node of original.nodes) {
      // Only edit authored, top-level slide objects. Other content is still rendered by PowerPoint's layer order.
      const shape = node.source.element;
      if (!shape || shape.parentElement?.localName !== "spTree" || node.hidden || node.size.w <= 0 || node.size.h <= 0) continue;
      const text = kids(kid(shape, "txBody"), "p").map(p =>
        kids(p).map(run => run.localName === "br" ? "\n" : kid(run, "t")?.textContent ?? "").join("")
      ).join("\n");
      if (node.placeholder?.type === "title" || node.placeholder?.type === "ctrTitle") title = text;
      let kind: SlideObject["kind"];
      let series: SourceSeries[] = [];
      let chartTitle = "";
      let image: SlideObject["image"];
      let movie: SlideObject["movie"];
      let gif: GifClip | undefined;
      if (node.nodeType === "shape" && shape.localName === "sp") kind = text.trim() ? "text" : "shape";
      else if (node.nodeType === "chart") {
        kind = "chart";
        const info = chartInfo(files.charts.get(node.chartPath));
        series = info.series;
        chartTitle = info.title;
      } else if (node.nodeType === "table") {
        kind = "table";
        series = tableSeries(node);
      } else if (node.nodeType === "picture" && shape.localName === "pic" && !node.isAudio) {
        kind = node.isVideo ? "video" : "photo";
        if (node.isVideo) {
          const rel = original.rels.get(node.mediaRId ?? "");
          const playback = autoMovie(shape.ownerDocument, node.id);
          if (rel && rel.targetMode !== "External" && playback) movie = { part: resolvePath(part, rel.target), ...playback };
        }
        const rel = original.rels.get(node.blipEmbed ?? "");
        if (rel && rel.targetMode !== "External") {
          const mediaPath = resolvePath(part, rel.target);
          const bytes = files.media.get(mediaPath);
          const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
          if (bytes && ext === "gif" && !node.isVideo) {
            if (!gifs.has(mediaPath)) gifs.set(mediaPath, readGif(mediaPath, bytes));
            gif = gifs.get(mediaPath);
          }
          if (bytes && ["png", "jpeg", "jpg", "gif", "webp", "bmp"].includes(ext)) {
            image = photoLoaders.get(mediaPath);
            if (!image) {
              let decoded: Promise<HTMLImageElement> | undefined;
              image = () => decoded ??= loadPhoto(new Blob([new Uint8Array(bytes)], { type: "image/" + (ext === "jpg" ? "jpeg" : ext) }));
              photoLoaders.set(mediaPath, image);
            }
          }
        }
      } else continue;
      const run = desc(shape, "rPr", NS.a)[0];
      const defaultRun = desc(shape, "defRPr", NS.a)[0];
      const size = num(run, "sz") ?? num(defaultRun, "sz");
      objects.push({
        id: node.id, kind, label: text.trim() || chartTitle || (kind === "chart" ? series[0]?.name : "") || node.name || objectNames[kind],
        text, image, movie, gif, series, chartTitle, chartPath: node.nodeType === "chart" ? node.chartPath : undefined, box: { ...node.position, ...node.size }, rotation: node.rotation,
        ink: rgb(run) ?? rgb(defaultRun), fill: rgb(kid(shape, "spPr")), fontSize: size ? size / 100 : undefined,
      });
    }
    const topText = objects.filter(o => o.kind === "text" && o.box.y < model.height * .32)
      .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || b.box.h - a.box.h)[0];
    return { part, title: title || topText?.text || objects.find(o => o.text.trim())?.text || "", objects, original, xml };
  });
  return { file, files, slides, model };
}

export async function loadPhoto(blob: Blob) {
  const image = new Image();
  const reader = new FileReader();
  image.src = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  await image.decode();
  return image;
}
