import { boxOf, placedShapes, type Box } from "../../PptxRestyle/engine/shapes";
import { findPh, phOf } from "../../PptxRestyle/engine/styles";
import JSZip from "jszip";
import { relsPathOf, resolvePath } from "../../PptxRestyle/engine/pkg";
import { desc, insertOrdered, kid, kids, parseXml, serializeXml } from "../../PptxRestyle/engine/xml";

export const effects = {
  fade: { label: "Плавное появление", filter: "fade", preset: "10", subtype: "0" },
  wipe: { label: "Раскрытие слева", filter: "wipe(left)", preset: "22", subtype: "8" },
  rise: { label: "Раскрытие снизу", filter: "wipe(down)", preset: "22", subtype: "4" },
} as const;
export type Effect = keyof typeof effects;
export interface Animation { effect: Effect; duration: number }
export interface ChartSketch {
  kind: "bar" | "column" | "line" | "pie" | "ring";
  rows: { category: string; [key: string]: string | number }[];
  series: string[];
  stacked: boolean;
}

function chartSketch(doc: Document): ChartSketch | undefined {
  const plots = kids(desc(doc, "plotArea")[0]).filter(el => el.localName.endsWith("Chart"));
  if (plots.length !== 1) return;
  const plot = plots[0];
  let kind: ChartSketch["kind"];
  switch (plot.localName) {
    case "barChart": kind = kid(plot, "barDir")?.getAttribute("val") === "bar" ? "bar" : "column"; break;
    case "lineChart": kind = "line"; break;
    case "pieChart": kind = "pie"; break;
    case "doughnutChart": kind = "ring"; break;
    default: return;
  }
  const rows = new Map<number, ChartSketch["rows"][number]>();
  const series = kids(plot, "ser").map((ser, i) => {
    const names = new Map(desc(kid(ser, "cat"), "pt").map(pt => [pt.getAttribute("idx"), kid(pt, "v")?.textContent]));
    for (const pt of desc(kid(ser, "val"), "pt")) {
      const idx = pt.getAttribute("idx");
      const raw = kid(pt, "v")?.textContent?.trim();
      if (!raw || !Number.isFinite(Number(raw))) continue;
      const row = rows.get(Number(idx)) ?? { category: names.get(idx) || String(Number(idx) + 1) };
      row["s" + i] = Number(raw);
      rows.set(Number(idx), row);
    }
    return desc(kid(ser, "tx"), "v")[0]?.textContent || "Ряд " + (i + 1);
  });
  if (!rows.size) return;
  return { kind, series, rows: [...rows].sort(([a], [b]) => a - b).map(([, row]) => row), stacked: kid(plot, "grouping")?.getAttribute("val") === "stacked" };
}

export interface SlideObject { id: string; name: string; kind: "Текст" | "Диаграмма"; content: string; sketch?: ChartSketch; box?: Box; existing: boolean; textPt?: number }
export function objectLabel(object: SlideObject) {
  return object.content.trim().split("\n")[0] || object.name;
}

export interface Slide { part: string; doc: Document; objects: SlideObject[]; pictures: { box: Box; blob: Blob }[] }
export interface Presentation { file: File; slides: Slide[]; width: number; height: number }
export type Choices = Record<string, Record<string, Animation>>;

async function readXml(zip: JSZip, part: string) {
  const entry = zip.file(part);
  if (!entry) throw new Error("В презентации отсутствует часть " + part);
  const doc = parseXml(await entry.async("string"));
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Ошибка XML в " + part);
  return doc;
}

async function relationships(zip: JSZip, part: string) {
  const rels = part ? relsPathOf(part) : "_rels/.rels";
  if (!zip.file(rels)) return [];
  return kids((await readXml(zip, rels)).documentElement, "Relationship")
    .filter(r => r.getAttribute("TargetMode") !== "External")
    .map(r => ({
      id: r.getAttribute("Id"), type: r.getAttribute("Type") ?? "",
      target: resolvePath(part, r.getAttribute("Target") ?? ""),
    }));
}
function relationId(el: Element) {
  return Array.from(el.attributes).find(a => a.namespaceURI?.endsWith("/relationships") && a.localName === "id")?.value;
}

