import { useEffect, useRef, useState } from "react";
import type { DocState, Layer } from "../core/types";
import { BLEND_MODES } from "../core/types";
import { moveLayer, updateLayer } from "../core/doc";
import { Ico } from "./icons";

/** Миниатюра слоя или маски (перерисовывается при смене canvas). */
function Thumb({ canvas, isMask }: { canvas: HTMLCanvasElement; isMask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = Math.min(40 / canvas.width, 40 / canvas.height);
    c.width = Math.max(1, Math.round(canvas.width * k));
    c.height = Math.max(1, Math.round(canvas.height * k));
    const ctx = c.getContext("2d")!;
    if (isMask) {
      // Маска: белое — видно, чёрное — скрыто
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      const tmp = document.createElement("canvas");
      tmp.width = c.width;
      tmp.height = c.height;
      const t = tmp.getContext("2d")!;
      t.drawImage(canvas, 0, 0, c.width, c.height);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = "#fff";
      t.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(canvas, 0, 0, c.width, c.height);
    }
  }, [canvas, isMask]);
  return <canvas ref={ref} className={`ie-thumb ${isMask ? "is-mask" : ""}`} />;
}

interface Props {
  state: DocState;
  /** Черновик без записи в историю (пока тянут ползунок). */
  live: (s: DocState) => void;
  /** Выбор слоя / цели (слой или маска) — без отдельного шага истории. */
  select: (s: DocState) => void;
  commit: (s: DocState, label: string) => void;
  onAddLayer: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMergeDown: () => void;
  onAddMask: () => void;
}

export default function LayersPanel({ state, live, select, commit, onAddLayer, onDuplicate, onDelete, onMergeDown, onAddMask }: Props) {
  const active = state.layers.find((l) => l.id === state.activeId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const opacityStart = useRef<DocState | null>(null);

  const set = (l: Layer, patch: Partial<Layer>, label: string) => commit(updateLayer(state, l.id, patch), label);
  const top = [...state.layers].map((l, i) => ({ l, i })).reverse();

  return (
    <section className="ie-panel ie-layers">
      {active && (
        <div className="ie-layer-props">
          <select
            className="ie-select"
            value={active.blend}
            onChange={(e) => set(active, { blend: e.target.value as Layer["blend"] }, "Режим наложения")}
            aria-label="Режим наложения"
            title="Режим наложения"
          >
            {BLEND_MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="ie-opacity" title="Непрозрачность слоя">
            <span>Непрозр.</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(active.opacity * 100)}
              onPointerDown={() => {
                opacityStart.current = state;
              }}
              onChange={(e) => live(updateLayer(state, active.id, { opacity: Number(e.target.value) / 100 }))}
              onPointerUp={() => {
                if (opacityStart.current) commit(state, "Непрозрачность");
                opacityStart.current = null;
              }}
              onKeyUp={() => commit(state, "Непрозрачность")}
            />
            <b>{Math.round(active.opacity * 100)}%</b>
          </label>
        </div>
      )}

      <ol className="ie-layer-list" onDragLeave={() => setDropAt(null)}>
        {top.map(({ l, i }) => (
          <li
            key={l.id}
            className={`ie-layer ${l.id === state.activeId ? "is-active" : ""} ${dropAt === i ? "drop-above" : ""}`}
            draggable={renaming !== l.id}
            onDragStart={() => setDragId(l.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== l.id) commit(moveLayer(state, dragId, i), "Порядок слоёв");
              setDragId(null);
              setDropAt(null);
            }}
            onClick={() => l.id !== state.activeId && select({ ...state, activeId: l.id, editMask: false })}
          >
            <button
              className={`ie-icon-btn ie-eye ${l.visible ? "" : "is-off"}`}
              onClick={(e) => {
                e.stopPropagation();
                set(l, { visible: !l.visible }, l.visible ? "Скрыть слой" : "Показать слой");
              }}
              title={l.visible ? "Скрыть" : "Показать"}
              aria-label={l.visible ? "Скрыть слой" : "Показать слой"}
            >
              <Ico name={l.visible ? "eye" : "eyeOff"} size={16} />
            </button>
            <span
              className={`ie-thumb-wrap ${l.id === state.activeId && !state.editMask ? "is-target" : ""}`}
              title="Рисовать по слою"
              onClick={(e) => {
                e.stopPropagation();
                select({ ...state, activeId: l.id, editMask: false });
              }}
            >
              <Thumb canvas={l.canvas} />
              {l.kind === "text" && <span className="ie-badge">T</span>}
            </span>
            {l.mask && (
              <span
                className={`ie-thumb-wrap ${l.id === state.activeId && state.editMask ? "is-target" : ""} ${l.maskEnabled ? "" : "is-disabled"}`}
                title="Маска слоя: кликните, чтобы рисовать по маске (кисть — показать, ластик — скрыть). Shift+клик — выключить/включить"
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) set(l, { maskEnabled: !l.maskEnabled }, l.maskEnabled ? "Выключить маску" : "Включить маску");
                  else select({ ...state, activeId: l.id, editMask: true });
                }}
              >
                <Thumb canvas={l.mask} isMask />
              </span>
            )}
            {renaming === l.id ? (
              <input
                className="ie-rename"
                defaultValue={l.name}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setRenaming(null);
                  if (e.target.value.trim() && e.target.value !== l.name) set(l, { name: e.target.value.trim() }, "Переименование");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="ie-layer-name" onDoubleClick={() => setRenaming(l.id)} title="Двойной клик — переименовать">
                {l.name}
                {l.opacity < 1 && <small> · {Math.round(l.opacity * 100)}%</small>}
              </span>
            )}
            <button
              className={`ie-icon-btn ie-lock ${l.locked ? "is-on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                set(l, { locked: !l.locked }, l.locked ? "Снять закрепление" : "Закрепить слой");
              }}
              title={l.locked ? "Слой закреплён — нажмите, чтобы снять" : "Закрепить слой"}
              aria-label="Закрепить слой"
            >
              <Ico name="lock" size={14} />
            </button>
          </li>
        ))}
      </ol>

      <footer className="ie-panel-foot">
        <button className="ie-icon-btn" onClick={onAddLayer} title="Новый слой (Ctrl+Shift+N)" aria-label="Новый слой">
          <Ico name="plus" />
        </button>
        <button className="ie-icon-btn" onClick={onDuplicate} title="Дублировать слой (Ctrl+J)" aria-label="Дублировать">
          <Ico name="copy" />
        </button>
        <button className="ie-icon-btn" onClick={onAddMask} disabled={!!active?.mask} title="Добавить маску (из выделения, если оно есть)" aria-label="Маска">
          <Ico name="mask" />
        </button>
        <button className="ie-icon-btn" onClick={onMergeDown} disabled={state.layers[0]?.id === state.activeId} title="Слить с нижним (Ctrl+E)" aria-label="Слить с нижним">
          <Ico name="merge" />
        </button>
        <button className="ie-icon-btn" onClick={onDelete} disabled={state.layers.length < 2} title="Удалить слой" aria-label="Удалить слой">
          <Ico name="trash" />
        </button>
      </footer>
    </section>
  );
}
