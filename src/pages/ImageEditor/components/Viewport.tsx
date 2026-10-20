import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { DocState, Layer, ToolId, ToolOptions } from "../core/types";
import { alphaBounds, cloneCanvas, createCanvas, ctx2d, ctxRead, hexToRgb, rgbToHex } from "../core/canvas";
import {
  activeLayer,
  addLayer,
  composite,
  cropDoc,
  expandToDoc,
  compositeRect,
  invalidatePixels,
  layerPixels,
  makeLayer,
  newLayerName,
  rasterize,
  removeLayer,
  renderText,
  sampleColor,
  transformLayer,
  updateLayer,
} from "../core/doc";
import { combine, floodMask, maskToCanvas, outline, shapeMask } from "../core/selection";

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ViewportHandle {
  fit: () => void;
  zoomTo: (z: number) => void;
  zoomBy: (k: number) => void;
  applyCrop: () => void;
  cancelCrop: () => void;
  startTransform: () => void;
  applyTransform: () => void;
  cancelTransform: () => void;
  finishText: () => void;
}

interface Props {
  state: DocState;
  /** Состояние для предпросмотра (фильтры, удаление фона) — показывается вместо state. */
  preview: DocState | null;
  tool: ToolId;
  options: ToolOptions;
  fg: string;
  bg: string;
  setFg: (c: string) => void;
  setBg: (c: string) => void;
  commit: (s: DocState, label: string) => void;
  onCursor: (p: { x: number; y: number } | null) => void;
  onZoom: (z: number) => void;
  onModeChange: (mode: { crop: boolean; transform: boolean; text: boolean }) => void;
  notify: (msg: string) => void;
}

type Pt = { x: number; y: number };

interface Stroke {
  layerId: string;
  target: "pixels" | "mask";
  layer: Layer;
  base: HTMLCanvasElement;
  work: HTMLCanvasElement;
  acc: HTMLCanvasElement;
  tip: HTMLCanvasElement;
  sel: HTMLCanvasElement | null;
  last: Pt | null;
  /** Ещё не перенесённая на холст часть мазка (координаты слоя). */
  dirty: Rect | null;
  raf: number;
  opacity: number;
  kind: "brush" | "eraser" | "stamp";
  size: number;
  stampOffset: Pt;
}

interface Xform {
  layerId: string;
  orig: Layer;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  angle: number;
}

type Drag =
  | { kind: "pan"; start: Pt; view: View }
  | { kind: "move"; start: Pt; layer: Layer }
  | { kind: "marquee"; start: Pt; cur: Pt; mode: ToolOptions["selectMode"] }
  | { kind: "lasso"; points: Pt[]; mode: ToolOptions["selectMode"] }
  | { kind: "crop"; start: Pt; handle: string; rect: Rect }
  | { kind: "xform"; start: Pt; handle: string; x0: Xform }
  | { kind: "gradient"; start: Pt; cur: Pt; layer: Layer; base: HTMLCanvasElement }
  | { kind: "shape"; start: Pt; cur: Pt; canvas: HTMLCanvasElement }
  | { kind: "stroke" }
  | { kind: "pinch"; d0: number; c0: Pt; view: View };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const RATIOS: Record<string, number | null> = { free: null, "1:1": 1, "4:3": 4 / 3, "3:2": 3 / 2, "16:9": 16 / 9, original: null };

function brushTip(size: number, hardness: number, color: string): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(size));
  const c = createCanvas(d, d);
  const ctx = ctx2d(c);
  const r = d / 2;
  const [cr, cg, cb] = hexToRgb(color);
  if (hardness >= 0.99 || d <= 2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
  g.addColorStop(Math.max(0.01, hardness), `rgba(${cr},${cg},${cb},1)`);
  g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, d, d);
  return c;
}

/** Выделение в координатах слоя. */
function selectionForLayer(s: DocState, l: Layer): HTMLCanvasElement | null {
  if (!s.selection) return null;
  const c = createCanvas(l.canvas.width, l.canvas.height);
  ctx2d(c).drawImage(s.selection, -l.x, -l.y);
  return c;
}

/** Нарисовать src поверх dst с учётом выделения. */
function drawMasked(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, sel: HTMLCanvasElement | null, alpha = 1) {
  let s = src;
  if (sel) {
    s = cloneCanvas(src);
    const c = ctx2d(s);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(sel, 0, 0);
  }
  dst.globalAlpha = alpha;
  dst.drawImage(s, 0, 0);
  dst.globalAlpha = 1;
}

