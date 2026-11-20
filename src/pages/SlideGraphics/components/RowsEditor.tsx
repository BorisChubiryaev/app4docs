import React from "react";
import { parseNum } from "../core/parse";
import type { Input, Row } from "../core/types";

// Таблица данных шаблона: подпись и одно-два числа (или имя и должность).
// Вставка диапазона из Excel в любую ячейку заполняет строки начиная с неё.

interface Props {
  input: Input;
  rows: Row[];
  names?: [string, string];
  onChange: (rows: Row[]) => void;
}


type Column = [keyof Row, string];

function columnsFor(input: Input, names?: [string, string]): Column[] {
  switch (input) {
    case "flows": return [["label", "Источник"], ["note", "Получатель"], ["value", "Объём"]];
    case "people": return [["label", "Имя"], ["note", "Должность"]];
    case "pairs": return [["label", "Подпись"], ["value", names?.[0] || "Ряд 1"], ["value2", names?.[1] || "Ряд 2"]];
    default: return [["label", "Подпись"], ["value", names?.[0] || "Значение"]];
  }
}

const isNumberColumn = (key: keyof Row) => key === "value" || key === "value2";

const RowsEditor: React.FC<Props> = ({ input, rows, names, onChange }) => {
  const cols = columnsFor(input, names);
  const cell = (row: Row, index: number) => {
    const value = row[cols[index][0]];
    return typeof value === "number" ? String(value).replace(".", ",") : value ?? "";
  };
  const setCell = (row: Row, index: number, text: string): Row => {
    const key = cols[index][0];
    return { ...row, [key]: isNumberColumn(key) ? parseNum(text) : text };
  };

  // Ввод чисел храним как текст, пока ячейка в фокусе, — иначе «3,» превращалось бы в «3»
  const [draft, setDraft] = React.useState<{ r: number; c: number; v: string } | null>(null);

  const onPaste = (e: React.ClipboardEvent, ri: number, ci: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l.length || i < a.length - 1);
    const next = rows.map((r) => ({ ...r }));
    lines.forEach((line, li) => {
      const parts = line.split("\t");
      const at = ri + li;
      while (next.length <= at) next.push({ label: "", value: 0 });
      parts.forEach((p, pi) => {
        if (ci + pi < cols.length) next[at] = setCell(next[at], ci + pi, p.trim());
      });
    });
    setDraft(null); // иначе ячейка в фокусе показала бы старый текст
    onChange(next);
  };

  return (
    <div className="sg-rows">
      <table>
        <thead>
          <tr>
            {cols.map(([key, name]) => (
              <th key={key}>{name}</th>
            ))}
            <th aria-label="Удалить" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map(([key, name], ci) => {
                const editing = draft && draft.r === ri && draft.c === ci;
                return (
                  <td key={key}>
                    <input
                      value={editing ? draft.v : cell(r, ci)}
                      inputMode={isNumberColumn(key) ? "decimal" : undefined}
                      onFocus={() => setDraft({ r: ri, c: ci, v: cell(r, ci) })}
                      onBlur={() => setDraft(null)}
                      onChange={(e) => {
                        setDraft({ r: ri, c: ci, v: e.target.value });
                        onChange(rows.map((x, i) => (i === ri ? setCell(x, ci, e.target.value) : x)));
                      }}
                      onPaste={(e) => onPaste(e, ri, ci)}
                      aria-label={`${name}, строка ${ri + 1}`}
                    />
                  </td>
                );
              })}
              <td className="sg-rows__del">
                <button onClick={() => onChange(rows.filter((_, i) => i !== ri))} title="Удалить строку" aria-label="Удалить строку">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sg-rows__foot">
        <button className="sg-btn" onClick={() => onChange([...rows, input === "people" ? { label: "Новый человек", value: 0, note: "" } : { label: `Пункт ${rows.length + 1}`, value: 0, value2: input === "pairs" ? 0 : undefined }])}>
          ＋ Строка
        </button>
        <span className="sg-hint">Можно вставить диапазон из Excel (Ctrl+V)</span>
      </div>
    </div>
  );
};

export default RowsEditor;
