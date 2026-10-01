import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExcelSheet } from "../../../types/sheet.types";
import {
  compareSheets,
  type CellDiff,
  type CompareOptions,
  type DiffKind,
} from "./diff";
import { cellAddress, columnLetter, displayCell } from "./format";
import { plural, DIFFS } from "../plural";
import "./ExcelCompareView.css";

// Фиксированные размеры нужны для виртуальной прокрутки: по ним считаем,
// какие строки и колонки сейчас видны, и рисуем только их.
const ROW_H = 30;
const COL_W = 150;
const ROWNUM_W = 64;
const OVERSCAN_ROWS = 8;
const OVERSCAN_COLS = 2;

const KIND_LABEL: Record<DiffKind, string> = {
  modified: "Изменено",
  added: "Добавлено",
  removed: "Удалено",
};
const KINDS: DiffKind[] = ["modified", "added", "removed"];

type RowMode = "diffs" | "all";
type View = "grid" | "list";

interface Props {
  sheet1: ExcelSheet;
  sheet2: ExcelSheet;
  fileName1: string;
  fileName2: string;
}

/** Похоже ли, что первая строка — заголовки таблицы. */
const looksLikeHeader = (sheet: ExcelSheet): boolean => {
  const first = sheet.rows[0];
  if (!first || sheet.rowCount < 2) return false;
  const filled = first.filter((v) => v !== undefined && v !== null);
  return (
    filled.length > 0 &&
    filled.filter((v) => typeof v === "string").length / filled.length >= 0.6
  );
};

