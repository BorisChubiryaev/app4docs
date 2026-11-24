import { NS, desc, insertOrdered, kid, make, num, path } from "../../PptxRestyle/engine/xml";

const mediaExtension = "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}";
export const mediaRelationship = "http://schemas.microsoft.com/office/2007/relationships/media";

export function movieNode(doc: Document, id: string) {
  return desc(kid(doc.documentElement, "timing"), "video", NS.p).find(video =>
    path(video, "cMediaNode", "tgtEl", "spTgt")?.getAttribute("spid") === id);
}

export function autoMovie(doc: Document, id: string) {
  const timing = path(movieNode(doc, id), "cMediaNode", "cTn");
  const start = path(timing, "stCondLst", "cond");
  const ms = num(timing, "dur") ?? 0;
  if (ms <= 0 || start?.getAttribute("delay") !== "0" || start.hasAttribute("evt")) return undefined;
  return { duration: ms / 1000, loop: timing?.getAttribute("repeatCount") === "indefinite" };
}

export function attachMovie(doc: Document, pic: Element, shapeId: string, videoRel: string, mediaRel: string, duration: number, loop: boolean) {
  const link = make(doc, NS.a, "hlinkClick", { action: "ppaction://media" });
  link.setAttributeNS(NS.r, "r:id", "");
  path(pic, "nvPicPr", "cNvPr")!.append(link);
  const file = make(doc, NS.a, "videoFile");
  file.setAttributeNS(NS.r, "r:link", videoRel);
  const extensions = make(doc, NS.p, "extLst"), ext = make(doc, NS.p, "ext", { uri: mediaExtension });
  const media = make(doc, NS.p14, "media");
  media.setAttributeNS(NS.r, "r:embed", mediaRel);
  ext.append(media); extensions.append(ext);
  path(pic, "nvPicPr", "nvPr")!.append(file, extensions);

  // Append our media timing as a sibling of the existing animation sequences.
  const slide = doc.documentElement;
  const timing = kid(slide, "timing") ?? insertOrdered(slide, make(doc, NS.p, "timing"), ["extLst"]);
  const nodes = kid(timing, "tnLst") ?? insertOrdered(timing, make(doc, NS.p, "tnLst"), ["bldLst", "extLst"]);
  let nextId = desc(nodes, "cTn", NS.p).reduce((max, el) => Math.max(max, num(el, "id") ?? 0), 0) + 1;
  let root = desc(nodes, "cTn", NS.p).find(el => el.getAttribute("nodeType") === "tmRoot");
  if (!root) {
    const par = make(doc, NS.p, "par");
    root = make(doc, NS.p, "cTn", { id: nextId++, dur: "indefinite", restart: "never", nodeType: "tmRoot" });
    par.append(root); nodes.append(par);
  }
  const children = kid(root, "childTnLst") ?? insertOrdered(root, make(doc, NS.p, "childTnLst"), ["subTnLst"]);
  const video = make(doc, NS.p, "video"), playback = make(doc, NS.p, "cMediaNode", { vol: 0 });
  const time = make(doc, NS.p, "cTn", { id: nextId, dur: Math.round(duration * 1000), fill: "hold", display: 0 });
  if (loop) time.setAttribute("repeatCount", "indefinite");
  const conditions = make(doc, NS.p, "stCondLst");
  conditions.append(make(doc, NS.p, "cond", { delay: 0 }));
  time.append(conditions);
  const target = make(doc, NS.p, "tgtEl");
  target.append(make(doc, NS.p, "spTgt", { spid: shapeId }));
  playback.append(time, target); video.append(playback); children.append(video);
}
