import type { CellPrimitive } from "../../../utils/excelCell";
import type { ExcelSheet } from "../../../types/sheet.types";

/** 1 → A, 27 → AA */
export const columnLetter = (n: number): string => {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26);
  }
  return s;
};

/** Адрес ячейки по 0-based координатам: (0, 0) → A1 */
export const cellAddress = (r: number, c: number): string =>
  `${columnLetter(c + 1)}${r + 1}`;

interface NumFmt {
  /** -1 — выводить как есть */
  decimals: number;
  percent: boolean;
  thousands: boolean;
}

const fmtCache = new Map<string, NumFmt>();

const parseNumFmt = (numFmt: string): NumFmt => {
  const cached = fmtCache.get(numFmt);
  if (cached) return cached;

  const f: NumFmt = {
    decimals: 0,
    percent: numFmt.includes("%"),
    thousands: numFmt.includes("#") || /0,0/.test(numFmt),
  };
  const decimalMatch = numFmt.match(/[0#]\.([0#]+)/);
  if (decimalMatch) f.decimals = decimalMatch[1].length;
  else if (numFmt === "@" || numFmt.toLowerCase() === "standard") f.decimals = -1;

  fmtCache.set(numFmt, f);
  return f;
};

const groupThousands = (s: string): string => {
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
};

// 0.1 + 0.2 → 0.3, как показывает Excel, а не 0.30000000000000004.
const plain = (v: number): string => String(Number(v.toPrecision(15)));

export const formatNumber = (value: number, numFmt?: string): string => {
  if (!numFmt) return groupThousands(plain(value));
  const f = parseNumFmt(numFmt);
  const v = f.percent ? value * 100 : value;
  let s =
    f.decimals === -1
      ? plain(v)
      : f.decimals > 0
        ? v.toFixed(f.decimals)
        : String(Math.round(v));
  if (f.thousands) s = groupThousands(s);
  if (f.percent) s += "%";
  return s;
};

export const formatValue = (v: CellPrimitive | undefined, numFmt?: string): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatNumber(v, numFmt);
  if (typeof v === "boolean") return v ? "ИСТИНА" : "ЛОЖЬ";
  return v;
};

/** Отображаемое значение ячейки листа (с учётом числового формата). */
export const displayCell = (sheet: ExcelSheet, r: number, c: number): string => {
  const v = sheet.rows[r]?.[c];
  if (typeof v !== "number") return formatValue(v);
  const fi = sheet.fmt[r]?.[c];
  return formatNumber(v, fi === undefined ? undefined : sheet.numFmts[fi]);
};
