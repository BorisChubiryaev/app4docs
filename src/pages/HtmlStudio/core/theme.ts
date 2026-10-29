// Оформление страницы: все цвета (CSS, inline-стили, SVG, цвета графиков в
// скриптах), CSS-переменные и шрифты. Замена цвета меняет его везде сразу —
// так «перекрашивается» вся страница одним кликом.

/** Кусок текста страницы, где могут быть цвета: стиль, атрибут, скрипт. */
export interface TextSlot {
  get(): string;
  set(v: string): void;
  kind: "style" | "attr" | "script";
}

export function slotsOf(doc: Document): TextSlot[] {
  const out: TextSlot[] = [];
  for (const st of Array.from(doc.querySelectorAll("style"))) {
    if (st.hasAttribute("data-he")) continue;
    out.push({ kind: "style", get: () => st.textContent ?? "", set: (v) => (st.textContent = v) });
  }
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    out.push({ kind: "attr", get: () => el.getAttribute("style") ?? "", set: (v) => el.setAttribute("style", v) });
  }
  for (const el of Array.from(doc.querySelectorAll("[fill],[stroke],[stop-color],[color],[bgcolor]"))) {
    for (const a of ["fill", "stroke", "stop-color", "color", "bgcolor"]) {
      if (el.hasAttribute(a)) out.push({ kind: "attr", get: () => el.getAttribute(a) ?? "", set: (v) => el.setAttribute(a, v) });
    }
  }
  for (const sc of Array.from(doc.querySelectorAll("script"))) {
    if (sc.src) continue;
    out.push({ kind: "script", get: () => sc.textContent ?? "", set: (v) => (sc.textContent = v) });
  }
  return out;
}

// ── Цвета ──

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+%?\s*)?\)/g;

/** Цвет из записи CSS → #rrggbb и прозрачность. */
export function parseColor(s: string): { hex: string; alpha: number } | null {
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${h.slice(0, 6).toLowerCase()}`, alpha };
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)(%?)\s*)?\)/);
  if (!m) return null;
  const hex = `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("")}`;
  const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
  return { hex, alpha };
}

export interface ColorUse {
  hex: string;
  count: number;
  /** Где встречается: стили, разметка, графики */
  where: Set<TextSlot["kind"]>;
}

export function findColors(doc: Document): ColorUse[] {
  const map = new Map<string, ColorUse>();
  for (const slot of slotsOf(doc)) {
    // В скриптах — только цвета в кавычках (это настройки графиков, а не код)
    const text = slot.get();
    const re = new RegExp(COLOR_RE.source, "g");
    for (const m of text.matchAll(re)) {
      if (slot.kind === "script") {
        const before = text[m.index! - 1];
        if (before !== "'" && before !== '"' && before !== "`") continue;
      }
      const c = parseColor(m[0]);
      if (!c) continue;
      const u = map.get(c.hex) ?? { hex: c.hex, count: 0, where: new Set() };
      u.count++;
      u.where.add(slot.kind);
      map.set(c.hex, u);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const toCss = (hex: string, alpha: number, wasRgb: boolean): string => {
  if (alpha >= 0.999) return hex;
  if (wasRgb) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number(alpha.toFixed(3))})`;
  }
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
};

/** Заменить цвет везде (прозрачность каждой записи сохраняется). */
export function replaceColor(doc: Document, from: string, to: string): number {
  let n = 0;
  const target = to.toLowerCase();
  for (const slot of slotsOf(doc)) {
    const text = slot.get();
    const re = new RegExp(COLOR_RE.source, "g");
    const next = text.replace(re, (m, offset: number) => {
      if (slot.kind === "script") {
        const before = text[offset - 1];
        if (before !== "'" && before !== '"' && before !== "`") return m;
      }
      const c = parseColor(m);
      if (!c || c.hex !== from) return m;
      n++;
      return toCss(target, c.alpha, m.startsWith("rgb"));
    });
    if (next !== text) slot.set(next);
  }
  return n;
}

// ── CSS-переменные ──

export interface CssVar {
  name: string;
  value: string;
}

export function findVars(doc: Document): CssVar[] {
  const out = new Map<string, string>();
  for (const st of Array.from(doc.querySelectorAll("style"))) {
    if (st.hasAttribute("data-he")) continue;
    const text = st.textContent ?? "";
    for (const block of text.matchAll(/(?::root|html|body|\.light|\.dark|\[data-theme[^\]]*\])\s*\{([^}]*)\}/g)) {
      for (const d of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) if (!out.has(d[1])) out.set(d[1], d[2].trim());
    }
  }
  return [...out.entries()].map(([name, value]) => ({ name, value }));
}

export function setVar(doc: Document, name: string, value: string) {
  const esc = name.replace(/[-]/g, "\\-");
  for (const st of Array.from(doc.querySelectorAll("style"))) {
    if (st.hasAttribute("data-he")) continue;
    const text = st.textContent ?? "";
    const next = text.replace(new RegExp(`(${esc}\\s*:\\s*)([^;}]+)`, "g"), (_m, a) => `${a}${value}`);
    if (next !== text) st.textContent = next;
  }
}

// ── Шрифты ──

export function findFonts(doc: Document): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const slot of slotsOf(doc)) {
    if (slot.kind === "script") continue;
    for (const m of slot.get().matchAll(/font-family\s*:\s*([^;}"]+)/g)) {
      const v = m[1].trim();
      map.set(v, (map.get(v) ?? 0) + 1);
    }
  }
  return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

export function replaceFont(doc: Document, from: string, to: string): number {
  let n = 0;
  for (const slot of slotsOf(doc)) {
    if (slot.kind === "script") continue;
    const text = slot.get();
    const next = text.replace(/(font-family\s*:\s*)([^;}"]+)/g, (m, a, v) => {
      if (v.trim() !== from) return m;
      n++;
      return `${a}${to}`;
    });
    if (next !== text) slot.set(next);
  }
  return n;
}

/** Шрифты, которые есть почти на любом компьютере (без интернета). */
export const SAFE_FONTS = [
  "Inter, Arial, sans-serif",
  "Arial, Helvetica, sans-serif",
  "'Segoe UI', Roboto, Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Verdana, sans-serif",
  "'Trebuchet MS', Arial, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Times New Roman', Times, serif",
  "'Courier New', monospace",
  "'SB Sans Display', 'SB Sans Text', Arial, sans-serif",
];
