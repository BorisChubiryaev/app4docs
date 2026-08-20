// Оффлайн-парсер инструкций (без ИИ): распознаёт типовые формулировки
// изменений по шаблонам. Используется, когда не задан ключ OpenRouter,
// а также как быстрый предварительный разбор перед ИИ.
import type { Operation, OpTarget } from "./types";

let idc = 0;
function nid(src: string) {
  idc += 1;
  return `${src}#${idc}`;
}
export function resetIds() {
  idc = 0;
}

function tidy(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Инструкция может занимать несколько абзацев: директива заканчивается на «:»,
 * а новая редакция идёт отдельным абзацем с «…». Склеиваем такие пары.
 * Табличные директивы (после них — ячейки таблицы) не склеиваем.
 */
function mergeInstructions(paras: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    let cur = tidy(paras[i]);
    // пока текущая строка заканчивается на «:» и следующая начинается с «ёлочки»
    while (
      i + 1 < paras.length &&
      /:$/.test(cur) &&
      /^«/.test(tidy(paras[i + 1])) &&
      !/таблиц/i.test(cur)
    ) {
      cur = cur + " " + tidy(paras[i + 1]);
      i++;
    }
    out.push(cur);
  }
  return out;
}

/** Текст между первой «ёлочкой» после idx и ПОСЛЕДНЕЙ » в строке. */
function payloadToLastGuillemet(s: string, fromIdx: number): string | null {
  const open = s.indexOf("«", fromIdx);
  const close = s.lastIndexOf("»");
  if (open < 0 || close <= open) return null;
  return tidy(s.slice(open + 1, close));
}

