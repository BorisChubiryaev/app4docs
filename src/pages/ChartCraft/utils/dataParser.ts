import type {
  CellValue,
  ChartType,
  ColumnInfo,
  ColumnType,
  ParsedData,
  Row,
} from "../types";
import type { ExcelSheet } from "../../../types/sheet.types";
import { parseExcelInWorker } from "../../../utils/parseExcelInWorker";
import { isLegacyOfficeFile, LEGACY_XLS_MESSAGE } from "../../../utils/excelCell";

/** Книга: все листы разобраны один раз, переключение листа — без повторного чтения. */
export interface Workbook {
  fileName: string;
  sheets: { name: string; grid: unknown[][] }[];
}

export async function readWorkbook(file: File): Promise<Workbook> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "txt" || ext === "tsv") {
    const text = decodeText(await file.arrayBuffer());
    return {
      fileName: file.name,
      sheets: [{ name: "CSV", grid: csvToRows(text, detectDelimiter(text)) }],
    };
  }
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    const buf = await file.arrayBuffer();
    if (isLegacyOfficeFile(buf)) throw new Error(`«${file.name}» — ${LEGACY_XLS_MESSAGE}`);
    const sheets = await parseExcelInWorker(buf);
    if (!sheets.length) throw new Error("В книге нет листов.");
    return { fileName: file.name, sheets: sheets.map(sheetToGrid) };
  }
  throw new Error(`Формат .${ext} не поддерживается — нужен CSV или XLSX.`);
}

/** Данные, вставленные из буфера обмена (Excel/Google Таблицы — через табуляцию). */
export function readPastedText(text: string): Workbook {
  const trimmed = text.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const delimiter = trimmed.includes("\t") ? "\t" : detectDelimiter(trimmed);
  return {
    fileName: "Вставленные данные",
    sheets: [{ name: "Вставка", grid: csvToRows(trimmed, delimiter) }],
  };
}

/** Лист книги → ParsedData; бросает понятную ошибку, если данных нет. */
export function workbookSheet(wb: Workbook, sheetName?: string): ParsedData {
  const candidates = sheetName
    ? wb.sheets.filter((s) => s.name === sheetName)
    : // По умолчанию — первый лист, в котором есть хотя бы две строки.
      [...wb.sheets.filter((s) => s.grid.length >= 2), ...wb.sheets];
  const sheet = candidates[0];
  if (!sheet) throw new Error("Лист не найден.");
  const data = processGrid(sheet.grid, wb.fileName, sheet.name);
  return { ...data, sheetNames: wb.sheets.map((s) => s.name) };
}

const sheetToGrid = (s: ExcelSheet) => ({
  name: s.name,
  grid: Array.from({ length: s.rowCount }, (_, r) =>
    Array.from({ length: s.colCount }, (_, c) => s.rows[r]?.[c] ?? null),
  ),
});

// ── CSV ──────────────────────────────────────────────────────────────────────

/** UTF-8, а если в нём «битые» символы — Windows-1251 (так сохраняет русский Excel). */
function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("windows-1251").decode(buf);
  } catch {
    return utf8;
  }
}

/** Разбор CSV с учётом кавычек и заданного разделителя. */
export function csvToRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // \r\n — перевод строки обработает \n
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Разделитель — тот, что даёт одинаковое число колонок в первых строках. */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ",";
  let bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts[0]) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// ── Сетка → строки ───────────────────────────────────────────────────────────

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Строка заголовков — первая «широкая» строка: над таблицей часто стоит
 * название отчёта в одной ячейке, его пропускаем.
 */
function findHeaderRow(grid: unknown[][]): number {
  const widths = grid.slice(0, 15).map((r) => r.filter((c) => !isEmpty(c)).length);
  const max = Math.max(0, ...widths);
  const need = Math.max(2, Math.ceil(max * 0.6));
  const idx = widths.findIndex((w) => w >= need);
  return idx < 0 ? widths.findIndex((w) => w > 0) : idx;
}

function processGrid(grid: unknown[][], fileName: string, sheetName: string): ParsedData {
  const h = findHeaderRow(grid);
  if (h < 0) throw new Error("Файл пуст — в нём нет данных.");
  const headerRow = grid[h];

  // Колонки без заголовка и без значений — выбрасываем (один проход по сетке).
  const filledCol: boolean[] = headerRow.map((c) => !isEmpty(c));
  for (let r = h + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    for (let c = 0; c < cells.length; c++) if (!filledCol[c] && !isEmpty(cells[c])) filledCol[c] = true;
  }
  const used: number[] = [];
  filledCol.forEach((f, c) => f && used.push(c));
  const seen = new Map<string, number>();
  const headers = used.map((c, i) => {
    const raw = isEmpty(headerRow[c]) ? `Столбец ${i + 1}` : String(headerRow[c]).trim();
    const n = seen.get(raw) ?? 0;
    seen.set(raw, n + 1);
    return n ? `${raw} (${n + 1})` : raw;
  });

  const raw: Row[] = [];
  for (let r = h + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    if (used.every((c) => isEmpty(cells[c]))) continue;
    const obj: Row = {};
    used.forEach((c, i) => {
      const v = cells[c];
      obj[headers[i]] = isEmpty(v)
        ? null
        : typeof v === "number" || typeof v === "string"
          ? v
          : typeof v === "boolean"
            ? v
              ? "Да"
              : "Нет"
            : String(v);
    });
    raw.push(obj);
  }
  if (!raw.length) throw new Error("В таблице есть заголовки, но нет строк с данными.");

  const rows = convertNumericColumns(raw, headers);
  return { headers, rows, fileName, sheetName, totalRows: rows.length };
}

