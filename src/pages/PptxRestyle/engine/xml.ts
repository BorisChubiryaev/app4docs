// Помощники для XML пакета PowerPoint (OOXML). Только стандартный DOM —
// работает и в браузере, и в Node (с @xmldom/xmldom в тестах).

export const NS = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
  p14: "http://schemas.microsoft.com/office/powerpoint/2010/main",
};

const PREFIX: Record<string, string> = {
  [NS.p]: "p",
  [NS.a]: "a",
  [NS.r]: "r",
  [NS.c]: "c",
  [NS.p14]: "p14",
};

export const parseXml = (text: string): Document => new DOMParser().parseFromString(text, "application/xml");

export const serializeXml = (doc: Document): string => {
  let s = new XMLSerializer().serializeToString(doc);
  if (!s.startsWith("<?xml")) s = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;
  return s;
};

const isEl = (n: Node | null): n is Element => !!n && n.nodeType === 1;

/** Дочерние элементы (по локальному имени и пространству имён). */
export function kids(el: Element | null | undefined, local?: string, ns?: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (!isEl(n)) continue;
    if (local && n.localName !== local) continue;
    if (ns && n.namespaceURI !== ns) continue;
    out.push(n);
  }
  return out;
}

export const kid = (el: Element | null | undefined, local: string, ns?: string): Element | null =>
  kids(el, local, ns)[0] ?? null;

/** Путь из дочерних элементов: path(el, "spPr", "xfrm", "off"). */
export function path(el: Element | null | undefined, ...locals: string[]): Element | null {
  let cur: Element | null | undefined = el;
  for (const l of locals) {
    cur = kid(cur, l);
    if (!cur) return null;
  }
  return cur ?? null;
}

/** Все потомки с локальным именем. */
export function desc(el: Element | Document | null | undefined, local: string, ns = "*"): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS(ns, local) as unknown as ArrayLike<Element>);
}

export function make(doc: Document, ns: string, local: string, attrs: Record<string, string | number> = {}): Element {
  const pre = PREFIX[ns];
  const el = doc.createElementNS(ns, pre ? `${pre}:${local}` : local);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export const removeEl = (el: Element | null | undefined) => {
  if (el?.parentNode) el.parentNode.removeChild(el);
};

export const removeKids = (el: Element | null | undefined, local: string) => kids(el, local).forEach(removeEl);

/** Вставить дочерний элемент по порядку схемы: перед первым из `before`. */
export function insertOrdered(parent: Element, child: Element, before: string[]) {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (isEl(n) && before.includes(n.localName)) {
      parent.insertBefore(child, n);
      return child;
    }
  }
  parent.appendChild(child);
  return child;
}

export const num = (el: Element | null | undefined, attr: string): number | undefined => {
  const v = el?.getAttribute(attr);
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const attrR = (el: Element, local: string): string | null =>
  el.getAttributeNS(NS.r, local) || el.getAttribute(`r:${local}`);

export const textOf = (el: Element): string =>
  desc(el, "t", NS.a)
    .map((t) => t.textContent ?? "")
    .join("");
