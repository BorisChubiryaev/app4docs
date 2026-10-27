// Обход фигур слайда с абсолютными координатами и поиск заголовка.
import { NS, desc, kid, kids, num, path, textOf } from "./xml";
import { phOf, isTitlePh } from "./styles";

export interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

const SHAPES = new Set(["sp", "pic", "grpSp", "graphicFrame", "cxnSp", "contentPart"]);

/** Рамка фигуры в координатах родителя. */
export function boxOf(shape: Element): Box | null {
  const pr = kids(shape).find((k) => k.localName === "spPr" || k.localName === "grpSpPr");
  const xfrm = shape.localName === "graphicFrame" ? kid(shape, "xfrm") : kid(pr, "xfrm");
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return null;
  return { x: num(off, "x") ?? 0, y: num(off, "y") ?? 0, cx: num(ext, "cx") ?? 0, cy: num(ext, "cy") ?? 0 };
}

/** Фигуры контейнера (с раскрытием mc:AlternateContent). */
export function shapesIn(container: Element): Element[] {
  const out: Element[] = [];
  for (const k of kids(container)) {
    if (SHAPES.has(k.localName)) out.push(k);
    else if (k.localName === "AlternateContent") {
      const branch = kids(k).find((b) => b.localName === "Choice") ?? kids(k).find((b) => b.localName === "Fallback");
      if (branch) out.push(...shapesIn(branch));
    }
  }
  return out;
}

export interface Placed {
  el: Element;
  box: Box;
  depth: number;
}

/** Все фигуры с абсолютными рамками (группы раскрываются). */
export function placedShapes(tree: Element): Placed[] {
  const out: Placed[] = [];
  const walk = (container: Element, tr: (b: Box) => Box, depth: number) => {
    for (const s of shapesIn(container)) {
      const b = boxOf(s);
      const abs = b ? tr(b) : null;
      if (abs) out.push({ el: s, box: abs, depth });
      if (s.localName === "grpSp" && b) {
        const xfrm = path(s, "grpSpPr", "xfrm");
        const chOff = kid(xfrm, "chOff");
        const chExt = kid(xfrm, "chExt");
        const cx0 = num(chOff, "x") ?? b.x;
        const cy0 = num(chOff, "y") ?? b.y;
        const kx = (num(chExt, "cx") || b.cx) ? b.cx / (num(chExt, "cx") || b.cx || 1) : 1;
        const ky = (num(chExt, "cy") || b.cy) ? b.cy / (num(chExt, "cy") || b.cy || 1) : 1;
        const inner = (c: Box): Box => tr({ x: b.x + (c.x - cx0) * kx, y: b.y + (c.y - cy0) * ky, cx: c.cx * kx, cy: c.cy * ky });
        walk(s, inner, depth + 1);
      }
    }
  };
  walk(tree, (b) => b, 0);
  return out;
}

/** Наибольший кегль текста фигуры (в сотых пункта). */
export function maxSize(shape: Element): number {
  let m = 0;
  for (const r of desc(shape, "rPr", NS.a)) {
    const t = r.parentNode as Element;
    if (!textOf(t).trim()) continue;
    m = Math.max(m, num(r, "sz") ?? 1800);
  }
  return m;
}

export const hasText = (shape: Element) => !!kid(shape, "txBody") && textOf(kid(shape, "txBody")!).trim().length > 0;

/**
 * Заголовок слайда: плейсхолдер заголовка или текст с самым крупным
 * кеглем в верхней части слайда.
 */
export function findTitle(tree: Element, cy: number): Placed | null {
  const all = placedShapes(tree).filter((p) => p.el.localName === "sp" && hasText(p.el));
  // Плейсхолдер заголовка — если он сверху (на титульных он посередине)
  const ph = all.find((p) => isTitlePh(phOf(p.el)));
  if (ph && ph.box.y <= cy * 0.25) return ph;
  let best: Placed | null = null;
  let bestSz = 0;
  for (const p of all) {
    if (p.box.y > cy * 0.2) continue;
    const t = textOf(kid(p.el, "txBody")!).trim();
    if (t.length > 220) continue;
    const sz = maxSize(p.el);
    if (sz < 1600) continue;
    if (sz > bestSz || (sz === bestSz && best && p.box.y < best.box.y)) {
      best = p;
      bestSz = sz;
    }
  }
  if (!best) return null;
  // Заголовок — самый крупный текст в верхней зоне, а не подпись к схеме
  const bigger = all.some((p) => p !== best && p.box.y <= cy * 0.2 && maxSize(p.el) > bestSz);
  return bigger ? null : best;
}

/** Самый крупный текст слайда (для титульных слайдов). */
export function biggestText(tree: Element): Placed | null {
  let best: Placed | null = null;
  let bestSz = 0;
  for (const p of placedShapes(tree)) {
    if (p.el.localName !== "sp" || !hasText(p.el)) continue;
    const sz = maxSize(p.el);
    if (sz > bestSz) {
      best = p;
      bestSz = sz;
    }
  }
  return best;
}
