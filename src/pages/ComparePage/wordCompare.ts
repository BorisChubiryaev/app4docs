// Движок структурного сравнения Word-документов (.docx).
//
// Прежняя версия использовала mammoth.extractRawText (плоский текст) и
// эвристику «строка похожа на таблицу по табам/запятым» — из-за этого
// изменения в таблицах терялись, а абзацы путались при сдвиге структуры.
//
// Здесь мы разбираем document.xml напрямую (через JSZip), сохраняя порядок
// и структуру: абзацы и таблицы (строки/ячейки). Затем выравниваем блоки
// с учётом схожести и строим пословный diff — понятная и надёжная картина.

import JSZip from "jszip";

// ─── Модель документа ───────────────────────────────────────────────

export interface DocParagraph {
  kind: "paragraph";
  text: string;
}
export interface DocTable {
  kind: "table";
  rows: string[][];
}
export type DocBlock = DocParagraph | DocTable;

export interface WordDocModel {
  blocks: DocBlock[];
  paragraphCount: number;
  tableCount: number;
}

// ─── Результат сравнения ────────────────────────────────────────────

export type InlineToken = { text: string; type: "same" | "del" | "ins" };

export type RowStatus = "identical" | "modified" | "added" | "removed";

export interface CompareRow {
  id: string;
  kind: "paragraph" | "table" | "table-cell" | "table-row";
  status: RowStatus;
  /** Человекочитаемое местоположение, напр. «Абзац 4» или «Таблица 2 · строка 3 · столбец 2». */
  location: string;
  leftText: string;
  rightText: string;
  /** Пословный diff для «modified» (для остальных — просто текст одним токеном). */
  leftTokens: InlineToken[];
  rightTokens: InlineToken[];
}

export interface WordCompareResult {
  rows: CompareRow[];
  changed: number;
  added: number;
  removed: number;
  identical: number;
}

// ─── Парсинг .docx ──────────────────────────────────────────────────

const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Текст одного абзаца (w:p): собираем w:t, w:tab → таб, w:br → перевод строки. */
function paragraphText(p: Element): string {
  let out = "";
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 1) {
        const el = child as Element;
        const name = el.localName;
        if (name === "t") {
          out += el.textContent || "";
        } else if (name === "tab") {
          out += "\t";
        } else if (name === "br" || name === "cr") {
          out += "\n";
        } else if (name === "delText") {
          // Удалённый в режиме правок текст игнорируем — сравниваем финал.
        } else {
          walk(el);
        }
      }
    });
  };
  walk(p);
  return out;
}

/** Все прямые дочерние элементы с данным localName. */
function directChildren(parent: Element, localName: string): Element[] {
  const res: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      res.push(n as Element);
    }
  }
  return res;
}

/** Текст ячейки таблицы: объединяем её абзацы через перевод строки. */
function cellText(tc: Element): string {
  return directChildren(tc, "p")
    .map((p) => paragraphText(p))
    .join("\n")
    .trim();
}

function parseTable(tbl: Element): DocTable {
  const rows: string[][] = [];
  for (const tr of directChildren(tbl, "tr")) {
    const cells = directChildren(tr, "tc").map((tc) => cellText(tc));
    rows.push(cells);
  }
  return { kind: "table", rows };
}

/**
 * Разбирает .docx в упорядоченный список блоков (абзацы и таблицы),
 * сохраняя порядок появления в документе.
 */
export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<WordDocModel> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Это не похоже на .docx (нет word/document.xml)");
  }
  const xml = await docFile.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");

  // getElementsByTagNameNS устойчив к префиксам (w:, иногда другой).
  const bodies = dom.getElementsByTagNameNS(WNS, "body");
  const blocks: DocBlock[] = [];
  let paragraphCount = 0;
  let tableCount = 0;

  if (bodies.length > 0) {
    const body = bodies[0];
    for (let i = 0; i < body.childNodes.length; i++) {
      const node = body.childNodes[i];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.localName === "p") {
        const text = paragraphText(el).replace(/\u00A0/g, " ").trimEnd();
        if (text.trim().length > 0) {
          blocks.push({ kind: "paragraph", text });
          paragraphCount++;
        }
      } else if (el.localName === "tbl") {
        blocks.push(parseTable(el));
        tableCount++;
      }
    }
  }

  return { blocks, paragraphCount, tableCount };
}

// ─── Утилиты сравнения ──────────────────────────────────────────────

