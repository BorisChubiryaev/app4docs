import React, { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";

// Редактор кода (CodeMirror 6): подсветка, поиск и замена (Ctrl+F, Ctrl+H),
// автоотступы, свёртка блоков. Загружается отдельным файлом — только когда
// открыта вкладка «Код».

interface Props {
  value: string;
  onChange: (v: string) => void;
  dark: boolean;
}

const CodeEditor: React.FC<Props> = ({ value, onChange, dark }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          html(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current(u.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": { height: "100%", fontSize: "13px", backgroundColor: dark ? "#16181f" : "#fff", color: dark ? "#e6e8ef" : "#1f2330" },
              ".cm-scroller": { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace" },
              ".cm-gutters": { backgroundColor: dark ? "#1c1f28" : "#f5f6fa", color: dark ? "#7b8194" : "#9aa0b2", border: "none" },
              // Слой выделения CodeMirror лежит ПОД текстом и под подсветкой
              // строки: непрозрачная подсветка строки закрывала выделенное
              // слово, поэтому она полупрозрачная, а выделение — яркое
              ".cm-activeLine": { backgroundColor: dark ? "rgba(255, 255, 255, 0.04)" : "rgba(79, 110, 247, 0.05)" },
              ".cm-activeLineGutter": { backgroundColor: dark ? "#232735" : "#e9ecfb" },
              "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
                backgroundColor: dark ? "#3b5bdb" : "#a5bcff",
              },
              ".cm-selectionMatch": { backgroundColor: dark ? "rgba(255, 212, 59, 0.25)" : "rgba(255, 200, 0, 0.3)" },
              ".cm-cursor, .cm-dropCursor": { borderLeftColor: dark ? "#e6e8ef" : "#1f2330", borderLeftWidth: "2px" },
            },
            { dark },
          ),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Пересоздаём только при смене темы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // Внешнее изменение текста (отмена, открытие файла)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="hs-code" />;
};

export default CodeEditor;
