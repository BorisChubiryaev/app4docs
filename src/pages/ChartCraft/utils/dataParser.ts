import * as XLSX from "xlsx";
import type { ParsedData, ColumnInfo, ColumnType, ChartType } from "../types";

export async function parseFile(file: File): Promise<ParsedData> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") return parseCSV(file);
  if (["xlsx", "xls"].includes(ext || "")) return parseExcel(file);
  throw new Error(`Неподдерживаемый формат: .${ext}`);
}

async function parseCSV(file: File): Promise<ParsedData> {
  const text = await file.text();
  const wb = XLSX.read(text, { type: "string" });
  return processWorkbook(wb, file.name);
}

async function parseExcel(file: File): Promise<ParsedData> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return processWorkbook(wb, file.name);
}

function processWorkbook(wb: XLSX.WorkBook, fileName: string): ParsedData {
  const sn = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sn], {
    defval: null,
    raw: false,
  });
  if (!rows.length) throw new Error("Файл пуст");
  const cleaned = cleanData(rows);
  return {
    headers: Object.keys(cleaned[0]),
    rows: cleaned,
    fileName,
    sheetName: sn,
    totalRows: cleaned.length,
  };
}

export function parseNumericValue(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s || s === "-" || s === ".") return null;

  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\$€£¥₽₴₸₹¢]/g, "").trim();
  const pct = s.endsWith("%");
  if (pct) s = s.slice(0, -1).trim();
  if (/^[-−–]/.test(s)) {
    neg = !neg;
    s = s.slice(1).trim();
  }

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas > 0 && dots > 0) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (commas === 1 && dots === 0) {
    const after = s.split(",")[1];
    s =
      after?.length === 3 && s.split(",")[0].length > 3
        ? s.replace(",", "")
        : s.replace(",", ".");
  } else if (commas > 1) {
    s = s.replace(/,/g, "");
  } else if (dots > 1) {
    s = s.replace(/\./g, "");
  }

  s = s.replace(/\s/g, "").replace(/^\+/, "");
  const n = Number(s);
  if (isNaN(n) || !isFinite(n)) return null;
  return neg ? -Math.abs(n) : Math.abs(n);
}

function cleanData(rows: Record<string, any>[]): Record<string, any>[] {
  if (!rows.length) return rows;
  const headers = Object.keys(rows[0]);
  const sample = Math.min(20, rows.length);
  const numCols = new Set<string>();

  for (const h of headers) {
    let nc = 0,
      ne = 0;
    for (let i = 0; i < sample; i++) {
      const v = rows[i][h];
      if (v == null || v === "") continue;
      ne++;
      if (parseNumericValue(v) !== null) nc++;
    }
    if (ne > 0 && nc / ne > 0.6) numCols.add(h);
  }

  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const h of headers) {
      if (numCols.has(h)) {
        const p = parseNumericValue(row[h]);
        out[h] = p !== null ? p : 0;
      } else {
        out[h] = row[h];
      }
    }
    return out;
  });
}

export function detectColumnTypes(data: ParsedData): ColumnInfo[] {
  return data.headers.map((header) => {
    const vals = data.rows.map((r) => r[header]);
    const nonNull = vals.filter((v) => v != null && v !== "");
    const nullCount = vals.length - nonNull.length;
    const nums = nonNull.filter((v) => typeof v === "number" && isFinite(v));
    const isNum = nums.length > nonNull.length * 0.7;
    const dates = nonNull.filter(
      (v) => typeof v !== "number" && !isNaN(new Date(v).getTime()),
    );
    const isDate = !isNum && dates.length > nonNull.length * 0.7;

    let type: ColumnType = "unknown";
    let min: number | undefined, max: number | undefined;
    if (isNum) {
      type = "numeric";
      const n = nums as number[];
      min = Math.min(...n);
      max = Math.max(...n);
    } else if (isDate) {
      type = "date";
    } else {
      type = "category";
    }

    return {
      name: header,
      type,
      sampleValues: nonNull.slice(0, 5),
      uniqueCount: new Set(nonNull).size,
      nullCount,
      min,
      max,
    };
  });
}

export function suggestChartType(
  cols: ColumnInfo[],
  rowCount: number,
): ChartType {
  const num = cols.filter((c) => c.type === "numeric");
  const cat = cols.filter((c) => c.type === "category");
  const dat = cols.filter((c) => c.type === "date");
  if (dat.length > 0 && num.length > 0) return "line";
  if (cat.length > 0 && num.length === 1 && rowCount <= 10) return "pie";
  if (num.length >= 2 && cat.length === 0) return "scatter";
  if (num.length > 2 && cat.length > 0) return "composed";
  if (cat.length > 0 && num.length > 0) return rowCount > 20 ? "line" : "bar";
  if (num.length >= 3 && rowCount <= 8) return "radar";
  return "bar";
}
