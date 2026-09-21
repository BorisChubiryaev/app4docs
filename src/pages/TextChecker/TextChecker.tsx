import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import mammoth from "mammoth";
import { saveAs } from "file-saver";
import PageShell from "../../components/PageShell";
import TextCheckerInstructions from "./components/TextCheckerInstructions";
import { useSpellChecker } from "./useSpellChecker";
import { DEMO_TEXT } from "./demoText";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  DEFAULT_OPTIONS,
  SEVERITY_LABELS,
  applyAllFixes,
  applyFix,
  nonOverlapping,
  runRules,
  sortIssues,
  spellingIssues,
  textStats,
} from "./engine";
import type { CheckOptions, Issue, IssueCategory, Suggestion } from "./engine";
import "./TextChecker.css";

/** Порядок категорий в панели переключателей. */
const CATEGORIES: IssueCategory[] = [
  "spelling",
  "punctuation",
  "grammar",
  "typography",
  "style",
];

/** Какой ключ настроек отвечает за категорию. */
const CATEGORY_OPTION: Record<IssueCategory, keyof CheckOptions> = {
  spelling: "spelling",
  punctuation: "punctuation",
  grammar: "grammar",
  typography: "typography",
  style: "style",
};

/** Сколько карточек показываем в панели: на больших текстах их тысячи. */
const VISIBLE_ISSUES_LIMIT = 200;

/** Сигнатура замечания для списка «пропущенных» — переживает правки текста. */
const signature = (issue: Issue) => `${issue.ruleId}|${issue.fragment.trim().toLowerCase()}`;

interface Segment {
  text: string;
  issue?: Issue;
}

