import type { SlideHandle } from "@aiden0z/pptx-renderer";
import { Pkg, RT, dirOf, relativePath, relsPathOf } from "../../PptxRestyle/engine/pkg";
import { NS, desc, insertOrdered, kid, kids, make, parseXml, path, serializeXml, textOf } from "../../PptxRestyle/engine/xml";
import { encodeMp4, even, renderImage } from "../core/export";
import type { ChartEdit, GraphicEdit, NativeStyle, Presentation, Slide, SlideEdit } from "../core/presentation";
import { baseColor, renderFrame } from "../core/render";
import { renderGif } from "../core/renderGif";
import { byId } from "../templates";
import { colorChart } from "./chartStyle";
import { attachMovie, mediaRelationship, movieNode } from "./slideVideo";
import { gifPainter } from "./gifPlayback";

const MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const EMU = 914400 / 96;
const fills = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];

function setFill(parent: Element, color: string) {
  const doc = parent.ownerDocument;
  const fill = make(doc, NS.a, "solidFill");
  fill.append(make(doc, NS.a, "srgbClr", { val: color.slice(1).toUpperCase() }));
  for (const child of kids(parent)) if (fills.includes(child.localName)) child.remove();
  insertOrdered(parent, fill, ["ln", "effectLst", "effectDag", "scene3d", "sp3d", "highlight", "uLn", "uLnTx", "uFill", "uFillTx", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "extLst"]);
}

function writeParagraph(p: Element, text: string) {
  if (textOf(p) === text && !kid(p, "br")) return;
  const runs = kids(p, "r");
  const old = runs.map(r => kid(r, "t")?.textContent ?? "").join("");
  if (!runs.length || kid(p, "fld") || kid(p, "br")) {
    const doc = p.ownerDocument;
    const r = make(doc, NS.a, "r");
    const style = path(runs[0], "rPr");
    if (style) r.append(style.cloneNode(true));
    const t = make(doc, NS.a, "t");
    t.textContent = text;
    r.append(t);
    for (const child of kids(p)) if (!["pPr", "endParaRPr"].includes(child.localName)) child.remove();
    insertOrdered(p, r, ["endParaRPr"]);
    return;
  }
  // Keep differently formatted runs and hyperlinks on both sides of the edited range.
  let start = 0, tail = 0;
  while (start < Math.min(text.length, old.length) && old[start] === text[start]) start++;
  while (tail < Math.min(text.length, old.length) - start && old[old.length - tail - 1] === text[text.length - tail - 1]) tail++;
  let offset = 0;
  let inserted = false;
  for (const run of runs) {
    const t = kid(run, "t");
    if (!t) continue;
    const value = t.textContent ?? "";
    const end = offset + value.length;
    const prefix = value.slice(0, Math.max(0, start - offset));
    const middle = !inserted && end >= start ? text.slice(start, text.length - tail) : "";
    if (end >= start) inserted = true;
    t.textContent = prefix + middle + value.slice(Math.max(0, old.length - tail - offset));
    offset = end;
  }
}

function applyStyle(shape: Element, style: NativeStyle) {
  const doc = shape.ownerDocument;
  const spPr = kid(shape, "spPr");
  if (style.fill && spPr) setFill(spPr, style.fill);
  const body = kid(shape, "txBody");
  if (!body) return;
  if (style.fontSize) {
    const props = kid(body, "bodyPr");
    if (props && !kid(props, "spAutoFit") && !kid(props, "noAutofit")) {
      kid(props, "normAutofit")?.remove();
      insertOrdered(props, make(doc, NS.a, "noAutofit"), ["scene3d", "sp3d", "flatTx", "extLst"]);
    }
  }
  if (style.text !== undefined) {
    const paragraphs = kids(body, "p");
    const lines = style.text.split("\n");
    for (const [index, line] of lines.entries()) {
      const p = paragraphs[index] ?? make(doc, NS.a, "p");
      if (!p.parentNode) {
        const previous = paragraphs.at(-1);
        const paragraphStyle = kid(previous, "pPr");
        if (paragraphStyle) p.append(paragraphStyle.cloneNode(true));
        const run = kid(previous, "r");
        if (run) p.append(run.cloneNode(true));
        body.append(p);
      }
      writeParagraph(p, line);
    }
    paragraphs.slice(lines.length).forEach(p => p.remove());
  }
  if (style.ink || style.fontSize) {
    for (const p of kids(body, "p")) {
      const pPr = kid(p, "pPr") ?? p.insertBefore(make(doc, NS.a, "pPr"), p.firstChild);
      const props = [kid(pPr, "defRPr") ?? insertOrdered(pPr, make(doc, NS.a, "defRPr"), ["extLst"])];
      for (const run of kids(p).filter(el => ["r", "fld", "br"].includes(el.localName))) {
        props.push(kid(run, "rPr") ?? run.insertBefore(make(doc, NS.a, "rPr"), run.firstChild));
      }
      const end = kid(p, "endParaRPr");
      if (end) props.push(end);
      for (const rPr of props) {
        if (style.ink) setFill(rPr, style.ink);
        if (style.fontSize) rPr.setAttribute("sz", String(Math.round(style.fontSize * 100)));
      }
    }
  }
}

