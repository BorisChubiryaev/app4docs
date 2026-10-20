import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { saveAs } from "file-saver";
import PageShell from "../../components/PageShell";
import type { DocState, Layer, ToolId, ToolOptions } from "./core/types";
import { DEFAULT_OPTIONS } from "./core/types";
import { alphaBounds, canvasFromImageData, cloneCanvas, createCanvas, ctx2d, getImageData, loadImageFile } from "./core/canvas";
import {
  activeLayer,
  addEmptyLayer,
  addLayer,
  canvasSize,
  composite,
  cropDoc,
  docFromCanvas,
  duplicateLayer,
  expandToDoc,
  flatten,
  layerPixels,
  makeLayer,
  mergeDown,
  newDocument,
  rasterize,
  removeLayer,
  resizeDoc,
  rotateDoc,
  transformCanvas,
  updateLayer,
} from "./core/doc";
import { initHistory, push, redo as hRedo, replace as hReplace, undo as hUndo, jump as hJump, type History } from "./core/history";
import { bounds, feather, growShrink, invert, selectAll } from "./core/selection";
import { applyFilter, FILTERS, type FilterDef } from "./core/filters";
import { colorMask, type BgOptions } from "./core/bgremove";
import { aiLoaded, aiMask, ensureAi } from "./core/aiSegment";
import { baseName, exportImage, OPEN_ACCEPT, openAsCanvas, openAsDocument, savePsd, saveProject } from "./core/io";
import Viewport, { type ViewportHandle } from "./components/Viewport";
import LayersPanel from "./components/LayersPanel";
import {
  BgRemoveDialog,
  CanvasSizeDialog,
  ExportDialog,
  FilterDialog,
  ImageSizeDialog,
  NewDocDialog,
  NumberDialog,
  type ExportKind,
} from "./components/Dialogs";
import { Ico, type EditorIcon } from "./components/icons";
import "./ImageEditor.css";

// ── Инструменты ──

const TOOLS: { id: ToolId; icon: EditorIcon; label: string; key: string }[] = [
  { id: "move", icon: "move", label: "Перемещение", key: "V" },
  { id: "marquee", icon: "marquee", label: "Прямоугольное выделение", key: "M" },
  { id: "ellipse", icon: "ellipse", label: "Овальное выделение", key: "Shift+M" },
  { id: "lasso", icon: "lasso", label: "Лассо", key: "L" },
  { id: "wand", icon: "wand", label: "Волшебная палочка", key: "W" },
  { id: "crop", icon: "crop", label: "Кадрирование", key: "C" },
  { id: "brush", icon: "brush", label: "Кисть", key: "B" },
  { id: "eraser", icon: "eraser", label: "Ластик", key: "E" },
  { id: "stamp", icon: "stamp", label: "Штамп (Alt+клик — источник)", key: "S" },
  { id: "fill", icon: "fill", label: "Заливка", key: "G" },
  { id: "gradient", icon: "gradient", label: "Градиент", key: "Shift+G" },
  { id: "shape", icon: "shape", label: "Фигуры", key: "U" },
  { id: "text", icon: "text", label: "Текст", key: "T" },
  { id: "eyedropper", icon: "eyedropper", label: "Пипетка (Alt — в фоновый цвет)", key: "I" },
  { id: "hand", icon: "hand", label: "Рука (или зажмите Пробел)", key: "H" },
  { id: "zoom", icon: "zoom", label: "Масштаб (Alt — уменьшить)", key: "Z" },
];

const TOOL_KEYS: Record<string, ToolId> = {
  KeyV: "move",
  KeyM: "marquee",
  KeyL: "lasso",
  KeyW: "wand",
  KeyC: "crop",
  KeyB: "brush",
  KeyE: "eraser",
  KeyS: "stamp",
  KeyG: "fill",
  KeyU: "shape",
  KeyT: "text",
  KeyI: "eyedropper",
  KeyH: "hand",
  KeyZ: "zoom",
};

