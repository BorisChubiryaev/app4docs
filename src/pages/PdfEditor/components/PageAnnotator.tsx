import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import "./PageAnnotator.css";

/** Аннотация в НОРМАЛИЗОВАННЫХ координатах (0..1 от размеров страницы). */
export type Annotation =
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      color: string;
      fontSize: number; // доля от высоты страницы
    }
  | {
      id: string;
      type: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "highlight";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      type: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      dataUrl: string;
    }
  | {
      id: string;
      type: "draw";
      points: { x: number; y: number }[];
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "line" | "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      strokeWidth: number;
    };

type Tool =
  | "select"
  | "text"
  | "rect"
  | "highlight"
  | "image"
  | "draw"
  | "line"
  | "arrow";

const uid = () => Math.random().toString(36).slice(2, 10);

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "select", icon: "🖱️", label: "Выбор / перемещение" },
  { id: "text", icon: "🅣", label: "Текст" },
  { id: "draw", icon: "✏️", label: "Рисование" },
  { id: "line", icon: "／", label: "Линия" },
  { id: "arrow", icon: "➤", label: "Стрелка" },
  { id: "rect", icon: "▭", label: "Прямоугольник" },
  { id: "highlight", icon: "🖍️", label: "Выделение" },
  { id: "image", icon: "🖼️", label: "Картинка" },
];

const isBox = (a: Annotation) =>
  a.type === "text" ||
  a.type === "rect" ||
  a.type === "highlight" ||
  a.type === "image";

interface Props {
  backgroundUrl: string;
  initial: Annotation[];
  onSave: (a: Annotation[]) => void;
  onClose: () => void;
}