/** Индекс первого элемента >= target в отсортированном массиве. */
const lowerBound = (arr: number[], target: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// ─────────────────────────── Виртуальная таблица листа ───────────────────────────

interface GridPaneProps {
  sheet: ExcelSheet;
  side: 1 | 2;
  title: string;
  /** Номера строк листа (0-based) в порядке показа; null — все подряд. */
  rows: number[] | null;
  totalRows: number;
  cols: number[];
  colLabel: (c: number) => string;
  kindAt: (r: number, c: number) => DiffKind | undefined;
  focus: { r: number; c: number } | null;
  height: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (side: 1 | 2) => void;
  scrollTop: number;
  scrollLeft: number;
  width: number;
}

const GridPane = memo(function GridPane({
  sheet,
  side,
  title,
  rows,
  totalRows,
  cols,
  colLabel,
  kindAt,
  focus,
  height,
  scrollRef,
  onScroll,
  scrollTop,
  scrollLeft,
  width,
}: GridPaneProps) {
  const bodyHeight = height - ROW_H;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + bodyHeight) / ROW_H) + OVERSCAN_ROWS,
  );
  const visibleW = Math.max(0, width - ROWNUM_W);
  const firstCol = Math.max(
    0,
    Math.floor(Math.max(0, scrollLeft) / COL_W) - OVERSCAN_COLS,
  );
  const lastCol = Math.min(
    cols.length,
    Math.ceil((scrollLeft + visibleW) / COL_W) + OVERSCAN_COLS,
  );
  const visibleCols = cols.slice(firstCol, lastCol);
  const padLeft = firstCol * COL_W;
  const padRight = (cols.length - lastCol) * COL_W;

  const body: React.ReactNode[] = [];
  for (let i = firstRow; i < lastRow; i++) {
    const r = rows ? rows[i] : i;
    body.push(
      <tr key={r} style={{ height: ROW_H }}>
        <th className="xc-rownum" scope="row">
          {r + 1}
        </th>
        {padLeft > 0 && <td className="xc-pad" />}
        {visibleCols.map((c) => {
          const kind = kindAt(r, c);
          const text = displayCell(sheet, r, c);
          const isFocus = focus !== null && focus.r === r && focus.c === c;
          return (
            <td
              key={c}
              className={
                (kind ? `xc-cell--${kind} xc-cell--side${side}` : "") +
                (isFocus ? " xc-cell--focus" : "")
              }
              title={text.length > 18 ? text : undefined}
            >
              {text}
            </td>
          );
        })}
        {padRight > 0 && <td className="xc-pad" />}
      </tr>,
    );
  }

  return (
    <section className={`xc-pane xc-pane--${side}`}>
      <header className="xc-pane__head">
        <span className={`xc-dot xc-dot--${side}`} />
        <span className="xc-pane__title" title={title}>
          {title}
        </span>
      </header>
      <div
        ref={scrollRef}
        className="xc-pane__scroll"
        style={{ height }}
        onScroll={() => onScroll(side)}
      >
        <table
          className="xc-grid"
          style={{ width: ROWNUM_W + cols.length * COL_W }}
        >
          <thead>
            <tr style={{ height: ROW_H }}>
              <th className="xc-rownum xc-corner" style={{ width: ROWNUM_W }}>
                #
              </th>
              {padLeft > 0 && <th className="xc-pad" style={{ width: padLeft }} />}
              {visibleCols.map((c) => (
                <th key={c} style={{ width: COL_W }} title={colLabel(c)}>
                  {colLabel(c)}
                </th>
              ))}
              {padRight > 0 && (
                <th className="xc-pad" style={{ width: padRight }} />
              )}
            </tr>
          </thead>
          <tbody>
            {firstRow > 0 && (
              <tr aria-hidden="true" style={{ height: firstRow * ROW_H }} />
            )}
            {body}
            {lastRow < totalRows && (
              <tr
                aria-hidden="true"
                style={{ height: (totalRows - lastRow) * ROW_H }}
              />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
});

// ─────────────────────────── Список различий ───────────────────────────

interface DiffListProps {
  diffs: CellDiff[];
  sheet1: ExcelSheet;
  sheet2: ExcelSheet;
  colLabel: (c: number) => string;
  height: number;
  activeIndex: number;
  onPick: (index: number) => void;
}

const DiffList = memo(function DiffList({
  diffs,
  sheet1,
  sheet2,
  colLabel,
  height,
  activeIndex,
  onPick,
}: DiffListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Новый набор фильтров — возвращаемся к началу списка.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [diffs]);

  const bodyHeight = height - ROW_H;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN_ROWS);
  const last = Math.min(
    diffs.length,
    Math.ceil((scrollTop + bodyHeight) / ROW_H) + OVERSCAN_ROWS,
  );

  const rows: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const d = diffs[i];
    const v1 = displayCell(sheet1, d.r, d.c);
    const v2 = displayCell(sheet2, d.r, d.c);
    rows.push(
      <tr
        key={i}
        style={{ height: ROW_H }}
        className={i === activeIndex ? "is-active" : undefined}
        onClick={() => onPick(i)}
        title="Показать в таблицах"
      >
        <td className="xc-list__addr">{cellAddress(d.r, d.c)}</td>
        <td className="xc-list__col">{colLabel(d.c)}</td>
        <td>
          <span className={`xc-kind xc-kind--${d.kind}`}>
            {KIND_LABEL[d.kind]}
          </span>
        </td>
        <td className="xc-list__val xc-list__val--1" title={v1}>
          {v1 === "" ? <span className="xc-empty">пусто</span> : v1}
        </td>
        <td className="xc-list__val xc-list__val--2" title={v2}>
          {v2 === "" ? <span className="xc-empty">пусто</span> : v2}
        </td>
      </tr>,
    );
  }

  return (
    <div
      ref={ref}
      className="xc-list"
      style={{ height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <table className="xc-list__table">
        <colgroup>
          <col style={{ width: 90 }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: 120 }} />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr style={{ height: ROW_H }}>
            <th>Ячейка</th>
            <th>Колонка</th>
            <th>Тип</th>
            <th>Файл 1</th>
            <th>Файл 2</th>
          </tr>
        </thead>
        <tbody>
          {first > 0 && (
            <tr aria-hidden="true" style={{ height: first * ROW_H }} />
          )}
          {rows}
          {last < diffs.length && (
            <tr
              aria-hidden="true"
              style={{ height: (diffs.length - last) * ROW_H }}
            />
          )}
        </tbody>
      </table>
    </div>
  );
});

