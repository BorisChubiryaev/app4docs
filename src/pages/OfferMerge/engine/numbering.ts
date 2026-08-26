// Восстановление автонумерации Word.
//
// Номера пунктов (2.44, 1.2 …) в document.xml как текст ОТСУТСТВУЮТ — их
// рисует Word по numbering.xml. Чтобы находить пункт «по номеру» (а не по
// новому тексту), реконструируем нумерацию: идём по абзацам, ведём счётчики
// уровней для каждого numId и формируем номер вида «N.M» из десятичных уровней.
import { decodeXml } from "./ooxml";

const WT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const P_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

interface NumDefs {
  numToAbstract: Map<string, string>;
  starts: Map<string, Map<number, number>>; // abstractId -> ilvl -> start
}

export function parseNumbering(numberingXml: string | null): NumDefs {
  const numToAbstract = new Map<string, string>();
  const starts = new Map<string, Map<number, number>>();
  if (!numberingXml) return { numToAbstract, starts };

  const numRe = /<w:num\s+w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId\s+w:val="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(numberingXml)) !== null) numToAbstract.set(m[1], m[2]);

  const absRe = /<w:abstractNum\s+w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g;
  let a: RegExpExecArray | null;
  while ((a = absRe.exec(numberingXml)) !== null) {
    const id = a[1];
    const levels = new Map<number, number>();
    const lvlRe = /<w:lvl\s+w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
    let l: RegExpExecArray | null;
    while ((l = lvlRe.exec(a[0])) !== null) {
      const ilvl = parseInt(l[1], 10);
      const st = l[2].match(/<w:start\s+w:val="(\d+)"/);
      levels.set(ilvl, st ? parseInt(st[1], 10) : 1);
    }
    starts.set(id, levels);
  }
  return { numToAbstract, starts };
}

export interface NumberedPara {
  start: number;
  end: number;
  inner: string;
  text: string;
  number: string | null; // «2.44», «1.2» … либо null, если абзац не нумерован
}

function paraText(pXml: string): string {
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((m = WT_RE.exec(pXml)) !== null) parts.push(decodeXml(m[1]));
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Проиндексировать все абзацы документа с вычисленными номерами. */
export function indexNumberedParagraphs(
  documentXml: string,
  numberingXml: string | null,
): NumberedPara[] {
  const defs = parseNumbering(numberingXml);
  const counters = new Map<string, number[]>(); // numId -> counters по уровням
  const out: NumberedPara[] = [];

  let m: RegExpExecArray | null;
  P_RE.lastIndex = 0;
  while ((m = P_RE.exec(documentXml)) !== null) {
    const inner = m[0];
    let number: string | null = null;

    const numIdM = inner.match(/<w:numId\s+w:val="(\d+)"/);
    const ilvlM = inner.match(/<w:ilvl\s+w:val="(\d+)"/);
    // numPr присутствует только внутри <w:pPr>; убеждаемся, что это нумерация абзаца.
    if (numIdM && /<w:numPr>/.test(inner) && numIdM[1] !== "0") {
      const numId = numIdM[1];
      const ilvl = ilvlM ? parseInt(ilvlM[1], 10) : 0;
      const abstractId = defs.numToAbstract.get(numId);
      const levelStarts = abstractId ? defs.starts.get(abstractId) : undefined;
      const startOf = (lv: number) => levelStarts?.get(lv) ?? 1;

      const c = counters.get(numId) ?? [];
      if (c[ilvl] == null) c[ilvl] = startOf(ilvl);
      else c[ilvl] = c[ilvl] + 1;
      for (let k = ilvl + 1; k < c.length; k++) c[k] = undefined as unknown as number;
      counters.set(numId, c);

      const parts: number[] = [];
      for (let lv = 0; lv <= ilvl; lv++) parts.push(c[lv] ?? startOf(lv));
      number = parts.join(".");
    }

    out.push({ start: m.index, end: m.index + inner.length, inner, text: paraText(inner), number });
  }
  return out;
}

/** Нормализовать номер к виду «1.2» (убрать хвостовые точки/пробелы). */
export function normNumber(s: string): string {
  return s.trim().replace(/[.\s]+$/, "");
}

/** Найти абзац по номеру (напр. «1.2»), начиная с позиции fromOffset. */
export function findByNumber(
  index: NumberedPara[],
  number: string,
  fromOffset = 0,
): NumberedPara | null {
  const want = normNumber(number);
  for (const p of index) {
    if (p.start < fromOffset) continue;
    if (p.number && normNumber(p.number) === want) return p;
  }
  return null;
}