export async function openPresentation(file: File): Promise<Presentation> {
  const zip = await JSZip.loadAsync(file);
  const main = (await relationships(zip, "")).find(r => r.type.endsWith("/officeDocument"));
  if (!main) throw new Error("Файл не содержит презентацию PowerPoint");
  const pres = await readXml(zip, main.target);
  const refs = await relationships(zip, main.target);
  const size = kid(pres.documentElement, "sldSz");
  const width = Number(size?.getAttribute("cx")) || 12192000;
  const height = Number(size?.getAttribute("cy")) || 6858000;
  const slides: Slide[] = [];
  const media = new Map<string, Blob>();
  const layouts = new Map<string, Document>();
  async function layoutTree(part?: string) {
    if (!part || !zip.file(part)) return null;
    if (!layouts.has(part)) layouts.set(part, await readXml(zip, part));
    return desc(layouts.get(part), "spTree")[0] ?? null;
  }
  for (const id of kids(kid(pres.documentElement, "sldIdLst"), "sldId")) {
    const part = refs.find(r => r.id === relationId(id) && r.type.endsWith("/slide"))?.target;
    if (!part) throw new Error("Не удалось найти слайд по его связи в PPTX");
    const doc = await readXml(zip, part);
    const slideRels = await relationships(zip, part);
    const objects: SlideObject[] = [];
    const tree = kid(kid(doc.documentElement, "cSld"), "spTree");
    const placed = tree ? placedShapes(tree) : [];
    const boxes = new Map(placed.map(s => [s.el, s.box]));
    const existing = new Set(desc(kid(doc.documentElement, "timing"), "spTgt").map(e => e.getAttribute("spid")));
    const layoutPart = slideRels.find(r => r.type.endsWith("/slideLayout"))?.target;
    const pictures: Slide["pictures"] = [];
    for (const { el, box } of placed) {
      if (el.localName !== "pic") continue;
      const blip = desc(el, "blip")[0];
      const embed = Array.from(blip?.attributes ?? []).find(a => a.localName === "embed")?.value;
      const path = slideRels.find(r => r.id === embed && r.type.endsWith("/image"))?.target;
      const match = path?.match(/\.(png|jpe?g|gif|webp)$/i);
      if (!path || !match) continue;
      const entry = zip.file(path);
      if (!entry) continue;
      if (!media.has(path)) media.set(path, new Blob([await entry.async("arraybuffer")], { type: "image/" + match[1].toLowerCase().replace("jpg", "jpeg") }));
      pictures.push({ box, blob: media.get(path)! });
    }
    for (const el of Array.from(tree?.getElementsByTagName("*") ?? [])) {
      if (el.localName !== "sp" && el.localName !== "graphicFrame") continue;
      const nv = kid(kid(el, el.localName === "sp" ? "nvSpPr" : "nvGraphicFramePr"), "cNvPr");
      const shapeId = nv?.getAttribute("id");
      if (!shapeId || !/^\d+$/.test(shapeId) || objects.some(o => o.id === shapeId)) continue;
      const chart = desc(el, "chart").find(c => relationId(c));
      const text = kids(kid(el, "txBody"), "p").map(p => desc(p, "t").map(t => t.textContent).join("")).join("\n").trim();
      if (!chart && !text) continue;
      let content = text;
      let sketch: ChartSketch | undefined;
      if (chart) {
        const target = slideRels.find(r => r.id === relationId(chart))?.target;
        if (target && zip.file(target)) {
          const chartDoc = await readXml(zip, target);
          sketch = chartSketch(chartDoc);
          const title = desc(desc(chartDoc, "title")[0], "t").map(t => t.textContent).join("");
          const series = desc(chartDoc, "ser").map(s => desc(kid(s, "tx"), "v")[0]?.textContent).filter(Boolean);
          content = [title, ...series].filter(Boolean).join(" · ");
        }
      }
      let box = boxes.get(el);
      const ph = phOf(el);
      if (!box && ph && layoutPart) {
        const layout = findPh(await layoutTree(layoutPart), ph, true);
        box = layout ? boxOf(layout) ?? undefined : undefined;
        if (!box) {
          const master = (await relationships(zip, layoutPart)).find(r => r.type.endsWith("/slideMaster"));
          const parent = findPh(await layoutTree(master?.target), (layout && phOf(layout)) || ph, false);
          if (parent) box = boxOf(parent) ?? undefined;
        }
      }
      const textPt = Number(desc(el, "rPr")[0]?.getAttribute("sz")) / 100 || undefined;
      objects.push({ id: shapeId, existing: existing.has(shapeId), box, textPt, kind: chart ? "Диаграмма" : "Текст", name: nv?.getAttribute("name") || "Объект " + shapeId, content, sketch });
    }
    slides.push({ part, doc, objects, pictures });
  }
  if (!slides.length) throw new Error("В файле нет слайдов");
  return { file, slides, width, height };
}

