// Модуль «Объединение изменений в Оферту».
// Полностью браузерная обработка (algorithm-only): документы не покидают
// компьютер, сервер и сеть не задействованы.
import { useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import PageShell from "../../components/PageShell";
import { parseAllChangeDocs, buildOutputs } from "./engine/pipeline";
import { loadDocx } from "./engine/docx";
import { previewOperations, type PreviewSnippet } from "./engine/preview";
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
  replace_footnote: "изложить сноску заново",
  add_footnote: "добавить сноску",
  insert_point: "добавить новый пункт",
  append_table_rows: "добавить строки таблицы",
  replace_table_rows: "изменить строки таблицы",
  sort_table_alpha: "сортировка по алфавиту",
  insert_table_row_alpha: "добавить по алфавиту",
  replace_sentence: "изложить предложение заново",
  append_sentence: "дополнить предложением",
  replace_words: "заменить слова",
  delete_words: "удалить слова",
  delete_point: "исключить пункт",
  manual: "ручная обработка",
};

const OP_TYPE_ICON: Record<Operation["type"], string> = {
  insert_after: "➕",
  replace: "✏️",
  replace_footnote: "✏️",
  add_footnote: "🔖",
  insert_point: "➕",
  append_table_rows: "▤",
  replace_table_rows: "▦",
  sort_table_alpha: "🔤",
  insert_table_row_alpha: "🔤",
  replace_sentence: "✏️",
  append_sentence: "➕",
  replace_words: "🔁",
  delete_words: "🗑️",
  delete_point: "🗑️",
  manual: "✋",
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
    case "preamble":
      return "Преамбула";
    case "appendix_point":
      return `Приложение №${t.appendix}, п. ${t.point}`;
    case "appendix_table":
      return `Таблица${t.point ? ` п. ${t.point}` : ""} Приложения №${t.appendix}`;
  }
}

function targetShort(op: Operation): string {
  const t = op.target;
  switch (t.kind) {
    case "footnote":
      return `Сноска ${t.number}`;
    case "term":
      return `Термин «${t.term}»`;
    case "point":
      return `Пункт ${t.point}`;
    case "preamble":
      return "Преамбула";
    case "appendix_point":
      return `Прил. ${t.appendix} · п. ${t.point}`;
    case "appendix_table":
      return `Таблица · Прил. ${t.appendix}`;
  }
}

async function fileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const STEPS: { key: Stage; label: string }[] = [
  { key: "upload", label: "1. Загрузка" },
  { key: "review", label: "2. Проверка" },
  { key: "done", label: "3. Файлы" },
];