const FONTS = [
  ["Inter, Arial, sans-serif", "Inter"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["'Times New Roman', Times, serif", "Times New Roman"],
  ["Georgia, serif", "Georgia"],
  ["'Courier New', monospace", "Courier New"],
  ["Verdana, sans-serif", "Verdana"],
  ["Tahoma, sans-serif", "Tahoma"],
  ["Impact, 'Arial Black', sans-serif", "Impact"],
];

type Dialog =
  | { kind: "new" }
  | { kind: "imageSize" }
  | { kind: "canvasSize" }
  | { kind: "export" }
  | { kind: "filter"; def: FilterDef; values: Record<string, number>; previewOn: boolean }
  | { kind: "bg"; opts: BgOptions; mask: HTMLCanvasElement | null }
  | { kind: "number"; title: string; label: string; initial: number; min: number; max: number; apply: (v: number) => void };

interface MenuItem {
  label?: string;
  key?: string;
  action?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Выделение в координатах слоя. */
function selForLayer(s: DocState, l: Layer): HTMLCanvasElement | null {
  if (!s.selection) return null;
  const c = createCanvas(l.canvas.width, l.canvas.height);
  ctx2d(c).drawImage(s.selection, -l.x, -l.y);
  return c;
}

/** result поверх base, но только там, где выделение (без выделения — целиком). */
function throughSelection(base: HTMLCanvasElement, result: HTMLCanvasElement, sel: HTMLCanvasElement | null): HTMLCanvasElement {
  if (!sel) return result;
  const masked = cloneCanvas(result);
  const m = ctx2d(masked);
  m.globalCompositeOperation = "destination-in";
  m.drawImage(sel, 0, 0);
  const out = cloneCanvas(base);
  const o = ctx2d(out);
  // Внутри выделения старые пиксели заменяются новыми (с учётом мягкого края)
  const hole = cloneCanvas(sel);
  o.globalCompositeOperation = "destination-out";
  o.drawImage(hole, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.drawImage(masked, 0, 0);
  return out;
}

function demoDocument(): DocState {
  const w = 1600;
  const h = 1000;
  const bg = createCanvas(w, h);
  const ctx = ctx2d(bg);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#1f4e8c");
  g.addColorStop(1, "#7f3fbf");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 120, 0, Math.PI * 2);
    ctx.fill();
  }
  const s = docFromCanvas(bg, "Фон");
  const obj = createCanvas(520, 520);
  const o = ctx2d(obj);
  const rg = o.createRadialGradient(200, 180, 30, 260, 260, 260);
  rg.addColorStop(0, "#ffd36b");
  rg.addColorStop(1, "#eb6834");
  o.fillStyle = rg;
  o.beginPath();
  o.arc(260, 260, 250, 0, Math.PI * 2);
  o.fill();
  return addLayer(s, makeLayer(obj, "Шар", { x: 540, y: 240 }));
}

const ImageEditor = () => {
  const [hist, setHist] = useState<History | null>(null);
  const [draft, setDraft] = useState<DocState | null>(null);
  const [docName, setDocName] = useState("Без названия");
  const [tool, setToolState] = useState<ToolId>("brush");
  const [opts, setOpts] = useState<ToolOptions>(DEFAULT_OPTIONS);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<DocState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [bgStatus, setBgStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState({ crop: false, transform: false, text: false });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"layers" | "history">("layers");
  const [dragOver, setDragOver] = useState(false);
  const vp = useRef<ViewportHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const clip = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);

  const state = draft ?? hist?.present.state ?? null;
  const stateRef = useRef(state);
  stateRef.current = state;
  const layer = state ? activeLayer(state) : undefined;

  const notify = useCallback((m: string) => setToast(m), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const commit = useCallback((s: DocState, label: string) => {
    setDraft(null);
    setHist((h) => (h ? push(h, s, label) : initHistory(s, label)));
  }, []);
  const select = useCallback((s: DocState) => {
    setDraft(null);
    setHist((h) => (h ? hReplace(h, s) : h));
  }, []);
  const undo = useCallback(() => {
    setDraft(null);
    setHist((h) => (h ? hUndo(h) : h));
  }, []);
  const redo = useCallback(() => {
    setDraft(null);
    setHist((h) => (h ? hRedo(h) : h));
  }, []);

  const setTool = useCallback(
    (t: ToolId) => {
      if (mode.text) vp.current?.finishText();
      setToolState(t);
    },
    [mode.text],
  );

  // Предупреждение о несохранённой работе
  useEffect(() => {
    if (!hist || !hist.past.length) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [hist]);

  // ── Открытие ──
  const openDoc = useCallback(async (file: File) => {
    setBusy("Открываем файл…");
    try {
      const s = await openAsDocument(file);
      setHist(initHistory(s, "Открытие"));
      setDraft(null);
      setDocName(baseName(file.name));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось открыть файл.");
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const placeCanvas = useCallback(
    (c: HTMLCanvasElement, name: string) => {
      const s = stateRef.current;
      if (!s) {
        setHist(initHistory(docFromCanvas(c, name), "Вставка"));
        setDocName(name);
        return;
      }
      // Крупнее холста — вписываем, как «Поместить» в Photoshop
      const k = Math.min(1, s.width / c.width, s.height / c.height);
      let src = c;
      if (k < 1) {
        src = createCanvas(Math.round(c.width * k), Math.round(c.height * k));
        const ctx = ctx2d(src);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(c, 0, 0, src.width, src.height);
      }
      const l = makeLayer(src, name, { x: Math.round((s.width - src.width) / 2), y: Math.round((s.height - src.height) / 2) });
      commit(addLayer(s, l), "Поместить изображение");
      setToolState("move");
    },
    [commit],
  );

  const placeFile = useCallback(
    async (file: File) => {
      setBusy("Добавляем изображение…");
      try {
        placeCanvas(await openAsCanvas(file), baseName(file.name));
      } catch (e) {
        notify(e instanceof Error ? e.message : "Не удалось прочитать файл.");
      } finally {
        setBusy(null);
      }
    },
    [placeCanvas, notify],
  );

  // Вставка картинки из системного буфера (Ctrl+V из браузера, скриншот)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (!f) return;
      e.preventDefault();
      placeCanvas(await loadImageFile(f), "Вставленное изображение");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [placeCanvas]);

  // ── Действия над документом ──
  const act = useCallback(
    (fn: (s: DocState) => DocState | null, label: string) => {
      const s = stateRef.current;
      if (!s) return;
      const next = fn(s);
      if (next && next !== s) commit(next, label);
    },
    [commit],
  );

  const requireLayer = (s: DocState, allowLocked = false): Layer | null => {
    const l = activeLayer(s);
    if (!l) return null;
    if (l.locked && !allowLocked) {
      notify("Слой закреплён — снимите замок в панели слоёв.");
      return null;
    }
    return l;
  };

  const clearSelection = () =>
    act((s) => {
      if (!s.selection) return null;
      const l0 = requireLayer(s);
      if (!l0) return null;
      const l = expandToDoc(s, rasterize(l0));
      const sel = selForLayer(s, l)!;
      if (s.editMask && l.mask) {
        const m = cloneCanvas(l.mask);
        const c = ctx2d(m);
        c.globalCompositeOperation = "destination-out";
        c.drawImage(sel, 0, 0);
        return updateLayer(s, l.id, { mask: m });
      }
      const out = cloneCanvas(l.canvas);
      const c = ctx2d(out);
      c.globalCompositeOperation = "destination-out";
      c.drawImage(sel, 0, 0);
      return updateLayer(s, l.id, { ...l, canvas: out });
    }, "Очистить");

  const fillSelection = (color: string) =>
    act((s) => {
      const l0 = requireLayer(s);
      if (!l0) return null;
      const l = expandToDoc(s, rasterize(l0));
      const f = createCanvas(l.canvas.width, l.canvas.height);
      const c = ctx2d(f);
      c.fillStyle = color;
      c.fillRect(0, 0, f.width, f.height);
      return updateLayer(s, l.id, { ...l, canvas: throughSelection(l.canvas, f, selForLayer(s, l)) });
    }, "Заливка выделения");

  const copy = (cut: boolean) => {
    const s = stateRef.current;
    if (!s) return;
    const l = activeLayer(s);
    if (!l) return;
    const px = layerPixels(l);
    let piece = px;
    let x = l.x;
    let y = l.y;
    if (s.selection) {
      const sel = selForLayer(s, l)!;
      const masked = cloneCanvas(px);
      const m = ctx2d(masked);
      m.globalCompositeOperation = "destination-in";
      m.drawImage(sel, 0, 0);
      const b = alphaBounds(masked);
      if (!b) return notify("В выделении на этом слое ничего нет.");
      piece = createCanvas(b.w, b.h);
      ctx2d(piece).drawImage(masked, -b.x, -b.y);
      x = l.x + b.x;
      y = l.y + b.y;
    }
    clip.current = { canvas: piece, x, y };
    // И в системный буфер — чтобы вставить в другие программы
    piece.toBlob((blob) => {
      if (blob && navigator.clipboard && typeof ClipboardItem !== "undefined")
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => undefined);
    });
    if (cut) clearSelection();
    notify(cut ? "Вырезано — Ctrl+V вставит новым слоем." : "Скопировано — Ctrl+V вставит новым слоем.");
  };

  const pasteInternal = () => {
    const c = clip.current;
    const s = stateRef.current;
    if (!c || !s) return false;
    commit(addLayer(s, makeLayer(cloneCanvas(c.canvas), "Вставленный слой", { x: c.x, y: c.y })), "Вставить");
    setToolState("move");
    return true;
  };

  const layerViaCopy = () => {
    const s = stateRef.current;
    if (!s) return;
    if (!s.selection) return act((st) => duplicateLayer(st, st.activeId), "Дублировать слой");
    const l = activeLayer(s);
    if (!l) return;
    const masked = cloneCanvas(layerPixels(l));
    const m = ctx2d(masked);
    m.globalCompositeOperation = "destination-in";
    m.drawImage(selForLayer(s, l)!, 0, 0);
    const b = alphaBounds(masked);
    if (!b) return notify("В выделении на этом слое ничего нет.");
    const piece = createCanvas(b.w, b.h);
    ctx2d(piece).drawImage(masked, -b.x, -b.y);
    commit({ ...addLayer(s, makeLayer(piece, `${l.name} — фрагмент`, { x: l.x + b.x, y: l.y + b.y })), selection: null }, "Скопировать на новый слой");
  };

  const addMask = () =>
    act((s) => {
      const l = activeLayer(s);
      if (!l || l.mask) return null;
      const mask = createCanvas(l.canvas.width, l.canvas.height);
      const c = ctx2d(mask);
      if (s.selection) c.drawImage(s.selection, -l.x, -l.y);
      else {
        c.fillStyle = "#fff";
        c.fillRect(0, 0, mask.width, mask.height);
      }
      return { ...updateLayer(s, l.id, { mask, maskEnabled: true }), selection: null, editMask: true };
    }, "Добавить маску");

  const applyMask = () =>
    act((s) => {
      const l = activeLayer(s);
      if (!l?.mask) return null;
      return { ...updateLayer(s, l.id, { canvas: cloneCanvas(layerPixels(l)), mask: null, kind: "raster", text: undefined }), editMask: false };
    }, "Применить маску");

  const deleteMask = () =>
    act((s) => {
      const l = activeLayer(s);
      if (!l?.mask) return null;
      return { ...updateLayer(s, l.id, { mask: null }), editMask: false };
    }, "Удалить маску");

  const transformActiveLayer = (deg: 0 | 90 | 180 | 270, fh: boolean, fv: boolean, label: string) =>
    act((s) => {
      const l = requireLayer(s);
      if (!l) return null;
      const canvas = transformCanvas(l.canvas, deg, fh, fv);
      const mask = l.mask ? transformCanvas(l.mask, deg, fh, fv) : null;
      const cx = l.x + l.canvas.width / 2;
      const cy = l.y + l.canvas.height / 2;
      return updateLayer(s, l.id, {
        canvas,
        mask,
        x: Math.round(cx - canvas.width / 2),
        y: Math.round(cy - canvas.height / 2),
        kind: "raster",
        text: undefined,
      });
    }, label);

  // ── Фильтры ──
  const filterResult = useCallback((s: DocState, def: FilterDef, values: Record<string, number>): DocState | null => {
    const l0 = activeLayer(s);
    if (!l0) return null;
    const l = rasterize(l0);
    const out = canvasFromImageData(applyFilter(getImageData(l.canvas), def.id, values));
    return updateLayer(s, l.id, { canvas: throughSelection(l.canvas, out, selForLayer(s, l)), kind: "raster", text: undefined });
  }, []);

  const openFilter = (def: FilterDef) => {
    const s = stateRef.current;
    if (!s || !requireLayer(s)) return;
    setDialog({ kind: "filter", def, values: Object.fromEntries(def.params.map((p) => [p.key, p.value])), previewOn: true });
  };

  // Живой предпросмотр фильтра (с задержкой, чтобы ползунок не тормозил)
  const filterDialog = dialog?.kind === "filter" ? dialog : null;
  useEffect(() => {
    if (!filterDialog || !state) return;
    if (!filterDialog.previewOn) {
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    const t = setTimeout(() => {
      setPreview(filterResult(state, filterDialog.def, filterDialog.values));
      setPreviewBusy(false);
    }, 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDialog?.values, filterDialog?.previewOn, filterDialog?.def]);

  const closeDialog = () => {
    setDialog(null);
    setPreview(null);
    setPreviewBusy(false);
  };

  // ── Удаление фона ──
  const runBgRemoval = async () => {
    const s = stateRef.current;
    if (!s || dialog?.kind !== "bg") return;
    const l = activeLayer(s);
    if (!l) return;
    const o = dialog.opts;
    setPreviewBusy(true);
    try {
      let mask: HTMLCanvasElement;
      if (o.mode === "ai") {
        if (!aiLoaded()) {
          const mb = (b: number) => (b / 1048576).toFixed(0);
          setBgStatus("Загружаем нейросеть…");
          await ensureAi((loaded, total) => setBgStatus(`Загружаем нейросеть: ${mb(loaded)} из ${mb(total)} МБ (только в первый раз)`));
        }
        setBgStatus("Ищем объект…");
        mask = await aiMask(l.canvas, o);
      } else {
        setBgStatus("Ищем фон…");
        // Даём интерфейсу показать статус, затем считаем
        await new Promise((r) => setTimeout(r, 30));
        mask = colorMask(l.canvas, o);
      }
      setDialog((d) => (d?.kind === "bg" ? { ...d, mask } : d));
      setPreview(updateLayer(s, l.id, { mask, maskEnabled: true }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось найти объект.";
      notify(o.mode === "ai" ? `${msg} Попробуйте режим «Однотонный фон».` : msg);
    } finally {
      setPreviewBusy(false);
      setBgStatus(null);
    }
  };

  // ── Экспорт ──
  const doExport = async (o: { kind: ExportKind; name: string; quality: number; scale: number; background: string }) => {
    const s = stateRef.current;
    if (!s) return;
    setBusy("Сохраняем…");
    try {
      let blob: Blob;
      let ext: string = o.kind;
      if (o.kind === "psd") blob = await savePsd(s);
      else if (o.kind === "cvxproj") blob = await saveProject(s);
      else {
        blob = await exportImage(s, o.kind, o.quality, o.scale, o.background);
        ext = o.kind === "jpeg" ? "jpg" : o.kind;
      }
      saveAs(blob, `${o.name}.${ext}`);
      setDocName(o.name);
      closeDialog();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось сохранить.");
    } finally {
      setBusy(null);
    }
  };

  const quickSaveProject = async () => {
    const s = stateRef.current;
    if (!s) return;
    setBusy("Сохраняем проект…");
    try {
      saveAs(await saveProject(s), `${docName}.cvxproj`);
      notify("Проект сохранён — откройте его здесь же, чтобы продолжить.");
    } finally {
      setBusy(null);
    }
  };

  // ── Горячие клавиши ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || dialog) return;
      const s = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (mod) {
        const handled = (() => {
          if (code === "KeyZ" && !e.shiftKey) return undo(), true;
          if ((code === "KeyZ" && e.shiftKey) || code === "KeyY") return redo(), true;
          if (code === "KeyO") return fileRef.current?.click(), true;
          if (code === "KeyN" && e.altKey) return setDialog({ kind: "new" }), true;
          if (!s) return false;
          if (code === "KeyS" && e.shiftKey) return setDialog({ kind: "export" }), true;
          if (code === "KeyS") return quickSaveProject(), true;
          if (code === "KeyA") return commit({ ...s, selection: selectAll(s.width, s.height) }, "Выделить всё"), true;
          if (code === "KeyD") return s.selection && commit({ ...s, selection: null }, "Снять выделение"), true;
          if (code === "KeyI" && e.shiftKey) return commit({ ...s, selection: invert(s.selection, s.width, s.height) }, "Инвертировать выделение"), true;
          if (code === "KeyC") return copy(false), true;
          if (code === "KeyX") return copy(true), true;
          if (code === "KeyV") return pasteInternal();
          if (code === "KeyJ") return layerViaCopy(), true;
          if (code === "KeyT" && e.altKey) return vp.current?.startTransform(), true;
          if (code === "KeyE" && !e.shiftKey) return act((st) => mergeDown(st, st.activeId), "Слить с нижним"), true;
          if (code === "KeyE" && e.shiftKey) return act(flatten, "Свести"), true;
          if (code === "KeyN" && e.shiftKey) return act(addEmptyLayer, "Новый слой"), true;
          if (code === "Digit0") return vp.current?.fit(), true;
          if (code === "Digit1") return vp.current?.zoomTo(1), true;
          if (code === "Equal" || code === "NumpadAdd") return vp.current?.zoomBy(1.25), true;
          if (code === "Minus" || code === "NumpadSubtract") return vp.current?.zoomBy(0.8), true;
          return false;
        })();
        if (handled) e.preventDefault();
        return;
      }
      if (!s) return;
      if (code === "Delete" || code === "Backspace") {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (code === "BracketLeft") return setOpts((o) => ({ ...o, size: Math.max(1, Math.round(o.size / 1.2)) }));
      if (code === "BracketRight") return setOpts((o) => ({ ...o, size: Math.min(1000, Math.round(o.size * 1.2 + 1)) }));
      if (code === "KeyX") {
        setFg(bg);
        setBg(fg);
        return;
      }
      if (code === "KeyD") {
        setFg("#000000");
        setBg("#ffffff");
        return;
      }
      if (e.altKey) return;
      if (code === "KeyM" && e.shiftKey) return setTool("ellipse");
      if (code === "KeyG" && e.shiftKey) return setTool("gradient");
      const t = TOOL_KEYS[code];
      if (t && !e.shiftKey) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Меню ──
  const s = state;
  const hasSel = !!s?.selection;
  const menus: [string, MenuItem[]][] = [
    [
      "Файл",
      [
        { label: "Новый…", key: "Ctrl+Alt+N", action: () => setDialog({ kind: "new" }) },
        { label: "Открыть…", key: "Ctrl+O", action: () => fileRef.current?.click() },
        { label: "Поместить изображение как слой…", action: () => placeRef.current?.click(), disabled: !s },
        { sep: true },
        { label: "Сохранить проект (.cvxproj)", key: "Ctrl+S", action: quickSaveProject, disabled: !s },
        { label: "Сохранить как / экспорт…", key: "Ctrl+Shift+S", action: () => setDialog({ kind: "export" }), disabled: !s },
        { sep: true },
        {
          label: "Закрыть документ",
          action: () => {
            if (hist?.past.length && !window.confirm("Закрыть без сохранения?")) return;
            setHist(null);
            setDraft(null);
          },
          disabled: !s,
        },
      ],
    ],
    [
      "Правка",
      [
        { label: `Отменить${hist?.present && hist.past.length ? ` «${hist.present.label}»` : ""}`, key: "Ctrl+Z", action: undo, disabled: !hist?.past.length },
        { label: "Повторить", key: "Ctrl+Shift+Z", action: redo, disabled: !hist?.future.length },
        { sep: true },
        { label: "Вырезать", key: "Ctrl+X", action: () => copy(true), disabled: !s },
        { label: "Копировать", key: "Ctrl+C", action: () => copy(false), disabled: !s },
        { label: "Вставить", key: "Ctrl+V", action: () => pasteInternal() || notify("Буфер пуст. Скопируйте фрагмент или картинку."), disabled: !s },
        { label: "Очистить выделенное", key: "Delete", action: clearSelection, disabled: !hasSel },
        { sep: true },
        { label: "Залить основным цветом", action: () => fillSelection(fg), disabled: !s },
        { label: "Залить фоновым цветом", action: () => fillSelection(bg), disabled: !s },
        { sep: true },
        { label: "Свободное трансформирование", key: "Ctrl+Alt+T", action: () => vp.current?.startTransform(), disabled: !s },
      ],
    ],
    [
      "Изображение",
      [
        { label: "Размер изображения…", action: () => setDialog({ kind: "imageSize" }), disabled: !s },
        { label: "Размер холста…", action: () => setDialog({ kind: "canvasSize" }), disabled: !s },
        { sep: true },
        { label: "Повернуть на 90° по часовой", action: () => act((st) => rotateDoc(st, 90), "Поворот 90°"), disabled: !s },
        { label: "Повернуть на 90° против часовой", action: () => act((st) => rotateDoc(st, 270), "Поворот −90°"), disabled: !s },
        { label: "Повернуть на 180°", action: () => act((st) => rotateDoc(st, 180), "Поворот 180°"), disabled: !s },
        { label: "Отразить по горизонтали", action: () => act((st) => rotateDoc(st, 0, true), "Отражение"), disabled: !s },
        { label: "Отразить по вертикали", action: () => act((st) => rotateDoc(st, 0, false, true), "Отражение"), disabled: !s },
        { sep: true },
        {
          label: "Кадрировать по выделению",
          action: () => act((st) => (st.selection ? cropDoc(st, bounds(st.selection)!) : null), "Кадрировать по выделению"),
          disabled: !hasSel,
        },
        {
          label: "Обрезать прозрачные края",
          action: () =>
            act((st) => {
              const b = alphaBounds(composite(st));
              return b ? cropDoc(st, b) : null;
            }, "Обрезка краёв"),
          disabled: !s,
        },
        { label: "Свести слои", key: "Ctrl+Shift+E", action: () => act(flatten, "Свести"), disabled: !s || s.layers.length < 2 },
      ],
    ],
    [
      "Слой",
      [
        { label: "Новый слой", key: "Ctrl+Shift+N", action: () => act(addEmptyLayer, "Новый слой"), disabled: !s },
        { label: "Дублировать / скопировать выделенное", key: "Ctrl+J", action: layerViaCopy, disabled: !s },
        { label: "Удалить слой", action: () => act((st) => removeLayer(st, st.activeId), "Удалить слой"), disabled: !s || s.layers.length < 2 },
        { label: "Слить с нижним", key: "Ctrl+E", action: () => act((st) => mergeDown(st, st.activeId), "Слить с нижним"), disabled: !s },
        { sep: true },
        { label: "✨ Удалить фон…", action: () => s && requireLayer(s) && setDialog({ kind: "bg", opts: { mode: "ai", tolerance: 35, feather: 0.5, cleanup: true }, mask: null }), disabled: !s },
        { sep: true },
        { label: "Добавить маску (из выделения)", action: addMask, disabled: !s || !!layer?.mask },
        { label: "Применить маску", action: applyMask, disabled: !layer?.mask },
        { label: "Удалить маску", action: deleteMask, disabled: !layer?.mask },
        { label: "Выделение по маске", action: () => act((st) => {
          const l = activeLayer(st);
          if (!l?.mask) return null;
          const sel = createCanvas(st.width, st.height);
          ctx2d(sel).drawImage(l.mask, l.x, l.y);
          return { ...st, selection: sel };
        }, "Выделение по маске"), disabled: !layer?.mask },
        { sep: true },
        { label: "Повернуть слой на 90°", action: () => transformActiveLayer(90, false, false, "Поворот слоя"), disabled: !s },
        { label: "Отразить слой по горизонтали", action: () => transformActiveLayer(0, true, false, "Отражение слоя"), disabled: !s },
        { label: "Отразить слой по вертикали", action: () => transformActiveLayer(0, false, true, "Отражение слоя"), disabled: !s },
        { label: "Растрировать текст", action: () => act((st) => {
          const l = activeLayer(st);
          return l?.kind === "text" ? updateLayer(st, l.id, rasterize(l)) : null;
        }, "Растрировать"), disabled: layer?.kind !== "text" },
      ],
    ],
    [
      "Выделение",
      [
        { label: "Всё", key: "Ctrl+A", action: () => act((st) => ({ ...st, selection: selectAll(st.width, st.height) }), "Выделить всё"), disabled: !s },
        { label: "Снять выделение", key: "Ctrl+D", action: () => act((st) => (st.selection ? { ...st, selection: null } : null), "Снять выделение"), disabled: !hasSel },
        { label: "Инвертировать", key: "Ctrl+Shift+I", action: () => act((st) => ({ ...st, selection: invert(st.selection, st.width, st.height) }), "Инвертировать выделение"), disabled: !hasSel },
        { sep: true },
        {
          label: "Выделить содержимое слоя",
          action: () =>
            act((st) => {
              const l = activeLayer(st);
              if (!l) return null;
              const sel = createCanvas(st.width, st.height);
              ctx2d(sel).drawImage(layerPixels(l), l.x, l.y);
              return { ...st, selection: sel };
            }, "Выделить содержимое слоя"),
          disabled: !s,
        },
        { sep: true },
        {
          label: "Растушевать…",
          action: () =>
            setDialog({ kind: "number", title: "Растушевка выделения", label: "Радиус, пкс", initial: 8, min: 0.5, max: 200, apply: (v) => act((st) => (st.selection ? { ...st, selection: feather(st.selection, v) } : null), "Растушевка") }),
          disabled: !hasSel,
        },
        {
          label: "Расширить…",
          action: () =>
            setDialog({ kind: "number", title: "Расширить выделение", label: "На сколько пикселей", initial: 5, min: 1, max: 200, apply: (v) => act((st) => (st.selection ? { ...st, selection: growShrink(st.selection, Math.round(v)) } : null), "Расширить выделение") }),
          disabled: !hasSel,
        },
        {
          label: "Сжать…",
          action: () =>
            setDialog({ kind: "number", title: "Сжать выделение", label: "На сколько пикселей", initial: 5, min: 1, max: 200, apply: (v) => act((st) => (st.selection ? { ...st, selection: growShrink(st.selection, -Math.round(v)) } : null), "Сжать выделение") }),
          disabled: !hasSel,
        },
      ],
    ],
    ["Коррекция", FILTERS.filter((f) => f.group === "correct").map((f) => ({ label: f.params.length ? `${f.title}…` : f.title, action: () => openFilter(f), disabled: !s }))],
    ["Фильтры", FILTERS.filter((f) => f.group === "filter").map((f) => ({ label: `${f.title}…`, action: () => openFilter(f), disabled: !s }))],
    [
      "Просмотр",
      [
        { label: "Увеличить", key: "Ctrl +", action: () => vp.current?.zoomBy(1.25), disabled: !s },
        { label: "Уменьшить", key: "Ctrl −", action: () => vp.current?.zoomBy(0.8), disabled: !s },
        { label: "Показать целиком", key: "Ctrl+0", action: () => vp.current?.fit(), disabled: !s },
        { label: "Реальный размер (100 %)", key: "Ctrl+1", action: () => vp.current?.zoomTo(1), disabled: !s },
      ],
    ],
  ];

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest(".ie-menubar") && setOpenMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [openMenu]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (stateRef.current && !/\.(cvxproj|psd)$/i.test(f.name)) placeFile(f);
    else openDoc(f);
  };

  const fileInputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={OPEN_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openDoc(f);
          e.target.value = "";
        }}
      />
      <input
        ref={placeRef}
        type="file"
        accept={OPEN_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) placeFile(f);
          e.target.value = "";
        }}
      />
    </>
  );

  // ── Стартовый экран ──
  if (!s || !hist) {
    return (
      <PageShell title="Графический редактор" subtitle="Слои, маски, выделения, коррекция и удаление фона — прямо в браузере" width="100%">
        {fileInputs}
        <div
          className={`ie-start ${dragOver ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="ie-start-card">
            <div className="ie-start-icon">
              <Ico name="image" size={44} />
            </div>
            <h2>Откройте изображение или создайте новое</h2>
            <p>Перетащите файл сюда или вставьте картинку из буфера (Ctrl+V)</p>
            <div className="ie-start-actions">
              <button className="ie-btn ie-btn--primary ie-btn--lg" onClick={() => fileRef.current?.click()}>
                <Ico name="folder" /> Открыть файл
              </button>
              <button className="ie-btn ie-btn--lg" onClick={() => setDialog({ kind: "new" })}>
                <Ico name="plus" /> Новый документ
              </button>
              <button
                className="ie-btn ie-btn--lg"
                onClick={() => {
                  setHist(initHistory(demoDocument(), "Пример"));
                  setDocName("Пример");
                }}
              >
                <Ico name="sparkles" /> Пример
              </button>
            </div>
            <p className="ie-start-formats">PNG, JPEG, WebP, GIF, BMP, SVG, PDF, PSD (со слоями), проект .cvxproj</p>
            <ul className="ie-start-features">
              <li>Слои с режимами наложения, непрозрачностью и масками</li>
              <li>Удаление фона, волшебная палочка, лассо, растушёвка</li>
              <li>Кисть, ластик, штамп, градиент, фигуры, текст</li>
              <li>Коррекция: уровни, экспозиция, тон и насыщенность, резкость, размытие</li>
              <li>Сохранение в PNG/JPEG/WebP, PSD со слоями и проект</li>
              <li>Всё работает офлайн — файлы не покидают компьютер</li>
            </ul>
          </div>
        </div>
        {dialog?.kind === "new" && (
          <NewDocDialog
            onClose={() => setDialog(null)}
            onCreate={(w, h, b) => {
              setHist(initHistory(newDocument(w, h, b), "Новый документ"));
              setDocName("Без названия");
              setDialog(null);
            }}
          />
        )}
        {busy && <div className="ie-busy">{busy}</div>}
        {toast && <div className="ie-toast">{toast}</div>}
      </PageShell>
    );
  }

  const targetText = layer ? `${layer.name}${s.editMask ? " · маска" : ""}${s.selection ? " · в выделении" : ""}` : "";

  return (
    <PageShell title="Графический редактор" subtitle={`${docName} · ${s.width} × ${s.height} пкс`} fill width="100%">
      {fileInputs}
      <div className="ie-app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {/* Меню */}
        <nav className="ie-menubar">
          {menus.map(([name, items]) => (
            <div key={name} className="ie-menu">
              <button
                className={`ie-menu-btn ${openMenu === name ? "is-open" : ""}`}
                onClick={() => setOpenMenu(openMenu === name ? null : name)}
                onMouseEnter={() => openMenu && setOpenMenu(name)}
              >
                {name}
              </button>
              {openMenu === name && (
                <div className="ie-menu-list" role="menu">
                  {items.map((it, i) =>
                    it.sep ? (
                      <div key={i} className="ie-menu-sep" />
                    ) : (
                      <button
                        key={i}
                        role="menuitem"
                        className="ie-menu-item"
                        disabled={it.disabled}
                        onClick={() => {
                          setOpenMenu(null);
                          it.action?.();
                        }}
                      >
                        <span>{it.label}</span>
                        {it.key && <kbd>{it.key}</kbd>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="ie-menubar-spacer" />
          <button className="ie-icon-btn" onClick={undo} disabled={!hist.past.length} title="Отменить (Ctrl+Z)" aria-label="Отменить">
            <Ico name="undo" />
          </button>
          <button className="ie-icon-btn" onClick={redo} disabled={!hist.future.length} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить">
            <Ico name="redo" />
          </button>
          <button className="ie-btn ie-btn--primary ie-btn--sm" onClick={() => setDialog({ kind: "export" })}>
            <Ico name="download" size={16} /> Сохранить
          </button>
        </nav>

        {/* Параметры инструмента */}
        <OptionsBar
          tool={tool}
          opts={opts}
          setOpts={setOpts}
          mode={mode}
          vp={vp}
          editMask={s.editMask}
          hasSel={hasSel}
          onDeselect={() => act((st) => ({ ...st, selection: null }), "Снять выделение")}
          onBgRemove={() => requireLayer(s) && setDialog({ kind: "bg", opts: { mode: "ai", tolerance: 35, feather: 0.5, cleanup: true }, mask: null })}
        />

        <div className="ie-main">
          {/* Инструменты */}
          <aside className="ie-toolbox" aria-label="Инструменты">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`ie-tool ${tool === t.id ? "is-active" : ""}`}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                <Ico name={t.icon} size={20} />
              </button>
            ))}
            <div className="ie-colors">
              <label className="ie-swatch ie-swatch--fg" style={{ background: fg }} title="Основной цвет">
                <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
              </label>
              <label className="ie-swatch ie-swatch--bg" style={{ background: bg }} title="Фоновый цвет">
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
              </label>
              <button
                className="ie-swap"
                onClick={() => {
                  setFg(bg);
                  setBg(fg);
                }}
                title="Поменять цвета (X)"
                aria-label="Поменять цвета"
              >
                <Ico name="swap" size={12} />
              </button>
            </div>
          </aside>

          {/* Холст */}
          <div className="ie-stage">
            <Viewport
              ref={vp}
              state={s}
              preview={preview}
              tool={tool}
              options={opts}
              fg={fg}
              bg={bg}
              setFg={setFg}
              setBg={setBg}
              commit={commit}
              onCursor={setCursor}
              onZoom={setZoom}
              onModeChange={setMode}
              notify={notify}
            />
          </div>

          {/* Панели */}
          <aside className="ie-side">
            <div className="ie-tabs">
              <button className={panelTab === "layers" ? "is-active" : ""} onClick={() => setPanelTab("layers")}>
                Слои
              </button>
              <button className={panelTab === "history" ? "is-active" : ""} onClick={() => setPanelTab("history")}>
                История
              </button>
            </div>
            {panelTab === "layers" ? (
              <LayersPanel
                state={s}
                live={setDraft}
                select={select}
                commit={commit}
                onAddLayer={() => act(addEmptyLayer, "Новый слой")}
                onDuplicate={() => act((st) => duplicateLayer(st, st.activeId), "Дублировать слой")}
                onDelete={() => act((st) => removeLayer(st, st.activeId), "Удалить слой")}
                onMergeDown={() => act((st) => mergeDown(st, st.activeId), "Слить с нижним")}
                onAddMask={addMask}
              />
            ) : (
              <HistoryPanel hist={hist} onJump={(i) => setHist((h) => (h ? hJump(h, i) : h))} />
            )}
          </aside>
        </div>

        <footer className="ie-status">
          <span>{Math.round(zoom * 100)}%</span>
          <span>
            {s.width} × {s.height} пкс
          </span>
          {cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < s.width && cursor.y < s.height && (
            <span>
              X {cursor.x} · Y {cursor.y}
            </span>
          )}
          <span className="ie-status-target" title="Куда применяются действия">
            {targetText}
          </span>
          <span className="ie-status-hint">{TOOL_HINTS[tool]}</span>
        </footer>
      </div>

      {dialog?.kind === "new" && (
        <NewDocDialog
          onClose={closeDialog}
          onCreate={(w, h, b) => {
            setHist(initHistory(newDocument(w, h, b), "Новый документ"));
            setDocName("Без названия");
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "imageSize" && (
        <ImageSizeDialog w0={s.width} h0={s.height} onClose={closeDialog} onApply={(w, h) => (act((st) => resizeDoc(st, w, h), "Размер изображения"), closeDialog())} />
      )}
      {dialog?.kind === "canvasSize" && (
        <CanvasSizeDialog w0={s.width} h0={s.height} onClose={closeDialog} onApply={(w, h, ax, ay) => (act((st) => canvasSize(st, w, h, ax, ay), "Размер холста"), closeDialog())} />
      )}
      {dialog?.kind === "export" && <ExportDialog name0={docName} w={s.width} h={s.height} busy={!!busy} onClose={closeDialog} onExport={doExport} />}
      {dialog?.kind === "filter" && (
        <FilterDialog
          def={dialog.def}
          values={dialog.values}
          setValues={(values) => setDialog({ ...dialog, values })}
          previewOn={dialog.previewOn}
          setPreviewOn={(previewOn) => setDialog({ ...dialog, previewOn })}
          busy={previewBusy}
          target={targetText}
          onClose={closeDialog}
          onApply={() => {
            const r = filterResult(s, dialog.def, dialog.values);
            if (r) commit(r, dialog.def.title);
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "bg" && (
        <BgRemoveDialog
          opts={dialog.opts}
          setOpts={(o) => setDialog({ ...dialog, opts: o })}
          busy={previewBusy}
          status={bgStatus}
          hasResult={!!dialog.mask}
          onPreview={runBgRemoval}
          onClose={closeDialog}
          onApplyMask={() => {
            if (preview) commit({ ...preview, editMask: false }, "Удаление фона");
            closeDialog();
            notify("Фон убран маской. Доработать край: кликните миниатюру маски и рисуйте кистью (вернуть) или ластиком (убрать).");
          }}
          onSelect={() => {
            const l = activeLayer(s);
            if (!l || dialog.kind !== "bg" || !dialog.mask) return;
            const sel = createCanvas(s.width, s.height);
            ctx2d(sel).drawImage(dialog.mask, l.x, l.y);
            commit({ ...s, selection: sel }, "Выделить объект");
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "number" && (
        <NumberDialog
          title={dialog.title}
          label={dialog.label}
          initial={dialog.initial}
          min={dialog.min}
          max={dialog.max}
          onClose={closeDialog}
          onApply={(v) => {
            dialog.apply(v);
            closeDialog();
          }}
        />
      )}
      {busy && <div className="ie-busy">{busy}</div>}
      {toast && <div className="ie-toast">{toast}</div>}
    </PageShell>
  );
};

export default ImageEditor;

const TOOL_HINTS: Record<ToolId, string> = {
  move: "Тяните слой. Ctrl+Alt+T — свободное трансформирование",
  marquee: "Shift — добавить или квадрат, Alt — вычесть",
  ellipse: "Shift — добавить или круг, Alt — вычесть",
  lasso: "Обведите область. Shift — добавить, Alt — вычесть",
  wand: "Клик по цвету. Shift — добавить, Alt — вычесть",
  crop: "Тяните рамку или её углы. Enter — применить, Esc — отмена",
  brush: "[ и ] — размер. Чтобы рисовать по маске — кликните её миниатюру в слоях",
  eraser: "[ и ] — размер. По маске — скрывает часть слоя",
  stamp: "Alt+клик — откуда копировать, затем рисуйте",
  fill: "Клик заливает похожие по цвету пиксели",
  gradient: "Протяните линию: от основного цвета к фоновому",
  shape: "Фигура рисуется на новом слое. Shift — ровные пропорции",
  text: "Клик — новый текст, клик по тексту — правка. Ctrl+Enter — готово",
  eyedropper: "Клик — основной цвет, Alt+клик — фоновый",
  hand: "Тяните, чтобы двигать холст. Колесо — прокрутка, Ctrl+колесо — масштаб",
  zoom: "Клик — приблизить, Alt+клик — отдалить",
};

function HistoryPanel({ hist, onJump }: { hist: History; onJump: (i: number) => void }) {
  const all = [...hist.past, hist.present, ...hist.future];
  const cur = hist.past.length;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }, [cur]);
  return (
    <section className="ie-panel">
      <header className="ie-panel-head">История · {all.length} шагов</header>
      <ol className="ie-history" ref={listRef}>
        {all.map((e, i) => (
          <li key={i}>
            <button className={`${i === cur ? "is-current" : ""} ${i > cur ? "is-future" : ""}`} onClick={() => onJump(i)}>
              {e.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="ie-panel-note">Клик по шагу — вернуться к нему. Хранится до 60 шагов.</p>
    </section>
  );
}

function OptionsBar({
  tool,
  opts,
  setOpts,
  mode,
  vp,
  editMask,
  hasSel,
  onDeselect,
  onBgRemove,
}: {
  tool: ToolId;
  opts: ToolOptions;
  setOpts: (f: (o: ToolOptions) => ToolOptions) => void;
  mode: { crop: boolean; transform: boolean; text: boolean };
  vp: React.RefObject<ViewportHandle | null>;
  editMask: boolean;
  hasSel: boolean;
  onDeselect: () => void;
  onBgRemove: () => void;
}) {
  const set = <K extends keyof ToolOptions>(k: K, v: ToolOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const num = (k: "size" | "tolerance" | "shapeStroke" | "fontSize", label: string, min: number, max: number, unit = "") => (
    <label className="ie-opt">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={opts[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <input type="number" className="ie-num" min={min} max={max} value={opts[k]} onChange={(e) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
      {unit}
    </label>
  );
  const pct = (k: "hardness" | "opacity", label: string) => (
    <label className="ie-opt">
      <span>{label}</span>
      <input type="range" min={0} max={100} value={Math.round(opts[k] * 100)} onChange={(e) => set(k, Number(e.target.value) / 100)} />
      <b>{Math.round(opts[k] * 100)}%</b>
    </label>
  );
  const selectModes = (
    <div className="ie-seg" role="radiogroup" aria-label="Режим выделения">
      {(
        [
          ["new", "Новое"],
          ["add", "Добавить"],
          ["subtract", "Вычесть"],
          ["intersect", "Пересечь"],
        ] as const
      ).map(([v, l]) => (
        <button key={v} className={opts.selectMode === v ? "is-active" : ""} onClick={() => set("selectMode", v)}>
          {l}
        </button>
      ))}
    </div>
  );
  const check = (k: "contiguous" | "sampleAll" | "antialias" | "shapeFill" | "bold" | "italic", label: string) => (
    <label className="ie-check">
      <input type="checkbox" checked={opts[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
    </label>
  );

  let content: ReactNode = null;
  if (mode.transform)
    content = (
      <>
        <span className="ie-opt-title">Трансформирование: тяните углы (Shift — свободно), ручку сверху — поворот</span>
        <button className="ie-btn ie-btn--primary ie-btn--sm" onClick={() => vp.current?.applyTransform()}>
          <Ico name="check" size={16} /> Применить (Enter)
        </button>
        <button className="ie-btn ie-btn--sm" onClick={() => vp.current?.cancelTransform()}>
          Отмена (Esc)
        </button>
      </>
    );
  else
    switch (tool) {
      case "move":
        content = (
          <>
            <button className="ie-btn ie-btn--sm" onClick={() => vp.current?.startTransform()}>
              Свободное трансформирование
            </button>
            <button className="ie-btn ie-btn--sm" onClick={onBgRemove}>
              <Ico name="sparkles" size={16} /> Удалить фон
            </button>
          </>
        );
        break;
      case "marquee":
      case "ellipse":
      case "lasso":
        content = (
          <>
            {selectModes}
            {check("antialias", "Сглаживание")}
          </>
        );
        break;
      case "wand":
        content = (
          <>
            {selectModes}
            {num("tolerance", "Допуск", 0, 255)}
            {check("contiguous", "Смежные")}
            {check("sampleAll", "По всем слоям")}
            {check("antialias", "Сглаживание")}
          </>
        );
        break;
      case "crop":
        content = (
          <>
            <label className="ie-opt">
              <span>Пропорции</span>
              <select className="ie-select" value={opts.cropRatio} onChange={(e) => set("cropRatio", e.target.value as ToolOptions["cropRatio"])}>
                <option value="free">Свободно</option>
                <option value="original">Как у изображения</option>
                <option value="1:1">1 : 1</option>
                <option value="4:3">4 : 3</option>
                <option value="3:2">3 : 2</option>
                <option value="16:9">16 : 9</option>
              </select>
            </label>
            <button className="ie-btn ie-btn--primary ie-btn--sm" onClick={() => vp.current?.applyCrop()}>
              <Ico name="check" size={16} /> Кадрировать (Enter)
            </button>
            <button className="ie-btn ie-btn--sm" onClick={() => vp.current?.cancelCrop()}>
              Сбросить
            </button>
          </>
        );
        break;
      case "brush":
      case "eraser":
      case "stamp":
        content = (
          <>
            {num("size", "Размер", 1, 1000, "пкс")}
            {pct("hardness", "Жёсткость")}
            {pct("opacity", "Непрозрачность")}
            {editMask && (
              <span className="ie-opt-note">
                Рисуете по маске: {tool === "eraser" ? "ластик скрывает" : "кисть возвращает"} пиксели слоя
              </span>
            )}
            {tool === "stamp" && <span className="ie-opt-note">Alt+клик — точка, откуда копировать</span>}
          </>
        );
        break;
      case "fill":
        content = (
          <>
            {num("tolerance", "Допуск", 0, 255)}
            {pct("opacity", "Непрозрачность")}
            {check("contiguous", "Смежные")}
            {check("sampleAll", "По всем слоям")}
          </>
        );
        break;
      case "gradient":
        content = (
          <>
            <div className="ie-seg">
              <button className={opts.gradient === "linear" ? "is-active" : ""} onClick={() => set("gradient", "linear")}>
                Линейный
              </button>
              <button className={opts.gradient === "radial" ? "is-active" : ""} onClick={() => set("gradient", "radial")}>
                Радиальный
              </button>
            </div>
            {pct("opacity", "Непрозрачность")}
          </>
        );
        break;
      case "shape":
        content = (
          <>
            <div className="ie-seg">
              {(
                [
                  ["rect", "Прямоугольник"],
                  ["ellipse", "Эллипс"],
                  ["line", "Линия"],
                  ["arrow", "Стрелка"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={opts.shape === v ? "is-active" : ""} onClick={() => set("shape", v)}>
                  {l}
                </button>
              ))}
            </div>
            {(opts.shape === "rect" || opts.shape === "ellipse") && check("shapeFill", "Заливка")}
            {num("shapeStroke", "Толщина", 1, 100, "пкс")}
          </>
        );
        break;
      case "text":
        content = (
          <>
            <label className="ie-opt">
              <span>Шрифт</span>
              <select className="ie-select" value={opts.font} onChange={(e) => set("font", e.target.value)}>
                {FONTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {num("fontSize", "Кегль", 6, 500, "пкс")}
            {check("bold", "Жирный")}
            {check("italic", "Курсив")}
            <div className="ie-seg">
              {(
                [
                  ["left", "Слева"],
                  ["center", "Центр"],
                  ["right", "Справа"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={opts.align === v ? "is-active" : ""} onClick={() => set("align", v)}>
                  {l}
                </button>
              ))}
            </div>
            {mode.text && (
              <button className="ie-btn ie-btn--primary ie-btn--sm" onClick={() => vp.current?.finishText()}>
                <Ico name="check" size={16} /> Готово
              </button>
            )}
          </>
        );
        break;
      case "hand":
      case "zoom":
        content = (
          <>
            <button className="ie-btn ie-btn--sm" onClick={() => vp.current?.fit()}>
              <Ico name="fit" size={16} /> Целиком
            </button>
            <button className="ie-btn ie-btn--sm" onClick={() => vp.current?.zoomTo(1)}>
              100%
            </button>
          </>
        );
        break;
      default:
        content = <span className="ie-opt-note">{TOOL_HINTS[tool]}</span>;
    }

  return (
    <div className="ie-options">
      <span className="ie-opt-tool">{TOOLS.find((t) => t.id === tool)?.label}</span>
      {content}
      {hasSel && !mode.transform && (
        <button className="ie-btn ie-btn--sm ie-opt-right" onClick={onDeselect} title="Ctrl+D">
          Снять выделение
        </button>
      )}
    </div>
  );
}
