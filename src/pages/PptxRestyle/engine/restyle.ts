// Перекраска перенесённого слайда под шаблон: шрифты, цвета текста с учётом
// контраста к фону, заливки и линии фигур — в фирменную палитру, таблицы.
import {
  chroma,
  colorChild,
  contrast,
  hexToRgb,
  hslToRgb,
  luminance,
  resolveColor,
  rgbToHex,
  rgbToHsl,
  type Color,
  type ColorCtx,
  type RGB,
} from "./color";
import { placedShapes, shapesIn, type Box } from "./shapes";
import { RPR_ORDER, setOrdered } from "./styles";
import type { TemplateProfile } from "./template";
import { NS, desc, kid, kids, make, num, path, removeEl } from "./xml";

/**
 * Цветной текст:
 *  template — цветами шаблона (заголовки — цветом заголовков, текст — цветом текста);
 *  palette — в ближайший по оттенку цвет фирменной палитры;
 *  keep — как в исходнике (только с поправкой на читаемость).
 * Заголовки и подзаголовки в режимах template и palette всегда берут цвет
 * заголовков шаблона.
 */
export type TextColorMode = "template" | "palette" | "keep";

export interface RestyleOptions {
  fonts: boolean;
  colors: boolean;
  textColors: TextColorMode;
}

/** Сопоставление цветов исходной презентации фирменной палитре. */
export class ColorMapper {
  private hueMap = new Map<string, RGB | null>();
  constructor(
    private profile: TemplateProfile,
    /** Насыщенные цвета исходника с частотой — для устойчивого сопоставления */
    sourceColors: Map<string, number>,
  ) {
    const palette = profile.palette.map(hexToRgb);
    const used = new Map<number, number>();
    const sorted = [...sourceColors.entries()].sort((a, b) => b[1] - a[1]);
    for (const [hex] of sorted) {
      const [h] = rgbToHsl(hexToRgb(hex));
      let best = -1;
      let bestD = Infinity;
      palette.forEach((p, i) => {
        const [h2] = rgbToHsl(p);
        let d = Math.abs(h - h2);
        d = Math.min(d, 1 - d) * 360;
        // Повторное использование одного цвета палитры — с небольшим штрафом
        const score = d + (used.get(i) ?? 0) * 25;
        if (d <= 75 && score < bestD) {
          bestD = score;
          best = i;
        }
      });
      if (best >= 0) used.set(best, (used.get(best) ?? 0) + 1);
      this.hueMap.set(this.key(hexToRgb(hex)), best >= 0 ? palette[best] : null);
    }
  }

  private key(rgb: RGB) {
    const [h, s, l] = rgbToHsl(rgb);
    return `${Math.round(h * 24)}:${Math.round(s * 4)}:${Math.round(l * 6)}`;
  }

