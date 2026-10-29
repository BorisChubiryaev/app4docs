import React, { useEffect, useState } from "react";
import { INSERTS, TAG_NAMES, isTextual, labelOf } from "../core/doc";

// Свойства выделенного элемента: текст, ссылка, картинка, оформление,
// таблица, атрибуты. Всё меняется сразу на странице.

interface Props {
  el: Element;
  version: number;
  commit: () => void;
  select: (el: Element | null) => void;
  startTextEdit: (el: Element) => void;
  remove: () => void;
  duplicate: () => void;
  move: (dir: -1 | 1) => void;
  insert: (html: string) => void;
  openTable: (t: HTMLTableElement) => void;
}

const toHex = (c: string): string => {
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
  if (!m) return c.startsWith("#") && c.length === 7 ? c : "#000000";
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
};
const transparent = (c: string) => /rgba\([^)]*,\s*0\)$/.test(c) || c === "transparent";
const px = (v: string) => Math.round(parseFloat(v) || 0);

const ElementPanel: React.FC<Props> = ({ el, version, commit, select, startTextEdit, remove, duplicate, move, insert, openTable }) => {
  const doc = el.ownerDocument;
  const win = doc.defaultView!;
  const he = el as HTMLElement;
  const cs = win.getComputedStyle(el);
  const tag = el.tagName.toLowerCase();
  const leaf = el.children.length === 0 && tag !== "img";
  const [text, setText] = useState(leaf ? el.textContent ?? "" : "");
  const [showAttrs, setShowAttrs] = useState(false);
  const [, force] = useState(0);
  useEffect(() => setText(leaf ? el.textContent ?? "" : ""), [el, version, leaf]);

  const crumbs: Element[] = [];
  for (let p: Element | null = el; p && p.tagName !== "HTML"; p = p.parentElement) crumbs.unshift(p);

  const setStyle = (prop: string, value: string) => {
    he.style.setProperty(prop, value);
    force((n) => n + 1);
    commit();
  };
  const setAttr = (name: string, value: string | null) => {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    force((n) => n + 1);
    commit();
  };

  const table = el.closest("table") as HTMLTableElement | null;
  const cell = el.closest("td,th") as HTMLTableCellElement | null;
  const row = cell?.parentElement as HTMLTableRowElement | null;

  const tableOp = (op: string) => {
    if (!table || !cell || !row) return;
    const ci = cell.cellIndex;
    if (op === "rowAbove" || op === "rowBelow") {
      const copy = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(copy.cells).forEach((c) => (c.textContent = ""));
      row.parentElement!.insertBefore(copy, op === "rowAbove" ? row : row.nextSibling);
    } else if (op === "rowDel") {
      const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLTableRowElement | null;
      row.remove();
      select(next?.cells[Math.min(ci, next.cells.length - 1)] ?? table);
    } else if (op === "colLeft" || op === "colRight") {
      for (const r of Array.from(table.rows)) {
        const ref = r.cells[Math.min(ci, r.cells.length - 1)];
        if (!ref) continue;
        const c = ref.cloneNode(false) as HTMLElement;
        c.textContent = "";
        r.insertBefore(c, op === "colLeft" ? ref : ref.nextSibling);
      }
    } else if (op === "colDel") {
      for (const r of Array.from(table.rows)) r.cells[ci]?.remove();
      select(table);
    }
    commit();
  };

  const isImg = tag === "img";
  const isLink = tag === "a";
  const hidden = cs.display === "none" || he.style.display === "none";

  return (
    <div className="hs-panel">
      <div className="hs-crumbs" aria-label="Путь к элементу">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="hs-crumbs__sep">›</span>}
            <button className={`hs-crumb ${c === el ? "is-on" : ""}`} onClick={() => select(c)} title={labelOf(c)}>
              {labelOf(c)}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="hs-el-title">
        <strong>{TAG_NAMES[tag] ?? `<${tag}>`}</strong>
        <span className="hs-muted">&lt;{tag}&gt;</span>
      </div>

      <div className="hs-actions">
        {isTextual(el) && (
          <button className="hs-btn hs-btn--accent" onClick={() => startTextEdit(el)} title="Двойной клик по тексту на странице — то же самое">
            ✏️ Править текст
          </button>
        )}
        <button className="hs-icon" onClick={() => move(-1)} title="Выше (Alt+↑)">
          ↑
        </button>
        <button className="hs-icon" onClick={() => move(1)} title="Ниже (Alt+↓)">
          ↓
        </button>
        <button className="hs-icon" onClick={duplicate} title="Дублировать (Ctrl+D)">
          ⧉
        </button>
        <button className="hs-icon hs-icon--danger" onClick={remove} title="Удалить (Delete)">
          🗑
        </button>
        {el.parentElement && el.parentElement.tagName !== "HTML" && (
          <button className="hs-icon" onClick={() => select(el.parentElement)} title="Выделить внешний блок">
            ⬑
          </button>
        )}
      </div>

      <label className="hs-field">
        <span>Вставить после</span>
        <select
          className="ds-select"
          value=""
          onChange={(e) => {
            const it = INSERTS.find((x) => x.id === e.target.value);
            if (it) insert(it.html);
          }}
        >
          <option value="">— выберите блок —</option>
          {INSERTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </label>

      {leaf && !isImg && (
        <label className="hs-field">
          <span>Текст</span>
          <textarea
            rows={Math.min(8, Math.max(2, Math.ceil(text.length / 40)))}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              el.textContent = e.target.value;
            }}
            onBlur={commit}
          />
        </label>
      )}

      {isLink && (
        <div className="hs-group">
          <div className="hs-group__title">Ссылка</div>
          <label className="hs-field">
            <span>Адрес</span>
            <input defaultValue={el.getAttribute("href") ?? ""} key={`href${version}`} onBlur={(e) => setAttr("href", e.target.value)} placeholder="https://…" />
          </label>
          <label className="hs-check">
            <input type="checkbox" checked={el.getAttribute("target") === "_blank"} onChange={(e) => setAttr("target", e.target.checked ? "_blank" : null)} />
            Открывать в новой вкладке
          </label>
        </div>
      )}

      {isImg && (
        <div className="hs-group">
          <div className="hs-group__title">Картинка</div>
          <div className="hs-img-row">
            {el.getAttribute("src") ? <img src={el.getAttribute("src")!} alt="" className="hs-img-preview" /> : <span className="hs-muted">нет картинки</span>}
            <label className="hs-btn">
              Заменить файлом…
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setAttr("src", String(r.result));
                  r.readAsDataURL(f);
                }}
              />
            </label>
          </div>
          <label className="hs-field">
            <span>Адрес картинки</span>
            <input
              defaultValue={(el.getAttribute("src") ?? "").startsWith("data:") ? "" : el.getAttribute("src") ?? ""}
              key={`src${version}`}
              placeholder="встроена в файл"
              onBlur={(e) => e.target.value && setAttr("src", e.target.value)}
            />
          </label>
          <label className="hs-field">
            <span>Описание (alt)</span>
            <input defaultValue={el.getAttribute("alt") ?? ""} key={`alt${version}`} onBlur={(e) => setAttr("alt", e.target.value)} />
          </label>
        </div>
      )}

      {table && cell && (
        <div className="hs-group">
          <div className="hs-group__title">Таблица</div>
          <div className="hs-actions">
            <button className="hs-btn" onClick={() => tableOp("rowAbove")}>
              ＋ строка выше
            </button>
            <button className="hs-btn" onClick={() => tableOp("rowBelow")}>
              ＋ строка ниже
            </button>
            <button className="hs-btn" onClick={() => tableOp("rowDel")}>
              − строка
            </button>
            <button className="hs-btn" onClick={() => tableOp("colLeft")}>
              ＋ столбец слева
            </button>
            <button className="hs-btn" onClick={() => tableOp("colRight")}>
              ＋ столбец справа
            </button>
            <button className="hs-btn" onClick={() => tableOp("colDel")}>
              − столбец
            </button>
          </div>
          <button className="hs-btn hs-btn--accent" onClick={() => openTable(table)}>
            ▦ Открыть как таблицу (вставка из Excel)
          </button>
        </div>
      )}
      {table && !cell && (
        <button className="hs-btn hs-btn--accent" onClick={() => openTable(table)}>
          ▦ Открыть как таблицу (вставка из Excel)
        </button>
      )}

      <div className="hs-group">
        <div className="hs-group__title">Оформление</div>
        <div className="hs-style-grid">
          <label className="hs-field">
            <span>Цвет текста</span>
            <input type="color" value={toHex(cs.color)} onChange={(e) => setStyle("color", e.target.value)} />
          </label>
          <label className="hs-field">
            <span>Фон</span>
            <span className="hs-inline">
              <input type="color" value={transparent(cs.backgroundColor) ? "#ffffff" : toHex(cs.backgroundColor)} onChange={(e) => setStyle("background-color", e.target.value)} />
              {!transparent(cs.backgroundColor) && (
                <button className="hs-link" onClick={() => setStyle("background-color", "transparent")}>
                  убрать
                </button>
              )}
            </span>
          </label>
          <label className="hs-field">
            <span>Размер шрифта, px</span>
            <input type="number" min={6} max={200} value={px(cs.fontSize)} onChange={(e) => setStyle("font-size", `${e.target.value}px`)} />
          </label>
          <label className="hs-field">
            <span>Начертание</span>
            <span className="hs-inline">
              <button className={`hs-icon ${Number(cs.fontWeight) >= 600 ? "is-on" : ""}`} onClick={() => setStyle("font-weight", Number(cs.fontWeight) >= 600 ? "400" : "700")} title="Жирный">
                <b>Ж</b>
              </button>
              <button className={`hs-icon ${cs.fontStyle === "italic" ? "is-on" : ""}`} onClick={() => setStyle("font-style", cs.fontStyle === "italic" ? "normal" : "italic")} title="Курсив">
                <i>К</i>
              </button>
            </span>
          </label>
          <label className="hs-field hs-field--wide">
            <span>Выравнивание</span>
            <span className="hs-inline">
              {[
                ["left", "⯇"],
                ["center", "≡"],
                ["right", "⯈"],
                ["justify", "☰"],
              ].map(([v, icon]) => (
                <button key={v} className={`hs-icon ${cs.textAlign === v || (v === "left" && cs.textAlign === "start") ? "is-on" : ""}`} onClick={() => setStyle("text-align", v)} title={v}>
                  {icon}
                </button>
              ))}
            </span>
          </label>
          <label className="hs-field">
            <span>Внутр. отступ, px</span>
            <input type="number" min={0} max={300} value={px(cs.paddingTop)} onChange={(e) => setStyle("padding", `${e.target.value}px`)} />
          </label>
          <label className="hs-field">
            <span>Внешн. отступ, px</span>
            <input type="number" min={-100} max={300} value={px(cs.marginTop)} onChange={(e) => setStyle("margin", `${e.target.value}px`)} />
          </label>
          <label className="hs-field">
            <span>Скругление, px</span>
            <input type="number" min={0} max={300} value={px(cs.borderTopLeftRadius)} onChange={(e) => setStyle("border-radius", `${e.target.value}px`)} />
          </label>
          <label className="hs-field">
            <span>Ширина</span>
            <input
              defaultValue={he.style.width}
              key={`w${version}`}
              placeholder={`${Math.round(parseFloat(cs.width))}px`}
              onBlur={(e) => setStyle("width", e.target.value)}
              title="Например: 50%, 320px, auto"
            />
          </label>
        </div>
        <label className="hs-check">
          <input type="checkbox" checked={hidden} onChange={(e) => setStyle("display", e.target.checked ? "none" : "")} />
          Скрыть элемент
        </label>
      </div>

      <button className="hs-link" onClick={() => setShowAttrs((v) => !v)}>
        {showAttrs ? "▾" : "▸"} Атрибуты (для опытных)
      </button>
      {showAttrs && (
        <div className="hs-group">
          {Array.from(el.attributes)
            .filter((a) => !a.name.startsWith("data-he") && a.name !== "contenteditable")
            .map((a) => (
              <label key={a.name + version} className="hs-field">
                <span>{a.name}</span>
                <span className="hs-inline">
                  <input defaultValue={a.value} onBlur={(e) => setAttr(a.name, e.target.value)} />
                  <button className="hs-icon" onClick={() => setAttr(a.name, null)} title="Удалить атрибут">
                    ✕
                  </button>
                </span>
              </label>
            ))}
          <form
            className="hs-inline"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const name = (f.elements.namedItem("n") as HTMLInputElement).value.trim();
              const value = (f.elements.namedItem("v") as HTMLInputElement).value;
              if (/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name) && !/^on/i.test(name)) setAttr(name, value);
              f.reset();
            }}
          >
            <input name="n" placeholder="имя" />
            <input name="v" placeholder="значение" />
            <button className="hs-btn">＋</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ElementPanel;
