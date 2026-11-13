// Быстрый переход к любому инструменту: Ctrl+K (⌘K на Mac) на любой странице
// или кнопка «Найти» в шапке. Заодно запоминает открытые инструменты для
// раздела «Недавние» на главной.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CATEGORIES,
  GAMES,
  ICONS,
  rankTools,
  readRecent,
  rememberTool,
} from "../tools";
import { OPEN_PALETTE } from "../utils/palette";
import "./CommandPalette.css";

type Item = {
  key: string;
  title: string;
  hint: string;
  path: string;
  icon: ReactNode;
  tone: string;
};

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Запоминаем открытый инструмент
  useEffect(() => rememberTool(location.pathname), [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "k" || e.key === "л" || e.code === "KeyK")
      ) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const cat = (id: string) =>
      CATEGORIES.find((c) => c.id === id)?.title ?? "";
    let tools = rankTools(q);
    if (!q.trim()) {
      // Без запроса сначала недавние
      const recent = readRecent();
      tools = [...tools].sort((a, b) => {
        const ia = recent.indexOf(a.path);
        const ib = recent.indexOf(b.path);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    }
    const out: Item[] = tools.map((t) => ({
      key: t.path,
      title: t.title,
      hint: `${cat(t.category)} · ${t.formats}`,
      path: t.path,
      icon: t.icon,
      tone: t.category,
    }));
    const ql = q.trim().toLowerCase();
    if (ql && ("главная".includes(ql) || "домой".includes(ql)))
      out.unshift({
        key: "/",
        title: "Главная",
        hint: "Все инструменты",
        path: "/",
        icon: ICONS.home,
        tone: "home",
      });
    GAMES.filter(
      (g) =>
        !ql || `${g.title} ${g.description} игра`.toLowerCase().includes(ql),
    ).forEach((g) =>
      out.push({
        key: g.path,
        title: g.title,
        hint: `Игры · ${g.description}`,
        path: g.path,
        icon: <span className="cp-glyph">{g.glyph}</span>,
        tone: "games",
      }),
    );
    return out;
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const go = (it?: Item) => {
    if (!it) return;
    setOpen(false);
    navigate(it.path);
  };

  return (
    <div className="cp-overlay" onMouseDown={() => setOpen(false)}>
      <div
        className="cp"
        role="dialog"
        aria-modal="true"
        aria-label="Найти инструмент"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cp__search">
          {ICONS.search}
          <input
            ref={inputRef}
            id="cp-query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Что нужно сделать? Например: сравнить, pdf в ворд, сжать"
            aria-label="Поиск инструмента"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") go(items[active]);
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cp__list" ref={listRef} role="listbox">
          {items.map((it, i) => (
            <li key={it.key}>
              <button
                type="button"
                data-i={i}
                className={`cp__item ${i === active ? "is-active" : ""}`}
                onMouseMove={() => setActive(i)}
                onClick={() => go(it)}
                role="option"
                aria-selected={i === active}
              >
                <span className={`cp__icon tone-${it.tone}`}>{it.icon}</span>
                <span className="cp__text">
                  <b>{it.title}</b>
                  <small>{it.hint}</small>
                </span>
                {i === active && <span className="cp__enter">Enter ↵</span>}
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="cp__empty">
              Ничего не нашлось. Попробуйте другое слово: «excel»,
              «презентация», «сравнить».
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
