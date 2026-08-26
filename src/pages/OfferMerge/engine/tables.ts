// Операции над таблицами Приложений Оферты: поиск нужной таблицы, добавление
// строк и ЗАМЕНА существующих строк по их номеру (первая ячейка).
import { escapeXml, decodeXml } from "./ooxml";
import { renderInsertRuns } from "./render";
import { sortKey } from "./alpha-sort";
import type { BuildOptions } from "./types";

const WT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

export interface TableSpan {
  start: number;
  end: number;
  inner: string; // весь <w:tbl>…</w:tbl>
}

/** Смещение заголовка приложения в документе. */
function appendixHeadingOffset(documentXml: string, appendix: string): number {
  const anchors =
    appendix === "2"
      ? ["Способы и особенности реализации Бесшовного", "Приложение № 2", "Приложение №2"]
      : [`Приложение № ${appendix}`, `Приложение №${appendix}`, "Компании информационного партнерства"];
  for (const a of anchors) {
    const p = documentXml.indexOf(a);
    if (p >= 0) return p;
  }
  return 0;
}

/** Найти таблицу приложения (первая <w:tbl> после его заголовка). */
export function findAppendixTable(documentXml: string, appendix: string): TableSpan | null {
  const from = appendixHeadingOffset(documentXml, appendix);
  const start = documentXml.indexOf("<w:tbl>", from);
  if (start < 0) return null;
  const endTag = documentXml.indexOf("</w:tbl>", start);
  if (endTag < 0) return null;
  const end = endTag + "</w:tbl>".length;
  return { start, end, inner: documentXml.slice(start, end) };
}

function cellText(tcXml: string): string {
  // Раны <w:t> внутри ячейки — непрерывный текст, склеиваем без пробелов
  // (иначе число «28», разбитое на раны «2» и «8», превратится в «2 8»).
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((m = WT_RE.exec(tcXml)) !== null) parts.push(decodeXml(m[1]));
  return parts.join("").replace(/\s+/g, " ").trim();
}

function tcPr(tcXml: string): string {
  const m = tcXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  return m ? m[0] : "";
}

/** Пересобрать <w:tc> с новым текстом (выделенным). */
function setCell(tcXml: string, text: string, opts: BuildOptions): string {
  return `<w:tc>${tcPr(tcXml)}<w:p>${renderInsertRuns(text, opts)}</w:p></w:tc>`;
}

function rowCells(trXml: string): string[] {
  return trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
}
function rowPr(trXml: string): string {
  const m = trXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);
  return m ? m[0] : "";
}

/**
 * Похожи ли наименования настолько, чтобы считать их одной компанией?
 * Используется как ПРЕДОХРАНИТЕЛЬ при откате на сопоставление по номеру:
 * заменять строку по номеру можно только если под этим номером стоит та же
 * компания (например, различие лишь в хвосте перечня сервисов), иначе мы
 * затрём чужую запись и потеряем её из Приложения.
 */
function namesCompatible(a: string, b: string): boolean {
  const x = sortKey(a).replace(/[^0-9a-zа-я]/g, "");
  const y = sortKey(b).replace(/[^0-9a-zа-я]/g, "");
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i >= 12; // длинный общий префикс — та же организация
}

export interface RowReplacement {
  /** Номер строки, указанный в документе «Изменения». */
  number: number;
  /** Новые значения ячеек. */
  cells: string[];
}

export interface ReplaceReport {
  xml: string;
  replaced: { number: number; name: string; atRow: number; byName: boolean }[];
  missing: { number: number; name: string }[];
  warnings: string[];
}

/**
 * Заменить строки таблицы.
 *
 * ВАЖНО: идентичность строки — это НАИМЕНОВАНИЕ компании, а не порядковый
 * номер. Номера в документе «Изменения» относятся к той редакции Приложения,
 * которая была актуальна на момент его подготовки, и легко расходятся с
 * номерами в текущей Оферте. Поэтому сопоставляем в два прохода:
 *   1) по наименованию (ключ сортировки) — надёжно;
 *   2) по номеру — только для тех правок, чьё наименование не найдено,
 *      и лишь если строка ещё не занята; расхождение фиксируем в отчёте.
 */
