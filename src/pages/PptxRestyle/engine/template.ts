// Анализ шаблона: какие в нём фоны, как оформлен заголовок и текст,
// какие цвета — фирменные. Шаблон может быть «настоящим» (оформление в
// макетах) или набором слайдов-примеров (фон и шрифты прямо на слайдах) —
// учитываем оба случая.
import { chroma, colorChild, contrast, hexToRgb, luminance, resolveColor, rgbToHex, rgbToHsl, type ColorCtx, type RGB } from "./color";
import { loadDeck, type Deck, type SlideInfo } from "./deck";
import { Pkg, relIs, RT } from "./pkg";
import { findTitle, placedShapes, hasText, maxSize } from "./shapes";
import { materializeText } from "./styles";
import { NS, attrR, desc, kid, num, parseXml, path, serializeXml, textOf } from "./xml";

export type Role = "title" | "section" | "content" | "end";

export interface BgOption {
  id: string;
  label: string;
  /** slide — фон слайда-примера; layout — фон макета */
  kind: "slide" | "layout";
  /** Часть шаблона: слайд-пример или макет */
  part: string;
  /** Картинка фона (для превью), если есть */
  image?: string;
  uses: number;
  /** Номер первого слайда-примера с этим фоном (с 1) */
  sample?: number;
}

export interface TextStyle {
  font: string;
  color: string;
  /** кегль, сотые пункта */
  sz: number;
  bold: boolean;
}

export interface TemplateProfile {
  name: string;
  cx: number;
  cy: number;
  dark: boolean;
  /** Цвет фона для расчёта контраста */
  bg: string;
  backgrounds: BgOption[];
  roles: Record<Role, string | null>;
  title: TextStyle & { x: number; y: number; cx: number; cy: number; algn: string };
  heroTitle: TextStyle;
  body: TextStyle;
  palette: string[];
  card: string | null;
  /** Макет для перенесённых слайдов (пустой) */
  blankLayout: string;
}

const ctxOf = (s: SlideInfo): ColorCtx => ({ scheme: s.scheme, map: s.map });

/** Копия документа слайда с закреплённым оформлением текста. */
export function materializedCopy(doc: Document, s: SlideInfo, deck: Deck): Document {
  const copy = parseXml(serializeXml(doc));
  for (const sp of desc(copy, "sp", NS.p)) materializeText(sp, { layout: s.layout, master: s.master, defaults: deck.defaults });
  return copy;
}

const runColor = (rPr: Element, ctx: ColorCtx): RGB =>
  resolveColor(colorChild(kid(rPr, "solidFill")), ctx)?.rgb ?? ctx.scheme[ctx.map.tx1 ?? "dk1"] ?? [0, 0, 0];

const runFont = (rPr: Element, s: SlideInfo): string => {
  const t = kid(rPr, "latin")?.getAttribute("typeface") || "";
  if (t === "+mj-lt") return s.fonts.major;
  if (t === "+mn-lt" || !t) return s.fonts.minor;
  return t;
};