/** Нормализация для сравнения на равенство: схлопываем пробелы. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Разбивка на токены (слова и пробелы сохраняются как отдельные токены). */
function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Только «словесные» токены (без пробелов) — для оценки схожести. */
function words(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Длина наибольшей общей подпоследовательности двух массивов токенов. */
function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array(m + 1).fill(0);
  let curr = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

/** Схожесть строк 0..1 по словам (2·LCS / (|a|+|b|)). */
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  const l = lcsLength(wa, wb);
  return (2 * l) / (wa.length + wb.length);
}

/** Пословный inline-diff: возвращает токены для левой и правой стороны. */
export function inlineDiff(
  a: string,
  b: string,
): { left: InlineToken[]; right: InlineToken[] } {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;

  // Полная таблица LCS для восстановления пути.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        ta[i - 1] === tb[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const left: InlineToken[] = [];
  const right: InlineToken[] = [];
  let i = n;
  let j = m;
  const leftRev: InlineToken[] = [];
  const rightRev: InlineToken[] = [];
  while (i > 0 && j > 0) {
    if (ta[i - 1] === tb[j - 1]) {
      leftRev.push({ text: ta[i - 1], type: "same" });
      rightRev.push({ text: tb[j - 1], type: "same" });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      leftRev.push({ text: ta[i - 1], type: "del" });
      i--;
    } else {
      rightRev.push({ text: tb[j - 1], type: "ins" });
      j--;
    }
  }
  while (i > 0) {
    leftRev.push({ text: ta[i - 1], type: "del" });
    i--;
  }
  while (j > 0) {
    rightRev.push({ text: tb[j - 1], type: "ins" });
    j--;
  }
  left.push(...leftRev.reverse());
  right.push(...rightRev.reverse());
  return { left, right };
}

// ─── Сравнение блоков верхнего уровня ───────────────────────────────

function blockKey(b: DocBlock): string {
  if (b.kind === "paragraph") return "P:" + norm(b.text);
  return (
    "T:" +
    b.rows.map((r) => r.map((c) => norm(c)).join("")).join("")
  );
}

function blocksEqual(a: DocBlock, b: DocBlock): boolean {
  return blockKey(a) === blockKey(b);
}

type Op =
  | { type: "equal"; a: DocBlock; b: DocBlock }
  | { type: "del"; a: DocBlock }
  | { type: "ins"; b: DocBlock };

