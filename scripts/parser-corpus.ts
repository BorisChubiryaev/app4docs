// Корпус формулировок для проверки разбора инструкций.
//
// Реальные документы «Изменения» покрывают лишь часть того, как в нормативных
// текстах формулируют одну и ту же правку. Корпус описывает варианты, которые
// встречаются в практике, и фиксирует ожидаемый тип операции — это регрессия
// на универсальность: добавили основу в словарь, прогнали, увидели, что старые
// формулировки не сломались.
//
// Запуск:
//   npx esbuild scripts/parser-corpus.ts --bundle --platform=node --format=esm \
//     --outfile=scripts/parser-corpus.mjs && node scripts/parser-corpus.mjs
import { parseInstruction, type Ctx } from "../src/pages/OfferMerge/engine/parse-instruction";
import type { OpType } from "../src/pages/OfferMerge/engine/types";

interface Case {
  /** Текст инструкции. */
  text: string;
  /** Ожидаемые типы операций по порядку. */
  expect: OpType[];
  /** Проверка отдельных полей первой операции. */
  check?: (op: Record<string, unknown>) => string | null;
  ctx?: Partial<Ctx>;
}

const P = "«Новая редакция пункта.»";

const CASES: Case[] = [
  // ── изложение пункта: разный порядок слов и разные глаголы ────────────────
  { text: `Пункт 3.5 изложить в следующей редакции: ${P}`, expect: ["replace"] },
  { text: `Изложить пункт 3.5 в новой редакции: ${P}`, expect: ["replace"] },
  { text: `Изложить п. 3.5 Оферты в следующей редакции: ${P}`, expect: ["replace"] },
  { text: `п. 3.5 читать в следующей редакции: ${P}`, expect: ["replace"] },
  { text: `Пункт 3.5 сформулировать следующим образом: ${P}`, expect: ["replace"] },
  { text: `Подпункт 3.5.1 изложить в следующей редакции: ${P}`, expect: ["replace"] },
  {
    text: `Преамбулу изложить в следующей редакции: ${P}`,
    expect: ["replace"],
    check: (op) => ((op.target as { kind: string }).kind === "preamble" ? null : "цель не преамбула"),
  },

  // ── предложения внутри пункта ─────────────────────────────────────────────
  {
    text: `Первое предложение п. 7.6 изложить в следующей редакции: ${P}`,
    expect: ["replace_sentence"],
    check: (op) => (op.sentenceIndex === 1 ? null : `sentenceIndex=${op.sentenceIndex}, ожидали 1`),
  },
  {
    text: `Последнее предложение пункта 6.1 изложить в новой редакции: ${P}`,
    expect: ["replace_sentence"],
    check: (op) => (op.sentenceIndex === -1 ? null : `sentenceIndex=${op.sentenceIndex}, ожидали -1`),
  },
  {
    text: `Второе предложение п. 4.2 изложить в следующей редакции: ${P}`,
    expect: ["replace_sentence"],
    check: (op) => (op.sentenceIndex === 2 ? null : `sentenceIndex=${op.sentenceIndex}, ожидали 2`),
  },
  { text: `дополнить п. 8.5 предложением в следующей редакции: ${P}`, expect: ["append_sentence"] },
  { text: `Пункт 8.5 дополнить предложением следующего содержания: ${P}`, expect: ["append_sentence"] },

  // ── абзацы внутри пункта ──────────────────────────────────────────────────
  {
    text: `Второй абзац п. 5.1 изложить в следующей редакции: ${P}`,
    expect: ["replace_paragraph"],
    check: (op) => (op.paragraphIndex === 2 ? null : `paragraphIndex=${op.paragraphIndex}`),
  },
  { text: `Дополнить п. 5.1 абзацем следующего содержания: ${P}`, expect: ["append_paragraph"] },

  // ── вставка относительно слов ─────────────────────────────────────────────
  {
    text: "Пункт 2.14 после слов «к продуктам» дополнить словами «и услугам».",
    expect: ["insert_after"],
    check: (op) => (op.anchor === "к продуктам" ? null : `якорь=${op.anchor}`),
  },
  {
    text: "В п. 2.14 перед словами «к продуктам» дополнить словами «и услугам».",
    expect: ["insert_before"],
  },
  { text: "п. 4.3.2 после слова «заключает» дополнить фразой «с Банком»", expect: ["insert_after"] },
  { text: "Пункт 5.1 после слов «Банка,» добавить формулировку «ККИП,»", expect: ["insert_after"] },
  {
    text: "Пункт 5.1 после слов «Банка,» дополнить формулировкой «ККИП,»;",
    expect: ["insert_after"],
  },
  {
    text: "В п. 9.2 после слов «доказательств заключения» дополнить словами «Банком и ККИП», после слова «Договора» дополнить предлогом «с».",
    expect: ["insert_after", "insert_after"],
  },
  {
    text: "Пункт 2.14 после слов «(в Системе «Сбербанк Онлайн»)» дополнить фразой «, в том числе ККИП.».",
    expect: ["insert_after"],
    check: (op) =>
      String(op.anchor).includes("Сбербанк Онлайн") ? null : `якорь обрезан: ${op.anchor}`,
  },

  // ── удаление ──────────────────────────────────────────────────────────────
  { text: "Исключить пункт 2.28 с изменением нумерации последующих пунктов.", expect: ["delete_point"] },
  { text: "Исключить п. 2.28. Оферты, с последующей перенумерацией пунктов.", expect: ["delete_point"] },
  { text: "Удалить п. 3.4.", expect: ["delete_point"] },
  { text: "Пункт 2.28 признать утратившим силу.", expect: ["delete_point"] },
  {
    text: "в п. 4.1.3. после слов «имеющим заключенный» удалить слова «с Банком».",
    expect: ["delete_words"],
    check: (op) => (op.find === "с Банком" ? null : `find=${op.find}`),
  },
  { text: "Из пункта 5.2 исключить слова «и Партнеров».", expect: ["delete_words"] },

  // ── замена слов ───────────────────────────────────────────────────────────
  {
    text: "в пункте 4.7 слово «Стороны» заменить на фразу «Банк и Клиент».",
    expect: ["replace_words"],
    check: (op) =>
      op.find === "Стороны" && op.payload === "Банк и Клиент" ? null : `find=${op.find} payload=${op.payload}`,
  },
  {
    text: "В п.9.7 и 9.8 слово «Стороны» заменить на фразу «Банк и Клиент».",
    expect: ["replace_words", "replace_words"],
  },
  {
    text: "В пунктах 1.1 и 1.2 слова «Компания» заменить словами «Организация».",
    expect: ["replace_words", "replace_words"],
  },

  // ── новые пункты ──────────────────────────────────────────────────────────
  {
    text: `Дополнить пунктом 2.15 с последующей перенумерацией пунктов: ${P}`,
    expect: ["insert_point"],
    check: (op) =>
      (op.target as { point?: string }).point === "2.15" ? null : `номер=${(op.target as { point?: string }).point}`,
  },
  {
    text: `Дополнить п. 7.9 в следующей редакции с последующей перенумерацией пунктов: ${P}`,
    expect: ["insert_point"],
  },
  { text: `Дополнить пунктом 5.6 и изложить в следующей редакции: ${P}`, expect: ["insert_point"] },
  { text: `Раздел 5 дополнить пунктом 5.7 следующего содержания: ${P}`, expect: ["insert_point"] },
  { text: `Включить в раздел 6 пункт 6.11 следующего содержания: ${P}`, expect: ["insert_point"] },

  // ── сноски ────────────────────────────────────────────────────────────────
  { text: `Изложить сноску 3 в следующей редакции: ${P}`, expect: ["replace_footnote"] },
  {
    text: "Сноску 5 после слов «в Личном кабинете» дополнить словами «и в приложении»",
    expect: ["insert_after"],
    check: (op) =>
      (op.target as { kind: string }).kind === "footnote" ? null : "цель не сноска",
  },
  {
    text: "Пункт 4.2 после слов «в Личном кабинете» дополнить сноской следующего содержания: «Текст сноски.»",
    expect: ["add_footnote"],
  },

  // ── случаи, которые честнее отдать оператору ──────────────────────────────
  {
    text: "Пункты 5.1–5.3 исключить.",
    expect: ["manual"],
  },
];

function run(): number {
  let ok = 0;
  const failures: string[] = [];
  for (const c of CASES) {
    const ctx: Ctx = { scope: "offer", ...c.ctx };
    const got = parseInstruction(c.text, ctx) ?? [];
    const types = got.map((d) => d.type);
    const same =
      types.length === c.expect.length && types.every((t, i) => t === c.expect[i]);
    if (!same) {
      failures.push(
        `  ✗ ${c.text.slice(0, 78)}\n      ожидали [${c.expect.join(", ")}], получили [${types.join(", ") || "—"}]`,
      );
      continue;
    }
    if (c.check) {
      const problem = c.check(got[0] as unknown as Record<string, unknown>);
      if (problem) {
        failures.push(`  ✗ ${c.text.slice(0, 78)}\n      ${problem}`);
        continue;
      }
    }
    ok++;
  }
  console.log(`Корпус формулировок: ${ok} из ${CASES.length}`);
  if (failures.length) {
    console.log(failures.join("\n"));
  }
  return failures.length;
}

process.exit(run() === 0 ? 0 : 1);
