// Модуль «Объединение изменений в Оферту».
// Полностью браузерная обработка (algorithm-only): документы не покидают
// компьютер, сервер и сеть не задействованы.
import { useMemo, useState } from "react";
import { saveAs } from "file-saver";
import PageShell from "../../components/PageShell";
import { parseAllChangeDocs, buildOutputs } from "./engine/pipeline";
import type { Operation, HighlightMode } from "./engine/types";
import "./OfferMerge.css";

type Stage = "upload" | "review" | "done";

interface ApplyResult {
  operationId: string;
  ok: boolean;
  message: string;
}

const OP_TYPE_LABEL: Record<Operation["type"], string> = {
  insert_after: "вставка после слов",
  replace: "изложить в новой редакции",
  append_table_rows: "добавить строки таблицы",
  delete: "исключить",
};

function targetLabel(op: Operation): string {
  const t = op.target;
  switch (t.kind) {
    case "footnote":
      return `Сноска № ${t.number}`;
    case "term":
      return `Термин${t.point ? ` (п. ${t.point})` : ""}: «${t.term}»`;
    case "point":
      return `Пункт ${t.point}${t.heading ? ` — ${t.heading}` : ""}`;
    case "appendix_point":
      return `Приложение №${t.appendix}, п. ${t.point}`;
    case "appendix_table":
      return `Таблица п. ${t.point} Приложения №${t.appendix}`;
  }
}

async function fileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

const STEPS: [Stage, string][] = [
  ["upload", "1. Загрузка"],
  ["review", "2. Проверка"],
  ["done", "3. Файлы"],
];