  /** Насыщенный цвет → цвет палитры (или исходный, если близкого нет). */
  accent(rgb: RGB): RGB {
    const k = this.key(rgb);
    if (!this.hueMap.has(k)) {
      // Цвет не встречался при сборе — ищем ближайший по тону
      const [h] = rgbToHsl(rgb);
      let best: RGB | null = null;
      let bestD = 75;
      for (const p of this.profile.palette.map(hexToRgb)) {
        const [h2] = rgbToHsl(p);
        let d = Math.abs(h - h2);
        d = Math.min(d, 1 - d) * 360;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      this.hueMap.set(k, best);
    }
    return this.hueMap.get(k) ?? rgb;
  }

  /** Заливка фигуры. */
  fill(rgb: RGB): RGB {
    if (chroma(rgb) >= 0.2) return this.accent(rgb);
    const L = luminance(rgb);
    const card = this.profile.card ? hexToRgb(this.profile.card) : null;
    if (this.profile.dark && L > 0.55) return card ?? [32, 34, 44];
    if (!this.profile.dark && L < 0.04 && card) return card;
    return rgb;
  }
}

/** Подобрать светлоту цвета так, чтобы он читался на фоне. */
function ensureContrast(rgb: RGB, bg: RGB, min: number): RGB {
  if (contrast(rgb, bg) >= min) return rgb;
  const [h, s, l] = rgbToHsl(rgb);
  const up = luminance(bg) < 0.35;
  for (let i = 1; i <= 20; i++) {
    const nl = up ? Math.min(1, l + i * 0.04) : Math.max(0, l - i * 0.04);
    const c = hslToRgb([h, s, nl]);
    if (contrast(c, bg) >= min) return c;
  }
  return up ? [255, 255, 255] : [0, 0, 0];
}

const srgb = (doc: Document, rgb: RGB, alpha = 1) => {
  const c = make(doc, NS.a, "srgbClr", { val: rgbToHex(rgb) });
  if (alpha < 0.999) c.appendChild(make(doc, NS.a, "alpha", { val: Math.round(alpha * 100000) }));
  return c;
};

const solidFill = (doc: Document, rgb: RGB, alpha = 1) => {
  const f = make(doc, NS.a, "solidFill");
  f.appendChild(srgb(doc, rgb, alpha));
  return f;
};

const SPPR_ORDER = ["xfrm", "custGeom", "prstGeom", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"];
const FILL_GROUP = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];

export interface SlideStyleCtx {
  src: ColorCtx;
  profile: TemplateProfile;
  mapper: ColorMapper;
  opts: RestyleOptions;
  /** Цвет фона слайда шаблона */
  slideBg: RGB;
  title: Element | null;
  /** Крупный заголовок титульного/раздела (стиль heroTitle) */
  hero: Element | null;
  /** Основной кегль слайда (сотые пункта) */
  bodySz: number;
}

/** Заливка фигуры (с учётом стиля темы). null — без заливки. */
function shapeFill(shape: Element, ctx: SlideStyleCtx): { color: Color | null; kind: "none" | "solid" | "grad" | "style" | "other" } {
  const spPr = kid(shape, "spPr");
  const f = kids(spPr).find((k) => FILL_GROUP.includes(k.localName));
  if (f) {
    if (f.localName === "noFill") return { color: null, kind: "none" };
    if (f.localName === "solidFill") return { color: resolveColor(colorChild(f), ctx.src), kind: "solid" };
    if (f.localName === "gradFill") {
      const stops = desc(f, "gs", NS.a).map((g) => resolveColor(colorChild(g), ctx.src)).filter(Boolean) as Color[];
      if (!stops.length) return { color: null, kind: "grad" };
      const avg: RGB = [0, 1, 2].map((i) => stops.reduce((s, c) => s + c.rgb[i], 0) / stops.length) as RGB;
      return { color: { rgb: avg, alpha: stops.reduce((s, c) => s + c.alpha, 0) / stops.length }, kind: "grad" };
    }
    return { color: null, kind: "other" };
  }
  const ref = path(shape, "style", "fillRef");
  if (ref && (num(ref, "idx") ?? 0) > 0) {
    const c = resolveColor(colorChild(ref), ctx.src);
    if (c) return { color: c, kind: "style" };
  }
  return { color: null, kind: "none" };
}

/** Перекрасить заливку и линию фигуры; вернуть новый цвет заливки (для текста). */
function restyleShapeColors(shape: Element, ctx: SlideStyleCtx, bg: RGB): RGB | null {
  const doc = shape.ownerDocument!;
  const spPr = kid(shape, "spPr");
  const { color, kind } = shapeFill(shape, ctx);
  let fillRgb: RGB | null = null;
  if (spPr && color && ctx.opts.colors) {
    const mapped = ctx.mapper.fill(color.rgb);
    if (kind === "grad") {
      for (const gs of desc(kid(spPr, "gradFill"), "gs", NS.a)) {
        const c = resolveColor(colorChild(gs), ctx.src);
        if (!c) continue;
        const old = colorChild(gs);
        if (old) gs.replaceChild(srgb(doc, ctx.mapper.fill(c.rgb), c.alpha), old);
      }
    } else {
      setOrdered(spPr, solidFill(doc, mapped, color.alpha), SPPR_ORDER, [FILL_GROUP]);
    }
    if (color.alpha >= 0.5) fillRgb = mapped;
  } else if (color && color.alpha >= 0.5) {
    fillRgb = color.rgb;
  }

  // Линия
  if (ctx.opts.colors && spPr) {
    const ln = kid(spPr, "ln");
    const lnFill = ln ? kid(ln, "solidFill") : null;
    let lc: Color | null = null;
    if (lnFill) lc = resolveColor(colorChild(lnFill), ctx.src);
    else if (!(ln && kid(ln, "noFill"))) {
      const ref = path(shape, "style", "lnRef");
      if (ref && (num(ref, "idx") ?? 0) > 0) lc = resolveColor(colorChild(ref), ctx.src);
    }
    if (lc) {
      let m = chroma(lc.rgb) >= 0.2 ? ctx.mapper.accent(lc.rgb) : lc.rgb;
      // Серые линии — заметными на новом фоне
      if (chroma(m) < 0.2 && contrast(m, fillRgb ?? bg) < 1.6) m = ctx.profile.dark ? [150, 155, 170] : [90, 90, 100];
      const line = ln ?? setOrdered(spPr, make(doc, NS.a, "ln"), SPPR_ORDER);
      setOrdered(line, solidFill(doc, m, lc.alpha), ["noFill", "solidFill", "gradFill", "pattFill", "prstDash", "custDash", "round", "bevel", "miter", "headEnd", "tailEnd", "extLst"], [["noFill", "solidFill", "gradFill", "pattFill"]]);
    }
  }
  return fillRgb;
}

type TextKind = "title" | "heading" | "body";

/**
 * Подзаголовок внутри текста: заметно крупнее основного текста слайда или
 * целиком жирный абзац крупнее основного. Жирное слово того же кегля, что
 * и текст, — это выделение, а не подзаголовок.
 */
const headingKind = (rPr: Element, bodySz: number): TextKind => {
  const sz = num(rPr, "sz") ?? 1800;
  if (sz >= Math.max(2000, bodySz * 1.2)) return "heading";
  const p = rPr.parentNode?.parentNode as Element | null;
  const runs = p ? kids(p, "r") : [];
  const allBold = runs.length > 0 && runs.every((r) => kid(r, "rPr")?.getAttribute("b") === "1");
  return allBold && sz >= bodySz * 1.15 ? "heading" : "body";
};

/** Основной кегль слайда — кегль, которым набрано больше всего символов. */
export function bodySizeOf(tree: Element): number {
  const count = new Map<number, number>();
  for (const r of desc(tree, "r", NS.a)) {
    const n = (kid(r, "t")?.textContent ?? "").trim().length;
    if (!n) continue;
    const sz = num(kid(r, "rPr"), "sz") ?? 1800;
    count.set(sz, (count.get(sz) ?? 0) + n);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1800;
}

/** Цвет текста под новый фон. */
function textColor(c: Color, behind: RGB, onSlideBg: boolean, kind: TextKind, ctx: SlideStyleCtx): RGB {
  const { profile } = ctx;
  const mode = ctx.opts.textColors;
  const heading = kind !== "body";
  const target = hexToRgb(heading ? profile.title.color : profile.body.color);
  const colored = chroma(c.rgb) >= 0.2;
  // Заголовки — цветом заголовков шаблона, даже если в исходнике были цветными
  if (heading && colored && mode !== "keep" && onSlideBg) return ensureContrast(target, behind, 3);
  if (!colored) {
    if (onSlideBg) return contrast(target, behind) >= 3 ? target : ensureContrast(target, behind, 4.5);
    if (contrast(c.rgb, behind) >= 4.5) return c.rgb;
    const options: RGB[] = [target, [255, 255, 255], [16, 16, 16]];
    return options.sort((a, b) => contrast(b, behind) - contrast(a, behind))[0];
  }
  if (mode === "template") {
    // Цветной текст на плашке — читаемым цветом шаблона для этой плашки
    if (onSlideBg) return ensureContrast(target, behind, 3);
    const options: RGB[] = [target, hexToRgb(profile.body.color), [255, 255, 255], [16, 16, 16]];
    return options.sort((a, b) => contrast(b, behind) - contrast(a, behind))[0];
  }
  const m = mode === "palette" ? ctx.mapper.accent(c.rgb) : c.rgb;
  return ensureContrast(m, behind, 3);
}

/** Перекрасить текст фигуры (или ячейки таблицы). */
function restyleText(body: Element, ctx: SlideStyleCtx, behind: RGB, onSlideBg: boolean, isTitle: boolean, hero = false) {
  const doc = body.ownerDocument!;
  const font = hero ? ctx.profile.heroTitle.font : isTitle ? ctx.profile.title.font : ctx.profile.body.font;
  for (const rPr of [...desc(body, "rPr", NS.a), ...desc(body, "endParaRPr", NS.a), ...desc(body, "defRPr", NS.a)]) {
    if (ctx.opts.colors) {
      const fill = kid(rPr, "solidFill");
      const grad = kid(rPr, "gradFill");
      if (!grad) {
        const c = (fill && resolveColor(colorChild(fill), ctx.src)) || { rgb: ctx.src.scheme[ctx.src.map.tx1 ?? "dk1"] ?? [0, 0, 0], alpha: 1 };
        const rgb = hero
          ? hexToRgb(ctx.profile.heroTitle.color)
          : textColor(c, behind, onSlideBg, isTitle ? "title" : headingKind(rPr, ctx.bodySz), ctx);
        setOrdered(rPr, solidFill(doc, rgb, c.alpha), RPR_ORDER, [["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]]);
      }
      // Подсветка текста и цвет подчёркивания старой темы — убираем
      removeEl(kid(rPr, "highlight"));
    }
    if (ctx.opts.fonts) {
      const latin = make(doc, NS.a, "latin", { typeface: font });
      setOrdered(rPr, latin, RPR_ORDER);
      for (const k of ["ea", "cs"]) {
        const el = kid(rPr, k);
        if (el && /^\+m[nj]-/.test(el.getAttribute("typeface") || "")) el.setAttribute("typeface", font);
      }
      if ((isTitle || hero) && ctx.profile.title.bold === false && /semibold|bold|medium/i.test(font)) rPr.setAttribute("b", "0");
    }
  }
  // Цвет маркеров списка
  if (ctx.opts.colors) {
    for (const bu of desc(body, "buClr", NS.a)) {
      const c = resolveColor(colorChild(bu), ctx.src);
      if (!c) continue;
      const old = colorChild(bu);
      if (old) bu.replaceChild(srgb(doc, textColor(c, behind, onSlideBg, "body", ctx), c.alpha), old);
    }
  }
}

/** Таблица: стиль «без стиля, сетка», фирменная шапка, линии, текст. */
function restyleTable(frame: Element, ctx: SlideStyleCtx) {
  const tbl = desc(frame, "tbl", NS.a)[0];
  if (!tbl || !ctx.opts.colors) {
    if (tbl)
      for (const tc of desc(tbl, "tc", NS.a)) {
        const b = kid(tc, "txBody");
        if (b) restyleText(b, ctx, ctx.slideBg, true, false);
      }
    return;
  }
  const doc = frame.ownerDocument!;
  const tblPr = kid(tbl, "tblPr");
  const header = tblPr?.getAttribute("firstRow") === "1";
  // Встроенные стили таблиц раскрашиваются темой — у шаблона она другая
  const styleId = kid(tblPr, "tableStyleId");
  if (styleId) styleId.textContent = "{5940675A-B579-460E-94D1-54222C63F5DA}";
  const lineRgb: RGB = ctx.profile.dark ? [120, 126, 145] : [190, 194, 204];
  const headRgb: RGB = ctx.profile.card ? hexToRgb(ctx.profile.card) : ctx.profile.dark ? [40, 44, 60] : [235, 237, 242];
  kids(tbl, "tr").forEach((tr, ri) => {
    for (const tc of kids(tr, "tc")) {
      let tcPr = kid(tc, "tcPr");
      if (!tcPr) tcPr = tc.appendChild(make(doc, NS.a, "tcPr")) as Element;
      const own = kids(tcPr).find((k) => FILL_GROUP.includes(k.localName));
      let cellRgb: RGB | null = null;
      if (own?.localName === "solidFill") {
        const c = resolveColor(colorChild(own), ctx.src);
        if (c) {
          cellRgb = ctx.mapper.fill(c.rgb);
          tcPr.replaceChild(solidFill(doc, cellRgb, c.alpha), own);
          if (c.alpha < 0.5) cellRgb = null;
        }
      } else if (!own && header && ri === 0) {
        cellRgb = headRgb;
        setOrdered(tcPr, solidFill(doc, cellRgb), ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr", "cell3D", ...FILL_GROUP, "headers", "extLst"], [FILL_GROUP]);
      }
      // Тонкие линии сетки
      for (const side of ["lnL", "lnR", "lnT", "lnB"]) {
        let ln = kid(tcPr, side);
        const hasOwn = ln && kids(ln).some((k) => k.localName === "solidFill");
        if (hasOwn) {
          const f = kid(ln!, "solidFill")!;
          const c = resolveColor(colorChild(f), ctx.src);
          if (c && chroma(c.rgb) < 0.2) ln!.replaceChild(solidFill(doc, lineRgb, c.alpha), f);
          else if (c) ln!.replaceChild(solidFill(doc, ctx.mapper.accent(c.rgb), c.alpha), f);
          continue;
        }
        if (ln && kid(ln, "noFill")) continue;
        if (!ln) {
          ln = make(doc, NS.a, side, { w: 9525 });
          const order = ["lnL", "lnR", "lnT", "lnB"];
          const next = kids(tcPr).find((k) => order.indexOf(k.localName) > order.indexOf(side) || !order.includes(k.localName));
          tcPr.insertBefore(ln, next ?? null);
        }
        ln.appendChild(solidFill(doc, lineRgb, 0.6));
      }
      const body = kid(tc, "txBody");
      if (body) restyleText(body, ctx, cellRgb ?? ctx.slideBg, !cellRgb, false);
    }
  });
}

/** Перекрасить все фигуры контейнера (дерево слайда или группа). */
export function restyleTree(container: Element, ctx: SlideStyleCtx) {
  for (const s of shapesIn(container)) {
    switch (s.localName) {
      case "grpSp":
        restyleTree(s, ctx);
        break;
      case "sp": {
        const fillRgb = restyleShapeColors(s, ctx, ctx.slideBg);
        const body = kid(s, "txBody");
        if (body) {
          const isTitle = s === ctx.title;
          const hero = s === ctx.hero;
          restyleText(body, ctx, fillRgb ?? ctx.slideBg, !fillRgb, isTitle, hero);
        }
        break;
      }
      case "cxnSp":
      case "pic":
        restyleShapeColors(s, ctx, ctx.slideBg);
        break;
      case "graphicFrame":
        restyleTable(s, ctx);
        break;
    }
  }
}

/** Насыщенные цвета слайда с частотой (для ColorMapper). */
export function collectColors(doc: Document, src: ColorCtx, into: Map<string, number>) {
  for (const el of [...desc(doc, "solidFill", NS.a), ...desc(doc, "gs", NS.a)]) {
    const c = resolveColor(colorChild(el), src);
    if (c && chroma(c.rgb) >= 0.2) into.set(rgbToHex(c.rgb), (into.get(rgbToHex(c.rgb)) ?? 0) + 1);
  }
}

/** Оценка числа строк текста при кегле sz (пункты) и ширине w (пункты). */
function estimateHeight(text: string[], sz: number, wPt: number): number {
  let lines = 0;
  for (const para of text) {
    const width = para.length * sz * 0.6;
    lines += Math.max(1, Math.ceil(width / Math.max(1, wPt)));
  }
  return lines * sz * 1.18;
}

/**
 * Заголовок — на место и в стиль шаблона. Кегль уменьшается, если длинный
 * заголовок иначе наедет на содержимое ниже.
 */
export function placeTitle(title: Element, tree: Element, ctx: SlideStyleCtx, cy: number) {
  const { profile } = ctx;
  const spPr = kid(title, "spPr");
  const xfrm = kid(spPr, "xfrm");
  if (!spPr || !xfrm) return;
  const off = kid(xfrm, "off")!;
  const ext = kid(xfrm, "ext")!;
  const old: Box = { x: num(off, "x") ?? 0, y: num(off, "y") ?? 0, cx: num(ext, "cx") ?? 0, cy: num(ext, "cy") ?? 0 };
  const body = kid(title, "txBody")!;
  const paras = kids(body, "p").map((p) => desc(p, "t", NS.a).map((t) => t.textContent ?? "").join(""));
  const srcSz = Math.max(...desc(body, "rPr", NS.a).map((r) => num(r, "sz") ?? 1800)) / 100;
  // Рамка исходного заголовка бывает много выше самого текста — берём оценку текста
  const textH = Math.min(old.cy, estimateHeight(paras, srcSz, old.cx / 12700 - 14) * 12700);
  // Верх ближайшего содержимого под заголовком (по отдельным фигурам, не группам)
  let contentTop = cy;
  for (const p of placedShapes(tree)) {
    if (p.el === title || p.el.localName === "grpSp") continue;
    if (p.box.cx * p.box.cy > profile.cx * cy * 0.85) continue;
    if (p.box.y >= old.y + textH * 0.6) contentTop = Math.min(contentTop, p.box.y);
  }
  const x = profile.title.x;
  const y = Math.min(profile.title.y, old.y);
  const w = Math.max(profile.title.cx, Math.round(profile.cx * 0.6));
  const wPt = w / 12700 - 14;
  const room = Math.max(contentTop - Math.round(cy * 0.01), old.y + textH) - y;
  const target = profile.title.sz / 100;
  let sz = target;
  // Не мельче 16 pt (и не мельче исходного, если он и так помещался)
  const floor = Math.min(target, 16);
  while (sz > floor && estimateHeight(paras, sz, wPt) * 12700 + 91440 > room) sz -= 1;
  const h = Math.max(Math.round(estimateHeight(paras, sz, wPt) * 12700 + 91440), Math.min(old.cy, room));
  off.setAttribute("x", String(x));
  off.setAttribute("y", String(y));
  ext.setAttribute("cx", String(w));
  ext.setAttribute("cy", String(h));
  for (const r of [...desc(body, "rPr", NS.a), ...desc(body, "endParaRPr", NS.a)]) r.setAttribute("sz", String(Math.round(sz * 100)));
  for (const pPr of desc(body, "pPr", NS.a)) {
    pPr.setAttribute("algn", profile.title.algn);
    pPr.removeAttribute("marL");
    pPr.removeAttribute("indent");
  }
  const bodyPr = kid(body, "bodyPr");
  if (bodyPr) {
    bodyPr.setAttribute("wrap", "square");
    bodyPr.setAttribute("anchor", "t");
    for (const k of kids(bodyPr)) if (/Autofit$|^spAutoFit$/.test(k.localName)) bodyPr.removeChild(k);
    bodyPr.appendChild(make(title.ownerDocument!, NS.a, "normAutofit"));
  }
}
