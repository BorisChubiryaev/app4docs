import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseCell, type Cell } from "../core/data";
import { parseDelimited, toTsv } from "../core/tables";

// Таблица для правки данных: ячейки, строки, столбцы, вставка из Excel,
// загрузка CSV/XLSX и выгрузка в Excel.

interface Props {
  title: string;
  subtitle?: string;
  header: string[];
  rows: Cell[][];
  /** Можно ли менять заголовки и число столбцов */
  columnsEditable: boolean;
  headerEditable: boolean;
  note?: string;
  onSave: (header: string[], rows: Cell[][]) => void;
  onClose: () => void;
}

const show = (v: Cell) => (v === null ? "" : String(v));

const DataGrid: React.FC<Props> = ({ title, subtitle, header, rows, columnsEditable, headerEditable, note, onSave, onClose }) => {
  const [head, setHead] = useState<string[]>(header);
  const [grid, setGrid] = useState<string[][]>(() => rows.map((r) => header.map((_, i) => show(r[i] ?? null))));
  // Тип значений столбца (по исходным данным) — чтобы числа остались числами
  const colTypes = useMemo(
    () => header.map((_, i) => rows.find((r) => r[i] !== null && r[i] !== undefined)?.[i] ?? null),
    [header, rows],
  );
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const width = head.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setCell = (r: number, c: number, v: string) =>
    setGrid((g) => g.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)));

  const addRow = (at: number) => setGrid((g) => [...g.slice(0, at), Array(width).fill(""), ...g.slice(at)]);
  const delRow = (r: number) => setGrid((g) => g.filter((_, i) => i !== r));
  const addCol = (at: number) => {
    setHead((h) => [...h.slice(0, at), `Столбец ${h.length + 1}`, ...h.slice(at)]);
    setGrid((g) => g.map((row) => [...row.slice(0, at), "", ...row.slice(at)]));
  };
  const delCol = (c: number) => {
    setHead((h) => h.filter((_, i) => i !== c));
    setGrid((g) => g.map((row) => row.filter((_, i) => i !== c)));
  };

  /** Вставка блока из Excel начиная с ячейки (r, c); таблица растёт по необходимости. */
  const pasteBlock = (r: number, c: number, block: string[][]) => {
    const needW = c + Math.max(...block.map((b) => b.length));
    if (needW > width && !columnsEditable) block = block.map((b) => b.slice(0, width - c));
    const w = Math.max(width, columnsEditable ? needW : width);
    if (w > width) setHead((h) => [...h, ...Array.from({ length: w - width }, (_, i) => `Столбец ${width + i + 1}`)]);
    setGrid((g) => {
      const out = g.map((row) => [...row, ...Array(w - row.length).fill("")]);
      block.forEach((b, bi) => {
        const ri = r + bi;
        while (out.length <= ri) out.push(Array(w).fill(""));
        b.forEach((v, bj) => {
          if (c + bj < w) out[ri][c + bj] = v;
        });
      });
      return out;
    });
    setMsg(`Вставлено: ${block.length} стр. × ${Math.max(...block.map((b) => b.length))} столб.`);
  };

  const onPaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // обычная вставка в ячейку
    e.preventDefault();
    pasteBlock(r, c, parseDelimited(text));
  };

  const importFile = async (f: File) => {
    try {
      let table: string[][];
      if (/\.xlsx$/i.test(f.name)) {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        const ws = wb.worksheets[0];
        table = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => {
            if (v === null || v === undefined) return "";
            if (typeof v === "object" && v && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
            if (typeof v === "object" && v && "text" in (v as object)) return String((v as { text: unknown }).text ?? "");
            if (v instanceof Date) return v.toLocaleDateString("ru-RU");
            return String(v);
          });
          table.push(vals);
        });
      } else {
        table = parseDelimited(await f.text());
      }
      if (!table.length) return setMsg("Файл пустой");
      // Первая строка файла — заголовки, если их можно менять
      if (headerEditable && columnsEditable) {
        const w = Math.max(...table.map((r) => r.length));
        setHead(Array.from({ length: w }, (_, i) => table[0][i] || `Столбец ${i + 1}`));
        setGrid(table.slice(1).map((r) => Array.from({ length: w }, (_, i) => r[i] ?? "")));
      } else {
        setGrid(table.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")));
      }
      setMsg(`Загружено из «${f.name}»: ${table.length - 1} строк`);
    } catch (err) {
      setMsg(`Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportXlsx = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Данные");
    ws.addRow(head);
    ws.getRow(1).font = { bold: true };
    for (const r of grid) ws.addRow(r.map((v, i) => parseCell(v, colTypes[i] ?? null)));
    head.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(50, Math.max(10, h.length + 2, ...grid.map((r) => (r[i] ?? "").length + 2)))));
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "данные"}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(head, grid));
      setMsg("Скопировано — можно вставить в Excel");
    } catch {
      setMsg("Браузер не дал доступ к буферу обмена");
    }
  };

  const save = () => {
    const out: Cell[][] = grid.map((r) => r.map((v, i) => parseCell(v, colTypes[i] ?? null)));
    onSave(head, out);
  };

  const f = focus;
  return (
    <div className="hs-modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hs-modal hs-modal--wide" role="dialog" aria-label={title}>
        <div className="hs-modal__head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="hs-muted">{subtitle}</div>}
          </div>
          <button className="hs-x" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="hs-grid-tools">
          <button className="hs-btn" onClick={() => addRow(f ? f.r + 1 : grid.length)}>
            ＋ Строка
          </button>
          <button className="hs-btn" disabled={!f} onClick={() => f && delRow(f.r)}>
            − Строка
          </button>
          {columnsEditable && (
            <>
              <button className="hs-btn" onClick={() => addCol(f ? f.c + 1 : width)}>
                ＋ Столбец
              </button>
              <button className="hs-btn" disabled={!f || width <= 1} onClick={() => f && delCol(f.c)}>
                − Столбец
              </button>
            </>
          )}
          <span className="hs-sep" />
          <button className="hs-btn" onClick={() => fileRef.current?.click()} title="Заменить данные содержимым файла Excel или CSV">
            📥 Из Excel/CSV
          </button>
          <button className="hs-btn" onClick={exportXlsx}>
            📤 В Excel
          </button>
          <button className="hs-btn" onClick={copyTsv}>
            📋 Копировать
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importFile(file);
            }}
          />
          <span className="hs-muted hs-grid-msg">{msg || "Совет: скопируйте диапазон в Excel и вставьте в нужную ячейку (Ctrl+V)"}</span>
        </div>
        {note && <div className="hs-note">{note}</div>}
        <div className="hs-grid-wrap">
          <table className="hs-grid">
            <thead>
              <tr>
                <th className="hs-grid__num">#</th>
                {head.map((h, c) => (
                  <th key={c} className={f?.c === c ? "is-col" : ""}>
                    {headerEditable ? (
                      <input value={h} onChange={(e) => setHead((x) => x.map((v, i) => (i === c ? e.target.value : v)))} aria-label={`Заголовок ${c + 1}`} />
                    ) : (
                      <span>{h}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r} className={f?.r === r ? "is-row" : ""}>
                  <td className="hs-grid__num">{r + 1}</td>
                  {row.map((v, c) => (
                    <td key={c}>
                      <input
                        value={v}
                        onFocus={() => setFocus({ r, c })}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onPaste={(e) => onPaste(e, r, c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            const next = (e.currentTarget.closest("tr")?.nextElementSibling as HTMLElement | null)?.querySelectorAll("input")[c];
                            if (next) (next as HTMLInputElement).focus();
                            else {
                              addRow(grid.length);
                              setTimeout(() => {
                                const rowsEl = e.currentTarget?.closest("tbody")?.querySelectorAll("tr");
                                rowsEl?.[rowsEl.length - 1]?.querySelectorAll("input")[c]?.focus();
                              }, 0);
                            }
                          }
                        }}
                        aria-label={`Строка ${r + 1}, ${head[c]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!grid.length && <p className="hs-muted" style={{ padding: 12 }}>Нет строк — нажмите «＋ Строка» или вставьте данные из Excel.</p>}
        </div>
        <div className="hs-modal__foot">
          <span className="hs-muted">
            {grid.length} строк × {width} столбцов
          </span>
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={save}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataGrid;