export default function OfferMerge() {
  const [stage, setStage] = useState<Stage>("upload");
  const [offer, setOffer] = useState<File | null>(null);
  const [changes, setChanges] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [offerBytes, setOfferBytes] = useState<Uint8Array | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("color");
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [outOffer, setOutOffer] = useState<Uint8Array | null>(null);
  const [outCombined, setOutCombined] = useState<Uint8Array | null>(null);

  const includedOps = useMemo(
    () => operations.filter((o) => !excluded[o.id]),
    [operations, excluded],
  );

  async function handleParse() {
    if (!offer || changes.length === 0) {
      setError("Загрузите Оферту и хотя бы один документ с изменениями.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setOfferBytes(await fileBytes(offer));
      const docs = [];
      for (const c of changes) docs.push({ name: c.name, data: await fileBytes(c) });
      const { operations: ops } = await parseAllChangeDocs(docs);
      setOperations(ops);
      setExcluded({});
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateOp(id: string, patch: Partial<Operation>) {
    setOperations((ops) => ops.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  async function handleBuild() {
    if (!offerBytes) return;
    setError(null);
    setBusy(true);
    try {
      const result = await buildOutputs(offerBytes, includedOps, {
        highlightMode,
        author: "genOferta",
      });
      setResults(result.results);
      setOutOffer(result.offerDocx);
      setOutCombined(result.combinedDocx);
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download(bytes: Uint8Array, name: string) {
    saveAs(
      new Blob([bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      name,
    );
  }

  function reset() {
    setStage("upload");
    setOperations([]);
    setResults([]);
    setOutOffer(null);
    setOutCombined(null);
    setError(null);
  }

  return (
    <PageShell
      title="Объединение изменений в Оферту"
      subtitle="Соберите изменения из нескольких документов и обновите текст оферты с выделением правок — прямо в браузере"
      icon="📑"
      width={900}
    >
      <div className="om">
        <div className="ds-tabs om-steps" role="list">
          {STEPS.map(([k, t]) => (
            <span key={k} className={`ds-tab${stage === k ? " ds-tab--active" : ""}`} role="listitem">
              {t}
            </span>
          ))}
        </div>

        {error && <div className="om-error">{error}</div>}

        {stage === "upload" && (
          <section className="om-section">
            <FileField
              label="Действующая Оферта (Приложение 7), .docx"
              multiple={false}
              files={offer ? [offer] : []}
              onFiles={(f) => setOffer(f[0] ?? null)}
            />
            <FileField
              label="Документы с изменениями (можно несколько), .docx"
              multiple
              files={changes}
              onFiles={setChanges}
            />
            <p className="om-hint">
              Обработка идёт полностью в браузере: документы никуда не отправляются,
              ИИ и сеть не задействованы.
            </p>
            <button className="om-btn" disabled={busy} onClick={handleParse}>
              {busy ? "Распознаём…" : "Распознать изменения →"}
            </button>
          </section>
        )}

        {stage === "review" && (
          <section className="om-section">
            <div className="ds-panel om-note">
              Распознано операций: <b>{operations.length}</b>. Разбор —
              детерминированный алгоритм, без ИИ и без сети. Проверьте правки,
              при необходимости отредактируйте текст или отключите ошибочные.
            </div>

            {operations.map((op, i) => (
              <OpCard
                key={op.id}
                op={op}
                index={i + 1}
                included={!excluded[op.id]}
                onToggle={(v) => setExcluded((s) => ({ ...s, [op.id]: !v }))}
                onChange={(patch) => updateOp(op.id, patch)}
              />
            ))}

            <div className="om-actions">
              <label className="om-hl">
                Выделение:
                <select
                  className="ds-select"
                  value={highlightMode}
                  onChange={(e) => setHighlightMode(e.target.value as HighlightMode)}
                >
                  <option value="color">цветом (как в образце)</option>
                  <option value="tracked">рецензирование (исправления)</option>
                  <option value="both">цветом + рецензирование</option>
                </select>
              </label>
              <button
                className="om-btn"
                disabled={busy || includedOps.length === 0}
                onClick={handleBuild}
              >
                {busy ? "Собираем…" : `Собрать файлы (${includedOps.length}) →`}
              </button>
              <button className="om-link" onClick={reset}>
                начать заново
              </button>
            </div>
          </section>
        )}

        {stage === "done" && (
          <section className="om-section">
            <div className="om-ok">
              Готово. Применено: {results.filter((r) => r.ok).length}/{results.length}.
            </div>
            <div className="om-actions">
              <button
                className="om-btn"
                onClick={() => outCombined && download(outCombined, "Объединённые_изменения.docx")}
              >
                ↓ Объединённый файл изменений
              </button>
              <button
                className="om-btn"
                onClick={() => outOffer && download(outOffer, "Оферта_с_изменениями.docx")}
              >
                ↓ Оферта с выделенными изменениями
              </button>
            </div>
            <div className="ds-panel om-results">
              {results.map((r) => (
                <div key={r.operationId} className={r.ok ? "ok" : "fail"}>
                  {r.ok ? "✅" : "❌"} {r.message}
                </div>
              ))}
            </div>
            <button className="om-link" onClick={reset}>
              начать заново
            </button>
          </section>
        )}
      </div>
    </PageShell>
  );
}

function FileField({
  label,
  multiple,
  files,
  onFiles,
}: {
  label: string;
  multiple: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
}) {
  return (
    <label className="ds-dropzone om-drop">
      <div className="om-drop__label">{label}</div>
      <input
        type="file"
        accept=".docx"
        multiple={multiple}
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      {files.length > 0 && (
        <ul className="om-drop__files">
          {files.map((f) => (
            <li key={f.name}>📄 {f.name}</li>
          ))}
        </ul>
      )}
    </label>
  );
}

function OpCard({
  op,
  index,
  included,
  onToggle,
  onChange,
}: {
  op: Operation;
  index: number;
  included: boolean;
  onToggle: (v: boolean) => void;
  onChange: (patch: Partial<Operation>) => void;
}) {
  return (
    <div className={`ds-panel om-card${included ? "" : " off"}`}>
      <div className="om-card__head">
        <div>
          <span className="om-card__num">{index}.</span>
          <span className="om-card__type">{OP_TYPE_LABEL[op.type]}</span>{" "}
          <b>{targetLabel(op)}</b>
          <span className="om-card__src"> · {op.sourceDoc}</span>
        </div>
        <label className="om-card__toggle">
          <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} />
          включить
        </label>
      </div>

      <details className="om-card__raw">
        <summary>исходная формулировка</summary>
        <p>{op.rawText}</p>
      </details>

      {op.warnings?.map((w, i) => (
        <p key={i} className="om-card__warn">
          ⚠ {w}
        </p>
      ))}

      {op.anchor !== undefined && (
        <Field label="После слов (якорь)" value={op.anchor} onChange={(v) => onChange({ anchor: v })} />
      )}
      {op.payload !== undefined && (
        <Field
          label={op.type === "replace" ? "Новая редакция" : "Вставляемый текст"}
          value={op.payload}
          onChange={(v) => onChange({ payload: v })}
          multiline
        />
      )}
      {op.rows && <p className="om-card__rows">Строк таблицы к добавлению: {op.rows.length}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="om-field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="ds-textarea" value={value} rows={2} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="ds-input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