/** LCS по блокам (равенство — точное), восстановление операций по порядку. */
function diffBlocks(a: DocBlock[], b: DocBlock[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = blocksEqual(a[i - 1], b[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (blocksEqual(a[i], b[j])) {
      ops.push({ type: "equal", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] > dp[i][j + 1]) {
      ops.push({ type: "del", a: a[i] });
      i++;
    } else {
      // На равенстве предпочитаем вставку — так идентичные блоки после
      // добавленного контента остаются выровненными, а не дробятся.
      ops.push({ type: "ins", b: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", a: a[i++] });
  while (j < m) ops.push({ type: "ins", b: b[j++] });
  return ops;
}

const SIM_THRESHOLD = 0.4;

function blockSimilarity(a: DocBlock, b: DocBlock): number {
  if (a.kind !== b.kind) return 0;
  if (a.kind === "paragraph" && b.kind === "paragraph") {
    return similarity(a.text, b.text);
  }
  if (a.kind === "table" && b.kind === "table") {
    return similarity(
      a.rows.map((r) => r.join(" ")).join(" "),
      (b as DocTable).rows.map((r) => r.join(" ")).join(" "),
    );
  }
  return 0;
}

// ─── Сравнение таблиц (строки/ячейки) ───────────────────────────────

function rowSignature(row: string[]): string {
  return row.map((c) => norm(c)).join("");
}

interface TableRowOp {
  type: "equal" | "del" | "ins";
  row: string[];
  index: number; // порядковый номер строки для отображения
}

function diffTable(
  t1: DocTable,
  t2: DocTable,
  tableNo: number,
  idPrefix: string,
): { rows: CompareRow[]; changed: number; added: number; removed: number } {
  const a = t1.rows;
  const b = t2.rows;
  const n = a.length;
  const m = b.length;

  // LCS по строкам (равенство — по сигнатуре).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        rowSignature(a[i - 1]) === rowSignature(b[j - 1])
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Восстанавливаем последовательность операций по строкам.
  const ops: TableRowOp[] = [];
  let i = 0;
  let j = 0;
  let visualRow = 0;
  while (i < n && j < m) {
    if (rowSignature(a[i]) === rowSignature(b[j])) {
      visualRow++;
      ops.push({ type: "equal", row: a[i], index: visualRow });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      visualRow++;
      ops.push({ type: "del", row: a[i], index: visualRow });
      i++;
    } else {
      visualRow++;
      ops.push({ type: "ins", row: b[j], index: visualRow });
      j++;
    }
  }
  while (i < n) {
    visualRow++;
    ops.push({ type: "del", row: a[i++], index: visualRow });
  }
  while (j < m) {
    visualRow++;
    ops.push({ type: "ins", row: b[j++], index: visualRow });
  }

  const rows: CompareRow[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;

  // Точечные правки ячеек внутри изменённой строки.
  const emitCells = (left: string[], right: string[], rowNo: number) => {
    const cols = Math.max(left.length, right.length);
    for (let c = 0; c < cols; c++) {
      const lc = left[c] ?? "";
      const rc = right[c] ?? "";
      if (norm(lc) === norm(rc)) continue;
      changed++;
      const d = inlineDiff(lc, rc);
      rows.push({
        id: `${idPrefix}-r${rowNo}-c${c}`,
        kind: "table-cell",
        status: "modified",
        location: `Таблица ${tableNo} · строка ${rowNo} · столбец ${c + 1}`,
        leftText: lc,
        rightText: rc,
        leftTokens: d.left,
        rightTokens: d.right,
      });
    }
  };

  const rowRemoved = (row: string[], rowNo: number) => {
    removed++;
    rows.push({
      id: `${idPrefix}-del-r${rowNo}`,
      kind: "table-row",
      status: "removed",
      location: `Таблица ${tableNo} · строка ${rowNo}`,
      leftText: row.join(" | "),
      rightText: "",
      leftTokens: [{ text: row.join(" | "), type: "del" }],
      rightTokens: [],
    });
  };

  const rowAdded = (row: string[], rowNo: number) => {
    added++;
    rows.push({
      id: `${idPrefix}-ins-r${rowNo}`,
      kind: "table-row",
      status: "added",
      location: `Таблица ${tableNo} · строка ${rowNo}`,
      leftText: "",
      rightText: row.join(" | "),
      leftTokens: [],
      rightTokens: [{ text: row.join(" | "), type: "ins" }],
    });
  };

  // Пересобираем соседние del/ins строк в «изменённые» по схожести,
  // чтобы точечная правка (например, одна дата) показывалась по ячейкам.
  let delBuf: TableRowOp[] = [];
  let insBuf: TableRowOp[] = [];
  const flush = () => {
    const dels = delBuf;
    const inss = insBuf;
    delBuf = [];
    insBuf = [];
    const used = new Set<number>();
    for (const d of dels) {
      let bestIdx = -1;
      let bestSim = 0.3;
      for (let k = 0; k < inss.length; k++) {
        if (used.has(k)) continue;
        const s = similarity(d.row.join(" "), inss[k].row.join(" "));
        if (s >= bestSim) {
          bestSim = s;
          bestIdx = k;
        }
      }
      if (bestIdx >= 0) {
        used.add(bestIdx);
        emitCells(d.row, inss[bestIdx].row, d.index);
      } else {
        rowRemoved(d.row, d.index);
      }
    }
    for (let k = 0; k < inss.length; k++) {
      if (!used.has(k)) rowAdded(inss[k].row, inss[k].index);
    }
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush();
    } else if (op.type === "del") {
      delBuf.push(op);
    } else {
      insBuf.push(op);
    }
  }
  flush();

  return { rows, changed, added, removed };
}

// ─── Основное сравнение ─────────────────────────────────────────────

export function compareWordModels(
  m1: WordDocModel,
  m2: WordDocModel,
): WordCompareResult {
  const ops = diffBlocks(m1.blocks, m2.blocks);

  const rows: CompareRow[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  let identical = 0;

  let paraNo = 0;
  let tableNo = 0;
  let uid = 0;

  // Буферы для пересборки соседних del/ins в «modified» по схожести.
  let delBuf: DocBlock[] = [];
  let insBuf: DocBlock[] = [];

  const emitParagraphIdentical = (text: string) => {
    paraNo++;
    identical++;
    rows.push({
      id: `p-${uid++}`,
      kind: "paragraph",
      status: "identical",
      location: `Абзац ${paraNo}`,
      leftText: text,
      rightText: text,
      leftTokens: [{ text, type: "same" }],
      rightTokens: [{ text, type: "same" }],
    });
  };

  const emitTableIdentical = (t: DocTable) => {
    tableNo++;
    identical++;
    const preview = `Таблица: ${t.rows.length} строк × ${
      t.rows[0]?.length || 0
    } столбцов`;
    rows.push({
      id: `t-${uid++}`,
      kind: "table",
      status: "identical",
      location: `Таблица ${tableNo}`,
      leftText: preview,
      rightText: preview,
      leftTokens: [{ text: preview, type: "same" }],
      rightTokens: [{ text: preview, type: "same" }],
    });
  };

  const emitParagraphModified = (a: string, b: string) => {
    paraNo++;
    changed++;
    const d = inlineDiff(a, b);
    rows.push({
      id: `p-${uid++}`,
      kind: "paragraph",
      status: "modified",
      location: `Абзац ${paraNo}`,
      leftText: a,
      rightText: b,
      leftTokens: d.left,
      rightTokens: d.right,
    });
  };

  const emitParagraphRemoved = (text: string) => {
    paraNo++;
    removed++;
    rows.push({
      id: `p-${uid++}`,
      kind: "paragraph",
      status: "removed",
      location: `Абзац ${paraNo}`,
      leftText: text,
      rightText: "",
      leftTokens: [{ text, type: "del" }],
      rightTokens: [],
    });
  };

  const emitParagraphAdded = (text: string) => {
    paraNo++;
    added++;
    rows.push({
      id: `p-${uid++}`,
      kind: "paragraph",
      status: "added",
      location: `Абзац ${paraNo}`,
      leftText: "",
      rightText: text,
      leftTokens: [],
      rightTokens: [{ text, type: "ins" }],
    });
  };

  const emitTable = (t1: DocTable | null, t2: DocTable | null) => {
    tableNo++;
    if (t1 && t2) {
      const res = diffTable(t1, t2, tableNo, `t-${uid++}`);
      if (res.rows.length === 0) {
        identical++;
        const preview = `Таблица: ${t1.rows.length} строк`;
        rows.push({
          id: `t-${uid++}`,
          kind: "table",
          status: "identical",
          location: `Таблица ${tableNo}`,
          leftText: preview,
          rightText: preview,
          leftTokens: [{ text: preview, type: "same" }],
          rightTokens: [{ text: preview, type: "same" }],
        });
      } else {
        changed += res.changed;
        added += res.added;
        removed += res.removed;
        rows.push(...res.rows);
      }
    } else if (t1) {
      removed++;
      rows.push({
        id: `t-${uid++}`,
        kind: "table",
        status: "removed",
        location: `Таблица ${tableNo}`,
        leftText: `Таблица (${t1.rows.length} строк)`,
        rightText: "",
        leftTokens: [{ text: `Таблица (${t1.rows.length} строк)`, type: "del" }],
        rightTokens: [],
      });
    } else if (t2) {
      added++;
      rows.push({
        id: `t-${uid++}`,
        kind: "table",
        status: "added",
        location: `Таблица ${tableNo}`,
        leftText: "",
        rightText: `Таблица (${t2.rows.length} строк)`,
        leftTokens: [],
        rightTokens: [{ text: `Таблица (${t2.rows.length} строк)`, type: "ins" }],
      });
    }
  };

  // Сброс буферов del/ins: пары по схожести → modified, остальное → add/remove.
  const flush = () => {
    const dels = [...delBuf];
    const inss = [...insBuf];
    delBuf = [];
    insBuf = [];
    const usedIns = new Set<number>();

    for (const d of dels) {
      // Ищем лучшую пару среди вставок того же типа.
      let bestIdx = -1;
      let bestSim = SIM_THRESHOLD;
      for (let k = 0; k < inss.length; k++) {
        if (usedIns.has(k)) continue;
        if (inss[k].kind !== d.kind) continue;
        const s = blockSimilarity(d, inss[k]);
        if (s >= bestSim) {
          bestSim = s;
          bestIdx = k;
        }
      }
      if (bestIdx >= 0) {
        usedIns.add(bestIdx);
        const partner = inss[bestIdx];
        if (d.kind === "paragraph" && partner.kind === "paragraph") {
          // LCS-выравнивание иногда прогоняет идентичный блок через
          // буферы del/ins — не помечаем такой абзац как изменённый.
          if (norm(d.text) === norm(partner.text)) {
            emitParagraphIdentical(partner.text);
          } else {
            emitParagraphModified(d.text, partner.text);
          }
        } else if (d.kind === "table" && partner.kind === "table") {
          emitTable(d, partner);
        }
      } else {
        if (d.kind === "paragraph") emitParagraphRemoved(d.text);
        else emitTable(d, null);
      }
    }
    for (let k = 0; k < inss.length; k++) {
      if (usedIns.has(k)) continue;
      const it = inss[k];
      if (it.kind === "paragraph") emitParagraphAdded(it.text);
      else emitTable(null, it);
    }
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      if (op.a.kind === "paragraph") emitParagraphIdentical(op.a.text);
      else emitTableIdentical(op.a as DocTable);
    } else if (op.type === "del") {
      delBuf.push(op.a);
    } else {
      insBuf.push(op.b);
    }
  }
  flush();

  return { rows, changed, added, removed, identical };
}
