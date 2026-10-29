import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import ElementPanel from "./components/ElementPanel";
import DataGrid from "./components/DataGrid";
import { DataPanel, TextsPanel, ThemePanel } from "./components/SidePanels";
import { applyData, type Cell, type DataSet } from "./core/data";
import { labelOf, normalizeHtml, serializeDoc, setupEditorDoc } from "./core/doc";
import { SAMPLE_HTML } from "./core/sample";
import { readTable, writeTable } from "./core/tables";
import "./HtmlStudio.css";

// HTML-редактор для страниц, которые генерирует ИИ: правка прямо на странице
// (текст, картинки, блоки, оформление), все тексты списком с заменой,
// таблицы и данные графиков как таблица с вставкой из Excel, цвета и шрифты
// всей страницы, код с подсветкой, просмотр с работающими скриптами.

const CodeEditor = lazy(() => import("./components/CodeEditor"));

type View = "visual" | "code" | "preview";
type Side = "element" | "texts" | "data" | "theme";
type Device = "desktop" | "tablet" | "phone";

const DEVICE_W: Record<Device, string> = { desktop: "100%", tablet: "820px", phone: "390px" };
const DRAFT_KEY = "htmlstudio.draft.v1";
const MAX_HISTORY = 80;

interface Draft {
  name: string;
  html: string;
  time: number;
}

const readDraft = (): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    return d && typeof d.html === "string" ? d : null;
  } catch {
    return null;
  }
};

const baseName = (n: string) => n.replace(/\.(html?|txt)$/i, "") || "страница";
const fmtKb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

const isDarkTheme = () =>
  typeof document !== "undefined" &&
  (document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches));

type GridState =
  | { kind: "table"; table: HTMLTableElement; header: string[]; rows: Cell[][]; hasHeader: boolean; merged: boolean }
  | { kind: "data"; ds: DataSet; script: HTMLScriptElement };