const top = <T,>(m: Map<T, number>): T | undefined => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const add = <T,>(m: Map<T, number>, k: T, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

export async function analyzeTemplate(pkg: Pkg, name: string): Promise<{ deck: Deck; profile: TemplateProfile }> {
  const deck = await loadDeck(pkg, name);
  const bgs = new Map<string, BgOption>();
  const slideBg: string[] = [];
  const titleSlides: number[] = [];

  const titleFont = new Map<string, number>();
  const titleColor = new Map<string, number>();
  const titleSz = new Map<number, number>();
  const titleBold = new Map<boolean, number>();
  const titleBoxes: { x: number; y: number; cx: number; cy: number; algn: string }[] = [];
  const bodyFont = new Map<string, number>();
  const bodyColor = new Map<string, number>();
  const bodySz = new Map<number, number>();
  const fills = new Map<string, number>();
  const cards = new Map<string, number>();
  let hero: TextStyle | null = null;

  for (const s of deck.slides) {
    const doc = await pkg.xml(s.part);
    // ── Фон ──
    const bg = doc.getElementsByTagNameNS(NS.p, "bg")[0];
    let key: string;
    let opt: BgOption;
    if (bg) {
      const blip = desc(bg, "blip", NS.a)[0];
      const rel = blip ? s.rels.find((r) => r.id === attrR(blip, "embed")) : undefined;
      key = rel ? `img:${rel.abs}` : `bg:${new XMLSerializer().serializeToString(bg)}`;
      opt = { id: "", label: "", kind: "slide", part: s.part, image: rel?.abs, uses: 0, sample: s.index + 1 };
    } else {
      key = `layout:${s.layoutPart}`;
      const lbg = s.layout.getElementsByTagNameNS(NS.p, "bg")[0];
      const lblip = lbg ? desc(lbg, "blip", NS.a)[0] : undefined;
      const lrel = lblip ? (await pkg.rels(s.layoutPart)).find((r) => r.id === attrR(lblip, "embed")) : undefined;
      opt = { id: "", label: s.layoutName, kind: "layout", part: s.layoutPart, image: lrel?.abs, uses: 0, sample: s.index + 1 };
    }
    if (!bgs.has(key)) bgs.set(key, { ...opt, id: `bg${bgs.size + 1}` });
    bgs.get(key)!.uses++;
    slideBg.push(bgs.get(key)!.id);

    // ── Текст ──
    const copy = materializedCopy(doc, s, deck);
    const tree = copy.getElementsByTagNameNS(NS.p, "spTree")[0];
    const ctx = ctxOf(s);
    const title = findTitle(tree, deck.cy);
    if (title) {
      titleSlides.push(s.index);
      const chars = textOf(title.el).length;
      for (const r of desc(title.el, "rPr", NS.a)) {
        if (!textOf(r.parentNode as Element).trim()) continue;
        add(titleFont, runFont(r, s), chars);
        add(titleColor, rgbToHex(runColor(r, ctx)), chars);
        add(titleSz, num(r, "sz") ?? 1800, chars);
        add(titleBold, r.getAttribute("b") === "1", chars);
      }
      const algn = path(title.el, "txBody", "p", "pPr")?.getAttribute("algn") || "l";
      titleBoxes.push({ ...title.box, algn });
    }
    for (const p of placedShapes(tree)) {
      if (p.el.localName !== "sp") continue;
      // Заливки фигур — кандидаты в фирменную палитру и «карточки»
      const solid = path(p.el, "spPr", "solidFill");
      const fc = solid ? resolveColor(colorChild(solid), ctx) : null;
      // Цвета градиентов и линий — тоже фирменные
      for (const g of [...desc(path(p.el, "spPr", "gradFill"), "gs", NS.a), ...desc(path(p.el, "spPr", "ln"), "solidFill", NS.a)]) {
        const c = resolveColor(colorChild(g), ctx);
        if (c && chroma(c.rgb) >= 0.25) add(fills, rgbToHex(c.rgb), 2);
      }
      if (fc && fc.alpha > 0.3) {
        const hex = rgbToHex(fc.rgb);
        if (chroma(fc.rgb) >= 0.25) add(fills, hex, 3);
        else if (hasText(p.el) || p.box.cx * p.box.cy > deck.cx * deck.cy * 0.03) add(cards, hex);
      }
      if (!hasText(p.el) || (title && p.el === title.el)) continue;
      const big = maxSize(p.el);
      for (const r of desc(p.el, "rPr", NS.a)) {
        const t = textOf(r.parentNode as Element).trim();
        if (!t) continue;
        const sz = num(r, "sz") ?? 1800;
        const c = runColor(r, ctx);
        if (chroma(c) >= 0.25) add(fills, rgbToHex(c), t.length);
        if (sz > 2800) continue;
        add(bodyFont, runFont(r, s), t.length);
        if (chroma(c) < 0.25) add(bodyColor, rgbToHex(c), t.length);
        add(bodySz, sz, t.length);
      }
      if (s.index === 0 && big >= 3600 && !hero) {
        const r = desc(p.el, "rPr", NS.a).find((x) => textOf(x.parentNode as Element).trim());
        if (r) hero = { font: runFont(r, s), color: rgbToHex(runColor(r, ctx)), sz: big, bold: r.getAttribute("b") === "1" };
      }
    }
  }

  const backgrounds = [...bgs.values()];
  backgrounds.forEach((b, i) => {
    if (!b.label) b.label = `Фон ${i + 1}`;
  });

  // ── Роли фонов ──
  const count = (ids: string[]) => {
    const m = new Map<string, number>();
    ids.forEach((id) => add(m, id));
    return m;
  };
  const contentBg = top(count(titleSlides.map((i) => slideBg[i]))) ?? top(count(slideBg)) ?? null;
  const titleBg = slideBg[0] ?? contentBg;
  const lastIdx = deck.slides.length - 1;
  let endBg: string | null = null;
  if (lastIdx > 0) {
    const last = await pkg.xml(deck.slides[lastIdx].part);
    const textLen = desc(last, "t", NS.a).reduce((n, t) => n + (t.textContent ?? "").length, 0);
    if (textLen < 40 && slideBg[lastIdx] !== contentBg) endBg = slideBg[lastIdx];
  }
  // Раздел — слайд без заголовка сверху: немного текста, но крупного
  let sectionBg: string | null = null;
  for (const s of deck.slides) {
    if (s.index === 0 || s.index === lastIdx || titleSlides.includes(s.index)) continue;
    const id = slideBg[s.index];
    if (id === contentBg || id === endBg || id === titleBg) continue;
    const d = await pkg.xml(s.part);
    const tree = materializedCopy(d, s, deck).getElementsByTagNameNS(NS.p, "spTree")[0];
    const texts = placedShapes(tree).filter((p) => p.el.localName === "sp" && hasText(p.el));
    const big = Math.max(0, ...texts.map((p) => maxSize(p.el)));
    if (texts.length <= 5 && big >= 3200) {
      sectionBg = id;
      break;
    }
  }
  sectionBg ??= titleBg;
  for (const b of backgrounds) {
    const role = b.id === titleBg ? "титульный" : b.id === contentBg ? "основной" : b.id === sectionBg ? "раздел" : b.id === endBg ? "финальный" : "";
    if (role) b.label = `${b.label} — ${role}`;
  }

  // ── Стили текста ──
  const bodyColorHex = top(bodyColor) ?? "000000";
  const dark = luminance(hexToRgb(bodyColorHex)) > 0.5;
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const tb = titleBoxes.filter((b) => b.y < deck.cy * 0.2);
  const titleFontName = top(titleFont) ?? deck.slides[0]?.fonts.major ?? "Arial";
  const title = {
    font: titleFontName,
    color: top(titleColor) ?? bodyColorHex,
    sz: top(titleSz) ?? 3200,
    bold: top(titleBold) ?? false,
    x: median(tb.map((b) => b.x)) || Math.round(deck.cx * 0.04),
    y: median(tb.map((b) => b.y)) || Math.round(deck.cy * 0.04),
    cx: median(tb.map((b) => b.cx)) || Math.round(deck.cx * 0.9),
    cy: median(tb.map((b) => b.cy)) || Math.round(deck.cy * 0.1),
    algn: tb.length ? (tb.filter((b) => b.algn === "ctr").length > tb.length / 2 ? "ctr" : "l") : "l",
  };
  const body: TextStyle = {
    font: top(bodyFont) ?? deck.slides[0]?.fonts.minor ?? "Arial",
    color: bodyColorHex,
    sz: top(bodySz) ?? 1800,
    bold: false,
  };

  // ── Фирменная палитра: насыщенные цвета, без почти одинаковых оттенков ──
  const palette: string[] = [];
  for (const [hex] of [...fills.entries()].sort((a, b) => b[1] - a[1])) {
    const [h] = rgbToHsl(hexToRgb(hex));
    if (palette.some((p) => {
      const [h2] = rgbToHsl(hexToRgb(p));
      const d = Math.abs(h - h2);
      return Math.min(d, 1 - d) < 0.035;
    })) continue;
    palette.push(hex);
    if (palette.length >= 8) break;
  }
  if (!palette.length) {
    const sch = deck.slides[0]?.scheme ?? {};
    for (const k of ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) if (sch[k]) palette.push(rgbToHex(sch[k]));
  }

  const bgRgb: RGB = dark ? [18, 20, 30] : [255, 255, 255];
  const card =
    [...cards.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h)
      .find((h) => (dark ? luminance(hexToRgb(h)) < 0.2 : luminance(hexToRgb(h)) > 0.6) && contrast(hexToRgb(h), hexToRgb(bodyColorHex)) > 4) ?? null;

  // ── Макет для перенесённых слайдов: пустой макет мастера основного фона ──
  const contentOpt = backgrounds.find((b) => b.id === contentBg);
  const refSlide = deck.slides.find((s) => slideBg[s.index] === contentBg) ?? deck.slides[0];
  let blankLayout = refSlide?.layoutPart ?? "";
  if (refSlide) {
    const masterRels = await pkg.rels(refSlide.masterPart);
    for (const r of masterRels.filter((x) => relIs(x, RT.slideLayout))) {
      const l = await pkg.xml(r.abs);
      if (l.documentElement.getAttribute("type") === "blank") {
        blankLayout = r.abs;
        break;
      }
    }
  }
  if (contentOpt?.kind === "layout") blankLayout = contentOpt.part;

  return {
    deck,
    profile: {
      name,
      cx: deck.cx,
      cy: deck.cy,
      dark,
      bg: rgbToHex(bgRgb),
      backgrounds,
      roles: { title: titleBg, content: contentBg, section: sectionBg, end: endBg },
      title,
      heroTitle: hero ?? { font: title.font, color: title.color, sz: Math.max(title.sz * 1.6, 4400), bold: title.bold },
      body,
      palette,
      card,
      blankLayout,
    },
  };
}