const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const { state, preview, tool, options, fg, bg, commit, onCursor, onZoom, onModeChange, notify } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setViewState] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const setView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setViewState(v);
      onZoom(v.zoom);
    },
    [onZoom],
  );

  const [transient, setTransient] = useState<DocState | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [xform, setXform] = useState<Xform | null>(null);
  const [textEdit, setTextEdit] = useState<{ layerId: string; isNew: boolean; before: DocState } | null>(null);
  // Курсор кисти — в ref, перерисовка не чаще кадра (без рендера React на каждое движение)
  const hoverRef = useRef<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const stampSrc = useRef<Pt | null>(null);
  // Пальцы на экране: второй палец — масштаб и сдвиг двумя пальцами
  const touches = useRef(new Map<number, Pt>());
  // Указатель, которым идёт текущее действие (касание ладонью его не прерывает)
  const dragPointer = useRef<{ id: number; touch: boolean } | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const shown = preview ?? transient ?? state;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    onModeChange({ crop: !!crop, transform: !!xform, text: !!textEdit });
  }, [crop, xform, textEdit, onModeChange]);

  // ── Вид ──
  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    const s = stateRef.current;
    if (!w || !h) return;
    const z = Math.min(1, (w - 48) / s.width, (h - 48) / s.height);
    setView({ zoom: z, panX: Math.round((w - s.width * z) / 2), panY: Math.round((h - s.height * z) / 2) });
  }, [setView]);

  const zoomAt = useCallback(
    (z: number, at?: Pt) => {
      const v = viewRef.current;
      const nz = Math.min(64, Math.max(0.02, z));
      const { w, h } = sizeRef.current;
      const p = at ?? { x: w / 2, y: h / 2 };
      const dx = (p.x - v.panX) / v.zoom;
      const dy = (p.y - v.panY) / v.zoom;
      setView({ zoom: nz, panX: p.x - dx * nz, panY: p.y - dy * nz });
    },
    [setView],
  );

  // Новый документ (другой размер) — вписать в экран
  const docKey = `${state.width}x${state.height}`;
  useEffect(() => {
    fit();
  }, [docKey, fit]);

  // Размер холста под контейнер
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      if (first) fit();
      setOverlayTick((t) => t + 1);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - r.left - v.panX) / v.zoom, y: (e.clientY - r.top - v.panY) / v.zoom };
  };
  const toScreen = (p: Pt): Pt => {
    const v = viewRef.current;
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
  };

  // ── Сведение (кэш) и контур выделения ──
  const compRef = useRef<{ src: DocState | null; canvas: HTMLCanvasElement | null; dirty: number }>({ src: null, canvas: null, dirty: 0 });
  const dirtyRef = useRef(0);
  // Изменённый живым мазком прямоугольник документа — пересводится только он
  const partialRef = useRef<Rect | null>(null);
  const checkerRef = useRef<CanvasPattern | null>(null);
  const antsRef = useRef<{ sel: HTMLCanvasElement | null; segs: Float32Array | null }>({ sel: null, segs: null });

  const draw = useCallback(
    (antsPhase = 0) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d")!;
      const { dpr } = sizeRef.current;
      const v = viewRef.current;
      const s = shown;
      const cache = compRef.current;
      if (cache.src !== s || cache.dirty !== dirtyRef.current || !cache.canvas) {
        cache.canvas = composite(s, undefined, cache.canvas ?? undefined);
        cache.src = s;
        cache.dirty = dirtyRef.current;
      } else if (partialRef.current) compositeRect(s, cache.canvas, partialRef.current);
      partialRef.current = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = v.panX;
      const y = v.panY;
      const w = s.width * v.zoom;
      const h = s.height * v.zoom;
      // Шахматка прозрачности
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      if (!checkerRef.current) {
        const t = createCanvas(16, 16);
        const tc = ctx2d(t);
        tc.fillStyle = "#ffffff";
        tc.fillRect(0, 0, 16, 16);
        tc.fillStyle = "#d9d9d9";
        tc.fillRect(8, 0, 8, 8);
        tc.fillRect(0, 8, 8, 8);
        checkerRef.current = ctx.createPattern(t, "repeat");
      }
      ctx.translate(x, y);
      ctx.fillStyle = checkerRef.current ?? "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.translate(-x, -y);
      ctx.imageSmoothingEnabled = v.zoom < 2;
      // Во время мазка — быстрое сглаживание (кадр в 2–3 раза дешевле), после — качественное
      ctx.imageSmoothingQuality = stroke.current ? "low" : "high";
      ctx.drawImage(cache.canvas!, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

      // Рамка активного слоя для инструмента «Перемещение»
      const al = activeLayer(s);
      if (al && tool === "move" && !xform) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#2a78d6";
        ctx.strokeRect(x + al.x * v.zoom, y + al.y * v.zoom, al.canvas.width * v.zoom, al.canvas.height * v.zoom);
        ctx.restore();
      }

      // «Бегущие муравьи»
      const sel = s.selection;
      if (sel) {
        if (antsRef.current.sel !== sel) antsRef.current = { sel, segs: outline(sel) };
        const segs = antsRef.current.segs!;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < segs.length; i += 4) {
          ctx.moveTo(x + segs[i] * v.zoom, y + segs[i + 1] * v.zoom);
          ctx.lineTo(x + segs[i + 2] * v.zoom, y + segs[i + 3] * v.zoom);
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#fff";
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.strokeStyle = "#000";
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -antsPhase;
        ctx.stroke();
        ctx.restore();
      }

      const d = drag.current;
      // Прямоугольник / эллипс выделения и лассо в процессе
      if (d && d.kind === "marquee") {
        const r = normRect(d.start, d.cur);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#000";
        ctx.beginPath();
        if (tool === "ellipse")
          ctx.ellipse(x + (r.x + r.w / 2) * v.zoom, y + (r.y + r.h / 2) * v.zoom, (r.w / 2) * v.zoom, (r.h / 2) * v.zoom, 0, 0, Math.PI * 2);
        else ctx.rect(x + r.x * v.zoom, y + r.y * v.zoom, r.w * v.zoom, r.h * v.zoom);
        ctx.stroke();
        ctx.restore();
      }
      if (d && d.kind === "lasso" && d.points.length > 1) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        d.points.forEach((p, i) => (i ? ctx.lineTo(x + p.x * v.zoom, y + p.y * v.zoom) : ctx.moveTo(x + p.x * v.zoom, y + p.y * v.zoom)));
        ctx.stroke();
        ctx.restore();
      }
      if (d && d.kind === "gradient") {
        const a = toScreen(d.start);
        const b = toScreen(d.cur);
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = "#2a78d6";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Кадрирование
      if (crop) {
        const r = { x: x + crop.x * v.zoom, y: y + crop.y * v.zoom, w: crop.w * v.zoom, h: crop.h * v.zoom };
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.rect(0, 0, sizeRef.current.w, sizeRef.current.h);
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        // Сетка третей
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        for (let i = 1; i < 3; i++) {
          ctx.moveTo(r.x + (r.w * i) / 3, r.y);
          ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
          ctx.moveTo(r.x, r.y + (r.h * i) / 3);
          ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
        }
        ctx.stroke();
        for (const hp of cropHandles(r)) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(hp.x - 5, hp.y - 5, 10, 10);
          ctx.strokeStyle = "#000";
          ctx.strokeRect(hp.x - 5, hp.y - 5, 10, 10);
        }
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        const label = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
        ctx.font = "12px sans-serif";
        const tw = ctx.measureText(label).width + 12;
        ctx.fillRect(r.x, r.y - 24, tw, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, r.x + 6, r.y - 10);
        ctx.restore();
      }

      // Свободное трансформирование
      if (xform) {
        const corners = xformCorners(xform).map(toScreen);
        ctx.save();
        ctx.strokeStyle = "#2a78d6";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        for (const hp of xformHandles(xform, v.zoom).map((h) => ({ ...toScreen(h), id: h.id }))) {
          ctx.fillStyle = hp.id === "rot" ? "#2a78d6" : "#fff";
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Курсор кисти
      const hover = hoverRef.current;
      if (hover && ["brush", "eraser", "stamp"].includes(tool) && !spaceDown) {
        const p = toScreen(hover);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, (options.size / 2) * v.zoom), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, (options.size / 2) * v.zoom) + 1, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.stroke();
        if (tool === "stamp" && stampSrc.current) {
          const sp = toScreen(stampSrc.current);
          ctx.beginPath();
          ctx.moveTo(sp.x - 6, sp.y);
          ctx.lineTo(sp.x + 6, sp.y);
          ctx.moveTo(sp.x, sp.y - 6);
          ctx.lineTo(sp.x, sp.y + 6);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
     
    [shown, crop, xform, tool, options.size, spaceDown],
  );
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const rafRef = useRef(0);
  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Перерисовка при изменениях + анимация «муравьёв»
  useEffect(() => {
    draw();
  }, [draw, view, overlayTick]);
  useEffect(() => {
    if (!shown.selection) return;
    let phase = 0;
    const id = window.setInterval(() => {
      phase = (phase + 1) % 8;
      draw(phase);
    }, 120);
    return () => window.clearInterval(id);
  }, [shown.selection, draw]);

  // ── Кадрирование ──
  useEffect(() => {
    if (tool === "crop" && !crop) setCrop({ x: 0, y: 0, w: state.width, h: state.height });
    if (tool !== "crop" && crop) setCrop(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, state.width, state.height]);

  const applyCrop = useCallback(() => {
    if (!crop) return;
    commit(cropDoc(stateRef.current, crop), "Кадрирование");
    setCrop({ x: 0, y: 0, w: Math.round(crop.w), h: Math.round(crop.h) });
  }, [crop, commit]);
  const cancelCrop = useCallback(() => setCrop({ x: 0, y: 0, w: stateRef.current.width, h: stateRef.current.height }), []);

  // ── Трансформирование ──
  const startTransform = useCallback(() => {
    const s = stateRef.current;
    const l = activeLayer(s);
    if (!l) return;
    if (l.locked) return notify("Слой закреплён — снимите замок, чтобы трансформировать.");
    // Рамка — по нарисованному, а не по всему холсту слоя (после кисти он размером с документ)
    let orig = l;
    const b = l.text ? null : alphaBounds(l.canvas);
    if (!l.text && !b) return notify("Слой пустой — трансформировать нечего.");
    if (b && (b.w < l.canvas.width || b.h < l.canvas.height)) {
      const cut = (src: HTMLCanvasElement) => {
        const c = createCanvas(b.w, b.h);
        ctx2d(c).drawImage(src, -b.x, -b.y);
        return c;
      };
      orig = { ...l, canvas: cut(l.canvas), mask: l.mask ? cut(l.mask) : l.mask, x: l.x + b.x, y: l.y + b.y };
    }
    setXform({ layerId: l.id, orig, cx: orig.x + orig.canvas.width / 2, cy: orig.y + orig.canvas.height / 2, sx: 1, sy: 1, angle: 0 });
  }, [notify]);

  useEffect(() => {
    if (!xform) return;
    const s = stateRef.current;
    const t = transformLayer(xform.orig, xform);
    setTransient(updateLayer(s, xform.layerId, { canvas: t.canvas, mask: t.mask, x: t.x, y: t.y }));
  }, [xform]);

  const applyTransform = useCallback(() => {
    if (!xform) return;
    const s = stateRef.current;
    const t = transformLayer(xform.orig, xform);
    setXform(null);
    setTransient(null);
    commit(updateLayer(s, xform.layerId, t), "Трансформирование");
  }, [xform, commit]);
  const cancelTransform = useCallback(() => {
    setXform(null);
    setTransient(null);
  }, []);

  // ── Текст ──
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const finishText = useCallback(() => {
    if (!textEdit) return;
    const s = transient ?? stateRef.current;
    const l = s.layers.find((x) => x.id === textEdit.layerId);
    setTextEdit(null);
    setTransient(null);
    if (!l || !l.text?.text.trim()) {
      // Пустой текст — слой не нужен
      if (!textEdit.isNew && l) commit(removeLayer(s, l.id), "Удаление текста");
      return;
    }
    commit(s, textEdit.isNew ? "Новый текст" : "Правка текста");
  }, [textEdit, transient, commit]);

  // Смена параметров шрифта в панели — сразу на редактируемый текстовый слой
  useEffect(() => {
    if (!textEdit) return;
    const s = transient ?? stateRef.current;
    const l = s.layers.find((x) => x.id === textEdit.layerId);
    if (!l?.text) return;
    const t = { ...l.text, font: options.font, size: options.fontSize, bold: options.bold, italic: options.italic, align: options.align, color: fg };
    if (JSON.stringify(t) === JSON.stringify(l.text)) return;
    setTransient(updateLayer(s, l.id, { text: t, canvas: renderText(t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.font, options.fontSize, options.bold, options.italic, options.align, fg]);

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomTo: (z) => zoomAt(z),
      zoomBy: (k) => zoomAt(viewRef.current.zoom * k),
      applyCrop,
      cancelCrop,
      startTransform,
      applyTransform,
      cancelTransform,
      finishText,
    }),
    [fit, zoomAt, applyCrop, cancelCrop, startTransform, applyTransform, cancelTransform, finishText],
  );

  // Пробел — временная «рука», Enter/Esc — для кадрирования и трансформирования
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
      }
      if (e.key === "Enter") {
        if (xform) applyTransform();
        else if (crop && tool === "crop") applyCrop();
      }
      if (e.key === "Escape") {
        if (xform) cancelTransform();
        else if (crop && tool === "crop") cancelCrop();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [xform, crop, tool, applyTransform, applyCrop, cancelTransform, cancelCrop]);

  // ── Мазки ──
  const beginStroke = (p: Pt, kind: Stroke["kind"], pressure: number) => {
    const s = stateRef.current;
    let l = activeLayer(s);
    if (!l) return;
    if (l.locked) return notify("Слой закреплён — снимите замок в панели слоёв.");
    if (!l.visible) return notify("Слой скрыт — включите его видимость, чтобы рисовать.");
    const target = s.editMask && l.mask ? "mask" : "pixels";
    if (kind === "stamp" && !stampSrc.current) return notify("Сначала укажите источник: Alt + клик по картинке.");
    if (target === "pixels") l = expandToDoc(s, rasterize(l));
    const src = target === "mask" ? l.mask! : l.canvas;
    const base = cloneCanvas(src);
    const color = target === "mask" ? "#ffffff" : kind === "brush" ? fg : "#000000";
    stroke.current = {
      layerId: l.id,
      target,
      layer: l,
      base,
      work: cloneCanvas(src),
      acc: createCanvas(src.width, src.height),
      tip: brushTip(options.size, options.hardness, color),
      sel: selectionForLayer(s, l),
      last: null,
      dirty: null,
      raf: 0,
      opacity: options.opacity,
      kind,
      size: options.size,
      stampOffset: kind === "stamp" ? { x: stampSrc.current!.x - p.x, y: stampSrc.current!.y - p.y } : { x: 0, y: 0 },
    };
    drag.current = { kind: "stroke" };
    // Слой в показываемом состоянии — сразу рабочий холст; дальше он меняется на месте
    setTransient(updateLayer(s, l.id, strokePatch(stroke.current)));
    strokeTo(p, pressure);
  };

  const strokePatch = (st: Stroke): Partial<Layer> =>
    st.target === "mask"
      ? { mask: st.work }
      : { canvas: st.work, x: st.layer.x, y: st.layer.y, mask: st.layer.mask, kind: "raster", text: undefined };

  // Перенести накопленные отпечатки на рабочий холст — только изменённый кусок
  const flushStroke = () => {
    const st = stroke.current;
    if (!st) return;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    const d = st.dirty;
    st.dirty = null;
    if (!d) return;
    const x0 = Math.max(0, Math.floor(d.x));
    const y0 = Math.max(0, Math.floor(d.y));
    const x1 = Math.min(st.work.width, Math.ceil(d.x + d.w));
    const y1 = Math.min(st.work.height, Math.ceil(d.y + d.h));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0;
    const h = y1 - y0;
    let src: HTMLCanvasElement = st.acc;
    let sx = x0;
    let sy = y0;
    if (st.sel) {
      const t = createCanvas(w, h);
      const tc = ctx2d(t);
      tc.drawImage(st.acc, -x0, -y0);
      tc.globalCompositeOperation = "destination-in";
      tc.drawImage(st.sel, -x0, -y0);
      src = t;
      sx = 0;
      sy = 0;
    }
    const wctx = ctx2d(st.work);
    wctx.save();
    wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(x0, y0, w, h);
    wctx.drawImage(st.base, x0, y0, w, h, x0, y0, w, h);
    if (st.kind === "eraser") wctx.globalCompositeOperation = "destination-out";
    wctx.globalAlpha = st.opacity;
    wctx.drawImage(src, sx, sy, w, h, x0, y0, w, h);
    wctx.restore();
    invalidatePixels(st.target === "mask" ? st.layer.canvas : st.work);
    const r = { x: x0 + st.layer.x, y: y0 + st.layer.y, w, h };
    partialRef.current = unionRect(partialRef.current, r);
    requestDraw();
  };

  const dab = (st: Stroke, x: number, y: number, size: number) => {
    const actx = ctx2d(st.acc);
    const lx = x - st.layer.x;
    const ly = y - st.layer.y;
    if (st.kind === "stamp") {
      const d = st.tip.width;
      const tmp = createCanvas(d, d);
      const t = ctx2d(tmp);
      t.drawImage(st.tip, 0, 0);
      t.globalCompositeOperation = "source-in";
      t.drawImage(st.base, -(lx + st.stampOffset.x - d / 2), -(ly + st.stampOffset.y - d / 2));
      actx.drawImage(tmp, lx - d / 2, ly - d / 2);
    } else {
      const d = size;
      actx.drawImage(st.tip, lx - d / 2, ly - d / 2, d, d);
    }
  };

  const strokeTo = (p: Pt, pressure: number) => {
    const st = stroke.current;
    if (!st) return;
    const from = st.last;
    const size = Math.max(1, st.size * (pressure > 0 && pressure !== 0.5 ? pressure * 1.2 : 1));
    const spacing = Math.max(1, size * 0.15);
    let to = p;
    if (!from) dab(st, p.x, p.y, size);
    else {
      // Отсчёт — от последнего отпечатка: при медленном движении (шаг мыши
      // меньше интервала) отпечатки не теряются, линия не рвётся
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const dist = Math.hypot(dx, dy);
      const n = Math.floor(dist / spacing);
      if (!n) return;
      for (let i = 1; i <= n; i++) dab(st, from.x + (dx * i * spacing) / dist, from.y + (dy * i * spacing) / dist, size);
      to = { x: from.x + (dx * n * spacing) / dist, y: from.y + (dy * n * spacing) / dist };
    }
    st.last = to;
    // Отметить затронутую область; на холст — раз в кадр
    const half = size / 2 + 2;
    for (const q of from ? [from, to] : [to])
      st.dirty = unionRect(st.dirty, { x: q.x - st.layer.x - half, y: q.y - st.layer.y - half, w: half * 2, h: half * 2 });
    if (!st.raf) st.raf = requestAnimationFrame(flushStroke);
  };

  const endStroke = () => {
    const st = stroke.current;
    if (!st) return;
    flushStroke();
    stroke.current = null;
    const s = stateRef.current;
    const label = st.target === "mask" ? "Маска: кисть" : st.kind === "brush" ? "Кисть" : st.kind === "eraser" ? "Ластик" : "Штамп";
    setTransient(null);
    commit(updateLayer(s, st.layerId, strokePatch(st)), label);
  };

  // ── Заливка, пипетка, палочка ──
  const pixelsAt = (s: DocState, all: boolean): { img: ImageData; ox: number; oy: number } | null => {
    if (all) return { img: ctxRead(composite(s)).getImageData(0, 0, s.width, s.height), ox: 0, oy: 0 };
    const l = activeLayer(s);
    if (!l) return null;
    const px = layerPixels(l);
    return { img: ctxRead(px).getImageData(0, 0, px.width, px.height), ox: l.x, oy: l.y };
  };

  const magicWand = (p: Pt, mode: ToolOptions["selectMode"]) => {
    const s = stateRef.current;
    const src = pixelsAt(s, options.sampleAll);
    if (!src) return;
    const m = floodMask(src.img, Math.floor(p.x - src.ox), Math.floor(p.y - src.oy), options.tolerance, options.contiguous);
    const local = maskToCanvas(m, src.img.width, src.img.height, options.antialias);
    const full = createCanvas(s.width, s.height);
    ctx2d(full).drawImage(local, src.ox, src.oy);
    commit({ ...s, selection: combine(s.selection, full, mode) }, "Волшебная палочка");
  };

  const bucket = (p: Pt) => {
    const s = stateRef.current;
    let l = activeLayer(s);
    if (!l) return;
    if (l.locked) return notify("Слой закреплён.");
    l = expandToDoc(s, rasterize(l));
    const src = options.sampleAll
      ? { img: ctxRead(composite(s)).getImageData(0, 0, s.width, s.height), ox: 0, oy: 0 }
      : { img: ctxRead(l.canvas).getImageData(0, 0, l.canvas.width, l.canvas.height), ox: l.x, oy: l.y };
    const m = floodMask(src.img, Math.floor(p.x - src.ox), Math.floor(p.y - src.oy), options.tolerance, options.contiguous);
    const region = maskToCanvas(m, src.img.width, src.img.height, options.antialias);
    // Область заливки в координатах слоя
    const regionL = createCanvas(l.canvas.width, l.canvas.height);
    ctx2d(regionL).drawImage(region, src.ox - l.x, src.oy - l.y);
    const fill = createCanvas(l.canvas.width, l.canvas.height);
    const fctx = ctx2d(fill);
    fctx.fillStyle = fg;
    fctx.fillRect(0, 0, fill.width, fill.height);
    fctx.globalCompositeOperation = "destination-in";
    fctx.drawImage(regionL, 0, 0);
    const out = cloneCanvas(l.canvas);
    drawMasked(ctx2d(out), fill, selectionForLayer(s, l), options.opacity);
    commit(updateLayer(s, l.id, { canvas: out, x: l.x, y: l.y, mask: l.mask, kind: "raster", text: undefined }), "Заливка");
  };

  const eyedrop = (p: Pt, toBg: boolean) => {
    const c = sampleColor(stateRef.current, p.x, p.y, true);
    if (!c) return;
    const hex = rgbToHex(c[0], c[1], c[2]);
    if (toBg) props.setBg(hex);
    else props.setFg(hex);
  };

  // ── Градиент и фигуры ──
  const renderGradient = (d: Extract<Drag, { kind: "gradient" }>) => {
    const s = stateRef.current;
    const l = d.layer;
    const g = createCanvas(l.canvas.width, l.canvas.height);
    const gctx = ctx2d(g);
    const a = { x: d.start.x - l.x, y: d.start.y - l.y };
    const b = { x: d.cur.x - l.x, y: d.cur.y - l.y };
    const grad =
      options.gradient === "radial"
        ? gctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
        : gctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, fg);
    grad.addColorStop(1, bg);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, g.width, g.height);
    const out = cloneCanvas(d.base);
    drawMasked(ctx2d(out), g, selectionForLayer(s, l), options.opacity);
    return updateLayer(s, l.id, { canvas: out, x: l.x, y: l.y, mask: l.mask, kind: "raster", text: undefined });
  };

  const renderShape = (d: Extract<Drag, { kind: "shape" }>, shift: boolean) => {
    const c = d.canvas;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, c.width, c.height);
    let r = normRect(d.start, d.cur);
    if (shift && options.shape !== "line" && options.shape !== "arrow") {
      const m = Math.max(r.w, r.h);
      r = { x: d.cur.x < d.start.x ? d.start.x - m : d.start.x, y: d.cur.y < d.start.y ? d.start.y - m : d.start.y, w: m, h: m };
    }
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    ctx.lineWidth = options.shapeStroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    if (options.shape === "rect") ctx.rect(r.x, r.y, r.w, r.h);
    else if (options.shape === "ellipse") ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(d.start.x, d.start.y);
      ctx.lineTo(d.cur.x, d.cur.y);
      if (options.shape === "arrow") {
        const ang = Math.atan2(d.cur.y - d.start.y, d.cur.x - d.start.x);
        const head = Math.max(12, options.shapeStroke * 4);
        ctx.moveTo(d.cur.x, d.cur.y);
        ctx.lineTo(d.cur.x - head * Math.cos(ang - 0.45), d.cur.y - head * Math.sin(ang - 0.45));
        ctx.moveTo(d.cur.x, d.cur.y);
        ctx.lineTo(d.cur.x - head * Math.cos(ang + 0.45), d.cur.y - head * Math.sin(ang + 0.45));
      }
    }
    if (options.shapeFill && (options.shape === "rect" || options.shape === "ellipse")) ctx.fill();
    else ctx.stroke();
  };

  // Прервать начатое одним пальцем действие (без записи в историю)
  const abortDrag = () => {
    const st = stroke.current;
    if (st?.raf) cancelAnimationFrame(st.raf);
    stroke.current = null;
    drag.current = null;
    setTransient(null);
  };

  const pinchInfo = () => {
    const [a, b] = [...touches.current.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const capture = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
  };

  // ── Указатель ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      const r = canvasRef.current!.getBoundingClientRect();
      touches.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      // Перо уже рисует — касание ладонью игнорируем
      if (drag.current && dragPointer.current && !dragPointer.current.touch) return;
      if (touches.current.size >= 2) {
        // Второй палец: это жест, а не рисование
        if (touches.current.size === 2) {
          abortDrag();
          const { d, c } = pinchInfo();
          drag.current = { kind: "pinch", d0: d, c0: c, view: viewRef.current };
          capture(e);
        }
        return;
      }
    }
    dragPointer.current = { id: e.pointerId, touch: e.pointerType === "touch" };
    if (e.button === 1 || spaceDown || tool === "hand") {
      drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, view: viewRef.current };
      capture(e);
      return;
    }
    if (e.button !== 0) return;
    if (textEdit) {
      finishText();
      return;
    }
    const p = toDoc(e);
    const s = stateRef.current;
    const mode: ToolOptions["selectMode"] = e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : options.selectMode;
    capture(e);

    if (xform) {
      const h = hitXform(xform, p, viewRef.current.zoom);
      drag.current = { kind: "xform", start: p, handle: h ?? "move", x0: { ...xform } };
      return;
    }
    switch (tool) {
      case "zoom":
        zoomAt(viewRef.current.zoom * (e.altKey ? 1 / 1.6 : 1.6), { x: e.clientX - canvasRef.current!.getBoundingClientRect().left, y: e.clientY - canvasRef.current!.getBoundingClientRect().top });
        return;
      case "move": {
        const l = activeLayer(s);
        if (!l) return;
        if (l.locked) return notify("Слой закреплён — снимите замок, чтобы двигать.");
        drag.current = { kind: "move", start: p, layer: l };
        return;
      }
      case "marquee":
      case "ellipse":
        drag.current = { kind: "marquee", start: p, cur: p, mode };
        return;
      case "lasso":
        drag.current = { kind: "lasso", points: [p], mode };
        return;
      case "wand":
        magicWand(p, mode);
        return;
      case "crop": {
        if (!crop) return;
        const handle = hitCrop(crop, p, viewRef.current.zoom);
        drag.current = { kind: "crop", start: p, handle: handle ?? "new", rect: { ...crop } };
        return;
      }
      case "brush":
      case "eraser":
        beginStroke(p, tool, e.pointerType === "pen" ? e.pressure : 0);
        return;
      case "stamp":
        if (e.altKey) {
          stampSrc.current = p;
          notify("Источник штампа задан — теперь рисуйте.");
          return;
        }
        beginStroke(p, "stamp", e.pointerType === "pen" ? e.pressure : 0);
        return;
      case "fill":
        bucket(p);
        return;
      case "eyedropper":
        eyedrop(p, e.altKey);
        return;
      case "gradient": {
        let l = activeLayer(s);
        if (!l) return;
        if (l.locked) return notify("Слой закреплён.");
        l = expandToDoc(s, rasterize(l));
        drag.current = { kind: "gradient", start: p, cur: p, layer: l, base: cloneCanvas(l.canvas) };
        return;
      }
      case "shape":
        drag.current = { kind: "shape", start: p, cur: p, canvas: createCanvas(s.width, s.height) };
        return;
      case "text": {
        // Клик по текстовому слою — правка, иначе новый текст
        const hit = [...s.layers].reverse().find(
          (l) => l.kind === "text" && l.visible && p.x >= l.x && p.y >= l.y && p.x <= l.x + l.canvas.width && p.y <= l.y + l.canvas.height,
        );
        if (hit) {
          setTextEdit({ layerId: hit.id, isNew: false, before: s });
          setTransient({ ...s, activeId: hit.id });
        } else {
          const t = {
            text: "",
            font: options.font,
            size: options.fontSize,
            color: fg,
            bold: options.bold,
            italic: options.italic,
            align: options.align,
            lineHeight: 1.2,
          };
          const layer = makeLayer(renderText(t), "Текст", { kind: "text", text: t, x: Math.round(p.x), y: Math.round(p.y - options.fontSize * 0.6) });
          setTextEdit({ layerId: layer.id, isNew: true, before: s });
          setTransient(addLayer(s, layer));
        }
        setTimeout(() => textAreaRef.current?.focus(), 0);
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      const r = canvasRef.current!.getBoundingClientRect();
      touches.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      const pd = drag.current;
      if (pd?.kind === "pinch") {
        if (touches.current.size < 2) return;
        const { d, c } = pinchInfo();
        const z = Math.min(64, Math.max(0.02, pd.view.zoom * (d / pd.d0)));
        // Точка документа под центром жеста следует за пальцами
        const dx = (pd.c0.x - pd.view.panX) / pd.view.zoom;
        const dy = (pd.c0.y - pd.view.panY) / pd.view.zoom;
        setView({ zoom: z, panX: c.x - dx * z, panY: c.y - dy * z });
        return;
      }
    }
    const p = toDoc(e);
    hoverRef.current = p;
    requestDraw();
    onCursor({ x: Math.floor(p.x), y: Math.floor(p.y) });
    if (drag.current && dragPointer.current && dragPointer.current.id !== e.pointerId) return; // ладонь, второй указатель
    const d = drag.current;
    if (!d) return;
    const s = stateRef.current;
    switch (d.kind) {
      case "pan": {
        setView({ ...d.view, panX: d.view.panX + e.clientX - d.start.x, panY: d.view.panY + e.clientY - d.start.y });
        return;
      }
      case "move": {
        const dx = Math.round(p.x - d.start.x);
        const dy = Math.round(p.y - d.start.y);
        setTransient(updateLayer(s, d.layer.id, { x: d.layer.x + dx, y: d.layer.y + dy }));
        return;
      }
      case "marquee": {
        let cur = p;
        if (e.shiftKey && d.mode !== "add") {
          const m = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y));
          cur = { x: d.start.x + Math.sign(p.x - d.start.x || 1) * m, y: d.start.y + Math.sign(p.y - d.start.y || 1) * m };
        }
        d.cur = cur;
        setOverlayTick((t) => t + 1);
        return;
      }
      case "lasso":
        d.points.push(p);
        setOverlayTick((t) => t + 1);
        return;
      case "stroke": {
        const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
        if (evs.length > 1) for (const ce of evs) strokeTo(toDoc(ce), e.pointerType === "pen" ? ce.pressure : 0);
        else strokeTo(p, e.pointerType === "pen" ? e.pressure : 0);
        return;
      }
      case "crop": {
        setCrop(dragCrop(d, p, s, options.cropRatio));
        return;
      }
      case "xform": {
        setXform(dragXform(d, p, e.shiftKey));
        return;
      }
      case "gradient":
        d.cur = p;
        setTransient(renderGradient(d));
        return;
      case "shape": {
        d.cur = p;
        renderShape(d, e.shiftKey);
        dirtyRef.current++;
        const layer = makeLayer(d.canvas, newLayerName(s, "Фигура"));
        setTransient(addLayer(s, layer));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (drag.current?.kind === "pinch") {
        // Жест окончен, когда подняты все пальцы; оставшийся палец не рисует
        if (!touches.current.size) drag.current = null;
        return;
      }
    }
    if (dragPointer.current && dragPointer.current.id !== e.pointerId) return; // не тот указатель
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = stateRef.current;
    switch (d.kind) {
      case "move": {
        const dx = Math.round(toDoc(e).x - d.start.x);
        const dy = Math.round(toDoc(e).y - d.start.y);
        setTransient(null);
        if (dx || dy) commit(updateLayer(s, d.layer.id, { x: d.layer.x + dx, y: d.layer.y + dy }), "Перемещение");
        return;
      }
      case "marquee": {
        const r = normRect(d.start, d.cur);
        setOverlayTick((t) => t + 1);
        if (r.w < 2 || r.h < 2) {
          if (d.mode === "new" && s.selection) commit({ ...s, selection: null }, "Снять выделение");
          return;
        }
        const m = shapeMask(s.width, s.height, { kind: tool === "ellipse" ? "ellipse" : "rect", ...r }, options.antialias);
        commit({ ...s, selection: combine(s.selection, m, d.mode) }, tool === "ellipse" ? "Овальное выделение" : "Прямоугольное выделение");
        return;
      }
      case "lasso": {
        setOverlayTick((t) => t + 1);
        if (d.points.length < 3) return;
        const m = shapeMask(s.width, s.height, { kind: "poly", points: d.points }, options.antialias);
        commit({ ...s, selection: combine(s.selection, m, d.mode) }, "Лассо");
        return;
      }
      case "stroke":
        endStroke();
        return;
      case "gradient": {
        const next = renderGradient(d);
        setTransient(null);
        commit(next, "Градиент");
        return;
      }
      case "shape": {
        setTransient(null);
        if (Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y) < 2) return;
        renderShape(d, e.shiftKey);
        // Фигура — на отдельном слое, обрезанном по содержимому
        commit(addLayer(s, makeLayer(d.canvas, newLayerName(s, "Фигура"))), "Фигура");
        return;
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const r = canvasRef.current!.getBoundingClientRect();
      zoomAt(viewRef.current.zoom * Math.pow(1.0015, -e.deltaY), { x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      const v = viewRef.current;
      setView({ ...v, panX: v.panX - (e.shiftKey ? e.deltaY : e.deltaX), panY: v.panY - (e.shiftKey ? 0 : e.deltaY) });
    }
  };

  // Колёсико с Ctrl — без масштабирования всей страницы браузера
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  // Поле ввода текста поверх холста
  const editLayer = textEdit ? (transient ?? state).layers.find((l) => l.id === textEdit.layerId) : null;
  const textBox = editLayer && editLayer.text ? toScreen({ x: editLayer.x, y: editLayer.y }) : null;

  const cursor = spaceDown || tool === "hand" ? (drag.current?.kind === "pan" ? "grabbing" : "grab") : CURSORS[tool] ?? "default";

  return (
    <div className="ie-viewport" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="ie-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null;
          requestDraw();
          onCursor(null);
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {textEdit && editLayer?.text && textBox && (
        <textarea
          ref={textAreaRef}
          className="ie-text-input"
          value={editLayer.text.text}
          placeholder="Введите текст"
          style={{
            left: textBox.x,
            top: textBox.y,
            font: `${editLayer.text.italic ? "italic " : ""}${editLayer.text.bold ? 700 : 400} ${editLayer.text.size * view.zoom}px ${editLayer.text.font}`,
            color: editLayer.text.color,
            textAlign: editLayer.text.align,
            lineHeight: editLayer.text.lineHeight,
            minWidth: Math.max(80, editLayer.canvas.width * view.zoom),
            minHeight: editLayer.text.size * view.zoom * 1.4,
          }}
          onChange={(e) => {
            const s = transient ?? state;
            const t = { ...editLayer.text!, text: e.target.value };
            setTransient(updateLayer(s, editLayer.id, { text: t, canvas: renderText(t), name: e.target.value.split("\n")[0].slice(0, 30) || "Текст" }));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              finishText();
            }
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
});

export default Viewport;

const CURSORS: Partial<Record<ToolId, string>> = {
  move: "move",
  marquee: "crosshair",
  ellipse: "crosshair",
  lasso: "crosshair",
  wand: "crosshair",
  crop: "crosshair",
  brush: "none",
  eraser: "none",
  stamp: "none",
  fill: "cell",
  gradient: "crosshair",
  shape: "crosshair",
  text: "text",
  eyedropper: "crosshair",
  zoom: "zoom-in",
};

function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function cropHandles(r: Rect) {
  return [
    { id: "nw", x: r.x, y: r.y },
    { id: "n", x: r.x + r.w / 2, y: r.y },
    { id: "ne", x: r.x + r.w, y: r.y },
    { id: "e", x: r.x + r.w, y: r.y + r.h / 2 },
    { id: "se", x: r.x + r.w, y: r.y + r.h },
    { id: "s", x: r.x + r.w / 2, y: r.y + r.h },
    { id: "sw", x: r.x, y: r.y + r.h },
    { id: "w", x: r.x, y: r.y + r.h / 2 },
  ];
}

function hitCrop(r: Rect, p: Pt, zoom: number): string | null {
  const tol = 8 / zoom;
  for (const h of cropHandles(r)) if (Math.abs(h.x - p.x) < tol && Math.abs(h.y - p.y) < tol) return h.id;
  if (p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h) return "move";
  return null;
}

function dragCrop(d: Extract<Drag, { kind: "crop" }>, p: Pt, s: DocState, ratioId: string): Rect {
  const r = { ...d.rect };
  const dx = p.x - d.start.x;
  const dy = p.y - d.start.y;
  const ratio = ratioId === "original" ? s.width / s.height : RATIOS[ratioId];
  if (d.handle === "new") {
    const w = p.x - d.start.x;
    let h = p.y - d.start.y;
    if (ratio) h = (Math.sign(h || 1) * Math.abs(w)) / ratio;
    return normRect(d.start, { x: d.start.x + w, y: d.start.y + h });
  }
  if (d.handle === "move") return { ...r, x: r.x + dx, y: r.y + dy };
  if (d.handle.includes("w")) {
    r.x += dx;
    r.w -= dx;
  }
  if (d.handle.includes("e")) r.w += dx;
  if (d.handle.includes("n")) {
    r.y += dy;
    r.h -= dy;
  }
  if (d.handle.includes("s")) r.h += dy;
  if (ratio) {
    const h = r.w / ratio;
    if (d.handle.includes("n")) r.y += r.h - h;
    r.h = h;
  }
  if (r.w < 0) {
    r.x += r.w;
    r.w = -r.w;
  }
  if (r.h < 0) {
    r.y += r.h;
    r.h = -r.h;
  }
  return { ...r, w: Math.max(1, r.w), h: Math.max(1, r.h) };
}

// ── Трансформирование: геометрия рамки ──

function xformCorners(t: Xform): Pt[] {
  const w = (t.orig.canvas.width * t.sx) / 2;
  const h = (t.orig.canvas.height * t.sy) / 2;
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x, y]) => ({ x: t.cx + x * cos - y * sin, y: t.cy + x * sin + y * cos }));
}