// ── Числа и даты ─────────────────────────────────────────────────────────────

const DATE_RE = [
  /^\d{1,2}[./]\d{1,2}[./]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/, // 01.02.2025, 1/2/25 10:30
  /^\d{4}-\d{1,2}-\d{1,2}([T\s]\d{1,2}:\d{2}(:\d{2})?)?/, // 2025-02-01
  /^\d{1,2}[./]\d{4}$/, // 02.2025
];

export const looksLikeDate = (v: unknown): boolean =>
  typeof v === "string" && DATE_RE.some((re) => re.test(v.trim()));

/** Дата из строки → метка времени (для сортировки по времени). */
export function dateKey(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[./](\d{4})$/);
  if (m) return Date.UTC(Number(m[2]), Number(m[1]) - 1, 1);
  return null;
}

export function parseNumericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  let s = raw.trim();
  if (!s || s === "-" || s === "." || looksLikeDate(s)) return null;

  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$€£¥₽₴₸₹¢]|руб\.?|р\.$/gi, "").trim();
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  if (/^[-−–]/.test(s)) {
    neg = !neg;
    s = s.slice(1).trim();
  }
  s = s.replace(/[\s\u00A0\u202F']/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas > 0 && dots > 0) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (commas === 1) {
    s = s.replace(",", "."); // по-русски запятая — десятичная
  } else if (commas > 1) {
    s = s.replace(/,/g, "");
  } else if (dots > 1) {
    s = s.replace(/\./g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Столбцы, где ≥ 80 % непустых значений — числа, превращаем в числа. Пустые остаются null. */
function convertNumericColumns(rows: Row[], headers: string[]): Row[] {
  const numeric = new Set<string>();
  for (const h of headers) {
    let filled = 0;
    let nums = 0;
    for (const r of rows) {
      const v = r[h];
      if (v === null) continue;
      filled++;
      if (parseNumericValue(v) !== null) nums++;
    }
    if (filled > 0 && nums / filled >= 0.8) numeric.add(h);
  }
  if (!numeric.size) return rows;
  return rows.map((r) => {
    const out: Row = { ...r };
    numeric.forEach((h) => {
      out[h] = parseNumericValue(r[h]);
    });
    return out;
  });
}

export function detectColumnTypes(data: ParsedData): ColumnInfo[] {
  return data.headers.map((name) => {
    const vals = data.rows.map((r) => r[name]);
    const filled = vals.filter((v): v is Exclude<CellValue, null> => v !== null);
    const nums = filled.filter((v): v is number => typeof v === "number");
    const dates = filled.filter(looksLikeDate);

    let type: ColumnType = "unknown";
    if (filled.length && nums.length === filled.length) type = "numeric";
    else if (filled.length && dates.length >= filled.length * 0.8) type = "date";
    else if (filled.length) type = "category";

    let min: number | undefined;
    let max: number | undefined;
    if (type === "numeric") {
      min = nums.reduce((a, b) => (b < a ? b : a), Infinity);
      max = nums.reduce((a, b) => (b > a ? b : a), -Infinity);
    }
    return {
      name,
      type,
      sampleValues: filled.slice(0, 5),
      uniqueCount: new Set(filled.map(String)).size,
      nullCount: vals.length - filled.length,
      filledCount: filled.length,
      min,
      max,
    };
  });
}

/** Столбцы по умолчанию: X — категории или даты, Y — первое число, не совпадающее с X. */
export function defaultColumns(cols: ColumnInfo[]): { x: string; y: string[] } {
  const x =
    cols.find((c) => c.type === "date") ??
    cols.find((c) => c.type === "category") ??
    cols[0];
  const y = cols.find((c) => c.type === "numeric" && c.name !== x?.name);
  return { x: x?.name ?? "", y: y ? [y.name] : [] };
}

/** Подходящий тип графика по выбранным столбцам. */
export function suggestChartType(x: ColumnInfo | undefined, ys: ColumnInfo[]): ChartType {
  if (!x || !ys.length) return "bar";
  if (x.type === "date") return ys.length > 1 ? "line" : "area";
  if (x.type === "numeric" && x.uniqueCount > 12) return "scatter";
  if (ys.length === 1 && x.uniqueCount >= 2 && x.uniqueCount <= 6) return "donut";
  if (x.uniqueCount > 12) return ys.length > 1 ? "line" : "barH";
  return "bar";
}
