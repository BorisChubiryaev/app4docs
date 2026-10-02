import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compareWordModels,
  type CompareRow,
  type InlineToken,
  type RowStatus,
  type WordDocModel,
} from "../wordCompare";
import { plural, DIFFS } from "../../../utils/plural";
// Панель фильтров, чипы, кнопки и навигация — общие с экраном Excel.
import "../excel/ExcelCompareView.css";

// Сколько строк результата рисуем сразу: строки разной высоты (абзацы
// переносятся), поэтому вместо виртуальной прокрутки — постраничный вывод.
const PAGE_SIZE = 200;

const STATUS_LABEL: Record<RowStatus, string> = {
  modified: "Изменено",
  added: "Добавлено",
  removed: "Удалено",
  identical: "Без изменений",
};
const STATUSES: RowStatus[] = ["modified", "added", "removed", "identical"];
const DEFAULT_STATUSES: RowStatus[] = ["modified", "added", "removed"];

type ElementFilter = "all" | "paragraph" | "table";

const kindIcon = (kind: CompareRow["kind"]) => {
  if (kind === "paragraph") return "📝";
  if (kind === "table") return "📊";
  if (kind === "table-row") return "▦";
  return "▣"; // table-cell
};

const renderTokens = (tokens: InlineToken[]) => {
  if (!tokens || tokens.length === 0) {
    return <span className="wd-empty">（пусто）</span>;
  }
  return tokens.map((t, i) => (
    <span key={i} className={`wd-tok wd-tok--${t.type}`}>
      {t.text}
    </span>
  ));
};

interface Props {
  model1: WordDocModel;
  model2: WordDocModel;
}

