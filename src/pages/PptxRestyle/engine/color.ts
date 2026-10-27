// Цвета DrawingML: схема темы, преобразования (lumMod, tint…), контраст.
import { NS, kid, kids } from "./xml";

export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "").padStart(6, "0");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

export const rgbToHex = ([r, g, b]: RGB): string =>
  [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

/** Относительная яркость по WCAG (0…1). */
export function luminance([r, g, b]: RGB): number {
  const c = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Насыщенность «на глаз»: серые, белые и чёрные — около нуля. */
export function chroma([r, g, b]: RGB): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Цвет с прозрачностью (alpha 0…1). */
export interface Color {
  rgb: RGB;
  alpha: number;
}

/** Схема темы: dk1, lt1, accent1… → RGB. */
export type Scheme = Record<string, RGB>;

export function readScheme(theme: Document): Scheme {
  const out: Scheme = {};
  const cs = theme.getElementsByTagNameNS(NS.a, "clrScheme")[0];
  if (!cs) return out;
  for (const slot of kids(cs)) {
    const c = kids(slot)[0];
    if (!c) continue;
    if (c.localName === "srgbClr") out[slot.localName] = hexToRgb(c.getAttribute("val") || "000000");
    else if (c.localName === "sysClr") out[slot.localName] = hexToRgb(c.getAttribute("lastClr") || (c.getAttribute("val") === "window" ? "FFFFFF" : "000000"));
  }
  return out;
}

export interface ThemeFonts {
  major: string;
  minor: string;
}

export function readFonts(theme: Document): ThemeFonts {
  const font = (tag: string) => {
    const el = theme.getElementsByTagNameNS(NS.a, tag)[0];
    return kid(el, "latin")?.getAttribute("typeface") || "";
  };
  return { major: font("majorFont"), minor: font("minorFont") };
}

/** Сопоставление ролей (bg1, tx1…) слотам схемы: clrMap мастера с поправками. */
export type ClrMap = Record<string, string>;

export function readClrMap(el: Element | null | undefined, base?: ClrMap): ClrMap {
  const out: ClrMap = { ...(base ?? { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" }) };
  if (!el) return out;
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  return out;
}

export interface ColorCtx {
  scheme: Scheme;
  map: ClrMap;
  /** Цвет для phClr (цвет-заполнитель в стилях темы). */
  ph?: RGB;
}

const PRESET: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  gray: "808080",
  darkGray: "A9A9A9",
  lightGray: "D3D3D3",
  orange: "FFA500",
};

/** Цвет из элемента цвета DrawingML (srgbClr, schemeClr…) с преобразованиями. */
export function resolveColor(el: Element | null | undefined, ctx: ColorCtx): Color | null {
  if (!el) return null;
  let rgb: RGB | undefined;
  switch (el.localName) {
    case "srgbClr":
      rgb = hexToRgb(el.getAttribute("val") || "000000");
      break;
    case "sysClr":
      rgb = hexToRgb(el.getAttribute("lastClr") || (el.getAttribute("val") === "window" ? "FFFFFF" : "000000"));
      break;
    case "prstClr":
      rgb = hexToRgb(PRESET[el.getAttribute("val") || ""] ?? "000000");
      break;
    case "scrgbClr":
      rgb = [
        (Number(el.getAttribute("r")) / 100000) * 255,
        (Number(el.getAttribute("g")) / 100000) * 255,
        (Number(el.getAttribute("b")) / 100000) * 255,
      ];
      break;
    case "hslClr":
      rgb = hslToRgb([
        Number(el.getAttribute("hue")) / 21600000,
        Number(el.getAttribute("sat")) / 100000,
        Number(el.getAttribute("lum")) / 100000,
      ]);
      break;
    case "schemeClr": {
      const val = el.getAttribute("val") || "tx1";
      if (val === "phClr") rgb = ctx.ph ?? [0, 0, 0];
      else rgb = ctx.scheme[ctx.map[val] ?? val] ?? ctx.scheme[val] ?? [0, 0, 0];
      break;
    }
    default:
      return null;
  }
  let alpha = 1;
  for (const t of kids(el)) {
    const v = Number(t.getAttribute("val") || 0) / 100000;
    const hsl = () => rgbToHsl(rgb!);
    switch (t.localName) {
      case "alpha":
        alpha = v;
        break;
      case "lumMod": {
        const [h, s, l] = hsl();
        rgb = hslToRgb([h, s, Math.min(1, l * v)]);
        break;
      }
      case "lumOff": {
        const [h, s, l] = hsl();
        rgb = hslToRgb([h, s, Math.max(0, Math.min(1, l + v))]);
        break;
      }
      case "satMod": {
        const [h, s, l] = hsl();
        rgb = hslToRgb([h, Math.min(1, s * v), l]);
        break;
      }
      case "tint":
        rgb = mix([255, 255, 255], rgb!, v);
        break;
      case "shade":
        rgb = mix([0, 0, 0], rgb!, v);
        break;
    }
  }
  return { rgb: rgb!, alpha };
}

/** Первый элемент цвета внутри заливки (solidFill → srgbClr…). */
export const colorChild = (fill: Element | null | undefined): Element | null =>
  kids(fill).find((k) => /Clr$/.test(k.localName)) ?? null;
