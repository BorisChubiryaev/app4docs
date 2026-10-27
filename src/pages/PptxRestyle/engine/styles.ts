// Наследование оформления текста и плейсхолдеров.
//
// На слайде PowerPoint хранит только отличия: размер, цвет, маркеры списков,
// отступы и даже положение плейсхолдера берутся из макета и мастера. При
// переносе слайда на чужой макет эта цепочка рвётся, поэтому всё нужное
// «закрепляем» прямо на слайде, а уже потом перекрашиваем.
import { NS, kid, kids, make, num, path } from "./xml";

/** Порядок дочерних элементов a:pPr по схеме. */
const PPR_ORDER = ["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip", "tabLst", "defRPr", "extLst"];
/** Взаимоисключающие группы элементов a:pPr. */
const PPR_GROUPS = [["lnSpc"], ["spcBef"], ["spcAft"], ["buClrTx", "buClr"], ["buSzTx", "buSzPct", "buSzPts"], ["buFontTx", "buFont"], ["buNone", "buAutoNum", "buChar", "buBlip"], ["tabLst"]];

export const RPR_ORDER = ["ln", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"];
const RPR_GROUPS = [["ln"], ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"], ["effectLst", "effectDag"], ["highlight"], ["uLnTx", "uLn"], ["uFillTx", "uFill"], ["latin"], ["ea"], ["cs"], ["sym"]];

/** Поставить дочерний элемент на место по порядку схемы (заменив старый из той же группы). */
export function setOrdered(parent: Element, child: Element, order: string[], groups: string[][] = []) {
  const group = groups.find((g) => g.includes(child.localName)) ?? [child.localName];
  for (const k of kids(parent)) if (group.includes(k.localName)) parent.removeChild(k);
  const idx = order.indexOf(child.localName);
  for (const k of kids(parent)) {
    const j = order.indexOf(k.localName);
    if (j > idx) {
      parent.insertBefore(child, k);
      return child;
    }
  }
  parent.appendChild(child);
  return child;
}

const clone = (doc: Document, el: Element) => doc.importNode(el, true) as Element;

/** Слить rPr: атрибуты и элементы `top` поверх `base` (в документе doc). */
export function mergeRPr(doc: Document, base: Element | null, top: Element | null, local = "rPr"): Element {
  const out = make(doc, NS.a, local);
  for (const src of [base, top]) {
    if (!src) continue;
    for (const a of Array.from(src.attributes)) out.setAttribute(a.name, a.value);
    for (const k of kids(src)) setOrdered(out, clone(doc, k), RPR_ORDER, RPR_GROUPS);
  }
  return out;
}

/** Слить pPr уровня: атрибуты, группы элементов и defRPr. */
export function mergePPr(doc: Document, base: Element | null, top: Element | null, local = "pPr"): Element {
  const out = make(doc, NS.a, local);
  let defR: Element | null = null;
  for (const src of [base, top]) {
    if (!src) continue;
    for (const a of Array.from(src.attributes)) out.setAttribute(a.name, a.value);
    for (const k of kids(src)) {
      if (k.localName === "defRPr") defR = mergeRPr(doc, defR, k, "defRPr");
      else if (k.localName !== "extLst") setOrdered(out, clone(doc, k), PPR_ORDER, PPR_GROUPS);
    }
  }
  if (defR) setOrdered(out, defR, PPR_ORDER);
  return out;
}

/** Набор стилей уровней (lstStyle, titleStyle, defaultTextStyle…). */
export type LevelStyles = (Element | null)[];

/** Уровень lvl (0…8) из элемента-списка уровней. */
export const levelOf = (list: Element | null | undefined, lvl: number): Element | null => {
  if (!list) return null;
  return kid(list, `lvl${lvl + 1}pPr`) ?? (lvl === 0 ? kid(list, "defPPr") : null);
};

/** Итоговый стиль уровня по цепочке (от общего к частному). */
export function effectiveLevel(doc: Document, chain: (Element | null | undefined)[], lvl: number): Element {
  let cur: Element | null = null;
  for (const list of chain) {
    if (!list) continue;
    // defPPr задаёт значения для всех уровней
    const def = kid(list, "defPPr");
    if (def) cur = mergePPr(doc, cur, def);
    const l = kid(list, `lvl${lvl + 1}pPr`);
    if (l) cur = mergePPr(doc, cur, l);
  }
  return cur ?? make(doc, NS.a, "pPr");
}

// ── Плейсхолдеры ──

export interface PhInfo {
  type: string;
  idx?: string;
}

export function phOf(shape: Element): PhInfo | null {
  const nv = kids(shape).find((k) => k.localName.startsWith("nv"));
  const ph = path(nv, "nvPr", "ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") || undefined };
}

const phGroup = (t: string) => (t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" ? "body" : t);

/** Найти плейсхолдер-«родителя» в макете или мастере. */
export function findPh(tree: Element | null, ph: PhInfo, byIdx: boolean): Element | null {
  if (!tree) return null;
  const all: Element[] = [];
  const walk = (el: Element) => {
    for (const k of kids(el)) {
      if (k.localName === "grpSp") walk(k);
      else if (phOf(k)) all.push(k);
    }
  };
  walk(tree);
  if (byIdx && ph.idx !== undefined) {
    const m = all.find((s) => phOf(s)!.idx === ph.idx);
    if (m) return m;
  }
  const g = phGroup(ph.type);
  return all.find((s) => phGroup(phOf(s)!.type) === g) ?? all.find((s) => phOf(s)!.type === ph.type) ?? null;
}

export const spTreeOf = (doc: Document): Element | null => doc.getElementsByTagNameNS(NS.p, "spTree")[0] ?? null;

/** Стили текста мастера: titleStyle / bodyStyle / otherStyle. */
export function masterStyle(master: Document, kind: "title" | "body" | "other"): Element | null {
  const tx = master.getElementsByTagNameNS(NS.p, "txStyles")[0];
  return kid(tx, `${kind}Style`);
}

export const isTitlePh = (ph: PhInfo | null) => !!ph && (ph.type === "title" || ph.type === "ctrTitle");

export interface SlideCtx {
  layout: Document;
  master: Document;
  /** defaultTextStyle из presentation.xml */
  defaults: Element | null;
}

/**
 * Закрепить на фигуре всё унаследованное: положение плейсхолдера, свойства
 * области текста, отступы и маркеры абзацев, размер/начертание/цвет текста.
 */
export function materializeText(shape: Element, ctx: SlideCtx) {
  const doc = shape.ownerDocument!;
  const ph = phOf(shape);
  const layoutPh = ph ? findPh(spTreeOf(ctx.layout), ph, true) : null;
  const masterPh = ph ? findPh(spTreeOf(ctx.master), ph, false) : null;

  // Положение: у плейсхолдера без своего xfrm — из макета или мастера
  if (ph) {
    const spPr = kid(shape, "spPr");
    if (spPr && !kid(spPr, "xfrm")) {
      const src = path(layoutPh, "spPr", "xfrm") ?? path(masterPh, "spPr", "xfrm");
      if (src) spPr.insertBefore(clone(doc, src), spPr.firstChild);
    }
  }

  const body = kid(shape, "txBody");
  if (!body) return;

  // Свойства области текста (поля, привязка, автоподбор)
  const bodyPr = kid(body, "bodyPr");
  if (bodyPr && ph) {
    for (const src of [path(masterPh, "txBody", "bodyPr"), path(layoutPh, "txBody", "bodyPr")]) {
      if (!src) continue;
      for (const a of Array.from(src.attributes)) if (!bodyPr.hasAttribute(a.name)) bodyPr.setAttribute(a.name, a.value);
      if (!kids(bodyPr).some((k) => /Autofit$|^spAutoFit$/.test(k.localName))) {
        const fit = kids(src).find((k) => /Autofit$|^spAutoFit$/.test(k.localName));
        if (fit) bodyPr.appendChild(clone(doc, fit));
      }
    }
  }

  // Цепочка стилей уровней — от общего к частному
  const base = !ph
    ? ctx.defaults
    : isTitlePh(ph)
      ? masterStyle(ctx.master, "title")
      : ["dt", "ftr", "sldNum"].includes(ph.type)
        ? masterStyle(ctx.master, "other")
        : masterStyle(ctx.master, "body");
  const chain: (Element | null)[] = [base];
  if (!ph) {
    // Цвет и шрифт из стиля фигуры (p:style/a:fontRef)
    const fontRef = path(shape, "style", "fontRef");
    const c = kids(fontRef).find((k) => /Clr$/.test(k.localName));
    if (c) {
      const lst = make(doc, NS.a, "lstStyle");
      const def = make(doc, NS.a, "defPPr");
      const r = make(doc, NS.a, "defRPr");
      const f = make(doc, NS.a, "solidFill");
      f.appendChild(clone(doc, c));
      r.appendChild(f);
      def.appendChild(r);
      lst.appendChild(def);
      chain.push(lst);
    }
  }
  chain.push(path(masterPh, "txBody", "lstStyle"), path(layoutPh, "txBody", "lstStyle"), kid(body, "lstStyle"));

  materializeBody(body, chain);
}

/** Закрепить стили уровней из цепочки на абзацах и фрагментах текста. */
export function materializeBody(body: Element, chain: (Element | null | undefined)[]) {
  const doc = body.ownerDocument!;
  const levels = new Map<number, Element>();
  const lvlStyle = (lvl: number) => {
    let s = levels.get(lvl);
    if (!s) levels.set(lvl, (s = effectiveLevel(doc, chain, lvl)));
    return s;
  };
  for (const p of kids(body, "p")) {
    const own = kid(p, "pPr");
    const lvl = num(own, "lvl") ?? 0;
    const eff = mergePPr(doc, lvlStyle(lvl), own);
    const defR = kid(eff, "defRPr");
    if (defR) eff.removeChild(defR);
    if (own) p.replaceChild(eff, own);
    else p.insertBefore(eff, p.firstChild);
    for (const r of kids(p)) {
      if (r.localName !== "r" && r.localName !== "fld" && r.localName !== "endParaRPr") continue;
      const local = r.localName === "endParaRPr" ? "endParaRPr" : "rPr";
      const ownR = r.localName === "endParaRPr" ? r : kid(r, "rPr");
      const merged = mergeRPr(doc, defR, ownR, local);
      if (r.localName === "endParaRPr") p.replaceChild(merged, r);
      else if (ownR) r.replaceChild(merged, ownR);
      else r.insertBefore(merged, r.firstChild);
    }
  }
  // Всё закреплено на абзацах — список стилей фигуры больше не нужен
  const lst = kid(body, "lstStyle");
  if (lst) while (lst.firstChild) lst.removeChild(lst.firstChild);
}