const WordCompareView: React.FC<Props> = ({ model1, model2 }) => {
  // Параметры сравнения
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreNumbering, setIgnoreNumbering] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(false);

  // Фильтры
  const [statuses, setStatuses] = useState<Set<RowStatus>>(
    () => new Set(DEFAULT_STATUSES),
  );
  const [element, setElement] = useState<ElementFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeId, setActiveId] = useState<string | null>(null);

  const result = useMemo(
    () =>
      compareWordModels(model1, model2, {
        ignoreCase,
        ignoreNumbering,
        ignorePunctuation,
      }),
    [model1, model2, ignoreCase, ignoreNumbering, ignorePunctuation],
  );

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = {
      modified: 0,
      added: 0,
      removed: 0,
      identical: 0,
    };
    for (const r of result.rows) c[r.status]++;
    return c;
  }, [result]);
  const totalDiffs = result.changed + result.added + result.removed;

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return result.rows.filter((r) => {
      if (!statuses.has(r.status)) return false;
      if (element === "paragraph" && r.kind !== "paragraph") return false;
      if (element === "table" && r.kind === "paragraph") return false;
      if (
        q &&
        !r.location.toLowerCase().includes(q) &&
        !r.leftText.toLowerCase().includes(q) &&
        !r.rightText.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [result, statuses, element, deferredSearch]);

  // Навигация — только по различиям из отфильтрованного списка.
  const diffIndexes = useMemo(() => {
    const out: number[] = [];
    filtered.forEach((r, i) => {
      if (r.status !== "identical") out.push(i);
    });
    return out;
  }, [filtered]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setActiveId(null);
  }, [filtered]);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Прокрутка к активной строке — после того, как она отрисована.
  useEffect(() => {
    if (!activeId) return;
    rowRefs.current
      .get(activeId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId, visibleCount]);

  const activePos = activeId
    ? diffIndexes.findIndex((i) => filtered[i].id === activeId)
    : -1;

  const goTo = (pos: number) => {
    if (diffIndexes.length === 0) return;
    const p = (pos + diffIndexes.length) % diffIndexes.length;
    const idx = diffIndexes[p];
    if (idx >= visibleCount) {
      setVisibleCount(Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE);
    }
    setActiveId(filtered[idx].id);
  };

  const toggleStatus = (s: RowStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const filtersChanged =
    statuses.size !== DEFAULT_STATUSES.length ||
    !DEFAULT_STATUSES.every((s) => statuses.has(s)) ||
    element !== "all" ||
    search.trim() !== "";

  const resetFilters = () => {
    setStatuses(new Set(DEFAULT_STATUSES));
    setElement("all");
    setSearch("");
  };

  const optionsOn = ignoreCase || ignoreNumbering || ignorePunctuation;
  const fmtN = (n: number) => n.toLocaleString("ru-RU");
  const shown = filtered.slice(0, visibleCount);
  const hidden = filtered.length - shown.length;

  return (
    <div className="xc wc">
      {/* ── Сводка ── */}
      <div className="xc-bar">
        <div className="xc-summary">
          {totalDiffs > 0 ? (
            <>
              <strong>{fmtN(totalDiffs)}</strong> {plural(totalDiffs, DIFFS)} · без
              изменений{" "}
              {fmtN(counts.identical)}
            </>
          ) : (
            <>✅ Документы совпадают{optionsOn && " с учётом выбранных параметров"}</>
          )}
          {filtersChanged && (
            <span className="xc-summary__filtered">
              · показано {fmtN(filtered.length)}
            </span>
          )}
        </div>
      </div>

      {/* ── Фильтры ── */}
      <div className="xc-filters">
        <div className="xc-filters__row">
          <div className="xc-chips" role="group" aria-label="Статус">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`xc-chip xc-chip--${s} ${statuses.has(s) ? "is-on" : ""}`}
                aria-pressed={statuses.has(s)}
                onClick={() => toggleStatus(s)}
                disabled={counts[s] === 0}
              >
                <span className="xc-chip__swatch" />
                {STATUS_LABEL[s]}
                <span className="xc-chip__count">{fmtN(counts[s])}</span>
              </button>
            ))}
          </div>

          <select
            className="ds-select xc-select"
            value={element}
            onChange={(e) => setElement(e.target.value as ElementFilter)}
            aria-label="Элементы"
          >
            <option value="all">Абзацы и таблицы</option>
            <option value="paragraph">Только абзацы</option>
            <option value="table">Только таблицы</option>
          </select>

          <input
            className="ds-input xc-search"
            type="search"
            placeholder="Поиск по тексту или месту (Абзац 12, Таблица 2)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {filtersChanged && (
            <button className="xc-link" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          )}
        </div>

        <div className="xc-filters__row xc-filters__row--opts">
          <label
            className="xc-check"
            title="«Договор» и «ДОГОВОР» считаются одинаковыми"
          >
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(e) => setIgnoreCase(e.target.checked)}
            />
            Без учёта регистра
          </label>
          <label
            className="xc-check"
            title="Перенумерация пунктов («2.» → «3.») после вставки не считается изменением"
          >
            <input
              type="checkbox"
              checked={ignoreNumbering}
              onChange={(e) => setIgnoreNumbering(e.target.checked)}
            />
            Игнорировать нумерацию пунктов
          </label>
          <label
            className="xc-check"
            title={'Точки, запятые, кавычки «» и "", тире и дефисы не сравниваются'}
          >
            <input
              type="checkbox"
              checked={ignorePunctuation}
              onChange={(e) => setIgnorePunctuation(e.target.checked)}
            />
            Игнорировать пунктуацию
          </label>
          <span className="xc-hint">Лишние пробелы и переносы не учитываются всегда</span>
        </div>
      </div>

      {/* ── Навигация ── */}
      <div className="xc-nav">
        <button
          className="xc-btn"
          onClick={() => goTo(activePos <= 0 ? diffIndexes.length - 1 : activePos - 1)}
          disabled={diffIndexes.length === 0}
        >
          ↑ Предыдущее
        </button>
        <button
          className="xc-btn"
          onClick={() => goTo(activePos + 1)}
          disabled={diffIndexes.length === 0}
        >
          Следующее ↓
        </button>
        <span className="xc-nav__pos">
          {activePos >= 0
            ? `${fmtN(activePos + 1)} из ${fmtN(diffIndexes.length)} · ${
                filtered[diffIndexes[activePos]].location
              }`
            : `${fmtN(diffIndexes.length)} ${plural(diffIndexes.length, DIFFS)} в списке`}
        </span>
      </div>

      {/* ── Таблица результата ── */}
      {filtered.length === 0 ? (
        <div className="xc-empty-state">
          {totalDiffs === 0 && !statuses.has("identical") ? (
            <>
              Различий нет.{" "}
              <button className="xc-link" onClick={() => toggleStatus("identical")}>
                Показать весь документ
              </button>
            </>
          ) : (
            <>
              Под фильтры ничего не попало.{" "}
              <button className="xc-link" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="wd-table">
          <div className="wd-row wd-row--head">
            <div className="wd-cell wd-cell--loc">Расположение</div>
            <div className="wd-cell">Файл 1</div>
            <div className="wd-cell">Файл 2</div>
            <div className="wd-cell wd-cell--status">Статус</div>
          </div>
          {shown.map((row) => (
            <div
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              className={`wd-row wd-row--${row.status} ${
                row.id === activeId ? "wd-row--active" : ""
              }`}
            >
              <div className="wd-cell wd-cell--loc">
                <span className="wd-kind">{kindIcon(row.kind)}</span>
                {row.location}
              </div>
              <div className="wd-cell">
                {row.status === "identical" ? (
                  <span className="wd-plain">{row.leftText}</span>
                ) : (
                  renderTokens(row.leftTokens)
                )}
              </div>
              <div className="wd-cell">
                {row.status === "identical" ? (
                  <span className="wd-plain">{row.rightText}</span>
                ) : (
                  renderTokens(row.rightTokens)
                )}
              </div>
              <div className="wd-cell wd-cell--status">
                <span className={`wd-status wd-status--${row.status}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <div className="xc-more">
          <span>
            Показано {fmtN(shown.length)} из {fmtN(filtered.length)}
          </span>
          <button
            className="xc-btn"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Показать ещё {fmtN(Math.min(PAGE_SIZE, hidden))}
          </button>
          <button className="xc-link" onClick={() => setVisibleCount(filtered.length)}>
            Показать все
          </button>
        </div>
      )}
    </div>
  );
};

export default WordCompareView;
