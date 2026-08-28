// Стенд для проверки движка OfferMerge вне браузера.
//
// Приложение работает целиком в браузере, поэтому регрессии в разборе
// инструкций видно только через UI — это медленно и не воспроизводится.
// Скрипт прогоняет тот же код на реальных docx и печатает, что распознано,
// что применилось и что потеряно.
//
// Запуск:  node scripts/offer-check.mjs <папка с docx> [--out каталог]
// Сборка:  npx esbuild scripts/offer-check.ts --bundle --platform=node \
//            --format=esm --outfile=scripts/offer-check.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseAllChangeDocs, buildOutputs } from "../src/pages/OfferMerge/engine/pipeline";
import { loadDocx } from "../src/pages/OfferMerge/engine/docx";
import { paragraphs } from "../src/pages/OfferMerge/engine/text";
import { indexNumberedParagraphs } from "../src/pages/OfferMerge/engine/numbering";
import { previewOperations } from "../src/pages/OfferMerge/engine/preview";
import type { Operation } from "../src/pages/OfferMerge/engine/types";

const args = process.argv.slice(2);
const dir = args[0];
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : "/tmp/offer-check";
if (!dir) {
  console.error("укажите папку с docx");
  process.exit(1);
}

function describe(op: Operation): string {
  const t = op.target as Record<string, unknown>;
  const where =
    t.kind === "footnote"
      ? `сноска ${t.number}`
      : t.kind === "appendix_table"
        ? `Приложение ${t.appendix}${t.point ? ` п.${t.point}` : ""}`
        : t.kind === "appendix_point"
          ? `Приложение ${t.appendix} п.${t.point}`
          : t.kind === "preamble"
            ? "преамбула"
            : t.kind === "term"
              ? `термин «${String(t.term ?? "").slice(0, 40)}»`
              : `п.${t.point}`;
  const bits = [op.type.padEnd(20), where.padEnd(30)];
  if (op.anchor) bits.push(`якорь: «${op.anchor.slice(0, 40)}»`);
  if (op.find) bits.push(`найти: «${String(op.find).slice(0, 30)}»`);
  if (op.payload !== undefined) bits.push(`текст: ${op.payload.slice(0, 60)}…`);
  if (op.rows) bits.push(`строк: ${op.rows.length}`);
  return bits.join(" | ");
}

async function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith(".docx") && !f.startsWith("~"));
  const offerName = files.find((f) => /Приложение\s*7/i.test(f));
  if (!offerName) {
    console.error("не найден файл Оферты (Приложение 7)");
    process.exit(1);
  }
  const changeNames = files.filter((f) => f !== offerName && !/Ошибки/i.test(f));
  const offerData = new Uint8Array(readFileSync(join(dir, offerName)));

  console.log("Оферта:", offerName);
  console.log("Документы изменений:", changeNames.length);

  const { operations } = await parseAllChangeDocs(
    changeNames.map((n) => ({ name: n, data: new Uint8Array(readFileSync(join(dir, n))) })),
  );

  for (const name of changeNames) {
    const own = operations.filter((o) => o.sourceDoc === name);
    console.log(`\n=== ${name}: распознано операций ${own.length}`);
    own.forEach((op, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describe(op)}`));
  }

  const res = await buildOutputs(offerData, operations, {});
  const ok = res.results.filter((r) => r.ok).length;
  console.log(`\n=== ПРИМЕНЕНИЕ: ${ok}/${res.results.length}`);
  const byId = new Map(operations.map((o) => [o.id, o]));
  for (const r of res.results) {
    const op = byId.get(r.operationId)!;
    console.log(`  ${r.ok ? "OK  " : "ФЕЙЛ"} ${op.type.padEnd(20)} ${r.message.slice(0, 140)}`);
  }

  // Предпросмотр обязан совпадать с применением — иначе оператор увидит одно,
  // а получит другое.
  const parts = await loadDocx(offerData);
  const previews = previewOperations(parts, operations);
  let mismatch = 0;
  for (const r of res.results) {
    const pv = previews.get(r.operationId);
    if (!pv || pv.ok !== r.ok) mismatch++;
  }
  console.log(`\nпредпросмотр расходится с применением: ${mismatch} из ${res.results.length}`);
  const sample = res.results.find((r) => r.ok && previews.get(r.operationId)?.segments?.some((s) => s.mark !== "keep"));
  if (sample) {
    const segs = previews.get(sample.operationId)!.segments!;
    console.log("пример предпросмотра:");
    console.log("  " + segs.map((s) => (s.mark === "ins" ? `[+${s.text}]` : s.mark === "del" ? `[-${s.text}]` : s.text)).join(""));
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "offer_updated.docx"), res.offerDocx);
  writeFileSync(join(outDir, "combined.docx"), res.combinedDocx);

  // Инварианты итогового файла: нумерация пунктов и число сносок.
  const before = await loadDocx(offerData);
  const after = await loadDocx(res.offerDocx);
  const fnBefore = (before.document.match(/<w:footnoteReference\b/g) ?? []).length;
  const fnAfter = (after.document.match(/<w:footnoteReference\b/g) ?? []).length;
  console.log(`\nсноски в тексте: ${fnBefore} → ${fnAfter}`);
  const idxAfter = indexNumberedParagraphs(after.document, after.numbering);
  const nums = idxAfter.map((p) => p.number).filter(Boolean) as string[];
  console.log(`нумерованных абзацев: ${nums.length}`);
  const paras = paragraphs(after.document);
  console.log(`абзацев всего: ${paras.length} (было ${paragraphs(before.document).length})`);
  console.log(`\nфайлы: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
