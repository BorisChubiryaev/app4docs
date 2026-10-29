import React, { useMemo, useState } from "react";
import { findDataSets, type DataSet } from "../core/data";
import { readTable } from "../core/tables";
import { countMatches, listTexts, makeMatcher, replaceAll } from "../core/texts";
import { SAFE_FONTS, findColors, findFonts, findVars, replaceColor, replaceFont, setVar } from "../core/theme";

interface Common {
  doc: Document | null;
  version: number;
  commit: () => void;
}

// ── Тексты ──

export const TextsPanel: React.FC<Common & { reveal: (el: Element) => void }> = ({ doc, version, commit, reveal }) => {
  const [find, setFind] = useState("");
  const [to, setTo] = useState("");
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [, force] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (doc ? listTexts(doc) : []), [doc, version]);
  const re = makeMatcher(find, opts);
  const count = countMatches(items, re);
  const shown = items.filter((it) => !filter || (it.node.textContent ?? "").toLowerCase().includes(filter.toLowerCase())).slice(0, 400);

  return (
    <div className="hs-panel">
      <div className="hs-group">
        <div className="hs-group__title">Найти и заменить</div>
        <label className="hs-field">
          <span>Найти</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="слово или фраза" />
        </label>
        <label className="hs-field">
          <span>Заменить на</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="hs-inline hs-wrap">
          <label className="hs-check">
            <input type="checkbox" checked={opts.caseSensitive} onChange={(e) => setOpts({ ...opts, caseSensitive: e.target.checked })} />
            Учитывать регистр
          </label>
          <label className="hs-check">
            <input type="checkbox" checked={opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} />
            Слово целиком
          </label>
          <label className="hs-check" title="Регулярное выражение, для опытных">
            <input type="checkbox" checked={opts.regex} onChange={(e) => setOpts({ ...opts, regex: e.target.checked })} />
            .*
          </label>
        </div>
        <div className="hs-inline">
          <button
            className="hs-btn hs-btn--accent"
            disabled={!count}
            onClick={() => {
              const n = replaceAll(items, re, to);
              setMsg(`Заменено: ${n}`);
              commit();
            }}
          >
            Заменить всё
          </button>
          <span className="hs-muted">{find ? (re ? `Найдено: ${count}` : "Ошибка в выражении") : msg}</span>
        </div>
        <p className="hs-muted hs-small">Меняется только видимый текст — разметка, стили и код не затрагиваются.</p>
      </div>
      <div className="hs-group">
        <div className="hs-group__title">Все тексты страницы ({items.length})</div>
        <input className="hs-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Фильтр…" />
        <div className="hs-texts">
          {shown.map((it, i) => (
            <div key={i} className="hs-text-item">
              <button className="hs-text-tag" onClick={() => reveal(it.el)} title="Показать на странице">
                {it.el.tagName.toLowerCase()}
              </button>
              <textarea
                defaultValue={it.node.textContent ?? ""}
                rows={Math.min(5, Math.max(1, Math.ceil((it.node.textContent ?? "").length / 38)))}
                onChange={(e) => {
                  it.node.textContent = e.target.value;
                  force((n) => n + 1);
                }}
                onFocus={() => reveal(it.el)}
                onBlur={commit}
              />
            </div>
          ))}
          {items.length > shown.length && <p className="hs-muted hs-small">Показаны первые {shown.length} — уточните фильтр.</p>}
        </div>
      </div>
    </div>
  );
};

// ── Данные ──

export interface TableRef {
  el: HTMLTableElement;
  title: string;
  rows: number;
  cols: number;
}

export const DataPanel: React.FC<
  Common & { openTable: (t: HTMLTableElement) => void; openData: (ds: DataSet, scriptEl: HTMLScriptElement) => void; reveal: (el: Element) => void }
