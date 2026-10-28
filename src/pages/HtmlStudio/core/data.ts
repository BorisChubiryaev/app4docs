// Данные внутри скриптов страницы: массивы и объекты, которые ИИ кладёт в
// <script> (const data = [...], labels: [...], JSON-блоки). Находим их
// разбором JavaScript (acorn), показываем как таблицу и записываем обратно
// только изменённый кусок текста — остальной код остаётся как был.
import { parse } from "acorn";

export type Cell = string | number | boolean | null;

/** Форма набора данных — от неё зависит, как показываем его таблицей. */
export type Shape =
  | { kind: "list" } // [1, 2, 3]
  | { kind: "chart" } // подписи + ряды графика (Chart.js, ECharts, ApexCharts)
  | { kind: "rows" } // [[1, 2], [3, 4]]
  | { kind: "records"; keys: string[] } // [{a: 1}, {a: 2}]
  | { kind: "dict" }; // {a: 1, b: 2}

export interface DataSet {
  id: string;
  /** Где лежит: номер скрипта и диапазон символов в его тексте */
  script: number;
  start: number;
  end: number;
  /** Имя переменной или свойства (data, labels, values…) */
  name: string;
  /** Путь для подписи: chart.data.datasets[0].data */
  path: string;
  shape: Shape;
  /** Таблица для редактирования: строка заголовков + строки */
  header: string[];
  rows: Cell[][];
  /** Как записывать обратно: кавычки, многострочность, отступ */
  style: { quote: '"' | "'" ; multiline: boolean; indent: string; json: boolean; keyQuotes: boolean };
  /** Для графика: литералы подписей и каждого ряда (по столбцам таблицы) */
  parts?: { start: number; end: number; style: DataSet["style"] }[];
}

const prop = (obj: Node | undefined, ...names: string[]): Node | undefined =>
  obj?.type === "ObjectExpression" ? obj.properties.find((p: Node) => names.includes(keyName(p) ?? ""))?.value : undefined;

const primList = (n: Node | undefined): n is Node =>
  !!n && n.type === "ArrayExpression" && n.elements.length > 0 && n.elements.every((e: Node | null) => e && isPrimitive(e));

/**
 * График: подписи по оси X и ряды значений той же длины.
 *  Chart.js:   { labels: [...], datasets: [{ label, data: [...] }] }
 *  ECharts:    { xAxis: { data: [...] }, series: [{ name, data: [...] }] }
 *  ApexCharts: { xaxis: { categories: [...] }, series: [{ name, data: [...] }] }
 */
function chartOf(o: Node): { labels: Node; series: { name: string; data: Node }[] } | null {
  if (o.type !== "ObjectExpression") return null;
  const axis = (n: Node | undefined) => (n?.type === "ArrayExpression" ? n.elements[0] : n);
  const labels = [prop(o, "labels", "categories"), prop(axis(prop(o, "xAxis")), "data"), prop(axis(prop(o, "xaxis")), "categories")].find(primList);
  const arr = prop(o, "datasets", "series");
  if (!labels || arr?.type !== "ArrayExpression") return null;
  const series: { name: string; data: Node }[] = [];
  arr.elements.forEach((e: Node | null, i: number) => {
    const data = prop(e ?? undefined, "data");
    if (!primList(data) || data.elements.length !== labels.elements.length) return;
    const nm = prop(e ?? undefined, "label", "name");
    series.push({ name: nm && isPrimitive(nm) ? String(primValue(nm)) : `Ряд ${i + 1}`, data });
  });
  return series.length ? { labels, series } : null;
}

