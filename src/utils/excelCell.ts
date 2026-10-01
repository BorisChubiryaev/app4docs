// Приведение значений ячеек ExcelJS к примитивам.
//
// ExcelJS отдаёт в cell.value не только строки и числа, но и объекты:
// формулы ({ formula, result }), форматированный текст ({ richText }),
// гиперссылки ({ text, hyperlink }), ошибки ({ error }) и Date.
// Такие объекты нельзя ни рендерить в React (падает вся страница),
// ни сравнивать через String() (получается "[object Object]").

const pad = (n: number) => String(n).padStart(2, "0");

// ExcelJS создаёт даты в UTC, поэтому форматируем по UTC-компонентам,
// иначе в часовых поясах западнее Гринвича дата съезжает на день назад.
const formatDate = (d: Date): string => {
  if (Number.isNaN(d.getTime())) return "";
  const date = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (h === 0 && m === 0 && s === 0) return date;
  return `${date} ${pad(h)}:${pad(m)}${s ? `:${pad(s)}` : ""}`;
};

export type CellPrimitive = string | number | boolean | null;

export const normalizeCellValue = (value: unknown): CellPrimitive => {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return formatDate(value);
  if (typeof value !== "object") return String(value);

  const v = value as Record<string, unknown>;

  // Формула (в т.ч. общая): берём закэшированный результат.
  if ("formula" in v || "sharedFormula" in v) {
    return normalizeCellValue(v.result);
  }
  if (Array.isArray(v.richText)) {
    return (v.richText as { text?: string }[]).map((r) => r?.text ?? "").join("");
  }
  // Гиперссылка: text сам может быть richText.
  if ("hyperlink" in v) {
    return normalizeCellValue(v.text ?? v.hyperlink);
  }
  if ("error" in v) return String(v.error);
  if ("text" in v) return normalizeCellValue(v.text);

  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

// .xls (Excel 97–2003) и .doc — это бинарный OLE-контейнер, а не zip.
// ExcelJS и mammoth читают только zip-форматы и падают с невнятной ошибкой
// "Can't find end of central directory", поэтому проверяем сигнатуру заранее.
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const isLegacyOfficeFile = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength < OLE_SIGNATURE.length) return false;
  const head = new Uint8Array(buffer, 0, OLE_SIGNATURE.length);
  return OLE_SIGNATURE.every((b, i) => head[i] === b);
};

export const LEGACY_XLS_MESSAGE =
  "файл в старом формате .xls (Excel 97–2003). Откройте его в Excel и сохраните как .xlsx (Файл → Сохранить как → Книга Excel).";
