// Презентация: порядок слайдов, макет, мастер и тема каждого слайда.
import { Pkg, RT, relIs, type Rel } from "./pkg";
import { readClrMap, readFonts, readScheme, type ClrMap, type Scheme, type ThemeFonts } from "./color";
import { NS, attrR, kid, kids, num } from "./xml";

export interface SlideInfo {
  index: number;
  part: string;
  rels: Rel[];
  layoutPart: string;
  masterPart: string;
  layout: Document;
  master: Document;
  scheme: Scheme;
  fonts: ThemeFonts;
  map: ClrMap;
  /** Тип макета (title, obj, secHead…) */
  layoutType: string;
  layoutName: string;
}

export interface Deck {
  name: string;
  pkg: Pkg;
  cx: number;
  cy: number;
  defaults: Element | null;
  slides: SlideInfo[];
}

export async function loadDeck(pkg: Pkg, name: string): Promise<Deck> {
  const presPart = "ppt/presentation.xml";
  const pres = await pkg.xml(presPart);
  const sz = pres.getElementsByTagNameNS(NS.p, "sldSz")[0];
  const presRels = await pkg.rels(presPart);
  const byId = new Map(presRels.map((r) => [r.id, r]));
  const lst = pres.getElementsByTagNameNS(NS.p, "sldIdLst")[0];
  const slides: SlideInfo[] = [];
  const themeCache = new Map<string, { scheme: Scheme; fonts: ThemeFonts }>();

  for (const sid of kids(lst, "sldId")) {
    const rel = byId.get(attrR(sid, "id") ?? "");
    if (!rel || !pkg.has(rel.abs)) continue;
    const rels = await pkg.rels(rel.abs);
    const lr = rels.find((r) => relIs(r, RT.slideLayout));
    if (!lr) continue;
    const layout = await pkg.xml(lr.abs);
    const mr = (await pkg.rels(lr.abs)).find((r) => relIs(r, RT.slideMaster));
    if (!mr) continue;
    const master = await pkg.xml(mr.abs);
    const tr = (await pkg.rels(mr.abs)).find((r) => relIs(r, RT.theme));
    let th = tr ? themeCache.get(tr.abs) : undefined;
    if (!th && tr) {
      const theme = await pkg.xml(tr.abs);
      th = { scheme: readScheme(theme), fonts: readFonts(theme) };
      themeCache.set(tr.abs, th);
    }
    const slideDoc = await pkg.xml(rel.abs);
    let map = readClrMap(master.getElementsByTagNameNS(NS.p, "clrMap")[0]);
    for (const doc of [layout, slideDoc]) {
      const ovr = doc.getElementsByTagNameNS(NS.a, "overrideClrMapping")[0];
      if (ovr) map = readClrMap(ovr, map);
    }
    slides.push({
      index: slides.length,
      part: rel.abs,
      rels,
      layoutPart: lr.abs,
      masterPart: mr.abs,
      layout,
      master,
      scheme: th?.scheme ?? {},
      fonts: th?.fonts ?? { major: "", minor: "" },
      map,
      layoutType: layout.documentElement.getAttribute("type") || "",
      layoutName: kid(layout.documentElement, "cSld")?.getAttribute("name") || "",
    });
  }
  return {
    name,
    pkg,
    cx: num(sz, "cx") ?? 12192000,
    cy: num(sz, "cy") ?? 6858000,
    defaults: pres.getElementsByTagNameNS(NS.p, "defaultTextStyle")[0] ?? null,
    slides,
  };
}
