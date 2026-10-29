// Тексты страницы списком: для «переписать», перевода и замены слов, не
// трогая разметку.

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CODE", "PRE"]);

export interface TextItem {
  node: Text;
  /** Ближайший элемент-блок — для подсветки и перехода */
  el: Element;
  text: string;
}

export function listTexts(doc: Document): TextItem[] {
  const out: TextItem[] = [];
  if (!doc.body) return out;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!(n.textContent ?? "").trim()) return NodeFilter.FILTER_REJECT;
      for (let p = n.parentElement; p; p = p.parentElement) if (SKIP.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    out.push({ node: t, el: t.parentElement!, text: t.textContent ?? "" });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeMatcher(find: string, opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }): RegExp | null {
  if (!find) return null;
  try {
    let src = opts.regex ? find : escapeRe(find);
    if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
    return new RegExp(src, `g${opts.caseSensitive ? "" : "i"}u`);
  } catch {
    return null;
  }
}

export function countMatches(items: TextItem[], re: RegExp | null): number {
  if (!re) return 0;
  let n = 0;
  for (const it of items) n += (it.node.textContent ?? "").match(new RegExp(re.source, re.flags))?.length ?? 0;
  return n;
}

/** Заменить во всех текстах страницы; возвращает число замен. */
export function replaceAll(items: TextItem[], re: RegExp | null, to: string): number {
  if (!re) return 0;
  let n = 0;
  for (const it of items) {
    const t = it.node.textContent ?? "";
    const next = t.replace(new RegExp(re.source, re.flags), (...m) => {
      n++;
      // $1… в замене работают и без «регулярок» не мешают
      return to.replace(/\$(\d)/g, (_x, d) => (m[Number(d)] as string) ?? "");
    });
    if (next !== t) it.node.textContent = next;
  }
  return n;
}
