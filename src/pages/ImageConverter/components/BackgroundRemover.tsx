import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { aiLoaded, aiMask, ensureAi } from "../../../utils/bgRemoval/aiSegment";
import { colorMask, type BgOptions } from "../../../utils/bgRemoval/bgremove";
import { createCanvas, ctx2d, ctxRead } from "../../../utils/bgRemoval/canvas";

// Удаление фона одного изображения: маска нейросетью или «по цвету фона»,
// доводка кистью (стереть / вернуть), замена фона и обрезка по объекту.
// Всё считается в браузере, файлы и модель никуда не уходят.

export type BgFill = { kind: "transparent" } | { kind: "color"; color: string };

export interface BgResult {
  canvas: HTMLCanvasElement;
}

/** Самая длинная сторона, с которой работаем (больше — память и время). */
const MAX_SIDE = 5000;
/** Длинная сторона холста предпросмотра. */
const VIEW_MAX = 1400;

const fmtMb = (b: number) => (b / 1048576).toFixed(0);

/** Источник в рабочем размере (большие фото уменьшаем до MAX_SIDE). */
export function workingCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  if (k === 1) return src;
  const c = createCanvas(src.width * k, src.height * k);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Границы непрозрачного содержимого маски (null — пусто). */
function maskBounds(mask: HTMLCanvasElement) {
  const { width: w, height: h } = mask;
  const d = ctxRead(mask).getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Итоговая картинка: объект по маске на выбранном фоне, при желании — обрезанная. */
export function composeResult(src: HTMLCanvasElement, mask: HTMLCanvasElement, fill: BgFill, crop: boolean): HTMLCanvasElement {
  const cut = createCanvas(src.width, src.height);
  const cctx = ctx2d(cut);
  cctx.drawImage(src, 0, 0);
  cctx.globalCompositeOperation = "destination-in";
  cctx.drawImage(mask, 0, 0, src.width, src.height);
  cctx.globalCompositeOperation = "source-over";

  let sx = 0;
  let sy = 0;
  let sw = src.width;
  let sh = src.height;
  if (crop) {
    const b = maskBounds(mask);
    if (b) {
      const pad = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.03);
      sx = Math.max(0, b.x0 - pad);
      sy = Math.max(0, b.y0 - pad);
      sw = Math.min(src.width, b.x1 + pad + 1) - sx;
      sh = Math.min(src.height, b.y1 + pad + 1) - sy;
    }
  }
  const out = createCanvas(sw, sh);
  const octx = ctx2d(out);
  if (fill.kind === "color") {
    octx.fillStyle = fill.color;
    octx.fillRect(0, 0, sw, sh);
  }
  octx.drawImage(cut, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Маска по выбранному способу. Для нейросети её нужно загрузить заранее (ensureAi). */
export async function computeMask(src: HTMLCanvasElement, o: BgOptions): Promise<HTMLCanvasElement> {
  return o.mode === "ai" ? aiMask(src, o) : colorMask(src, o);
}

/** Загрузить нейросеть с понятным текстом прогресса. */
export function loadAi(onText: (text: string, fraction: number) => void) {
  return ensureAi((loaded, total) =>
    onText(
      total
        ? `Загружаем нейросеть: ${fmtMb(loaded)} из ${fmtMb(total)} МБ (только в первый раз, дальше — из кэша)`
        : "Загружаем нейросеть…",
      total ? loaded / total : 0,
    ),
  );
}

interface Props {
  source: HTMLCanvasElement;
  name: string;
  onApply: (result: BgResult) => void;
  onClose: () => void;
}

type Brush = "none" | "erase" | "restore";

const BackgroundRemover: React.FC<Props> = ({ source, name, onApply, onClose }) => {
  const [src] = useState(() => workingCopy(source));
  const [opts, setOpts] = useState<BgOptions>({ mode: "ai", tolerance: 30, feather: 1, cleanup: true });
  const [fill, setFill] = useState<BgFill>({ kind: "transparent" });
  const [customColor, setCustomColor] = useState("#2b6cb0");
  const [crop, setCrop] = useState(false);
  const [busy, setBusy] = useState<{ text: string; fraction: number } | null>(null);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [brush, setBrush] = useState<Brush>("none");
  const [brushSize, setBrushSize] = useState(40);
  const [maskVersion, setMaskVersion] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const undoStack = useRef<ImageData[]>([]);
  const painting = useRef<{ x: number; y: number } | null>(null);
  const runId = useRef(0);

  const viewScale = Math.min(1, VIEW_MAX / Math.max(src.width, src.height));
  const vw = Math.max(1, Math.round(src.width * viewScale));
  const vh = Math.max(1, Math.round(src.height * viewScale));

  // ── Расчёт маски ──
  const run = useCallback(
    async (o: BgOptions) => {
      const id = ++runId.current;
      setError("");
      try {
        if (o.mode === "ai" && !aiLoaded()) {
          await loadAi((text, fraction) => id === runId.current && setBusy({ text, fraction }));
        }
        if (id !== runId.current) return;
        setBusy({ text: o.mode === "ai" ? "Нейросеть ищет объект…" : "Ищем фон по цвету краёв…", fraction: 1 });
        // Дать интерфейсу показать сообщение до тяжёлого расчёта
        await new Promise((r) => setTimeout(r, 30));
        const mask = await computeMask(src, o);
        if (id !== runId.current) return;
        maskRef.current = mask;
        undoStack.current = [];
        setMaskVersion((v) => v + 1);
      } catch (err) {
        if (id === runId.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === runId.current) setBusy(null);
      }
    },
    [src],
  );

  // Пересчёт при смене параметров (с небольшой задержкой для ползунков)
  useEffect(() => {
    const t = setTimeout(() => run(opts), maskRef.current ? 250 : 0);
    return () => clearTimeout(t);
  }, [opts, run]);

  // ── Предпросмотр ──
  const redraw = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const ctx = ctx2d(view);
    ctx.clearRect(0, 0, vw, vh);
    const mask = maskRef.current;
    if (showOriginal || !mask) {
      ctx.drawImage(src, 0, 0, vw, vh);
      return;
    }
    if (fill.kind === "color") {
      ctx.fillStyle = fill.color;
      ctx.fillRect(0, 0, vw, vh);
    }
    const tmp = createCanvas(vw, vh);
    const t = ctx2d(tmp);
    t.imageSmoothingQuality = "high";
    t.drawImage(src, 0, 0, vw, vh);
    t.globalCompositeOperation = "destination-in";
    t.drawImage(mask, 0, 0, vw, vh);
    ctx.drawImage(tmp, 0, 0);
  }, [src, vw, vh, fill, showOriginal]);

  useLayoutEffect(redraw, [redraw, maskVersion]);

  // ── Кисть ──
  const toMask = (e: React.PointerEvent) => {
    const r = viewRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * src.width, y: ((e.clientY - r.top) / r.height) * src.height };
  };
  const radius = () => {
    const r = viewRef.current?.getBoundingClientRect();
    return r ? (brushSize / 2) * (src.width / r.width) : brushSize / 2;
  };
  const dab = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = ctx2d(mask);
    const rad = radius();
    ctx.save();
    ctx.globalCompositeOperation = brush === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = rad * 2;
    // Мягкий край кисти
    ctx.filter = `blur(${Math.max(0.5, rad * 0.15)}px)`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.restore();
  };
  const frame = useRef(0);
  const scheduleRedraw = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      redraw();
    });
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brush === "none" || !maskRef.current || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = maskRef.current;
    undoStack.current.push(ctxRead(m).getImageData(0, 0, m.width, m.height));
    if (undoStack.current.length > 15) undoStack.current.shift();
    const p = toMask(e);
    painting.current = p;
    dab(p, p);
    scheduleRedraw();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brush !== "none") {
      const r = e.currentTarget.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    if (!painting.current) return;
    const p = toMask(e);
    dab(painting.current, p);
    painting.current = p;
    scheduleRedraw();
  };
  const onUp = () => {
    painting.current = null;
  };
  const undoBrush = () => {
    const prev = undoStack.current.pop();
    const m = maskRef.current;
    if (!prev || !m) return;
    ctxRead(m).putImageData(prev, 0, 0);
    setMaskVersion((v) => v + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoBrush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const apply = () => {
    if (!maskRef.current) return;
    onApply({ canvas: composeResult(src, maskRef.current, fill, crop) });
  };

  const setOpt = (patch: Partial<BgOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const bgClass = fill.kind === "transparent" ? "bgr-stage--checker" : "";

  return (
    <div className="bgr-overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bgr-modal" role="dialog" aria-label="Удаление фона">
        <div className="bgr-header">
          <h3>✂️ Удаление фона — {name}</h3>
          <button className="bgr-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="bgr-body">
          <div className="bgr-side">
            <div className="bgr-group">
              <div className="bgr-label">Способ</div>
              <label className={`bgr-mode ${opts.mode === "ai" ? "is-active" : ""}`}>
                <input type="radio" checked={opts.mode === "ai"} onChange={() => setOpt({ mode: "ai" })} />
                <span>
                  <strong>Нейросеть</strong>
                  <small>Люди, животные, товары, машины — на любом фоне</small>
                </span>
              </label>
              <label className={`bgr-mode ${opts.mode === "color" ? "is-active" : ""}`}>
                <input type="radio" checked={opts.mode === "color"} onChange={() => setOpt({ mode: "color" })} />
                <span>
                  <strong>Однотонный фон</strong>
                  <small>Логотипы, подписи, предметы на белом или цветном фоне</small>
                </span>
              </label>
            </div>

            {opts.mode === "color" && (
              <label className="bgr-range">
                Чувствительность: {opts.tolerance}
                <input type="range" min={1} max={100} value={opts.tolerance} onChange={(e) => setOpt({ tolerance: Number(e.target.value) })} />
              </label>
            )}
            <label className="bgr-range">
              Смягчение края: {opts.feather} пкс
              <input type="range" min={0} max={8} step={0.5} value={opts.feather} onChange={(e) => setOpt({ feather: Number(e.target.value) })} />
            </label>
            <label className="bgr-check">
              <input type="checkbox" checked={opts.cleanup} onChange={(e) => setOpt({ cleanup: e.target.checked })} />
              Убирать мелкий мусор и дырки
            </label>

            <div className="bgr-group">
              <div className="bgr-label">Доправить кистью</div>
              <div className="bgr-tools">
                <button className={`bgr-tool ${brush === "none" ? "is-active" : ""}`} onClick={() => setBrush("none")} title="Без кисти">
                  👁️
                </button>
                <button className={`bgr-tool ${brush === "erase" ? "is-active" : ""}`} onClick={() => setBrush("erase")} title="Стереть лишнее">
                  🧽 Стереть
                </button>
                <button className={`bgr-tool ${brush === "restore" ? "is-active" : ""}`} onClick={() => setBrush("restore")} title="Вернуть удалённое">
                  🖌️ Вернуть
                </button>
              </div>
              {brush !== "none" && (
                <label className="bgr-range">
                  Размер кисти: {brushSize}
                  <input type="range" min={6} max={160} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                </label>
              )}
              <button className="bgr-link" onClick={undoBrush} disabled={!undoStack.current.length}>
                ↶ Отменить мазок (Ctrl + Z)
              </button>
            </div>

            <div className="bgr-group">
              <div className="bgr-label">Новый фон</div>
              <div className="bgr-fills">
                <button
                  className={`bgr-fill bgr-fill--checker ${fill.kind === "transparent" ? "is-active" : ""}`}
                  onClick={() => setFill({ kind: "transparent" })}
                  title="Прозрачный"
                />
                {["#ffffff", "#000000", "#e8edf3"].map((c) => (
                  <button
                    key={c}
                    className={`bgr-fill ${fill.kind === "color" && fill.color === c ? "is-active" : ""}`}
                    style={{ background: c }}
                    onClick={() => setFill({ kind: "color", color: c })}
                    title={c}
                  />
                ))}
                <label
                  className={`bgr-fill bgr-fill--custom ${fill.kind === "color" && fill.color === customColor ? "is-active" : ""}`}
                  style={{ background: customColor }}
                  title="Свой цвет"
                >
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      setFill({ kind: "color", color: e.target.value });
                    }}
                  />
                </label>
              </div>
            </div>
            <label className="bgr-check">
              <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />
              Обрезать по объекту
            </label>
          </div>

          <div className="bgr-main">
            <div
              className={`bgr-stage ${bgClass}`}
              // Во всю доступную ширину, но не выше окна
              style={{ aspectRatio: `${vw} / ${vh}`, width: `min(100%, calc(min(64vh, 720px) * ${vw / vh}))` }}
            >
              <canvas
                ref={viewRef}
                width={vw}
                height={vh}
                className={`bgr-canvas ${brush !== "none" ? "is-brush" : ""}`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={() => setCursor(null)}
              />
              {cursor && brush !== "none" && (
                <div
                  className={`bgr-cursor bgr-cursor--${brush}`}
                  style={{ left: cursor.x, top: cursor.y, width: brushSize, height: brushSize }}
                />
              )}
              {busy && (
                <div className="bgr-busy">
                  <div className="bgr-spinner" />
                  <p>{busy.text}</p>
                  {busy.fraction < 1 && (
                    <div className="bgr-progress">
                      <div style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
            {error && (
              <p className="bgr-error">
                {error}
                {opts.mode === "ai" && (
                  <>
                    {" "}
                    <button className="bgr-link" onClick={() => setOpt({ mode: "color" })}>
                      Попробовать «Однотонный фон»
                    </button>
                  </>
                )}
              </p>
            )}
            <div className="bgr-under">
              <button
                className="bgr-btn"
                onPointerDown={() => setShowOriginal(true)}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
                title="Удерживайте, чтобы увидеть исходник"
              >
                👁️ Удерживайте — исходник
              </button>
              <span className="bgr-hint">
                {src !== source ? `Обработка в ${src.width}×${src.height} (исходник уменьшен). ` : ""}
                Результат — PNG/WebP с прозрачностью.
              </span>
            </div>
          </div>
        </div>

        <div className="bgr-footer">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={apply} disabled={!maskRef.current || !!busy}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackgroundRemover;
