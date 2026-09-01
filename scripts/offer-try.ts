// Прогон произвольных формулировок на реальной Оферте.
//
// Корпус в parser-corpus.ts проверяет только РАЗБОР. Этот скрипт доводит дело
// до конца: разбирает строки, применяет их к настоящему документу и печатает,
// что получилось в тексте, — иначе легко получить операцию, которую движок
// не умеет применять.
//
// Запуск: node scripts/offer-try.mjs <offer.docx> <файл с инструкциями>
import { readFileSync } from "node:fs";
import { loadDocx } from "../src/pages/OfferMerge/engine/docx";
import { applyOneOp, type ApplyState } from "../src/pages/OfferMerge/engine/apply";
import { parseInstruction, type Ctx } from "../src/pages/OfferMerge/engine/parse-instruction";
import { paragraphText } from "../src/pages/OfferMerge/engine/ooxml";
import type { Operation } from "../src/pages/OfferMerge/engine/types";

const [offerPath, phrasesPath] = process.argv.slice(2);
if (!offerPath || !phrasesPath) {
  console.error("укажите offer.docx и файл с инструкциями");
  process.exit(1);
}

/** Абзацы, затронутые правкой: показываем результат, а не только вердикт. */
function changedParagraphs(before: string, after: string): string[] {
  if (before === after) return [];
  const re = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  const beforeSet = new Set(before.match(re) ?? []);
  const out: string[] = [];
  for (const p of after.match(re) ?? []) {
    if (!beforeSet.has(p)) {
      const t = paragraphText(p).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

async function main() {
  const offer = await loadDocx(new Uint8Array(readFileSync(offerPath)));
  const lines = readFileSync(phrasesPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const state: ApplyState = {
    document: offer.document,
    footnotes: offer.footnotes,
    numbering: offer.numbering,
    styles: offer.styles,
  };
  const ctx: Ctx = { scope: "offer" };
  let ok = 0;
  let failed = 0;

  for (const line of lines) {
    const drafts = parseInstruction(line, ctx) ?? [];
    console.log("\n» " + line);
    if (!drafts.length) {
      console.log("   ✗ не распознано");
      failed++;
      continue;
    }
    for (const [i, d] of drafts.entries()) {
      const op: Operation = {
        id: `try#${i}`,
        sourceDoc: "проба",
        rawText: line,
        confidence: d.confidence,
        ...d,
      };
      const before = state.document;
      const beforeFn = state.footnotes;
      const res = applyOneOp(op, state, {});
      console.log(`   ${res.ok ? "✓" : "✗"} ${op.type}: ${res.message.slice(0, 150)}`);
      if (res.ok) ok++;
      else failed++;
      for (const p of changedParagraphs(before, state.document).slice(0, 2)) {
        console.log("     → " + p.slice(0, 170));
      }
      if (state.footnotes !== beforeFn) console.log("     → изменён текст сносок");
    }
  }
  console.log(`\nИтого: применено ${ok}, отказов ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