function xformHandles(t: Xform, zoom: number): (Pt & { id: string })[] {
  const c = xformCorners(t);
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const top = mid(c[0], c[1]);
  const len = 28 / zoom; // ручка поворота — на 28 экранных пикселей выше рамки
  const ang = t.angle - Math.PI / 2;
  return [
    { id: "nw", ...c[0] },
    { id: "ne", ...c[1] },
    { id: "se", ...c[2] },
    { id: "sw", ...c[3] },
    { id: "n", ...top },
    { id: "e", ...mid(c[1], c[2]) },
    { id: "s", ...mid(c[2], c[3]) },
    { id: "w", ...mid(c[3], c[0]) },
    { id: "rot", x: top.x + Math.cos(ang) * len, y: top.y + Math.sin(ang) * len },
  ];
}

function hitXform(t: Xform, p: Pt, zoom: number): string | null {
  const tol = 9 / zoom;
  for (const h of xformHandles(t, zoom)) if (Math.hypot(h.x - p.x, h.y - p.y) < tol) return h.id;
  // Снаружи рамки у углов — поворот
  const c = xformCorners(t);
  for (const k of c) if (Math.hypot(k.x - p.x, k.y - p.y) < tol * 3) return "rot";
  return null;
}

function dragXform(d: Extract<Drag, { kind: "xform" }>, p: Pt, shift: boolean): Xform {
  const t0 = d.x0;
  const t = { ...t0 };
  if (d.handle === "move") {
    t.cx = t0.cx + p.x - d.start.x;
    t.cy = t0.cy + p.y - d.start.y;
    return t;
  }
  if (d.handle === "rot") {
    const a0 = Math.atan2(d.start.y - t0.cy, d.start.x - t0.cx);
    const a1 = Math.atan2(p.y - t0.cy, p.x - t0.cx);
    let a = t0.angle + a1 - a0;
    if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    t.angle = a;
    return t;
  }
  // Масштаб: переводим указатель в систему координат слоя
  const cos = Math.cos(-t0.angle);
  const sin = Math.sin(-t0.angle);
  const lx = (p.x - t0.cx) * cos - (p.y - t0.cy) * sin;
  const ly = (p.x - t0.cx) * sin + (p.y - t0.cy) * cos;
  const W = t0.orig.canvas.width / 2;
  const H = t0.orig.canvas.height / 2;
  const corner = d.handle.length === 2;
  let sx = t0.sx;
  let sy = t0.sy;
  if (d.handle.includes("e") || d.handle.includes("w")) sx = Math.abs(lx) / W || 0.01;
  if (d.handle.includes("n") || d.handle.includes("s")) sy = Math.abs(ly) / H || 0.01;
  // Углы — пропорционально (Shift — свободно)
  if (corner && !shift) {
    const k = Math.max(sx / t0.sx, sy / t0.sy);
    sx = t0.sx * k;
    sy = t0.sy * k;
  }
  t.sx = Math.max(0.01, sx);
  t.sy = Math.max(0.01, sy);
  return t;
}