const PageAnnotator: React.FC<Props> = ({
  backgroundUrl,
  initial,
  onSave,
  onClose,
}) => {
  const [items, setItems] = useState<Annotation[]>(initial);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#e5484d");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(3); // % высоты страницы
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const drawingRef = useRef<{ x: number; y: number }[] | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const pendingImagePos = useRef<{ x: number; y: number }>({ x: 0.3, y: 0.3 });

  const selected = items.find((a) => a.id === selectedId) || null;

  useLayoutEffect(() => {
    const measure = () => {
      if (stageRef.current) {
        const r = stageRef.current.getBoundingClientRect();
        setStage({ w: r.width, h: r.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  const update = (id: string, patch: Partial<Annotation>) =>
    setItems((prev) =>
      prev.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
    );

  const removeSelected = () => {
    if (!selectedId) return;
    setItems((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Delete" || e.key === "Backspace") {
        const el = document.activeElement;
        if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
        removeSelected();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Координаты: px в stage → нормализованные ──
  const toNorm = (px: number, py: number) => ({
    x: stage.w ? px / stage.w : 0,
    y: stage.h ? py / stage.h : 0,
  });
  const evtPos = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Применить свойство к state и, если что-то выбрано, к объекту
  const applyColor = (v: string) => {
    setColor(v);
    if (selected) update(selected.id, { color: v });
  };
  const applyStroke = (v: number) => {
    setStrokeWidth(v);
    if (
      selected &&
      (selected.type === "rect" ||
        selected.type === "line" ||
        selected.type === "arrow" ||
        selected.type === "draw")
    )
      update(selected.id, { strokeWidth: v });
  };
  const applyFontSize = (v: number) => {
    setFontSize(v);
    if (selected && selected.type === "text")
      update(selected.id, { fontSize: v / 100 });
  };

  // ── Работа мышью на сцене ──
  const onStagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (tool === "select") {
      if (e.target === stageRef.current || e.target instanceof HTMLImageElement)
        setSelectedId(null);
      return;
    }
    const p = evtPos(e);
    const n = toNorm(p.x, p.y);

    if (tool === "text") {
      const a: Annotation = {
        id: uid(),
        type: "text",
        x: n.x,
        y: n.y,
        w: 0.3,
        h: (fontSize / 100) * 2.2,
        text: "",
        color,
        fontSize: fontSize / 100,
      };
      setItems((prev) => [...prev, a]);
      setSelectedId(a.id);
      setTool("select");
      // сразу фокус на новом текстовом поле
      requestAnimationFrame(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(
          ".pa-obj.is-selected .pa-text",
        );
        ta?.focus();
      });
      return;
    }
    if (tool === "image") {
      pendingImagePos.current = n;
      fileInputRef.current?.click();
      return;
    }
    stageRef.current?.setPointerCapture(e.pointerId);
    if (tool === "draw") {
      drawingRef.current = [n];
      setDraft({ id: "draft", type: "draw", points: [n], color, strokeWidth });
      return;
    }
    dragStartRef.current = n;
  };

  const onStagePointerMove = (e: React.PointerEvent) => {
    const p = evtPos(e);
    const n = toNorm(p.x, p.y);
    if (tool === "draw" && drawingRef.current) {
      drawingRef.current.push(n);
      setDraft({
        id: "draft",
        type: "draw",
        points: [...drawingRef.current],
        color,
        strokeWidth,
      });
      return;
    }
    const s = dragStartRef.current;
    if (!s) return;
    if (tool === "line" || tool === "arrow") {
      setDraft({
        id: "draft",
        type: tool,
        x1: s.x,
        y1: s.y,
        x2: n.x,
        y2: n.y,
        color,
        strokeWidth,
      });
    } else if (tool === "rect" || tool === "highlight") {
      const x = Math.min(s.x, n.x);
      const y = Math.min(s.y, n.y);
      const w = Math.abs(n.x - s.x);
      const h = Math.abs(n.y - s.y);
      setDraft(
        tool === "rect"
          ? { id: "draft", type: "rect", x, y, w, h, color, strokeWidth }
          : { id: "draft", type: "highlight", x, y, w, h, color },
      );
    }
  };

  const onStagePointerUp = () => {
    if (draft) {
      const tiny =
        (draft.type === "rect" || draft.type === "highlight") &&
        draft.w < 0.008 &&
        draft.h < 0.008;
      const dot =
        (draft.type === "line" || draft.type === "arrow") &&
        Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 0.01;
      if (!tiny && !dot) {
        const finalized = { ...draft, id: uid() } as Annotation;
        setItems((prev) => [...prev, finalized]);
        setSelectedId(finalized.id);
      }
    }
    drawingRef.current = null;
    dragStartRef.current = null;
    setDraft(null);
    // Инструмент НЕ сбрасываем — можно рисовать дальше
  };

  const onImagePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / img.height;
        const w = 0.3;
        const h = (w * stage.w) / aspect / (stage.h || 1);
        const pos = pendingImagePos.current;
        const a: Annotation = {
          id: uid(),
          type: "image",
          x: pos.x,
          y: pos.y,
          w,
          h,
          dataUrl: reader.result as string,
        };
        setItems((prev) => [...prev, a]);
        setSelectedId(a.id);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    setTool("select");
    e.target.value = "";
  };

  const save = () => {
    onSave(items);
    onClose();
  };

  // ── Рендер box-объекта (react-rnd) ──
  const renderBox = (a: Annotation) => {
    if (!isBox(a)) return null;
    const box = a as Extract<Annotation, { w: number }>;
    const px = {
      x: box.x * stage.w,
      y: box.y * stage.h,
      width: box.w * stage.w,
      height: box.h * stage.h,
    };
    const sel = selectedId === a.id;
    const isText = a.type === "text";
    return (
      <Rnd
        key={a.id}
        size={{ width: px.width, height: px.height }}
        position={{ x: px.x, y: px.y }}
        bounds="parent"
        disableDragging={tool !== "select"}
        enableResizing={tool === "select"}
        dragHandleClassName={isText ? "pa-drag" : undefined}
        onMouseDown={() => setSelectedId(a.id)}
        onDragStop={(_e, d) => {
          const n = toNorm(d.x, d.y);
          update(a.id, { x: n.x, y: n.y });
        }}
        onResizeStop={(_e, _dir, ref, _delta, pos) => {
          update(a.id, {
            w: ref.offsetWidth / stage.w,
            h: ref.offsetHeight / stage.h,
            x: pos.x / stage.w,
            y: pos.y / stage.h,
          });
        }}
        className={`pa-obj ${sel ? "is-selected" : ""}`}
      >
        {a.type === "text" && (
          <div className="pa-textwrap">
            {tool === "select" && (
              <div className="pa-drag" title="Перетащить">
                ⠿
              </div>
            )}
            <textarea
              className="pa-text"
              style={{ color: a.color, fontSize: `${a.fontSize * stage.h}px` }}
              value={a.text}
              placeholder="Текст…"
              onChange={(e) => update(a.id, { text: e.target.value })}
              onFocus={() => setSelectedId(a.id)}
            />
          </div>
        )}
        {a.type === "rect" && (
          <div
            className="pa-fill"
            style={{
              border: `${a.strokeWidth}px solid ${a.color}`,
              borderRadius: 2,
            }}
          />
        )}
        {a.type === "highlight" && (
          <div
            className="pa-fill"
            style={{ background: a.color, opacity: 0.35 }}
          />
        )}
        {a.type === "image" && (
          <img className="pa-img" src={a.dataUrl} alt="" draggable={false} />
        )}
      </Rnd>
    );
  };

  // ── SVG-слой (draw / line / arrow) ──
  const vectorEls = [...items, ...(draft ? [draft] : [])].filter(
    (a) => a.type === "draw" || a.type === "line" || a.type === "arrow",
  );

  // Черновик box-фигур (live) — прямоугольник / выделение
  const draftBox =
    draft && (draft.type === "rect" || draft.type === "highlight") ? draft : null;

  const showStroke =
    ["draw", "line", "arrow", "rect"].includes(tool) ||
    (selected != null &&
      ["draw", "line", "arrow", "rect"].includes(selected.type));
  const showFont = tool === "text" || selected?.type === "text";
  const curColor = selected?.color ?? color;
  const curStroke =
    selected && "strokeWidth" in selected ? selected.strokeWidth : strokeWidth;
  const curFont =
    selected?.type === "text" ? selected.fontSize * 100 : fontSize;

  return (
    <div className="pa-overlay">
      <div className="pa-window">
        <div className="pa-toolbar">
          <div className="pa-tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`pa-tool ${tool === t.id ? "is-active" : ""}`}
                title={t.label}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <div className="pa-props">
            <label className="pa-prop" title="Цвет">
              <input
                type="color"
                value={curColor}
                onChange={(e) => applyColor(e.target.value)}
              />
            </label>
            {showStroke && (
              <label className="pa-prop">
                Толщина
                <input
                  type="range"
                  min={1}
                  max={14}
                  value={curStroke}
                  onChange={(e) => applyStroke(Number(e.target.value))}
                />
              </label>
            )}
            {showFont && (
              <label className="pa-prop">
                Размер
                <input
                  type="range"
                  min={1.5}
                  max={9}
                  step={0.5}
                  value={curFont}
                  onChange={(e) => applyFontSize(Number(e.target.value))}
                />
              </label>
            )}
            {selectedId && (
              <button
                className="pa-danger"
                onClick={removeSelected}
                title="Удалить (Delete)"
              >
                🗑️
              </button>
            )}
          </div>
          <div className="pa-actions">
            <button className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button className="btn-primary" onClick={save}>
              Готово
            </button>
          </div>
        </div>

        <div className="pa-scroll">
          <div
            ref={stageRef}
            className={`pa-stage pa-tool-${tool}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
          >
            <img
              className="pa-bg"
              src={backgroundUrl}
              alt="Страница"
              draggable={false}
            />

            {items.map(renderBox)}

            {draftBox && (
              <div
                className="pa-draft"
                style={{
                  left: draftBox.x * stage.w,
                  top: draftBox.y * stage.h,
                  width: draftBox.w * stage.w,
                  height: draftBox.h * stage.h,
                  border:
                    draftBox.type === "rect"
                      ? `${draftBox.strokeWidth}px solid ${draftBox.color}`
                      : "none",
                  background:
                    draftBox.type === "highlight"
                      ? draftBox.color
                      : "transparent",
                  opacity: draftBox.type === "highlight" ? 0.35 : 1,
                }}
              />
            )}

            <svg
              className="pa-vector"
              width={stage.w}
              height={stage.h}
              viewBox={`0 0 ${stage.w} ${stage.h}`}
            >
              <defs>
                <marker
                  id="pa-arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L8,3 L0,6 Z" fill="context-stroke" />
                </marker>
              </defs>
              {vectorEls.map((a) => {
                if (a.type === "draw") {
                  const d = a.points
                    .map(
                      (p, i) =>
                        `${i === 0 ? "M" : "L"}${p.x * stage.w},${p.y * stage.h}`,
                    )
                    .join(" ");
                  return (
                    <path
                      key={a.id}
                      d={d}
                      fill="none"
                      stroke={a.color}
                      strokeWidth={a.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      onClick={() => tool === "select" && setSelectedId(a.id)}
                    />
                  );
                }
                if (a.type === "line" || a.type === "arrow") {
                  return (
                    <line
                      key={a.id}
                      x1={a.x1 * stage.w}
                      y1={a.y1 * stage.h}
                      x2={a.x2 * stage.w}
                      y2={a.y2 * stage.h}
                      stroke={a.color}
                      strokeWidth={a.strokeWidth}
                      strokeLinecap="round"
                      markerEnd={
                        a.type === "arrow" ? "url(#pa-arrowhead)" : undefined
                      }
                      onClick={() => tool === "select" && setSelectedId(a.id)}
                    />
                  );
                }
                return null;
              })}
            </svg>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onImagePicked}
        style={{ display: "none" }}
      />
    </div>
  );
};

export default PageAnnotator;