const HtmlStudio: React.FC = () => {
  const [html, setHtml] = useState<string | null>(null);
  const [name, setName] = useState("страница");
  const [view, setView] = useState<View>("visual");
  const [side, setSide] = useState<Side>("element");
  const [device, setDevice] = useState<Device>("desktop");
  const [selected, setSelected] = useState<Element | null>(null);
  const [editing, setEditing] = useState<Element | null>(null);
  const [version, setVersion] = useState(0);
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [grid, setGrid] = useState<GridState | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState("");
  const [draft] = useState<Draft | null>(readDraft);
  const [codeText, setCodeText] = useState("");
  const [codeDirty, setCodeDirty] = useState(false);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(false);

  const htmlRef = useRef<string | null>(null);
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<Element | null>(null);
  const editRef = useRef<Element | null>(null);
  const hoverRef = useRef<Element | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = (t: string) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  // ── Документ и история ──

  const saveDraft = (h: string, n: string) => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        if (h.length < 3_500_000) localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: n, html: h, time: Date.now() }));
      } catch {
        /* хранилище переполнено — черновик не сохраняем */
      }
    }, 800);
  };

  /** Показать HTML во фрейме редактирования (с нуля). */
  const loadFrame = useCallback((h: string) => {
    const f = frameRef.current;
    if (!f) return;
    selRef.current = null;
    editRef.current = null;
    hoverRef.current = null;
    setSelected(null);
    setEditing(null);
    setFrameDoc(null);
    f.srcdoc = h;
  }, []);

  const open = (src: string, fileName: string) => {
    const h = normalizeHtml(src);
    past.current = [];
    future.current = [];
    htmlRef.current = h;
    setHtml(h);
    setName(baseName(fileName));
    setCodeText(h);
    setCodeDirty(false);
    setView("visual");
    setSide("element");
    saveDraft(h, baseName(fileName));
  };

  /** Зафиксировать изменения из фрейма: снимок для отмены, черновик. */
  const commit = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || htmlRef.current === null) return;
    const next = serializeDoc(doc);
    if (next === htmlRef.current) {
      setVersion((v) => v + 1);
      return;
    }
    past.current.push(htmlRef.current);
    if (past.current.length > MAX_HISTORY) past.current.shift();
    future.current = [];
    htmlRef.current = next;
    setHtml(next);
    setCodeText(next);
    setVersion((v) => v + 1);
    saveDraft(next, name);
  }, [name]);

  const restore = (h: string) => {
    htmlRef.current = h;
    setHtml(h);
    setCodeText(h);
    setCodeDirty(false);
    if (view !== "preview") loadFrame(h);
    setVersion((v) => v + 1);
    saveDraft(h, name);
  };

  const undo = () => {
    stopEdit(false);
    const prev = past.current.pop();
    if (prev === undefined || htmlRef.current === null) return;
    future.current.push(htmlRef.current);
    restore(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (next === undefined || htmlRef.current === null) return;
    past.current.push(htmlRef.current);
    restore(next);
  };

  // Первый показ документа и возврат на визуальную вкладку
  useEffect(() => {
    if (htmlRef.current !== null && view === "visual" && frameRef.current && !frameRef.current.srcdoc) loadFrame(htmlRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html !== null, view]);

  // ── Выделение и правка текста во фрейме ──

  const mark = (el: Element | null, attr: string, ref: React.MutableRefObject<Element | null>) => {
    ref.current?.removeAttribute(attr);
    ref.current = el;
    el?.setAttribute(attr, "");
  };

  const select = useCallback((el: Element | null) => {
    if (el && (el.tagName === "HTML" || el.tagName === "HEAD")) el = el.ownerDocument.body;
    mark(el, "data-he-sel", selRef);
    setSelected(el);
    if (el) setSide("element");
  }, []);

  const stopEdit = useCallback(
    (save = true) => {
      const el = editRef.current;
      if (!el) return;
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-he-ce");
      el.removeAttribute("data-he-edit");
      el.removeAttribute("spellcheck");
      editRef.current = null;
      setEditing(null);
      if (save) commit();
    },
    [commit],
  );

  const startTextEdit = useCallback(
    (el: Element) => {
      if (editRef.current === el) return;
      stopEdit();
      const h = el as HTMLElement;
      if (!h.isContentEditable) {
        h.setAttribute("contenteditable", "true");
        h.setAttribute("data-he-ce", "");
      }
      h.setAttribute("data-he-edit", "");
      h.setAttribute("spellcheck", "true");
      editRef.current = el;
      setEditing(el);
      select(el);
      h.focus();
    },
    [select, stopEdit],
  );

  /** Положение плавающей панели над выделенным элементом. */
  const placeToolbar = useCallback(() => {
    const el = selRef.current;
    const f = frameRef.current;
    const stage = stageRef.current;
    if (!el || !f || !stage) return setToolbarPos(null);
    const r = el.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const x = Math.max(4, Math.min(fr.left - sr.left + r.left, sr.width - 330));
    let y = fr.top - sr.top + r.top - 40;
    if (y < 4) y = fr.top - sr.top + r.bottom + 6;
    if (r.bottom < 0 || r.top > fr.height) return setToolbarPos(null);
    setToolbarPos({ x, y });
  }, []);

  useEffect(placeToolbar, [selected, editing, version, placeToolbar, device]);

  const onFrameLoad = () => {
    const f = frameRef.current;
    const doc = f?.contentDocument;
    if (!doc || !doc.documentElement) return;
    setupEditorDoc(doc);
    setFrameDoc(doc);
    setVersion((v) => v + 1);

    doc.addEventListener("mouseover", (e) => {
      const t = e.target as Element;
      if (t === doc.documentElement || t === doc.body || editRef.current) return mark(null, "data-he-hover", hoverRef);
      mark(t, "data-he-hover", hoverRef);
    });
    doc.addEventListener("mouseleave", () => mark(null, "data-he-hover", hoverRef));
    doc.addEventListener(
      "click",
      (e) => {
        const t = e.target as Element;
        // Внутри редактируемого текста — обычная работа с курсором
        if (editRef.current && editRef.current.contains(t)) return;
        e.preventDefault(); // ссылки и кнопки не срабатывают
        if (editRef.current) stopEdit();
        doc.getSelection()?.removeAllRanges(); // синяя подсветка текста браузера мешает видеть выделение блока
        select(t);
      },
      true,
    );
    doc.addEventListener("dblclick", (e) => {
      const t = e.target as Element;
      if (editRef.current?.contains(t)) return;
      e.preventDefault();
      startTextEdit(t);
    });
    doc.addEventListener("submit", (e) => e.preventDefault(), true);
    doc.addEventListener("keydown", (e) => handleKey(e));
    doc.addEventListener("scroll", () => placeToolbar(), true);
    doc.addEventListener("input", () => placeToolbar());
  };

  // ── Действия с выделенным ──

  const removeSel = () => {
    const el = selRef.current;
    if (!el || el === el.ownerDocument.body) return;
    const next = el.nextElementSibling ?? el.previousElementSibling ?? el.parentElement;
    el.remove();
    select(next && next !== el.ownerDocument.documentElement ? next : null);
    commit();
  };
  const duplicateSel = () => {
    const el = selRef.current;
    if (!el || el === el.ownerDocument.body) return;
    const copy = el.cloneNode(true) as Element;
    for (const a of ["data-he-sel", "data-he-hover", "data-he-edit"]) copy.removeAttribute(a);
    el.after(copy);
    select(copy);
    commit();
  };
  const moveSel = (dir: -1 | 1) => {
    const el = selRef.current;
    if (!el) return;
    if (dir < 0 && el.previousElementSibling) el.previousElementSibling.before(el);
    else if (dir > 0 && el.nextElementSibling) el.nextElementSibling.after(el);
    else return;
    commit();
  };
  const insertAfter = (snippet: string) => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const tpl = doc.createElement("template");
    tpl.innerHTML = snippet;
    const node = tpl.content.firstElementChild;
    if (!node) return;
    const el = selRef.current;
    if (!el || el === doc.body) doc.body.appendChild(node);
    else el.after(node);
    select(node);
    commit();
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const reveal = (el: Element) => {
    if (view !== "visual") setView("visual");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.setAttribute("data-he-flash", "");
    setTimeout(() => el.removeAttribute("data-he-flash"), 1200);
  };

  // Форматирование выделенного текста при правке (жирный, курсив, ссылка, цвет)
  const exec = (cmd: string, value?: string) => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !editRef.current) return;
    doc.execCommand("styleWithCSS", false, "true");
    doc.execCommand(cmd, false, value);
    (editRef.current as HTMLElement).focus();
  };

  // ── Клавиатура ──

  const handleKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inField = (() => {
      const a = document.activeElement;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a as HTMLElement).isContentEditable);
    })();
    if (editRef.current) {
      if (e.key === "Escape") {
        e.preventDefault();
        stopEdit();
      }
      return; // в режиме правки — обычные клавиши текста
    }
    if (inField && e.target instanceof Node && e.target.ownerDocument === document) return;
    if (mod && k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((mod && k === "z" && e.shiftKey) || (mod && k === "y")) {
      e.preventDefault();
      redo();
    } else if (!selRef.current) return;
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSel();
    } else if (mod && k === "d") {
      e.preventDefault();
      duplicateSel();
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      moveSel(-1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      moveSel(1);
    } else if (e.key === "Escape") select(null);
    else if (e.key === "Enter") {
      e.preventDefault();
      startTextEdit(selRef.current);
    }
  };
  const keyRef = useRef(handleKey);
  keyRef.current = handleKey;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (html === null || view !== "visual" || grid || showPaste || showHelp) return;
      keyRef.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [html, view, grid, showPaste, showHelp]);

  // ── Код ──

  const applyCode = () => {
    if (!codeDirty || htmlRef.current === null) return;
    past.current.push(htmlRef.current);
    future.current = [];
    htmlRef.current = codeText;
    setHtml(codeText);
    setCodeDirty(false);
    saveDraft(codeText, name);
  };

  const switchView = (v: View) => {
    if (v === view) return;
    stopEdit();
    if (view === "code") applyCode();
    if (v === "code") setCodeText(htmlRef.current ?? "");
    if (view === "visual") {
      // Фрейм правки уходит со страницы вместе с его документом: выделение и
      // панели не должны держать элементы из него (при возврате фрейм новый)
      selRef.current = null;
      editRef.current = null;
      hoverRef.current = null;
      setSelected(null);
      setEditing(null);
      setFrameDoc(null);
      setToolbarPos(null);
    }
    setView(v);
  };

  // ── Таблицы и данные ──

  const openTable = (t: HTMLTableElement) => {
    const g = readTable(t);
    setGrid({ kind: "table", table: t, ...g });
  };
  const openData = (ds: DataSet, script: HTMLScriptElement) => setGrid({ kind: "data", ds, script });

  const saveGrid = (header: string[], rows: Cell[][]) => {
    if (!grid) return;
    if (grid.kind === "table") {
      writeTable(grid.table, header, rows, grid.hasHeader);
      say("Таблица обновлена");
    } else {
      const text = grid.script.textContent ?? "";
      grid.script.textContent = applyData(text, grid.ds, header, rows);
      say("Данные обновлены — откройте «Просмотр», чтобы увидеть графики");
    }
    setGrid(null);
    commit();
  };

  // ── Файлы ──

  const readFile = async (f: File) => {
    if (!/\.(html?|txt)$/i.test(f.name) && f.type !== "text/html") return say("Нужен файл .html");
    const buf = await f.arrayBuffer();
    // Кодировка: UTF-8, иначе — Windows-1251 (старые страницы)
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) {
      try {
        text = new TextDecoder("windows-1251").decode(buf);
      } catch {
        /* остаётся UTF-8 */
      }
    }
    open(text, f.name);
  };

  const download = () => {
    if (htmlRef.current === null) return;
    const blob = new Blob([htmlRef.current], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name || "страница"}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  const openInTab = (print = false) => {
    if (htmlRef.current === null) return;
    const url = URL.createObjectURL(new Blob([htmlRef.current], { type: "text/html;charset=utf-8" }));
    const w = window.open(url, "_blank");
    if (!w) return say("Браузер заблокировал новое окно — разрешите всплывающие окна");
    if (print) w.addEventListener("load", () => setTimeout(() => w.print(), 400));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(htmlRef.current ?? "");
      say("Код скопирован");
    } catch {
      say("Браузер не дал доступ к буферу обмена");
    }
  };

  const closeDoc = () => {
    if (!window.confirm("Закрыть документ? Несохранённые изменения останутся в черновике.")) return;
    setHtml(null);
    htmlRef.current = null;
    setFrameDoc(null);
    setSelected(null);
  };

  const hasScripts = useMemo(() => !!html && /<script[\s>]/i.test(html), [html]);
  const scriptOnly = useMemo(() => {
    if (!frameDoc || !hasScripts) return false;
    return (frameDoc.body?.innerText ?? "").trim().length < 40;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDoc, hasScripts, version]);
  const dark = isDarkTheme();

  // ── Пустое состояние ──

  if (html === null) {
    return (
      <PageShell
        title="HTML-редактор"
        subtitle="Правьте страницы, которые сгенерировал ИИ: тексты, таблицы, данные графиков, цвета — без знания HTML"
        onShowInstructions={() => setShowHelp(true)}
        width={1320}
      >
        <div
          className={`hs-start ${drag ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) readFile(f);
          }}
        >
          <div className="hs-start__icon">🧩</div>
          <h2>Откройте HTML-файл</h2>
          <p className="hs-muted">Перетащите файл сюда или выберите. Можно вставить код, скопированный из чата с ИИ.</p>
          <div className="hs-start__actions">
            <button className="btn-primary" onClick={() => fileRef.current?.click()}>
              📂 Выбрать файл
            </button>
            <button className="btn-secondary" onClick={() => setShowPaste(true)}>
              📋 Вставить код
            </button>
            <button className="btn-secondary" onClick={() => open(SAMPLE_HTML, "пример-отчёта.html")}>
              ✨ Открыть пример
            </button>
          </div>
          {draft && (
            <button className="hs-draft" onClick={() => open(draft.html, `${draft.name}.html`)}>
              ↩ Продолжить: «{draft.name}» · {new Date(draft.time).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} ·{" "}
              {fmtKb(draft.html.length)}
            </button>
          )}
          <ul className="hs-start__features">
            <li>✏️ Правка текста, картинок и блоков прямо на странице</li>
            <li>📊 Таблицы и данные графиков — как в Excel, со вставкой из Excel</li>
            <li>🔎 Все тексты списком, поиск и замена</li>
            <li>🎨 Цвета и шрифты всей страницы одним кликом</li>
            <li>🧑‍💻 Код с подсветкой — для опытных</li>
            <li>🔒 Скрипты страницы при правке не выполняются — открывать чужие файлы безопасно</li>
          </ul>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
        </div>
        {showPaste && pasteModal()}
        {help()}
      </PageShell>
    );
  }

  function pasteModal() {
    return (
      <div className="hs-modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && setShowPaste(false)}>
        <div className="hs-modal" role="dialog" aria-label="Вставить код">
          <div className="hs-modal__head">
            <h3>Вставьте HTML-код</h3>
            <button className="hs-x" onClick={() => setShowPaste(false)} aria-label="Закрыть">
              ✕
            </button>
          </div>
          <textarea
            className="hs-paste"
            autoFocus
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"<!DOCTYPE html>\n<html>…</html>\n\nили только фрагмент: <h1>…</h1><p>…</p>"}
          />
          <div className="hs-modal__foot">
            <button className="btn-secondary" onClick={() => setShowPaste(false)}>
              Отмена
            </button>
            <button
              className="btn-primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                // Код из чата часто приходит в ```html … ```
                const t = pasteText.replace(/^\s*```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
                open(t, "страница.html");
                setShowPaste(false);
                setPasteText("");
              }}
            >
              Открыть
            </button>
          </div>
        </div>
      </div>
    );
  }

  function help() {
    return (
      <InstructionsModalShell isOpen={showHelp} onClose={() => setShowHelp(false)} title="🧩 HTML-редактор" footerLabel="Понятно!" maxWidth={780}>
        <div className="instructions-section">
          <h3>Для чего</h3>
          <p>
            ИИ часто присылает отчёты, дашборды и страницы в виде HTML-файла. Здесь их можно поправить без знания HTML:
            переписать текст, обновить цифры, заменить картинку, поменять цвета — и сохранить файл.
          </p>
        </div>
        <div className="instructions-section">
          <h3>✏️ Визуально</h3>
          <ul>
            <li>Клик — выделить блок, двойной клик или Enter — править текст прямо на странице (Esc — готово)</li>
            <li>При правке текста: жирный, курсив, подчёркивание, ссылка, цвет выделенного фрагмента</li>
            <li>Справа — свойства блока: текст, ссылка, картинка (заменить файлом), цвет, размер, отступы, скрыть</li>
            <li>↑ ↓ — переставить, ⧉ — дублировать (Ctrl+D), 🗑 — удалить (Delete), «Вставить после» — новый блок</li>
            <li>Для таблиц — добавить и удалить строки и столбцы, «Открыть как таблицу» — правка в сетке</li>
            <li>Отмена и повтор — Ctrl+Z / Ctrl+Y; работа сохраняется в черновик браузера</li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>📊 Данные</h3>
          <ul>
            <li>Все таблицы страницы и данные, из которых скрипты рисуют графики (Chart.js, ECharts, ApexCharts и свои)</li>
            <li>Данные открываются как таблица: правьте ячейки, добавляйте строки, вставляйте диапазон из Excel, загружайте .xlsx/.csv, выгружайте в Excel</li>
            <li>Графики, которые рисует скрипт, видны на вкладке «Просмотр»</li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>🔎 Тексты и 🎨 Оформление</h3>
          <ul>
            <li>Все тексты страницы списком — удобно переписать или перевести; поиск и замена по всей странице</li>
            <li>Цвета страницы: нажмите на цвет — он заменится везде (включая цвета графиков); переменные темы; шрифты</li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>Безопасность и ограничения</h3>
          <ul>
            <li>При правке скрипты страницы не выполняются, ссылки не открываются — чужие файлы открывать безопасно</li>
            <li>То, что рисует скрипт (графики, таблицы из данных), на вкладке «Визуально» не видно — правьте данные, а смотрите в «Просмотре»</li>
            <li>Библиотеки и шрифты из интернета (CDN) без интернета не загрузятся — откройте готовый файл там, где интернет есть</li>
          </ul>
        </div>
      </InstructionsModalShell>
    );
  }

  // ── Рабочее место ──

  const selTag = selected?.tagName.toLowerCase();
  return (
    <PageShell
      title="HTML-редактор"
      subtitle="Правьте страницы, которые сгенерировал ИИ: тексты, таблицы, данные графиков, цвета — без знания HTML"
      onShowInstructions={() => setShowHelp(true)}
      width="100%"
    >
      <div className="hs">
        <div className="hs-bar">
          <input className="hs-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Имя файла" title="Имя файла при сохранении" />
          <span className="hs-muted hs-size">.html · {fmtKb(html.length)}</span>
          <span className="hs-sep" />
          <button className="hs-icon" onClick={undo} disabled={!past.current.length} title="Отменить (Ctrl+Z)">
            ↶
          </button>
          <button className="hs-icon" onClick={redo} disabled={!future.current.length} title="Повторить (Ctrl+Y)">
            ↷
          </button>
          <div className="hs-tabs" role="tablist">
            {(
              [
                ["visual", "✏️ Визуально"],
                ["code", "🧑‍💻 Код"],
                ["preview", "▶ Просмотр"],
              ] as [View, string][]
            ).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} className={`hs-tab ${view === v ? "is-on" : ""}`} onClick={() => switchView(v)}>
                {l}
              </button>
            ))}
          </div>
          {view !== "code" && (
            <div className="hs-devices" role="group" aria-label="Ширина экрана">
              {(
                [
                  ["desktop", "🖥", "Компьютер"],
                  ["tablet", "▭", "Планшет"],
                  ["phone", "📱", "Телефон"],
                ] as [Device, string, string][]
              ).map(([d, icon, t]) => (
                <button key={d} className={`hs-icon ${device === d ? "is-on" : ""}`} onClick={() => setDevice(d)} title={t}>
                  {icon}
                </button>
              ))}
            </div>
          )}
          <span className="hs-grow" />
          <button className="btn-primary hs-save" onClick={download} title="Скачать HTML-файл">
            💾 Скачать
          </button>
          <button className="hs-btn" onClick={() => openInTab(false)} title="Открыть в новой вкладке браузера (со скриптами)">
            ↗ В браузере
          </button>
          <button className="hs-btn" onClick={() => openInTab(true)} title="Печать или «Сохранить как PDF»">
            🖨 PDF
          </button>
          <button className="hs-btn" onClick={copyCode} title="Скопировать весь код">
            📋 Код
          </button>
          <button className="hs-icon" onClick={closeDoc} title="Закрыть документ">
            ✕
          </button>
        </div>

        <div className={`hs-work ${view === "visual" ? "" : "is-full"}`}>
          <div className="hs-stage" ref={stageRef}>
            {view === "visual" && (
              <>
                {hasScripts && (
                  <div className="hs-hint">
                    {scriptOnly ? "⚠️ Эту страницу почти целиком рисует скрипт — " : "ℹ️ Скрипты страницы при правке не работают — "}
                    графики и всё, что они рисуют, видно во вкладке{" "}
                    <button className="hs-link" onClick={() => switchView("preview")}>
                      «Просмотр»
                    </button>
                    , а их данные меняются во вкладке{" "}
                    <button className="hs-link" onClick={() => setSide("data")}>
                      «Данные»
                    </button>
                    .
                  </div>
                )}
                <div className="hs-frame-wrap">
                  <iframe
                    ref={frameRef}
                    title="Страница для правки"
                    className="hs-frame"
                    style={{ width: DEVICE_W[device] }}
                    sandbox="allow-same-origin"
                    onLoad={onFrameLoad}
                  />
                </div>
                {selected && toolbarPos && (
                  <div className="hs-float" style={{ left: toolbarPos.x, top: toolbarPos.y }} onMouseDown={(e) => e.preventDefault()}>
                    <span className="hs-float__tag">{labelOf(selected)}</span>
                    {editing ? (
                      <>
                        <button onClick={() => exec("bold")} title="Жирный (Ctrl+B)">
                          <b>Ж</b>
                        </button>
                        <button onClick={() => exec("italic")} title="Курсив (Ctrl+I)">
                          <i>К</i>
                        </button>
                        <button onClick={() => exec("underline")} title="Подчёркнутый (Ctrl+U)">
                          <u>Ч</u>
                        </button>
                        <button
                          onClick={() => {
                            const url = window.prompt("Адрес ссылки", "https://");
                            if (url) exec("createLink", url);
                          }}
                          title="Ссылка"
                        >
                          🔗
                        </button>
                        <label title="Цвет выделенного текста" className="hs-float__color">
                          🎨
                          <input type="color" onChange={(e) => exec("foreColor", e.target.value)} />
                        </label>
                        <button onClick={() => exec("removeFormat")} title="Убрать оформление">
                          ⌫
                        </button>
                        <button className="hs-float__done" onClick={() => stopEdit()}>
                          Готово
                        </button>
                      </>
                    ) : (
                      <>
                        {selTag !== "img" && (
                          <button onClick={() => startTextEdit(selected)} title="Править текст (Enter)">
                            ✏️
                          </button>
                        )}
                        <button onClick={() => moveSel(-1)} title="Выше (Alt+↑)">
                          ↑
                        </button>
                        <button onClick={() => moveSel(1)} title="Ниже (Alt+↓)">
                          ↓
                        </button>
                        <button onClick={duplicateSel} title="Дублировать (Ctrl+D)">
                          ⧉
                        </button>
                        <button onClick={removeSel} title="Удалить (Delete)">
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {view === "code" && (
              <div className="hs-code-wrap">
                <div className="hs-code-bar">
                  <span className="hs-muted">Поиск — Ctrl+F, замена — Ctrl+H (Ctrl+Alt+F в некоторых браузерах)</span>
                  <span className="hs-grow" />
                  {codeDirty && (
                    <button className="btn-primary" onClick={() => applyCode()}>
                      Применить изменения
                    </button>
                  )}
                </div>
                <Suspense fallback={<div className="hs-muted" style={{ padding: 20 }}>Загружаем редактор кода…</div>}>
                  <CodeEditor
                    value={codeText}
                    dark={dark}
                    onChange={(v) => {
                      setCodeText(v);
                      setCodeDirty(v !== htmlRef.current);
                    }}
                  />
                </Suspense>
              </div>
            )}
            {view === "preview" && (
              <div className="hs-frame-wrap">
                <iframe
                  key={html.length + ":" + version}
                  title="Просмотр страницы"
                  className="hs-frame"
                  style={{ width: DEVICE_W[device] }}
                  sandbox="allow-scripts allow-popups allow-modals allow-forms allow-downloads"
                  srcDoc={html}
                />
              </div>
            )}
          </div>

          {view === "visual" && (
            <aside className="hs-side">
              <div className="hs-side__tabs" role="tablist">
                {(
                  [
                    ["element", "Блок"],
                    ["texts", "Тексты"],
                    ["data", "Данные"],
                    ["theme", "Оформление"],
                  ] as [Side, string][]
                ).map(([s, l]) => (
                  <button key={s} role="tab" aria-selected={side === s} className={`hs-side__tab ${side === s ? "is-on" : ""}`} onClick={() => setSide(s)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="hs-side__body">
                {side === "element" &&
                  (selected?.isConnected && selected.ownerDocument.defaultView ? (
                    <ElementPanel
                      el={selected}
                      version={version}
                      commit={commit}
                      select={select}
                      startTextEdit={startTextEdit}
                      remove={removeSel}
                      duplicate={duplicateSel}
                      move={moveSel}
                      insert={insertAfter}
                      openTable={openTable}
                    />
                  ) : (
                    <div className="hs-panel hs-empty">
                      <p>
                        <strong>Нажмите на любой блок страницы</strong>, чтобы выделить его и изменить.
                      </p>
                      <p className="hs-muted">Двойной клик по тексту — править его прямо на странице.</p>
                      <button className="hs-btn" onClick={() => frameDoc?.body && select(frameDoc.body)}>
                        Выделить всю страницу
                      </button>
                    </div>
                  ))}
                {side === "texts" && <TextsPanel doc={frameDoc} version={version} commit={commit} reveal={reveal} />}
                {side === "data" && <DataPanel doc={frameDoc} version={version} commit={commit} openTable={openTable} openData={openData} reveal={reveal} />}
                {side === "theme" && <ThemePanel doc={frameDoc} version={version} commit={commit} />}
              </div>
            </aside>
          )}
        </div>
        {toast && <div className="hs-toast">{toast}</div>}
      </div>

      {grid?.kind === "table" && (
        <DataGrid
          title="Таблица на странице"
          subtitle={grid.hasHeader ? "Первая строка — заголовки столбцов" : undefined}
          header={grid.header}
          rows={grid.rows}
          columnsEditable
          headerEditable={grid.hasHeader}
          note={grid.merged ? "В таблице есть объединённые ячейки — при изменении числа строк или столбцов проверьте результат." : undefined}
          onSave={saveGrid}
          onClose={() => setGrid(null)}
        />
      )}
      {grid?.kind === "data" && (
        <DataGrid
          title={grid.ds.path}
          subtitle={
            grid.ds.shape.kind === "chart"
              ? "Данные графика: подписи и значения рядов"
              : grid.ds.shape.kind === "records"
                ? "Список записей: столбцы — поля"
                : grid.ds.shape.kind === "dict"
                  ? "Набор значений: ключ — значение"
                  : "Список значений"
          }
          header={grid.ds.header}
          rows={grid.ds.rows}
          columnsEditable={grid.ds.shape.kind === "records" || grid.ds.shape.kind === "rows"}
          headerEditable={grid.ds.shape.kind === "records"}
          note={grid.ds.shape.kind === "chart" ? "Чтобы добавить ряд графика, поправьте код (вкладка «Код»); здесь — подписи и значения." : undefined}
          onSave={saveGrid}
          onClose={() => setGrid(null)}
        />
      )}
      {showPaste && pasteModal()}
      {help()}
    </PageShell>
  );
};

export default HtmlStudio;