/** Режет текст на куски: обычный текст и подсвеченные фрагменты. */
function buildSegments(text: string, marks: Issue[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const issue of marks) {
    if (issue.start > cursor) segments.push({ text: text.slice(cursor, issue.start) });
    segments.push({ text: text.slice(issue.start, issue.end), issue });
    cursor = issue.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments;
}

const TextChecker: React.FC = () => {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<CheckOptions>(DEFAULT_OPTIONS);
  const [ruleIssues, setRuleIssues] = useState<Issue[]>([]);
  const [spellIssues, setSpellIssues] = useState<Issue[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestionsByWord, setSuggestionsByWord] = useState<Record<string, string[]>>({});
  const [popover, setPopover] = useState<{ top: number; left: number } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Слова, для которых подсказки уже запрошены у словаря. */
  const requestedSuggestions = useRef(new Set<string>());

  const spell = useSpellChecker(options.spelling);

  /* ── Проверка правилами: быстрая, в основном потоке ── */
  useEffect(() => {
    const timer = setTimeout(() => setRuleIssues(runRules(text, options)), 250);
    return () => clearTimeout(timer);
  }, [text, options]);

  /* ── Проверка орфографии: в воркере ── */
  const { check: checkSpelling, suggest: suggestSpelling } = spell;

  useEffect(() => {
    if (!options.spelling || spell.status !== "ready") {
      setSpellIssues([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      checkSpelling(text)
        .then((unknown) => {
          if (cancelled) return;
          setSpellIssues(spellingIssues(text, unknown));
          // Подсказки к первым словам подбираем заранее — так карточки
          // открываются без ожидания.
          const words = Array.from(new Set(unknown.map((u) => u.word))).slice(0, 12);
          for (const word of words) {
            if (requestedSuggestions.current.has(word)) continue;
            requestedSuggestions.current.add(word);
            suggestSpelling(word).then((list) => {
              setSuggestionsByWord((current) => ({ ...current, [word]: list }));
            });
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // В зависимостях — только стабильные части хука: объект spell
    // пересоздаётся на каждый рендер и зациклил бы эффект.
  }, [text, options.spelling, spell.status, checkSpelling, suggestSpelling, spell.personal]);

  /* ── Итоговый список замечаний ── */
  const issues = useMemo(() => {
    const all = sortIssues([...ruleIssues, ...spellIssues]).filter(
      (issue) => !ignored.has(signature(issue)),
    );
    // Для орфографии подставляем подсказки словаря, когда они пришли.
    return all.map((issue) => {
      if (issue.ruleId !== "unknown-word") return issue;
      const list = suggestionsByWord[issue.fragment];
      if (!list) return issue;
      return {
        ...issue,
        suggestions: list.map((value): Suggestion => ({ value })),
        suggestionsPending: false,
      };
    });
  }, [ruleIssues, spellIssues, ignored, suggestionsByWord]);

  const marks = useMemo(() => nonOverlapping(issues), [issues]);
  const segments = useMemo(() => buildSegments(text, marks), [text, marks]);
  const stats = useMemo(() => textStats(text), [text]);
  const selected = useMemo(
    () => issues.find((issue) => issue.id === selectedId) ?? null,
    [issues, selectedId],
  );

  const counts = useMemo(() => {
    const result = { error: 0, warning: 0, hint: 0 } as Record<string, number>;
    const byCategory: Record<string, number> = {};
    for (const issue of issues) {
      result[issue.severity] += 1;
      byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    }
    return { bySeverity: result, byCategory };
  }, [issues]);

  const autoFixable = useMemo(
    () => nonOverlapping(issues.filter((i) => i.autoFix && i.suggestions.length > 0)).length,
    [issues],
  );

  /* ── Позиционирование карточки подсказки ── */
  useLayoutEffect(() => {
    if (!selectedId) {
      setPopover(null);
      return;
    }
    const markEl = backdropRef.current?.querySelector<HTMLElement>(
      `[data-issue="${selectedId}"]`,
    );
    const box = editorRef.current?.getBoundingClientRect();
    if (!markEl || !box) {
      setPopover(null);
      return;
    }
    const rect = markEl.getBoundingClientRect();
    const width = 340;
    setPopover({
      top: rect.bottom - box.top + 8,
      left: Math.max(8, Math.min(rect.left - box.left, box.width - width - 8)),
    });
  }, [selectedId, text, marks, scrollTick]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* ── Работа с текстом ── */

  const changeText = useCallback(
    (next: string, remember = true) => {
      if (remember) setHistory((prev) => [...prev.slice(-19), text]);
      setText(next);
      setSelectedId(null);
    },
    [text],
  );

  const handleScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    // Карточка привязана к подсветке, поэтому при прокрутке её надо
    // пересчитать — иначе она «отклеится» от своего места в тексте.
    setScrollTick((tick) => tick + 1);
  }, []);

  /** Клик или перемещение каретки: показываем замечание под курсором. */
  const syncSelectionFromCaret = useCallback(() => {
    const area = textareaRef.current;
    if (!area) return;
    const pos = area.selectionStart;
    const hit = marks.find((issue) => pos >= issue.start && pos <= issue.end);
    setSelectedId(hit ? hit.id : null);
  }, [marks]);

  const selectIssue = useCallback((issue: Issue) => {
    setSelectedId(issue.id);
    const area = textareaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(issue.start, issue.end);
  }, []);

  const handleApply = useCallback(
    (issue: Issue, value: string) => {
      changeText(applyFix(text, issue, value));
      setToast("Исправлено");
    },
    [changeText, text],
  );

  const handleApplyAll = useCallback(() => {
    const result = applyAllFixes(text, issues);
    if (result.applied === 0) {
      setToast("Нечего исправлять автоматически");
      return;
    }
    changeText(result.text);
    setToast(`Исправлено автоматически: ${result.applied}`);
  }, [changeText, issues, text]);

  const handleIgnore = useCallback((issue: Issue) => {
    setIgnored((prev) => new Set(prev).add(signature(issue)));
    setSelectedId(null);
  }, []);

  const handleAddToDictionary = useCallback(
    (issue: Issue) => {
      spell.addWord(issue.fragment);
      setSelectedId(null);
      setToast(`«${issue.fragment}» добавлено в словарь`);
    },
    [spell],
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setText(last);
      setSelectedId(null);
      return prev.slice(0, -1);
    });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        if (/\.docx$/i.test(file.name)) {
          const arrayBuffer = await file.arrayBuffer();
          const { value } = await mammoth.extractRawText({ arrayBuffer });
          changeText(value);
        } else {
          changeText(await file.text());
        }
        setToast(`Загружено: ${file.name}`);
      } catch {
        setToast("Не удалось прочитать файл");
      }
    },
    [changeText],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Текст скопирован");
    } catch {
      setToast("Браузер не дал доступ к буферу обмена");
    }
  }, [text]);

  const handleDownload = useCallback(() => {
    saveAs(new Blob([text], { type: "text/plain;charset=utf-8" }), "Проверенный текст.txt");
  }, [text]);

  const toggleCategory = useCallback((category: IssueCategory) => {
    const key = CATEGORY_OPTION[category];
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
    setSelectedId(null);
  }, []);

  const spellStatusLabel =
    spell.status === "loading"
      ? "Словарь загружается…"
      : spell.status === "error"
        ? "Словарь не загрузился"
        : spell.status === "ready"
          ? busy
            ? "Проверяю орфографию…"
            : "Словарь подключён"
          : "Орфография выключена";

  return (
    <PageShell
      title="Корректор текста"
      subtitle="Орфография, пунктуация и оформление — полностью в браузере, без отправки текста на сервер"
      icon="🖋️"
      onShowInstructions={() => setShowInstructions(true)}
      width={1560}
    >
      <div className="tc-layout">
        {/* ─── Редактор ─── */}
        <section className="tc-editor-card">
          <div className="tc-toolbar">
            <button
              className="tc-tool"
              onClick={() => changeText(DEMO_TEXT)}
              title="Загрузить текст с типичными ошибками"
            >
              ✨ Пример
            </button>
            <button className="tc-tool" onClick={() => fileInputRef.current?.click()}>
              📂 Открыть файл
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx,.md,.csv"
              className="tc-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <button className="tc-tool" onClick={handleCopy} disabled={!text}>
              📋 Копировать
            </button>
            <button className="tc-tool" onClick={handleDownload} disabled={!text}>
              💾 Скачать
            </button>
            <button className="tc-tool" onClick={handleUndo} disabled={history.length === 0}>
              ↩️ Отменить
            </button>
            <button
              className="tc-tool tc-tool--danger"
              onClick={() => changeText("")}
              disabled={!text}
            >
              🗑 Очистить
            </button>
          </div>

          <div
            className="tc-editor"
            ref={editorRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
          >
            <div className="tc-backdrop" ref={backdropRef} aria-hidden="true">
              <div className="tc-highlights">
                {segments.map((segment, index) =>
                  segment.issue ? (
                    <mark
                      key={index}
                      data-issue={segment.issue.id}
                      className={`tc-mark tc-mark--${segment.issue.category} tc-mark--${segment.issue.severity}${
                        segment.issue.id === selectedId ? " tc-mark--active" : ""
                      }`}
                    >
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
                {"\n"}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              className="tc-input"
              value={text}
              spellCheck={false}
              placeholder={
                "Вставьте текст или перетащите сюда файл .docx / .txt.\n\nПроверка запускается сама — подчёркнутые места кликабельны."
              }
              onChange={(e) => {
                setText(e.target.value);
                setSelectedId(null);
              }}
              onScroll={handleScroll}
              onClick={syncSelectionFromCaret}
              onKeyUp={(e) => {
                if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                  syncSelectionFromCaret();
                }
              }}
            />

            {selected && popover && (
              <div className="tc-popover" style={{ top: popover.top, left: popover.left }}>
                <div className="tc-popover__head">
                  <span className={`tc-badge tc-badge--${selected.severity}`}>
                    {CATEGORY_ICONS[selected.category]} {CATEGORY_LABELS[selected.category]}
                  </span>
                  <button
                    className="tc-popover__close"
                    onClick={() => setSelectedId(null)}
                    aria-label="Закрыть"
                  >
                    ✕
                  </button>
                </div>
                <h4 className="tc-popover__title">{selected.title}</h4>
                <p className="tc-popover__message">{selected.message}</p>

                {selected.suggestions.length > 0 && (
                  <div className="tc-popover__fixes">
                    {selected.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        className="tc-fix"
                        onClick={() => handleApply(selected, suggestion.value)}
                      >
                        {suggestion.label ?? suggestion.value.replace(/\n/g, "↵") ?? "—"}
                      </button>
                    ))}
                  </div>
                )}
                {selected.ruleId === "unknown-word" && selected.suggestions.length === 0 && (
                  <p className="tc-popover__pending">
                    {spell.status === "ready" ? "Подбираю варианты…" : "Словарь недоступен"}
                  </p>
                )}

                <div className="tc-popover__actions">
                  <button className="tc-link" onClick={() => handleIgnore(selected)}>
                    Пропустить
                  </button>
                  {selected.category === "spelling" && selected.ruleId === "unknown-word" && (
                    <button className="tc-link" onClick={() => handleAddToDictionary(selected)}>
                      Добавить в словарь
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="tc-stats">
            <span>Символов: <b>{stats.characters}</b></span>
            <span>Без пробелов: <b>{stats.charactersNoSpaces}</b></span>
            <span>Слов: <b>{stats.words}</b></span>
            <span>Предложений: <b>{stats.sentences}</b></span>
            <span>Абзацев: <b>{stats.paragraphs}</b></span>
            <span>Чтение: <b>~{stats.readingMinutes} мин</b></span>
          </div>
        </section>

        {/* ─── Панель замечаний ─── */}
        <aside className="tc-panel">
          <div className="tc-panel__summary">
            <div className="tc-score">
              <span className="tc-score__value">{issues.length}</span>
              <span className="tc-score__label">
                {issues.length === 0 ? "замечаний нет" : "замечаний"}
              </span>
            </div>
            <div className="tc-score__breakdown">
              <span className="tc-badge tc-badge--error">
                {counts.bySeverity.error} · {SEVERITY_LABELS.error.toLowerCase()}
              </span>
              <span className="tc-badge tc-badge--warning">
                {counts.bySeverity.warning} · {SEVERITY_LABELS.warning.toLowerCase()}
              </span>
              <span className="tc-badge tc-badge--hint">
                {counts.bySeverity.hint} · {SEVERITY_LABELS.hint.toLowerCase()}
              </span>
            </div>
          </div>

          <div className="tc-filters">
            {CATEGORIES.map((category) => {
              const active = options[CATEGORY_OPTION[category]];
              return (
                <button
                  key={category}
                  className={`tc-chip${active ? " tc-chip--active" : ""}`}
                  onClick={() => toggleCategory(category)}
                  title={active ? "Выключить проверку" : "Включить проверку"}
                >
                  <span>{CATEGORY_ICONS[category]}</span>
                  {CATEGORY_LABELS[category]}
                  <b>{active ? (counts.byCategory[category] ?? 0) : "—"}</b>
                </button>
              );
            })}
          </div>

          <div className="tc-panel__actions">
            <button
              className="btn-primary tc-fixall"
              onClick={handleApplyAll}
              disabled={autoFixable === 0}
            >
              ⚡ Исправить всё ({autoFixable})
            </button>
            <span className={`tc-spell-status tc-spell-status--${spell.status}`}>
              {spellStatusLabel}
            </span>
          </div>

          <div className="tc-issues">
            {issues.length === 0 && (
              <div className="tc-empty">
                {text.trim()
                  ? "👍 Правила не нашли ошибок. Смысл и логику текста программа не проверяет."
                  : "Вставьте текст — замечания появятся здесь."}
              </div>
            )}

            {issues.slice(0, VISIBLE_ISSUES_LIMIT).map((issue) => (
              <article
                key={issue.id}
                className={`tc-issue tc-issue--${issue.severity}${
                  issue.id === selectedId ? " tc-issue--active" : ""
                }`}
                onClick={() => selectIssue(issue)}
              >
                <header className="tc-issue__head">
                  <span className="tc-issue__category">
                    {CATEGORY_ICONS[issue.category]} {CATEGORY_LABELS[issue.category]}
                  </span>
                  <span className={`tc-dot tc-dot--${issue.severity}`} />
                </header>
                <h4 className="tc-issue__title">{issue.title}</h4>
                <p className="tc-issue__fragment">
                  «{issue.fragment.replace(/\n/g, " ").trim() || "␣"}»
                </p>
                <p className="tc-issue__message">{issue.message}</p>
                {issue.suggestions.length > 0 && (
                  <div className="tc-issue__fixes">
                    {issue.suggestions.slice(0, 4).map((suggestion) => (
                      <button
                        key={suggestion.value}
                        className="tc-fix"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApply(issue, suggestion.value);
                        }}
                      >
                        {suggestion.label ?? suggestion.value.replace(/\n/g, "↵")}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {issues.length > VISIBLE_ISSUES_LIMIT && (
              <div className="tc-empty">
                Показаны первые {VISIBLE_ISSUES_LIMIT} замечаний из {issues.length}.
                Исправьте их — остальные подтянутся. В тексте подсвечены все.
              </div>
            )}
          </div>

          {spell.personal.length > 0 && (
            <details className="tc-personal">
              <summary>Личный словарь ({spell.personal.length})</summary>
              <div className="tc-personal__list">
                {spell.personal.map((word) => (
                  <button
                    key={word}
                    className="tc-personal__word"
                    onClick={() => spell.removeWord(word)}
                    title="Убрать из словаря"
                  >
                    {word} ✕
                  </button>
                ))}
              </div>
            </details>
          )}
        </aside>
      </div>

      {toast && <div className="tc-toast">{toast}</div>}

      <TextCheckerInstructions
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </PageShell>
  );
};

export default TextChecker;