function picture(doc: Document, edit: GraphicEdit, id: string, rel: string) {
  const pic = make(doc, NS.p, "pic");
  const nv = make(doc, NS.p, "nvPicPr");
  nv.append(make(doc, NS.p, "cNvPr", { id, name: byId(edit.scene.templateId).name }), make(doc, NS.p, "cNvPicPr"), make(doc, NS.p, "nvPr"));
  const fill = make(doc, NS.p, "blipFill");
  const blip = make(doc, NS.a, "blip");
  blip.setAttributeNS(NS.r, "r:embed", rel);
  const stretch = make(doc, NS.a, "stretch");
  stretch.append(make(doc, NS.a, "fillRect"));
  fill.append(blip, stretch);
  const props = make(doc, NS.p, "spPr");
  const transform = make(doc, NS.a, "xfrm", edit.rotation ? { rot: Math.round(edit.rotation * 60000) } : {});
  const { x, y, w, h } = edit.box;
  transform.append(make(doc, NS.a, "off", { x: Math.round(x * EMU), y: Math.round(y * EMU) }), make(doc, NS.a, "ext", { cx: Math.round(w * EMU), cy: Math.round(h * EMU) }));
  const geometry = make(doc, NS.a, "prstGeom", { prst: "rect" });
  geometry.append(make(doc, NS.a, "avLst"));
  props.append(transform, geometry);
  pic.append(nv, fill, props);
  return pic;
}