export function parseInstructionsOffline(
  rawParas: string[],
  docTables: string[][][],
  sourceDoc: string,
): Operation[] {
  const ops: Operation[] = [];
  const paras = mergeInstructions(rawParas);

  for (const text of paras) {
    // A) Изложить сноску N в следующей редакции: «PAYLOAD» — замена сноски.
    let m = text.match(/Изложить\s+сноску\s+(\d+)\s+в следующей редакции\s*:?/i);
    if (m) {
      const num = parseInt(m[1], 10);
      const payload = payloadToLastGuillemet(text, m.index! + m[0].length) ?? "";
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "replace_footnote",
        target: { kind: "footnote", number: num },
        payload,
        rawText: text,
        confidence: 0.85,
      });
      continue;
    }

    // B) Приложение № A … пункты N, N, … [таблицы п. K] изложить в следующей
    //    редакции + таблица ниже — ЗАМЕНА существующих строк по номерам.
    if (
      /Приложени/i.test(text) &&
      /изложить в следующей редакции/i.test(text) &&
      /пункт[ыа]?\s+\d+\s*,/i.test(text)
    ) {
      const app = text.match(/Приложени[а-я]*\s*№?\s*(\d+)/i);
      const appendix = app ? app[1] : "?";
      const tp = text.match(/таблиц[ыи]?\s*п\.?\s*(\d+)/i);
      const iP = text.search(/пункт[ыа]?/i);
      const iI = text.search(/изложить/i);
      const seg = text.slice(iP, iI).replace(/таблиц[ыи]?\s*п\.?\s*\d+/gi, "");
      const rowNumbers = (seg.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
      const want = new Set(rowNumbers);
      let rows: string[][] = [];
      for (const tbl of docTables) {
        const hit = tbl.filter((r) => want.has(parseInt((r[0] || "").trim(), 10)));
        if (hit.length > rows.length) rows = hit.map((r) => r.map((c) => c.trim()));
      }
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "replace_table_rows",
        target: { kind: "appendix_table", appendix, point: tp ? tp[1] : undefined },
        rows,
        rowNumbers,
        rawText: text,
        confidence: rows.length ? 0.8 : 0.4,
        warnings: rows.length ? undefined : ["новые данные строк не найдены в документе"],
      });
      continue;
    }

    // C) Операции, требующие ручной обработки (безопасно помечаем).
    const manualNote =
      /алфавитн/i.test(text) && /Приложени/i.test(text)
        ? "Сортировка приложения по алфавиту с перенумерацией — выполните вручную"
        : /Дополнить\s+пункт(?:ом)?\s+[\d.]+/i.test(text) && /перенумерац/i.test(text)
          ? "Добавление нового пункта с перенумерацией — выполните вручную"
          : /дополнить\s+сноской/i.test(text)
            ? "Добавление новой сноски к пункту — выполните вручную"
            : /Дополнить\s+Приложени[а-я]*\s*№?\s*\d+.*пункт(?:ом)?\s+следующего содержания/i.test(text)
              ? "Добавление компании в приложение (в алфавитном порядке) — выполните вручную"
              : null;
    if (manualNote) {
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "manual",
        target: { kind: "point", point: "—" },
        note: manualNote,
        rawText: text,
        confidence: 0.5,
        warnings: [manualNote],
      });
      continue;
    }

    // 1) Сноску N после слов «ЯКОРЬ» дополнить …: «PAYLOAD»
    m = text.match(/Сноску\s+(\d+)\s+после слов\s+(«.+?»)\s*(?:дополнить|заменить)/i);
    if (m) {
      const num = parseInt(m[1], 10);
      const anchor = tidy(m[2]);
      const verbIdx = m.index! + m[0].length;
      const payload = payloadToLastGuillemet(text, verbIdx) ?? "";
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "insert_after",
        target: { kind: "footnote", number: num },
        anchor,
        payload: ", " + payload.replace(/\.$/, "") + ".",
        rawText: text,
        confidence: 0.9,
      });
      continue;
    }

    // 2) Пункт X … после слов «ЯКОРЬ» дополнить словами: «PAYLOAD» [перенумерация]
    m = text.match(/(?:Пункт|п\.)\s*([\d.]+)[\s\S]*?после слов\s+(«.+?»)\s*дополнить/i);
    if (m) {
      const point = m[1].replace(/\.$/, "");
      const anchor = tidy(m[2]);
      const verbIdx = m.index! + m[0].length;
      const payload = payloadToLastGuillemet(text, verbIdx) ?? "";
      const headingMatch = text.match(/раздела\s+\d+\s+«([^»]+)»/i);
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "insert_after",
        target: { kind: "point", point, heading: headingMatch ? headingMatch[1] : undefined },
        anchor,
        payload: " " + payload,
        renumberFootnotes: /перенумерац/i.test(text),
        rawText: text,
        confidence: 0.85,
      });
      continue;
    }

    // 3) … п. X … изложить в следующей редакции: «PAYLOAD»
    m = text.match(/п\.?\s*([\d.]+)\.?\s*изложить в следующей редакции\s*:?/i);
    if (m) {
      const point = m[1].replace(/\.$/, "");
      const payload = payloadToLastGuillemet(text, m.index! + m[0].length) ?? "";
      const inAppendix = /Приложени/i.test(text);
      let target: OpTarget;
      if (inAppendix) {
        const app = text.match(/Приложени[а-я]*\s+№?\s*(\d+)/i);
        target = { kind: "appendix_point", appendix: app ? app[1] : "?", point };
      } else {
        const term = payload
          .replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "")
          .split(/\s[–-]\s/)[0]
          .trim();
        const sec = text.match(/раздел[а-я]*\s+(\d+)/i);
        target = { kind: "term", section: sec ? sec[1] : undefined, point, term };
      }
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "replace",
        target,
        payload,
        rawText: text,
        confidence: 0.85,
      });
      continue;
    }

    // 4) Дополнить таблицу в п.K Приложения № A строками X - Y …
    m = text.match(/Дополнить таблицу[\s\S]*?Приложени[а-я]*\s+№?\s*(\d+)[\s\S]*?строками\s+(\d+)\s*[-–—]\s*(\d+)/i);
    if (m) {
      const appendix = m[1];
      const from = parseInt(m[2], 10);
      const to = parseInt(m[3], 10);
      let rows: string[][] = [];
      for (const tbl of docTables) {
        const hit = tbl.filter((r) => {
          const n = parseInt((r[0] || "").trim(), 10);
          return n >= from && n <= to;
        });
        if (hit.length) {
          rows = hit.map((r) => r.map((c) => c.trim()));
          break;
        }
      }
      ops.push({
        id: nid(sourceDoc),
        sourceDoc,
        type: "append_table_rows",
        target: { kind: "appendix_table", appendix, point: "3" },
        rows,
        rowRange: { from, to },
        rawText: text,
        confidence: rows.length ? 0.8 : 0.4,
        warnings: rows.length ? undefined : ["строки таблицы не найдены в документе"],
      });
      continue;
    }
  }

  return ops;
}