export default function OfferMerge() {
  const [stage, setStage] = useState<Stage>("upload");
  const [offer, setOffer] = useState<File | null>(null);
  const [changes, setChanges] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [offerBytes, setOfferBytes] = useState<Uint8Array | null>(null);
  const [offerParts, setOfferParts] = useState<{
    document: string;
    footnotes: string | null;
    numbering: string | null;
    styles: string | null;
  } | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("color");
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [outOffer, setOutOffer] = useState<Uint8Array | null>(null);
  const [outCombined, setOutCombined] = useState<Uint8Array | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const flashTimer = useRef<number | null>(null);

  const includedOps = useMemo(
    () => operations.filter((o) => !excluded[o.id]),
    [operations, excluded],
  );

  // Предпросмотр: прогоняем движок на включённых правках в том же порядке, что
  // и при сборке, — карточка показывает ровно то, что окажется в файле.
  const previews = useMemo(() => {
    if (!offerParts) return new Map<string, PreviewSnippet>();
    return previewOperations(offerParts, includedOps);
  }, [includedOps, offerParts]);

  // Доступность этапов для переключения.
  const canReview = operations.length > 0;
  const canDone = !!outOffer && !!outCombined;
  function goStage(s: Stage) {
    if (s === "review" && !canReview) return;
    if (s === "done" && !canDone) return;
    setStage(s);
  }

  function goToOp(id: string) {
    const el = document.getElementById(`om-op-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1300);
  }

  function goToIndex(i: number) {
    if (i < 0 || i >= operations.length) return;
    setCurrent(i);
    goToOp(operations[i].id);
  }

  function addChanges(files: File[]) {
    const docx = files.filter((f) => f.name.toLowerCase().endsWith(".docx"));
    setChanges((prev) => {
      const names = new Set(prev.map((p) => p.name + p.size));
      return [...prev, ...docx.filter((f) => !names.has(f.name + f.size))];
    });
  }

  async function handleParse() {
    if (!offer || changes.length === 0) {
      setError("Загрузите Оферту и хотя бы один документ с изменениями.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const bytes = await fileBytes(offer);
      setOfferBytes(bytes);
      const parts = await loadDocx(bytes);
      setOfferParts({
        document: parts.document,
        footnotes: parts.footnotes,
        numbering: parts.numbering,
        styles: parts.styles,
      });
      const docs = [];
      for (const c of changes) docs.push({ name: c.name, data: await fileBytes(c) });
      const { operations: ops } = await parseAllChangeDocs(docs);
      setOperations(ops);
      setExcluded({});
      setCurrent(0);
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
      width={1040}
    >
      <div className="om">
        <div className="om-steps" role="tablist">
          {STEPS.map((s, i) => {
            const disabled =
              (s.key === "review" && !canReview) || (s.key === "done" && !canDone);
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={stage === s.key}
                className={`om-step${stage === s.key ? " is-active" : ""}`}
                disabled={disabled}
                onClick={() => goStage(s.key)}
              >
                {s.label}
                {i < STEPS.length - 1 && <span className="om-step__arrow">›</span>}
              </button>
            );
          })}
        </div>

        {error && <div className="om-error">{error}</div>}

        {stage === "upload" && (
          <section className="om-section">
            <DropZone
              icon="📄"
              label="Действующая Оферта (Приложение 7)"
              hint="Один файл .docx — базовый текст оферты"
              multiple={false}
              files={offer ? [offer] : []}
              onAdd={(f) => {
                const d = f.find((x) => x.name.toLowerCase().endsWith(".docx"));
                if (d) setOffer(d);
              }}
              onRemove={() => setOffer(null)}
            />
            <DropZone
              icon="🗂️"
              label="Документы с изменениями"
              hint="Можно несколько .docx — каждый со своим перечнем правок"
              multiple
              files={changes}
              onAdd={addChanges}
              onRemove={(i) => setChanges((prev) => prev.filter((_, idx) => idx !== i))}
            />
            <p className="om-hint">
              🔒 Обработка идёт полностью в браузере: документы никуда не отправляются,
              ИИ и сеть не задействованы.
            </p>
            <button className="om-btn" disabled={busy} onClick={handleParse}>
              {busy ? "Распознаём…" : "Распознать изменения →"}
            </button>
          </section>
        )}

        {stage === "review" && (
          <section className="om-review">
            <aside className="om-nav">
              <div className="om-nav__title">
                Изменения <span className="om-nav__count">{operations.length}</span>
                <div className="om-nav__pager">
                  <button
                    type="button"
                    className="om-pager-btn"
                    disabled={current <= 0}
                    onClick={() => goToIndex(current - 1)}
                    aria-label="Предыдущее изменение"
                  >
                    ◀
                  </button>
                  <span className="om-nav__pos">
                    {operations.length ? current + 1 : 0}/{operations.length}
                  </span>
                  <button
                    type="button"
                    className="om-pager-btn"
                    disabled={current >= operations.length - 1}
                    onClick={() => goToIndex(current + 1)}
                    aria-label="Следующее изменение"
                  >
                    ▶
                  </button>
                </div>
              </div>
              <ul className="om-nav__list">
                {operations.map((op, i) => {
                  const pv = previews.get(op.id);
                  return (
                    <li key={op.id}>
                      <button
                        type="button"
                        className={`om-nav__item${excluded[op.id] ? " off" : ""}${current === i ? " current" : ""}`}
                        onClick={() => goToIndex(i)}
                        title={targetLabel(op)}
                      >
                        <span className="om-nav__num">{i + 1}</span>
                        <span className="om-nav__ico">{OP_TYPE_ICON[op.type]}</span>
                        <span className="om-nav__lbl">{targetShort(op)}</span>
                        {pv && !pv.ok ? (
                          <span className="om-nav__warn" title="место правки не найдено">⚠</span>
                        ) : op.warnings?.length ? (
                          <span className="om-nav__warn">⚠</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="om-review__main">
              <div className="ds-panel om-note">
                Распознано операций: <b>{operations.length}</b>. Разбор —
                детерминированный алгоритм, без ИИ и без сети. Проверьте правки,
                при необходимости отредактируйте текст или отключите ошибочные.
                <DocSummary operations={operations} previews={previews} />
              </div>

              {operations.map((op, i) => (
                <OpCard
                  key={op.id}
                  op={op}
                  index={i + 1}
                  flash={flashId === op.id}
                  preview={previews.get(op.id)}
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
                <button className="om-link" onClick={() => goStage("upload")}>
                  ← к загрузке
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === "done" && (
          <section className="om-section">
            <div className="om-ok">
              Готово. Применено: {results.filter((r) => r.ok).length}/{results.length}.
            </div>
            <div className="om-downloads">
              <button
                className="om-dl"
                onClick={() => outCombined && download(outCombined, "Объединённые_изменения.docx")}
              >
                <span className="om-dl__ico">📋</span>
                <span>
                  <b>Объединённый файл изменений</b>
                  <small>перечень правок в порядке следования пунктов Оферты</small>
                </span>
                <span className="om-dl__arrow">↓</span>
              </button>
              <button
                className="om-dl"
                onClick={() => outOffer && download(outOffer, "Оферта_с_изменениями.docx")}
              >
                <span className="om-dl__ico">📝</span>
                <span>
                  <b>Оферта с выделенными изменениями</b>
                  <small>текст оферты с применёнными правками</small>
                </span>
                <span className="om-dl__arrow">↓</span>
              </button>
            </div>
            <div className="ds-panel om-results">
              {results.map((r) => (
                <div key={r.operationId} className={r.ok ? "ok" : "fail"}>
                  {r.ok ? "✅" : "❌"} {r.message}
                </div>
              ))}
            </div>
            <div className="om-actions">
              <button className="om-link" onClick={() => goStage("review")}>
                ← к проверке
              </button>
              <button className="om-link" onClick={reset}>
                начать заново
              </button>
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}

function DropZone({
  icon,
  label,
  hint,
  multiple,
  files,
  onAdd,
  onRemove,
}: {
  icon: string;
  label: string;
  hint: string;
  multiple: boolean;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="om-dz-wrap">
      <div
        className={`om-dz${over ? " is-over" : ""}${files.length ? " has-files" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onAdd(Array.from(e.dataTransfer.files));
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <div className="om-dz__icon">{icon}</div>
        <div className="om-dz__text">
          <div className="om-dz__label">{label}</div>
          <div className="om-dz__hint">{hint}</div>
          <div className="om-dz__cta">
            Перетащите файл сюда или <span>выберите</span>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          multiple={multiple}
          hidden
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="om-files">
          {files.map((f, i) => (
            <li key={f.name + f.size} className="om-chip">
              <span className="om-chip__ico">📄</span>
              <span className="om-chip__name" title={f.name}>
                {f.name}
              </span>
              <span className="om-chip__size">{fmtSize(f.size)}</span>
              <button
                type="button"
                className="om-chip__x"
                aria-label="Убрать файл"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpCard({
  op,
  index,
  flash,
  preview,
  included,
  onToggle,
  onChange,
}: {
  op: Operation;
  index: number;
  flash: boolean;
  preview?: PreviewSnippet;
  included: boolean;
  onToggle: (v: boolean) => void;
  onChange: (patch: Partial<Operation>) => void;
}) {
  return (
    <div
      id={`om-op-${op.id}`}
      className={`ds-panel om-card${included ? "" : " off"}${flash ? " flash" : ""}`}
    >
      <div className="om-card__head">
        <div>
          <span className="om-card__num">{index}.</span>
          <span className="om-card__type">
            {OP_TYPE_ICON[op.type]} {OP_TYPE_LABEL[op.type]}
          </span>{" "}
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

      {preview && <PreviewBlock preview={preview} />}

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

/**
 * Сводка по каждому загруженному документу «Изменения».
 *
 * Без неё легко не заметить, что из одного файла не подхватилась ни одна
 * правка: в общем списке это выглядит как «просто меньше карточек».
 */
function DocSummary({
  operations,
  previews,
}: {
  operations: Operation[];
  previews: Map<string, PreviewSnippet>;
}) {
  const docs = new Map<string, { total: number; ok: number; manual: number; miss: number }>();
  for (const op of operations) {
    const row = docs.get(op.sourceDoc) ?? { total: 0, ok: 0, manual: 0, miss: 0 };
    row.total++;
    const pv = previews.get(op.id);
    if (op.type === "manual") row.manual++;
    else if (pv && !pv.ok) row.miss++;
    else row.ok++;
    docs.set(op.sourceDoc, row);
  }
  if (docs.size === 0) return null;
  return (
    <ul className="om-docsum">
      {[...docs.entries()].map(([name, r]) => (
        <li key={name} className={r.ok === 0 ? "om-docsum__row om-docsum__row--empty" : "om-docsum__row"}>
          <span className="om-docsum__name">{name}</span>
          <span className="om-docsum__stats">
            применится {r.ok} из {r.total}
            {r.miss ? ` · не найдено мест: ${r.miss}` : ""}
            {r.manual ? ` · вручную: ${r.manual}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PreviewBlock({ preview }: { preview: PreviewSnippet }) {
  if (preview.kind === "manual") {
    return (
      <div className="om-preview om-preview--manual">
        <span className="om-preview__badge">✋ ручная обработка</span>
        <span className="om-preview__note">{preview.message}</span>
      </div>
    );
  }
  if (!preview.ok) {
    return (
      <div className="om-preview om-preview--miss">
        <span className="om-preview__badge">📍 правка не будет применена</span>
        <span className="om-preview__note">{preview.message}</span>
      </div>
    );
  }
  return (
    <div className="om-preview">
      <div className="om-preview__label">📍 Как будет в документе · {preview.message}</div>
      {preview.segments && (
        <div className="om-preview__doc">
          {preview.segments.map((seg, i) =>
            seg.mark === "ins" ? (
              <mark key={i} className="om-mark">
                {seg.text}
              </mark>
            ) : seg.mark === "del" ? (
              <span key={i} className="om-old">
                {seg.text}
              </span>
            ) : (
              <span key={i} className="om-ctx">
                {seg.text}
              </span>
            ),
          )}
        </div>
      )}
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
        // Юридическая формулировка бывает в 20 строк: поле подстраивается под
        // текст, иначе оператор проверяет правку через щёлку в три строки.
        <textarea
          className="ds-textarea om-textarea"
          value={value}
          rows={Math.min(24, Math.max(3, Math.ceil(value.length / 80) + value.split("\n").length))}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input className="ds-input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