export function replaceRows(
  tableInner: string,
  replacements: RowReplacement[],
  opts: BuildOptions,
  nameCol = 1,
): ReplaceReport {
  const trs = tableInner.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  const rowsCells = trs.map((tr) => rowCells(tr));
  const rowNum = (i: number) => {
    const c = rowsCells[i][0];
    const t = c ? cellText(c).trim() : "";
    return /^\d+$/.test(t) ? parseInt(t, 10) : null;
  };
  const rowName = (i: number) => {
    const c = rowsCells[i][nameCol];
    return c ? cellText(c) : "";
  };

  const out = [...trs];
  const taken = new Set<number>();
  const replaced: ReplaceReport["replaced"] = [];
  const missing: ReplaceReport["missing"] = [];
  const warnings: string[] = [];

  const applyTo = (rowIdx: number, rep: RowReplacement, byName: boolean) => {
    const cells = rowsCells[rowIdx];
    if (rep.cells.length !== cells.length) {
      warnings.push(
        `строка «${rep.cells[nameCol] ?? rep.number}»: столбцов в правке ${rep.cells.length}, в таблице ${cells.length}`,
      );
    }
    // Номер (первую ячейку) сохраняем — он принадлежит текущей Оферте.
    const rebuilt = cells.map((tc, i) =>
      i === 0 || i >= rep.cells.length ? tc : setCell(tc, rep.cells[i], opts),
    );
    out[rowIdx] = `<w:tr>${rowPr(trs[rowIdx])}${rebuilt.join("")}</w:tr>`;
    taken.add(rowIdx);
    replaced.push({
      number: rep.number,
      name: rep.cells[nameCol] ?? "",
      atRow: rowNum(rowIdx) ?? rowIdx + 1,
      byName,
    });
  };

  const pending: RowReplacement[] = [];

  // Проход 1 — по наименованию.
  for (const rep of replacements) {
    const key = sortKey(rep.cells[nameCol] ?? "");
    if (!key) {
      pending.push(rep);
      continue;
    }
    const idx = rowsCells.findIndex(
      (_, i) => !taken.has(i) && sortKey(rowName(i)) === key,
    );
    if (idx >= 0) applyTo(idx, rep, true);
    else pending.push(rep);
  }

  // Проход 2 — по номеру, но ТОЛЬКО если под этим номером та же компания.
  for (const rep of pending) {
    const idx = rowsCells.findIndex((_, i) => !taken.has(i) && rowNum(i) === rep.number);
    const newName = rep.cells[nameCol] ?? "";
    if (idx >= 0 && namesCompatible(newName, rowName(idx))) {
      applyTo(idx, rep, false);
    } else if (idx >= 0) {
      // Под этим номером — ДРУГАЯ компания: не трогаем, иначе потеряем её.
      missing.push({ number: rep.number, name: newName });
      warnings.push(
        `«${newName.slice(0, 40)}» не найдена по наименованию, а под № ${rep.number} стоит другая компания («${rowName(idx).slice(0, 30)}») — строка не изменена`,
      );
    } else {
      missing.push({ number: rep.number, name: newName });
    }
  }

  const firstTr = tableInner.indexOf("<w:tr");
  const prefix = firstTr >= 0 ? tableInner.slice(0, firstTr) : tableInner;
  const suffix = tableInner.endsWith("</w:tbl>") ? "</w:tbl>" : "";
  return { xml: prefix + out.join("") + suffix, replaced, missing, warnings };
}

/** Построить <w:tr> для новой строки (используется при добавлении). */
export function buildRow(cells: string[], opts: BuildOptions): string {
  const tcs = cells
    .map((c) => `<w:tc><w:tcPr/><w:p>${renderInsertRuns(c, opts)}</w:p></w:tc>`)
    .join("");
  return `<w:tr>${tcs}</w:tr>`;
}

export { escapeXml };