> = ({ doc, version, openTable, openData, reveal }) => {
  const { tables, sets, scripts } = useMemo(() => {
    if (!doc) return { tables: [] as TableRef[], sets: [] as DataSet[], scripts: [] as HTMLScriptElement[] };
    const tables = Array.from(doc.querySelectorAll("table")).map((t, i) => {
      const g = readTable(t);
      const cap = t.caption?.textContent?.trim() || g.header.filter(Boolean).slice(0, 3).join(" · ");
      return { el: t, title: cap || `Таблица ${i + 1}`, rows: g.rows.length, cols: g.header.length };
    });
    const scripts = Array.from(doc.querySelectorAll("script")).filter((s) => !s.src) as HTMLScriptElement[];
    const sets = findDataSets(scripts.map((s) => ({ text: s.textContent ?? "", type: s.getAttribute("type") ?? "" })));
    return { tables, sets, scripts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version]);

  return (
    <div className="hs-panel">
      <p className="hs-muted hs-small">
        Таблицы страницы и данные, из которых скрипты рисуют графики и показатели. Откройте нужные данные, поправьте
        или вставьте из Excel — страница обновится.
      </p>
      <div className="hs-group">
        <div className="hs-group__title">Таблицы на странице ({tables.length})</div>
        {tables.length === 0 && <p className="hs-muted hs-small">Таблиц нет.</p>}
        {tables.map((t, i) => (
          <div key={i} className="hs-data-item">
            <button className="hs-data-item__main" onClick={() => openTable(t.el)}>
              <span className="hs-data-item__icon">▦</span>
              <span>
                <strong>{t.title}</strong>
                <small>
                  {t.rows} строк × {t.cols} столбцов
                </small>
              </span>
            </button>
            <button className="hs-icon" onClick={() => reveal(t.el)} title="Показать на странице">
              👁
            </button>
          </div>
        ))}
      </div>
      <div className="hs-group">
        <div className="hs-group__title">Данные в скриптах ({sets.length})</div>
        {sets.length === 0 && <p className="hs-muted hs-small">Не найдено (на странице нет скриптов с данными).</p>}
        {sets.map((d) => (
          <div key={d.id} className="hs-data-item">
            <button className="hs-data-item__main" onClick={() => openData(d, scripts[d.script])}>
              <span className="hs-data-item__icon">{d.shape.kind === "chart" ? "📊" : d.shape.kind === "dict" ? "🔑" : "{ }"}</span>
              <span>
                <strong>{d.path}</strong>
                <small>
                  {d.rows.length} {d.shape.kind === "dict" ? "значений" : "строк"} · {d.header.slice(0, 4).join(", ")}
                  {d.header.length > 4 ? "…" : ""}
                </small>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Оформление ──

const isColorValue = (v: string) => /^#([0-9a-f]{3,8})$|^rgba?\(/i.test(v.trim());

export const ThemePanel: React.FC<Common> = ({ doc, version, commit }) => {
  const [msg, setMsg] = useState("");
  const [css, setCss] = useState<string | null>(null);
  const data = useMemo(() => {
    if (!doc) return { colors: [], vars: [], fonts: [], custom: "" };
    return {
      colors: findColors(doc),
      vars: findVars(doc),
      fonts: findFonts(doc),
      custom: doc.getElementById("he-custom-css")?.textContent ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version]);
  if (!doc) return null;

  return (
    <div className="hs-panel">
      <div className="hs-group">
        <div className="hs-group__title">Цвета страницы ({data.colors.length})</div>
        <p className="hs-muted hs-small">Нажмите на цвет и выберите новый — он заменится везде: в стилях, разметке и графиках.</p>
        <div className="hs-colors">
          {data.colors.slice(0, 40).map((c) => (
            <label key={c.hex} className="hs-color" title={`${c.hex} · ${c.count} раз${c.where.has("script") ? " · в т.ч. графики" : ""}`}>
              <input
                type="color"
                value={c.hex}
                onChange={(e) => {
                  const n = replaceColor(doc, c.hex, e.target.value);
                  setMsg(`Заменено ${n}: ${c.hex} → ${e.target.value}`);
                  commit();
                }}
              />
              <span className="hs-color__chip" style={{ background: c.hex }} />
              <span className="hs-color__n">{c.count}</span>
            </label>
          ))}
        </div>
        {msg && <p className="hs-muted hs-small">{msg}</p>}
      </div>

      {data.vars.length > 0 && (
        <div className="hs-group">
          <div className="hs-group__title">Переменные темы ({data.vars.length})</div>
          {data.vars.map((v) => (
            <label key={v.name + version} className="hs-field hs-field--row">
              <span title={v.name}>{v.name.replace(/^--/, "")}</span>
              <span className="hs-inline">
                {isColorValue(v.value) && (
                  <input
                    type="color"
                    value={v.value.trim().length === 7 ? v.value.trim() : "#000000"}
                    onChange={(e) => {
                      setVar(doc, v.name, e.target.value);
                      commit();
                    }}
                  />
                )}
                <input
                  defaultValue={v.value}
                  onBlur={(e) => {
                    if (e.target.value !== v.value) {
                      setVar(doc, v.name, e.target.value);
                      commit();
                    }
                  }}
                />
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="hs-group">
        <div className="hs-group__title">Шрифты</div>
        {data.fonts.length === 0 && <p className="hs-muted hs-small">Шрифт не задан — используется шрифт браузера.</p>}
        {data.fonts.map((f) => (
          <label key={f.value + version} className="hs-field">
            <span title={f.value}>
              {f.value.length > 40 ? `${f.value.slice(0, 40)}…` : f.value} <small className="hs-muted">({f.count})</small>
            </span>
            <select
              className="ds-select"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const n = replaceFont(doc, f.value, e.target.value);
                setMsg(`Шрифт заменён в ${n} местах`);
                commit();
              }}
            >
              <option value="">Заменить на…</option>
              {SAFE_FONTS.map((s) => (
                <option key={s} value={s} style={{ fontFamily: s }}>
                  {s.split(",")[0].replace(/'/g, "")}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="hs-group">
        <div className="hs-group__title">Свой CSS</div>
        <p className="hs-muted hs-small">Для опытных: добавьте правила — они сохранятся в файле.</p>
        <textarea
          className="hs-css"
          rows={6}
          value={css ?? data.custom}
          placeholder={"h1 { color: #1a73e8; }\n.card { border-radius: 16px; }"}
          onChange={(e) => setCss(e.target.value)}
          onBlur={() => {
            if (css === null) return;
            let st = doc.getElementById("he-custom-css");
            if (!css.trim()) st?.remove();
            else {
              if (!st) {
                st = doc.createElement("style");
                st.id = "he-custom-css";
                (doc.head ?? doc.documentElement).appendChild(st);
              }
              st.textContent = css;
            }
            setCss(null);
            commit();
          }}
        />
      </div>
    </div>
  );
};