// Добавляем шаги в основную последовательность показа. Идентификаторы
// временных узлов уникальны в пределах слайда, включая существующие триггеры.
function animate(slide: Slide, selection: Record<string, Animation>) {
  const doc = slide.doc.cloneNode(true) as Document;
  const root = doc.documentElement;
  const element = (name: string, attrs: Record<string, string> = {}) => {
    const e = doc.createElementNS(root.namespaceURI, "p:" + name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  function child(parent: Element, name: string, attrs?: Record<string, string>) {
    return parent.appendChild(element(name, attrs));
  }
  let serial = desc(root, "cTn").reduce((max, n) => Math.max(max, Number(n.getAttribute("id")) || 0), 0);
  const time = (parent: Element, attrs: Record<string, string>) => child(parent, "cTn", { id: String(++serial), ...attrs });
  function childrenOf(node: Element) {
    return kid(node, "childTnLst") ?? insertOrdered(node, element("childTnLst"), ["subTnLst"]);
  }
  function start(node: Element, delay: string) { child(child(node, "stCondLst"), "cond", { delay }); }
  const timing = kid(root, "timing") ?? insertOrdered(root, element("timing"), ["extLst"]);
  const list = kid(timing, "tnLst") ?? insertOrdered(timing, element("tnLst"), ["bldLst", "extLst"]);
  const nodes = desc(list, "cTn");
  let sequence = nodes.find(n => n.getAttribute("nodeType") === "mainSeq");
  if (!sequence) {
    const master = nodes.find(n => n.getAttribute("nodeType") === "tmRoot") ??
      time(child(list, "par"), { nodeType: "tmRoot", dur: "indefinite", restart: "never" });
    const seq = child(childrenOf(master), "seq", { concurrent: "1", nextAc: "seek" });
    sequence = time(seq, { nodeType: "mainSeq", dur: "indefinite" });
    for (const [name, evt] of [["prevCondLst", "onPrev"], ["nextCondLst", "onNext"]]) {
      child(child(child(child(seq, name), "cond", { evt, delay: "0" }), "tgtEl"), "sldTgt");
    }
  }
  for (const object of slide.objects) {
    const choice = selection[object.id];
    if (!choice) continue;
    const effect = effects[choice.effect];
    const click = time(child(childrenOf(sequence), "par"), { fill: "hold" });
    start(click, "indefinite");
    const group = time(child(childrenOf(click), "par"), { fill: "hold" });
    start(group, "0");
    const entrance = time(child(childrenOf(group), "par"), {
      fill: "hold", nodeType: "clickEffect", presetClass: "entr", presetID: effect.preset, presetSubtype: effect.subtype,
    });
    start(entrance, "0");
    const steps = childrenOf(entrance);
    function behavior(parent: Element, dur: string) {
      const bh = child(parent, "cBhvr");
      time(bh, { dur, fill: "hold" });
      child(child(bh, "tgtEl"), "spTgt", { spid: object.id });
      return bh;
    }
    const visible = child(steps, "set");
    child(child(behavior(visible, "1"), "attrNameLst"), "attrName").textContent = "style.visibility";
    child(child(visible, "to"), "strVal", { val: "visible" });
    behavior(child(steps, "animEffect", { transition: "in", filter: effect.filter }), String(Math.round(choice.duration * 1000)));
  }
  return serializeXml(doc);
}

export async function exportPresentation(deck: Presentation, choices: Choices) {
  const zip = await JSZip.loadAsync(deck.file);
  for (const slide of deck.slides) {
    if (slide.objects.some(o => choices[slide.part]?.[o.id])) zip.file(slide.part, animate(slide, choices[slide.part]));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
