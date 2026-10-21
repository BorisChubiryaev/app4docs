// Шрифты PDF → шрифты Word.
//
// pdf.js отдаёт в тексте внутренние имена («g_d0_f1»); настоящее имя шрифта
// («ABCDEF+TimesNewRomanPS-BoldMT») есть у загруженного объекта шрифта.
// Из него берём гарнитуру, жирность и наклон. Метрически совместимые
// свободные шрифты (Liberation, Arimo, Tinos…) заменяем на их офисные
// аналоги — так у получателя документ выглядит и переносится так же.

const ALIASES: [RegExp, string][] = [
  [/^(timesnewroman|times|liberationserif|tinos|nimbusroman|thorndale|freeserif)/, "Times New Roman"],
  [/^(arial|helvetica|liberationsans|arimo|nimbussans|freesans)/, "Arial"],
  [/^(couriernew|courier|liberationmono|cousine|nimbusmono|freemono)/, "Courier New"],
  [/^(calibri|carlito)/, "Calibri"],
  [/^(cambria|caladea)/, "Cambria"],
  [/^verdana/, "Verdana"],
  [/^tahoma/, "Tahoma"],
  [/^georgia/, "Georgia"],
  [/^garamond/, "Garamond"],
  [/^(segoeui|segoe)/, "Segoe UI"],
  [/^trebuchet/, "Trebuchet MS"],
  [/^(ptsans|ptsans)/, "PT Sans"],
  [/^ptserif/, "PT Serif"],
  [/^ptmono/, "PT Mono"],
  [/^(dejavusansmono)/, "DejaVu Sans Mono"],
  [/^(dejavusans)/, "DejaVu Sans"],
  [/^(dejavuserif)/, "DejaVu Serif"],
  [/^(robotomono)/, "Roboto Mono"],
  [/^roboto/, "Roboto"],
  [/^(opensans)/, "Open Sans"],
  [/^(symbol)/, "Symbol"],
  [/^(wingdings)/, "Wingdings"],
];

const STYLE_WORDS =
  /(bold|black|heavy|semibold|demibold|demi|extrabold|ultrabold|medium|light|thin|regular|roman|book|normal|italic|oblique|it$|mt$|ps$|condensed|narrow|cond)/gi;

export interface FontInfo {
  family: string;
  bold: boolean;
  italic: boolean;
}

const cache = new Map<string, FontInfo>();

/** Разбор имени шрифта PDF. `fallback` — семейство pdf.js (serif/sans-serif/monospace). */
export function parseFontName(rawName: string, fallback = ""): FontInfo {
  const key = `${rawName}|${fallback}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const name = rawName.replace(/^[A-Z]{6}\+/, "");
  const low = name.toLowerCase().replace(/[\s_]/g, "");
  const bold = /(bold|black|heavy|semibold|demibold|demi\b|extrabold|ultrabold|,b$|-b$|bd$)/.test(low);
  const italic = /(italic|oblique|,i$|-it$|it$|-i$|kursiv|slanted)/.test(low) && !/^(digital|capital)/.test(low);
  let family = "";
  const compact = low.replace(/[-,]/g, "");
  for (const [re, fam] of ALIASES)
    if (re.test(compact)) {
      family = fam;
      break;
    }
  if (!family) {
    // «MyriadPro-Regular» → «Myriad Pro»
    const base = name.split(/[-,]/)[0].replace(STYLE_WORDS, "");
    family = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  }
  if (!family || /^(g_|f\d|t\d|tt\d|font)/i.test(family)) {
    family = /mono/.test(fallback) ? "Courier New" : /sans/.test(fallback) ? "Arial" : "Times New Roman";
  }
  const info = { family, bold, italic };
  cache.set(key, info);
  return info;
}