// ─────────────────────────── Основной компонент ───────────────────────────

const ExcelCompareView: React.FC<Props> = ({
  sheet1,
  sheet2,
  fileName1,
  fileName2,
}) => {
  // Параметры сравнения
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreSpaces, setIgnoreSpaces] = useState(false);

  // Фильтры
  const [kinds, setKinds] = useState<Set<DiffKind>>(() => new Set(KINDS));
  const [column, setColumn] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [rowMode, setRowMode] = useState<RowMode>("diffs");
  const [hideCleanCols, setHideCleanCols] = useState(false);
  const [headerRow, setHeaderRow] = useState(() => looksLikeHeader(sheet1));

  // Вид
  const [view, setView] = useState<View>("grid");
  const [syncScroll, setSyncScroll] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);

  const options: CompareOptions = useMemo(
    () => ({ ignoreCase, ignoreSpaces }),
    [ignoreCase, ignoreSpaces],
  );
  const result = useMemo(
    () => compareSheets(sheet1, sheet2, options),
    [sheet1, sheet2, options],
  );

  // Подписи колонок: буква + заголовок из первой строки.
  const colLabel = useCallback(
    (c: number) => {
      const letter = columnLetter(c + 1);
      if (!headerRow) return letter;
      const name = sheet1.rows[0]?.[c] ?? sheet2.rows[0]?.[c];
      return name === undefined || name === null || name === ""
        ? letter
        : `${letter} · ${name}`;
    },
    [headerRow, sheet1, sheet2],
  );

  // Количество различий по колонкам — для выпадающего списка.
  const perColumn = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of result.diffs) m.set(d.c, (m.get(d.c) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [result]);

  // Если выбранной колонки больше нет среди различий — сбрасываем фильтр.
  useEffect(() => {
    if (column !== null && !perColumn.some(([c]) => c === column)) {
      setColumn(null);
    }
  }, [perColumn, column]);

  const filtersActive =
    kinds.size < KINDS.length || column !== null || deferredSearch.trim() !== "";

  const filtered = useMemo(() => {
    if (!filtersActive) return result.diffs;
    const q = deferredSearch.trim().toLowerCase();
    return result.diffs.filter((d) => {
      if (!kinds.has(d.kind)) return false;
      if (column !== null && d.c !== column) return false;
      if (q) {
        if (cellAddress(d.r, d.c).toLowerCase() === q) return true;
        const v1 = displayCell(sheet1, d.r, d.c).toLowerCase();
        const v2 = displayCell(sheet2, d.r, d.c).toLowerCase();
        if (!v1.includes(q) && !v2.includes(q)) return false;
      }
      return true;
    });
  }, [result, filtersActive, kinds, column, deferredSearch, sheet1, sheet2]);

  // Быстрый поиск типа различия по ячейке для подсветки.
  const kindByCell = useMemo(() => {
    const m = new Map<number, DiffKind>();
    const w = result.colCount;
    for (const d of filtered) m.set(d.r * w + d.c, d.kind);
    return m;
  }, [filtered, result.colCount]);
  const kindAt = useCallback(
    (r: number, c: number) => kindByCell.get(r * result.colCount + c),
    [kindByCell, result.colCount],
  );

  // Строки и колонки, которые показываем в таблицах.
  const diffRows = useMemo(() => {
    const out: number[] = [];
    for (const d of filtered) if (out[out.length - 1] !== d.r) out.push(d.r);
    return out;
  }, [filtered]);
  const shownRows = rowMode === "diffs" ? diffRows : null;
  const totalRows = shownRows ? shownRows.length : result.rowCount;

  const shownCols = useMemo(() => {
    if (hideCleanCols) {
      return [...new Set(filtered.map((d) => d.c))].sort((a, b) => a - b);
    }
    return Array.from({ length: result.colCount }, (_, i) => i);
  }, [hideCleanCols, filtered, result.colCount]);

  // ── Прокрутка ──
  const pane1 = useRef<HTMLDivElement>(null);
  const pane2 = useRef<HTMLDivElement>(null);
  const [scroll1, setScroll1] = useState({ top: 0, left: 0 });
  const [scroll2, setScroll2] = useState({ top: 0, left: 0 });
  const [paneWidth, setPaneWidth] = useState(800);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);

  useLayoutEffect(() => {
    const el = pane1.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaneWidth(el.clientWidth));
    ro.observe(el);
    setPaneWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [view, fullscreen]);

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const syncRef = useRef(syncScroll);
  syncRef.current = syncScroll;
  const handleScroll = useCallback((side: 1 | 2) => {
    const src = side === 1 ? pane1.current : pane2.current;
    const dst = side === 1 ? pane2.current : pane1.current;
    if (!src) return;
    const pos = { top: src.scrollTop, left: src.scrollLeft };
    (side === 1 ? setScroll1 : setScroll2)(pos);
    // Присвоение того же значения событие scroll не порождает,
    // поэтому зацикливания между панелями нет.
    if (syncRef.current && dst) {
      if (dst.scrollTop !== pos.top) dst.scrollTop = pos.top;
      if (dst.scrollLeft !== pos.left) dst.scrollLeft = pos.left;
    }
  }, []);

  // Смена набора строк/колонок — к началу таблиц.
  useEffect(() => {
    for (const el of [pane1.current, pane2.current]) {
      if (el) {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    }
    setScroll1({ top: 0, left: 0 });
    setScroll2({ top: 0, left: 0 });
    setActiveIndex(-1);
    setFocus(null);
  }, [shownRows, shownCols]);

  // ── Переход к различию ──
  const pendingJump = useRef<CellDiff | null>(null);

  const scrollToCell = useCallback(
    (d: CellDiff) => {
      const rowIdx = shownRows ? lowerBound(shownRows, d.r) : d.r;
      const colIdx = lowerBound(shownCols, d.c);
      const paneH = pane1.current?.clientHeight ?? 400;
      const top = Math.max(0, rowIdx * ROW_H - paneH / 3);
      // Прокручиваем ровно к границе колонки, чтобы слева не оставалось
      // колонки, наполовину спрятанной под закреплёнными номерами строк.
      const colsBefore = Math.floor((paneWidth - ROWNUM_W) / 3 / COL_W);
      const left = Math.max(0, (colIdx - colsBefore) * COL_W);
      for (const el of [pane1.current, pane2.current]) {
        if (el) {
          el.scrollTop = top;
          el.scrollLeft = left;
        }
      }
      setScroll1({ top, left });
      setScroll2({ top, left });
      setFocus({ r: d.r, c: d.c });
    },
    [shownRows, shownCols, paneWidth],
  );

  const goTo = useCallback(
    (index: number) => {
      if (filtered.length === 0) return;
      const i = (index + filtered.length) % filtered.length;
      setActiveIndex(i);
      if (view === "grid") {
        scrollToCell(filtered[i]);
      } else {
        // Таблицы ещё не смонтированы — прокрутим после переключения вида.
        pendingJump.current = filtered[i];
        setView("grid");
      }
    },
    [filtered, view, scrollToCell],
  );

  useLayoutEffect(() => {
    if (view === "grid" && pendingJump.current) {
      scrollToCell(pendingJump.current);
      pendingJump.current = null;
    }
  }, [view, scrollToCell]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  const toggleKind = (k: DiffKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const resetFilters = () => {
    setKinds(new Set(KINDS));
    setColumn(null);
    setSearch("");
  };

  const contentH = fullscreen
    ? Math.max(240, viewportH - 300)
    : Math.min(620, Math.max(320, viewportH - 260));

  const total = result.diffs.length;
  const changedRows = useMemo(() => {
    let n = 0;
    let prev = -1;
    for (const d of result.diffs) {
      if (d.r !== prev) {
        n++;
        prev = d.r;
      }
    }
    return n;
  }, [result]);
  const fmtN = (n: number) => n.toLocaleString("ru-RU");

  if (total === 0) {
    return (
      <div className="xc-identical">
        <span className="xc-identical__icon">✅</span>
        <div>
          <strong>Листы идентичны.</strong>{" "}
          Сравнено {fmtN(result.rowCount)} строк × {fmtN(result.colCount)} колонок
          {(ignoreCase || ignoreSpaces) && " с учётом выбранных параметров"}.
          {(ignoreCase || ignoreSpaces) && (
            <button
              className="xc-link"
              onClick={() => {
                setIgnoreCase(false);
                setIgnoreSpaces(false);
              }}
            >
              Сравнить строго
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`xc ${fullscreen ? "xc--fullscreen" : ""}`}>
      {/* ── Сводка и вид ── */}
      <div className="xc-bar">
        <div className="xc-summary">
          <strong>{fmtN(total)}</strong> {plural(total, DIFFS)} в{" "}
          <strong>{fmtN(changedRows)}</strong>{" "}
          {changedRows % 10 === 1 && changedRows % 100 !== 11 ? "строке" : "строках"}
          {filtersActive && (
            <span className="xc-summary__filtered">
              · показано {fmtN(filtered.length)}
            </span>
          )}
        </div>
        <div className="xc-bar__right">
          <div className="ds-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={view === "grid"}
              className={`ds-tab ${view === "grid" ? "ds-tab--active" : ""}`}
              onClick={() => setView("grid")}
            >
              Таблицы рядом
            </button>
            <button
              role="tab"
              aria-selected={view === "list"}
              className={`ds-tab ${view === "list" ? "ds-tab--active" : ""}`}
              onClick={() => setView("list")}
            >
              Список различий
            </button>
          </div>
          <button
            className="xc-btn"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Выйти (Esc)" : "Во весь экран"}
          >
            {fullscreen ? "✕ Свернуть" : "⛶ Во весь экран"}
          </button>
        </div>
      </div>

      {/* ── Фильтры ── */}
      <div className="xc-filters">
        <div className="xc-filters__row">
          <div className="xc-chips" role="group" aria-label="Тип изменения">
            {KINDS.map((k) => (
              <button
                key={k}
                className={`xc-chip xc-chip--${k} ${kinds.has(k) ? "is-on" : ""}`}
                aria-pressed={kinds.has(k)}
                onClick={() => toggleKind(k)}
                disabled={result.counts[k] === 0}
              >
                <span className="xc-chip__swatch" />
                {KIND_LABEL[k]}
                <span className="xc-chip__count">{fmtN(result.counts[k])}</span>
              </button>
            ))}
          </div>

          <select
            className="ds-select xc-select"
            value={column ?? ""}
            onChange={(e) =>
              setColumn(e.target.value === "" ? null : Number(e.target.value))
            }
            aria-label="Колонка"
          >
            <option value="">Все колонки</option>
            {perColumn.map(([c, n]) => (
              <option key={c} value={c}>
                {colLabel(c)} — {fmtN(n)}
              </option>
            ))}
          </select>

          <input
            className="ds-input xc-search"
            type="search"
            placeholder="Поиск по значению или адресу (B12)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {filtersActive && (
            <button className="xc-link" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          )}
        </div>

        <div className="xc-filters__row xc-filters__row--opts">
          {view === "grid" && (
            <div className="ds-tabs xc-seg" role="group" aria-label="Строки">
              <button
                className={`ds-tab ${rowMode === "diffs" ? "ds-tab--active" : ""}`}
                onClick={() => setRowMode("diffs")}
              >
                Только строки с различиями
              </button>
              <button
                className={`ds-tab ${rowMode === "all" ? "ds-tab--active" : ""}`}
                onClick={() => setRowMode("all")}
              >
                Все строки
              </button>
            </div>
          )}
          {view === "grid" && (
            <label className="xc-check">
              <input
                type="checkbox"
                checked={hideCleanCols}
                onChange={(e) => setHideCleanCols(e.target.checked)}
              />
              Скрыть колонки без различий
            </label>
          )}
          {view === "grid" && (
            <label className="xc-check">
              <input
                type="checkbox"
                checked={syncScroll}
                onChange={(e) => setSyncScroll(e.target.checked)}
              />
              Синхронная прокрутка
            </label>
          )}
          <label className="xc-check">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => setHeaderRow(e.target.checked)}
            />
            Строка 1 — заголовки
          </label>
          <span className="xc-sep" />
          <label className="xc-check" title="«Москва» и «МОСКВА» считаются одинаковыми">
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(e) => setIgnoreCase(e.target.checked)}
            />
            Без учёта регистра
          </label>
          <label
            className="xc-check"
            title="Пробелы по краям и повторные пробелы не считаются различием"
          >
            <input
              type="checkbox"
              checked={ignoreSpaces}
              onChange={(e) => setIgnoreSpaces(e.target.checked)}
            />
            Игнорировать лишние пробелы
          </label>
        </div>
      </div>

      {/* ── Навигация по различиям ── */}
      <div className="xc-nav">
        <button
          className="xc-btn"
          onClick={() => goTo(activeIndex <= 0 ? filtered.length - 1 : activeIndex - 1)}
          disabled={filtered.length === 0}
        >
          ↑ Предыдущее
        </button>
        <button
          className="xc-btn"
          onClick={() => goTo(activeIndex + 1)}
          disabled={filtered.length === 0}
        >
          Следующее ↓
        </button>
        <span className="xc-nav__pos">
          {activeIndex >= 0 && filtered[activeIndex]
            ? `${fmtN(activeIndex + 1)} из ${fmtN(filtered.length)} · ${cellAddress(
                filtered[activeIndex].r,
                filtered[activeIndex].c,
              )}`
            : `${fmtN(filtered.length)} ${plural(filtered.length, DIFFS)}`}
        </span>
        <span className="xc-legend">
          <span className="xc-legend__item">
            <span className="xc-dot xc-dot--1" /> Файл 1
          </span>
          <span className="xc-legend__item">
            <span className="xc-dot xc-dot--2" /> Файл 2
          </span>
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="xc-empty-state">
          Под фильтры не попало ни одного различия.{" "}
          <button className="xc-link" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        </div>
      ) : view === "grid" ? (
        <div className="xc-panes">
          <GridPane
            sheet={sheet1}
            side={1}
            title={`${fileName1} — ${sheet1.name}`}
            rows={shownRows}
            totalRows={totalRows}
            cols={shownCols}
            colLabel={colLabel}
            kindAt={kindAt}
            focus={focus}
            height={contentH}
            scrollRef={pane1}
            onScroll={handleScroll}
            scrollTop={scroll1.top}
            scrollLeft={scroll1.left}
            width={paneWidth}
          />
          <GridPane
            sheet={sheet2}
            side={2}
            title={`${fileName2} — ${sheet2.name}`}
            rows={shownRows}
            totalRows={totalRows}
            cols={shownCols}
            colLabel={colLabel}
            kindAt={kindAt}
            focus={focus}
            height={contentH}
            scrollRef={pane2}
            onScroll={handleScroll}
            scrollTop={scroll2.top}
            scrollLeft={scroll2.left}
            width={paneWidth}
          />
        </div>
      ) : (
        <DiffList
          diffs={filtered}
          sheet1={sheet1}
          sheet2={sheet2}
          colLabel={colLabel}
          height={contentH}
          activeIndex={activeIndex}
          onPick={goTo}
        />
      )}
    </div>
  );
};

export default ExcelCompareView;