const previews = new WeakMap<GraphicEdit, Promise<Uint8Array>>();
async function raster(edit: GraphicEdit, long: number) {
  const tpl = byId(edit.scene.templateId);
  const k = long / Math.max(edit.box.w, edit.box.h);
  const blob = await renderImage(edit.scene, tpl, edit.images, even(k * edit.box.w), even(k * edit.box.h), edit.time, edit.duration, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}
function posterBytes(edit: GraphicEdit) {
  let png = previews.get(edit);
  if (!png) {
    png = raster(edit, 1024);
    previews.set(edit, png);
    png.catch(() => previews.delete(edit));
  }
  return png;
}

type NextPart = (dir: string, ext: string) => string;
type ImageAsset = { ext: "png" | "gif"; bytes: Uint8Array; mp4?: Uint8Array };

async function editSlide(deck: Presentation, slide: Slide, edits: SlideEdit[], nextPart: NextPart, image: (edit: GraphicEdit) => Promise<ImageAsset>) {
  const doc = parseXml(slide.xml);
  const tree = path(doc.documentElement, "cSld", "spTree");
  if (!tree) throw new Error("Недоступна структура слайда.");
  const rels = new Map(slide.original.rels);
  const media = [];
  const videos = [];
  const charts = [];
  let nextShape = 1, nextRel = 1;
  const newRel = () => {
    while (rels.has(`rId${nextRel}`)) nextRel++;
    return `rId${nextRel++}`;
  };
  const ids = new Set(desc(tree, "cNvPr", NS.p).map(p => p.getAttribute("id")));
  for (const edit of edits) {
    const target = edit.targetId && kids(tree).find(shape =>
      kid(kids(shape).find(nv => nv.localName.startsWith("nv")), "cNvPr")?.getAttribute("id") === edit.targetId);
    if (edit.targetId && !target) throw new Error("Не найден выбранный объект.");
    if (edit.kind === "native") {
      if (target) applyStyle(target, edit.style);
      continue;
    }
    const relId = newRel();
    if (edit.kind === "chart") {
      const oldPath = slide.objects.find(o => o.id === edit.targetId)?.chartPath;
      const xml = oldPath && deck.files.charts.get(oldPath);
      const chartRef = target && desc(target, "chart", NS.c)[0];
      if (!oldPath || !xml || !chartRef) throw new Error("Исходная диаграмма недоступна.");
      const chartDoc = parseXml(xml);
      colorChart(chartDoc, edit.palette);
      const part = nextPart(dirOf(oldPath), "xml");
      const rel = { type: NS.r + RT.chart, target: relativePath(slide.part, part) };
      chartRef.setAttributeNS(NS.r, "r:id", relId);
      rels.set(relId, rel);
      charts.push({ oldPath, part, doc: chartDoc, relId, rel, edit });
      continue;
    }
    while (ids.has(String(nextShape))) nextShape++;
    const id = edit.targetId ?? String(nextShape++);
    ids.add(id);
    const asset = await image(edit);
    const mediaPath = nextPart("ppt/media", asset.ext);
    const rel = { type: NS.r + RT.image, target: relativePath(slide.part, mediaPath) };
    rels.set(relId, rel);
    media.push({ edit, mediaPath, relId, rel, ...asset });
    const pic = picture(doc, edit, id, relId);
    if (target && slide.objects.some(o => o.id === id && o.kind === "video")) movieNode(doc, id)?.remove();
    if (asset.mp4) {
      const part = nextPart("ppt/media", "mp4");
      const targetPath = relativePath(slide.part, part);
      const videoId = newRel(), mediaId = newRel();
      const videoRel = { type: NS.r + "/video", target: targetPath }, mediaRel = { type: mediaRelationship, target: targetPath };
      rels.set(videoId, videoRel); rels.set(mediaId, mediaRel);
      videos.push({ part, bytes: asset.mp4, links: [{ relId: videoId, rel: videoRel }, { relId: mediaId, rel: mediaRel }] });
      const tpl = byId(edit.scene.templateId);
      attachMovie(doc, pic, id, videoId, mediaId, edit.duration, tpl.loop);
    }
    if (target) target.replaceWith(pic);
    else if (edit.behind) tree.insertBefore(pic, kids(tree).find(el => !["nvGrpSpPr", "grpSpPr"].includes(el.localName)) ?? null);
    else insertOrdered(tree, pic, ["extLst"]);
  }
  return { doc, rels, media, charts, videos };
}

function partNames(paths: Iterable<string>) {
  const used = new Set(Array.from(paths, path => path.toLowerCase()));
  let n = 0;
  return (dir: string, ext: string) => {
    let name: string;
    do { name = `${dir}/slide-graphics${++n}.${ext}`; } while (used.has(name.toLowerCase()));
    return name;
  };
}

type ChartModel = NonNullable<ReturnType<Presentation["model"]["charts"]["get"]>>;
const chartPreviews = new WeakMap<ChartEdit, ChartModel>();

type Paint = (seconds: number | null, playing: boolean) => void;
export type SlidePreview = SlideHandle & { paint?: Paint };
export type SlideClock = { time: number | null; playing: boolean; paint?: Paint };

export async function previewSlide(deck: Presentation, slide: Slide, edits: SlideEdit[], live: boolean): Promise<SlidePreview> {
  const { renderSlide, buildPresentation } = await import("@aiden0z/pptx-renderer");
  const options = { externalMedia: "block" } as const;
  const movies = slide.objects.flatMap(o => o.movie ? [o.movie] : []);
  const gifs = slide.objects.flatMap(o => o.gif ? [o.gif] : []);
  if (!edits.length && !movies.length && !gifs.length) return renderSlide(deck.model, slide.original, options);
  const result = await editSlide(deck, slide, edits, partNames([...deck.model.media.keys(), ...deck.model.charts.keys()]),
    async edit => ({ ext: "png", bytes: await posterBytes(edit) }));
  const media = new Map(deck.model.media);
  for (const item of result.media) media.set(item.mediaPath, item.bytes);
  const charts = new Map(deck.model.charts), chartThemes = new Map(deck.model.chartThemes);
  const chartStyles = new Map(deck.model.chartStyles), chartColorStyles = new Map(deck.model.chartColorStyles);
  for (const change of result.charts) {
    let chart = chartPreviews.get(change.edit);
    if (!chart) {
      const parsed = buildPresentation({ ...deck.files, charts: new Map([[change.oldPath, serializeXml(change.doc)]]) }, { lazySlides: true });
      chart = parsed.charts.get(change.oldPath);
      if (!chart) throw new Error("Не удалось прочитать оформление диаграммы.");
      chartPreviews.set(change.edit, chart);
    }
    charts.set(change.part, chart);
    const theme = chartThemes.get(change.oldPath), style = chartStyles.get(change.oldPath), colors = chartColorStyles.get(change.oldPath);
    if (theme) chartThemes.set(change.part, theme);
    if (style) chartStyles.set(change.part, style);
    if (colors) chartColorStyles.set(change.part, colors);
  }
  const urls = new Map<string, string>();
  // Materialize this one revised slide against the original theme, layout and master.
  const handle = renderSlide({ ...deck.model, media, charts, chartThemes, chartStyles, chartColorStyles }, {
    ...slide.original, nodes: [], sourceXml: serializeXml(result.doc), nodesMaterialized: false,
    placeholderInheritanceResolved: false, rels: result.rels,
  }, { ...options, mediaUrlCache: urls });
  const painters: Paint[] = [];
  // Animate inside the picture's existing layer to preserve rotation, stacking and transparency.
  const ready = handle.ready.then(() => {
    const pictures = new Map(result.media.map(m => [urls.get(m.mediaPath), m.edit]));
    const gifSources = new Map(gifs.map(gif => [urls.get(gif.part), gif]));
    for (const img of handle.element.querySelectorAll("img")) {
      const clip = gifSources.get(img.src);
      if (!clip) continue;
      const paint = gifPainter(clip, img);
      if (live) painters.push(paint); else paint(null);
    }
    for (const video of handle.element.querySelectorAll("video")) {
      const clip = movies.find(m => urls.get(m.part) === video.src);
      if (!clip) continue;
      video.controls = false;
      if (!live) continue;
      video.muted = true; video.playsInline = true; video.loop = clip.loop;
      video.preload = "metadata";
      let starting = false;
      let requestedTime: number | null = null;
      video.addEventListener("loadedmetadata", () => {
        if (requestedTime !== null) video.currentTime = requestedTime;
      }, { once: true });
      painters.push((seconds, playing) => {
        requestedTime = seconds === null ? null : clip.loop ? seconds % clip.duration : Math.min(seconds, clip.duration);
        if (seconds === null || requestedTime === null) { video.pause(); return; }
        if (video.readyState >= 1 && Math.abs(video.currentTime - requestedTime) > (playing ? .25 : .001)) video.currentTime = requestedTime;
        if (!playing || (!clip.loop && seconds >= clip.duration)) { video.pause(); return; }
        if (video.paused && !starting) {
          starting = true;
          void video.play().catch(() => {}).finally(() => { starting = false; });
        }
      });
    }
    for (const layer of Array.from(handle.element.children)) {
      const img = layer.querySelector("img");
      const edit = img && pictures.get(img.src);
      if (!img || !edit || !(layer instanceof HTMLElement)) continue;
      layer.dataset.studioGraphic = edit.id;
      if (!live || !edit.animated) continue;
      const tpl = byId(edit.scene.templateId);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1.5, 1024 / Math.max(edit.box.w, edit.box.h));
      canvas.width = Math.max(1, Math.round(edit.box.w * scale));
      canvas.height = Math.max(1, Math.round(edit.box.h * scale));
      canvas.style.cssText = img.style.cssText;
      const ctx = canvas.getContext("2d")!;
      img.replaceWith(canvas);
      let last = -1;
      painters.push(seconds => {
        const t = seconds === null ? edit.time : tpl.loop ? seconds : Math.min(seconds, edit.duration);
        if (t === last) return;
        renderFrame(ctx, canvas.width, canvas.height, t, edit.scene, tpl, edit.images, edit.duration);
        last = t;
      });
    }
  });
  const dispose = () => { handle.dispose(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  return { element: handle.element, ready, paint: (t, playing) => painters.forEach(paint => paint(t, playing)), dispose, [Symbol.dispose]: dispose };
}

export async function exportPresentation(deck: Presentation, edits: SlideEdit[], signal: AbortSignal, onProgress: (percent: number) => void) {
  if (!edits.length) return deck.file;
  const pkg = await Pkg.load(await deck.file.arrayBuffer());
  const nextPart = partNames(pkg.parts());
  const count = edits.filter(e => e.kind === "graphic" && e.animated).length;
  let encoded = 0;
  async function image(edit: GraphicEdit): Promise<ImageAsset> {
    signal.throwIfAborted();
    if (!edit.animated) return { ext: "png", bytes: await raster(edit, 1920) };
    const tpl = byId(edit.scene.templateId);
    const progress = (k: number) => onProgress(Math.floor(95 * (encoded + k) / count));
    const base = baseColor(edit.scene, tpl);
    if (base) {
      const scale = Math.min(1.5, 1280 / Math.max(edit.box.w, edit.box.h));
      const clip = await encodeMp4(edit.scene, tpl, edit.images, {
        w: edit.box.w * scale, h: edit.box.h * scale, dur: edit.duration, fps: 25, signal, fallbackBase: base, onProgress: progress,
      }).catch(() => { signal.throwIfAborted(); return null; });
      if (clip) {
        encoded++;
        return { ext: "png", bytes: await raster(edit, 1280), mp4: new Uint8Array(await clip.arrayBuffer()) };
      }
    }
    const bytes = await renderGif(edit, tpl, signal, progress);
    encoded++;
    return { ext: "gif", bytes };
  }
  for (const slide of deck.slides) {
    signal.throwIfAborted();
    const local = edits.filter(edit => edit.slidePart === slide.part);
    if (!local.length) continue;
    const result = await editSlide(deck, slide, local, nextPart, image);
    pkg.setXml(slide.part, result.doc);
    if (!result.media.length && !result.charts.length) continue;
    const relPath = relsPathOf(slide.part);
    const relations = pkg.has(relPath) ? await pkg.xml(relPath) : parseXml(`<Relationships xmlns="${NS.rel}"/>`);
    for (const item of result.media) {
      pkg.setBytes(item.mediaPath, item.bytes);
      const type = "image/" + item.ext;
      if (pkg.contentType(item.mediaPath) !== type) {
        if (pkg.hasDefault(item.ext)) pkg.setOverride(item.mediaPath, type);
        else pkg.addDefault(item.ext, type);
      }
    }
    for (const video of result.videos) {
      pkg.setBytes(video.part, video.bytes);
      if (!pkg.hasDefault("mp4")) pkg.addDefault("mp4", "video/mp4");
      else if (pkg.contentType(video.part) !== "video/mp4") pkg.setOverride(video.part, "video/mp4");
    }
    // A chart part (or its slide relationship) can be shared by other objects. Give this shape its own part.
    for (const change of result.charts) {
      pkg.setXml(change.part, change.doc);
      pkg.setOverride(change.part, pkg.contentType(change.oldPath) ?? "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
      const oldRelations = relsPathOf(change.oldPath);
      if (pkg.has(oldRelations)) pkg.setBytes(relsPathOf(change.part), await pkg.bytes(oldRelations));
    }
    for (const item of [...result.media, ...result.charts, ...result.videos.flatMap(video => video.links)]) {
      relations.documentElement.append(make(relations, NS.rel, "Relationship", { Id: item.relId, Type: item.rel.type, Target: item.rel.target }));
    }
    pkg.setXml(relPath, relations);
  }
  return new Blob([new Uint8Array(await pkg.save())], { type: MIME });
}