type Node = {
  type: string;
  start: number;
  end: number;
  [k: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const isPrimitive = (n: Node): boolean =>
  n.type === "Literal" ||
  (n.type === "UnaryExpression" && n.operator === "-" && n.argument.type === "Literal" && typeof n.argument.value === "number") ||
  (n.type === "TemplateLiteral" && n.expressions.length === 0) ||
  (n.type === "Identifier" && (n.name === "undefined" || n.name === "NaN"));

const primValue = (n: Node): Cell => {
  if (n.type === "Literal") return n.value instanceof RegExp ? String(n.raw) : (n.value as Cell);
  if (n.type === "UnaryExpression") return -(n.argument.value as number);
  if (n.type === "TemplateLiteral") return n.quasis.map((q: Node) => q.value.cooked).join("");
  return null;
};

const keyName = (p: Node): string | null => {
  if (p.type !== "Property" || p.computed) return null;
  if (p.key.type === "Identifier") return p.key.name;
  if (p.key.type === "Literal") return String(p.key.value);
  return null;
};

/** Набор данных из узла-литерала (или null, если это не «табличные» данные). */
function shapeOf(n: Node): { shape: Shape; header: string[]; rows: Cell[][] } | null {
  if (n.type === "ArrayExpression") {
    const els: Node[] = n.elements.filter(Boolean);
    if (els.length === 0 || els.length !== n.elements.length) return null;
    if (els.every(isPrimitive)) return { shape: { kind: "list" }, header: ["Значение"], rows: els.map((e) => [primValue(e)]) };
    if (els.every((e) => e.type === "ArrayExpression" && e.elements.every((x: Node | null) => x && isPrimitive(x)))) {
      const w = Math.max(...els.map((e) => e.elements.length));
      return {
        shape: { kind: "rows" },
        header: Array.from({ length: w }, (_, i) => `Столбец ${i + 1}`),
        rows: els.map((e) => Array.from({ length: w }, (_, i) => (e.elements[i] ? primValue(e.elements[i]) : null))),
      };
    }
    if (els.every((e) => e.type === "ObjectExpression" && e.properties.every((p: Node) => keyName(p) !== null && isPrimitive(p.value)))) {
      const keys: string[] = [];
      for (const e of els) for (const p of e.properties) if (!keys.includes(keyName(p)!)) keys.push(keyName(p)!);
      if (!keys.length) return null;
      return {
        shape: { kind: "records", keys },
        header: keys,
        rows: els.map((e) => keys.map((k) => {
          const p = e.properties.find((x: Node) => keyName(x) === k);
          return p ? primValue(p.value) : null;
        })),
      };
    }
    return null;
  }
  if (n.type === "ObjectExpression") {
    const props: Node[] = n.properties;
    if (props.length >= 2 && props.every((p) => keyName(p) !== null && isPrimitive(p.value))) {
      return { shape: { kind: "dict" }, header: ["Ключ", "Значение"], rows: props.map((p) => [keyName(p), primValue(p.value)]) };
    }
  }
  return null;
}

function styleOf(src: string, n: Node, json: boolean): DataSet["style"] {
  const text = src.slice(n.start, n.end);
  const dq = (text.match(/"/g) ?? []).length;
  const sq = (text.match(/'/g) ?? []).length;
  const multiline = text.includes("\n");
  // Отступ строки, где начинается литерал
  const lineStart = src.lastIndexOf("\n", n.start) + 1;
  const indent = (src.slice(lineStart, n.start).match(/^\s*/) ?? [""])[0];
  const keyQuotes = json || /["']\s*[\w$-]+\s*["']\s*:/.test(text);
  return { quote: json || dq >= sq ? '"' : "'", multiline, indent, json, keyQuotes };
}

/** Найти наборы данных в текстах скриптов страницы. */
export function findDataSets(scripts: { text: string; type: string }[]): DataSet[] {
  const out: DataSet[] = [];
  scripts.forEach((s, si) => {
    const type = s.type.toLowerCase();
    const isJson = type.includes("json");
    if (type && !isJson && !/javascript|module|babel|^text\/x-he/.test(type)) return;
    let ast: Node;
    try {
      ast = (isJson
        ? parse(`(${s.text})`, { ecmaVersion: "latest" })
        : parse(s.text, { ecmaVersion: "latest", sourceType: type === "module" ? "module" : "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })) as unknown as Node;
    } catch {
      return; // не JavaScript (шаблоны, JSX) — пропускаем
    }
    const shift = isJson ? -1 : 0;
    const seen = new Set<Node>();
    const visit = (n: Node, name: string, path: string) => {
      if (!n || typeof n.type !== "string") return;
      const chart = !seen.has(n) ? chartOf(n) : null;
      if (chart) {
        const nodes = [chart.labels, ...chart.series.map((x) => x.data)];
        nodes.forEach((x) => seen.add(x));
        const parts = nodes.map((x) => ({ start: x.start + shift, end: x.end + shift, style: styleOf(s.text, { ...x, start: x.start + shift, end: x.end + shift }, isJson) }));
        out.push({
          id: `c${si}_${n.start}`,
          script: si,
          start: parts[0].start,
          end: parts[parts.length - 1].end,
          name: name || "график",
          path: `График${name ? ` «${name}»` : ""}: ${chart.series.map((x) => x.name).join(", ")}`,
          shape: { kind: "chart" },
          header: ["Подпись", ...chart.series.map((x) => x.name)],
          rows: chart.labels.elements.map((l: Node, i: number) => [primValue(l), ...chart.series.map((x) => primValue(x.data.elements[i]))]),
          style: parts[0].style,
          parts,
        });
      }
      const sh = (n.type === "ArrayExpression" || n.type === "ObjectExpression") && !seen.has(n) ? shapeOf(n) : null;
      // Мелочь (пара значений) — не данные, а настройки
      if (sh && (sh.rows.length >= 2 || sh.shape.kind === "records")) {
        seen.add(n);
        out.push({
          id: `d${si}_${n.start}`,
          script: si,
          start: n.start + shift,
          end: n.end + shift,
          name: name || "данные",
          path: path || name || "данные",
          ...sh,
          style: styleOf(s.text, { ...n, start: n.start + shift, end: n.end + shift }, isJson),
        });
        return;
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        if (Array.isArray(v)) {
          v.forEach((c, i) => {
            if (!c || typeof c !== "object") return;
            const node = c as Node;
            if (node.type === "Property" && !node.computed) {
              const kn = keyName(node) ?? name;
              visit(node.value, kn, path ? `${path}.${kn}` : kn);
            } else if (n.type === "ArrayExpression") visit(node, name, `${path}[${i}]`);
            else visit(node, name, path);
          });
        } else if (v && typeof v === "object" && typeof (v as Node).type === "string") {
          const node = v as Node;
          if (n.type === "VariableDeclarator" && k === "init") visit(node, n.id?.name ?? name, n.id?.name ?? path);
          else if (n.type === "AssignmentExpression" && k === "right") {
            const left = s.text.slice(n.left.start + shift, n.left.end + shift);
            visit(node, left.split(".").pop() ?? left, left);
          } else visit(node, name, path);
        }
      }
    };
    visit(ast, "", "");
  });
  return out;
}

// ── Запись обратно ──

/** Ячейка из поля ввода: числа и логические — как значения, остальное — строкой. */
export function parseCell(text: string, was: Cell): Cell {
  const t = text.trim();
  if (typeof was === "number" || (was === null && /^-?\d+([.,]\d+)?$/.test(t))) {
    const n = Number(t.replace(/\s/g, "").replace(",", "."));
    if (t !== "" && Number.isFinite(n)) return n;
  }
  if (typeof was === "boolean" && (t === "true" || t === "false")) return t === "true";
  if (t === "" && was === null) return null;
  return text;
}

const fmtCell = (v: Cell, q: string): string => {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const esc = v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(new RegExp(q, "g"), `\\${q}`);
  return `${q}${esc}${q}`;
};

const fmtKey = (k: string, st: DataSet["style"]) =>
  st.keyQuotes || !/^[A-Za-z_$][\w$]*$/.test(k) ? fmtCell(k, st.json ? '"' : st.quote) : k;

/** Текст литерала для изменённой таблицы — в стиле исходного кода. */
export function serialize(ds: DataSet, header: string[], rows: Cell[][]): string {
  const st = ds.style;
  const q = st.json ? '"' : st.quote;
  const inner = st.indent + "  ";
  const join = (items: string[], open: string, close: string, nested = false) => {
    if (!st.multiline || (nested && items.join(", ").length < 100)) return `${open}${items.join(", ")}${close}`;
    return `${open}\n${items.map((s) => inner + s).join(",\n")}\n${st.indent}${close}`;
  };
  switch (ds.shape.kind) {
    case "list":
    case "chart":
      return join(rows.map((r) => fmtCell(r[0] ?? null, q)), "[", "]");
    case "rows":
      return join(rows.map((r) => `[${r.map((c) => fmtCell(c, q)).join(", ")}]`), "[", "]");
    case "records":
      return join(
        rows.map((r) => `{ ${header.map((k, i) => `${fmtKey(k, st)}: ${fmtCell(r[i] ?? null, q)}`).join(", ")} }`),
        "[",
        "]",
      );
    case "dict":
      return join(rows.filter((r) => r[0] !== null && r[0] !== "").map((r) => `${fmtKey(String(r[0]), st)}: ${fmtCell(r[1] ?? null, q)}`), "{", "}");
  }
}

/** Записать изменённую таблицу в текст скрипта. */
export function applyData(text: string, ds: DataSet, header: string[], rows: Cell[][]): string {
  if (ds.shape.kind === "chart" && ds.parts) {
    // Каждый столбец — в свой литерал; с конца, чтобы не сбить позиции
    const edits = ds.parts.map((p, col) => ({
      ...p,
      text: serialize({ ...ds, shape: { kind: "list" }, style: { ...p.style, multiline: false } }, [], rows.map((r) => [r[col] ?? null])),
    }));
    edits.sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
  }
  return text.slice(0, ds.start) + serialize(ds, header, rows) + text.slice(ds.end);
}
