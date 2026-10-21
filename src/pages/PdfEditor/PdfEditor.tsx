// src/pages/PdfEditor/PdfEditor.tsx — PDF Studio
import React, { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import { compressPdfImages } from "./compressImages";
import PageShell from "../../components/PageShell";
import { PdfEditorInstructions } from "./components/PdfEditorInstructions";
import PageAnnotator, { type Annotation } from "./components/PageAnnotator";
import PageView, { type ThumbInfo } from "./components/PageView";
import { readFormFields, type FormField } from "./core/forms";
import {
  pageKey,
  type BuildOptions,
  type Crop,
  type FormValue,
  type PageItem,
  type SourceFile,
  type TextWord,
} from "./core/types";
import { pdfWorkerUrl } from "../../utils/pdfWorker";

import "./PdfEditor.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();

type OutputDocument = {
  id: string;
  name: string;
  pages: PageItem[];
};

type Snapshot = { items: PageItem[]; docs: OutputDocument[] };

type DragPayload =
  | { type: "grid-page"; ids: string[] }
  | { type: "bin-page"; docId: string; id: string };

type FileForms = { fileId: number; fileName: string; fields: FormField[] };

const generateId = () => `page_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const BLANK_NAME = "Пустая страница";
const THUMB_STORE = "pdfstudio.thumbSize";
const THUMB_PX = 440; // ширина растровой миниатюры

const baseName = (n: string) => n.replace(/\.pdf$/i, "").trim() || "документ";
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "документ";

/** «1-3,5,8-10» по номерам позиций. */
const compactRanges = (nums: number[]) => {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j;
  }
  return parts.join(",");
};

/** Разбор диапазонов «1-3, 5, 8-10» (номера с 1). */
export const parseRanges = (text: string, max: number): number[][] | string => {
  const groups: number[][] = [];
  for (const raw of text.split(/[;,]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)\s*(?:[-–—]\s*(\d+|конец|end)?)?$/i);
    if (!m) return `Не понимаю «${part}». Пример: 1-3, 5, 8-10`;
    const a = Number(m[1]);
    const b = m[2] === undefined ? (part.match(/[-–—]/) ? max : a) : /^\d+$/.test(m[2]) ? Number(m[2]) : max;
    if (a < 1 || b < 1 || a > max || b > max) return `Диапазон «${part}» вне 1–${max}`;
    const g: number[] = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) g.push(i);
    groups.push(a <= b ? g : g.reverse());
  }
  return groups.length ? groups : "Укажите хотя бы одну страницу";
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(2)} МБ`;
};

const readStoredThumb = () => {
  try {
    const v = Number(localStorage.getItem(THUMB_STORE));
    return v >= 110 && v <= 360 ? v : 180;
  } catch {
    return 180;
  }
};

const PdfEditor: React.FC = () => {
  // ─── Источники ───────────────────────────────────────────────────
  const filesRef = useRef<SourceFile[]>([]);
  const [formsByFile, setFormsByFile] = useState<FileForms[]>([]);
  const [formValues, setFormValues] = useState<Record<number, Record<string, FormValue>>>({});

  // ─── Страницы, документы, история ────────────────────────────────
  const [pageItems, setPageItems] = useState<PageItem[]>([]);
  const [outputDocuments, setOutputDocuments] = useState<OutputDocument[]>([]);
  const pageItemsRef = useRef<PageItem[]>([]);
  const outputDocsRef = useRef<OutputDocument[]>([]);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const coalesceKey = useRef<string | null>(null);
  const [, setHistoryTick] = useState(0);
  const docCounterRef = useRef(1);

  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [binDragOverKey, setBinDragOverKey] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileDragDepth = useRef(0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);

  // ─── Миниатюры (лениво, только видимые) ──────────────────────────
  const [thumbs, setThumbs] = useState<Record<string, ThumbInfo>>({});
  const thumbsRef = useRef<Record<string, ThumbInfo>>({});
  const thumbQueue = useRef<string[]>([]);
  const thumbInflight = useRef(new Set<string>());
  // Видимые сейчас элементы-миниатюры по ключу страницы
  const visible = useRef(new Map<string, Set<Element>>());
  const slots = useRef(new Map<string, { key: string; el: HTMLElement | null; cb: (el: HTMLElement | null) => void }>());
  const [thumbSize, setThumbSize] = useState(readStoredThumb);
  const [jumpValue, setJumpValue] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  // ─── Просмотр и редактор ─────────────────────────────────────────
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  const [highResPreviewUrl, setHighResPreviewUrl] = useState<string>("");
  const [editing, setEditing] = useState<{ item: PageItem; bg: string } | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  // ─── Распознавание ───────────────────────────────────────────────
  const ocrRef = useRef(new Map<string, TextWord[]>());
  const [ocrKeys, setOcrKeys] = useState<Set<string>>(new Set());
  const [ocrJob, setOcrJob] = useState<{
    done: number;
    total: number;
    stage: string;
    fraction: number;
    result?: string;
  } | null>(null);
  const ocrCancel = useRef(false);

  // ─── Модальные окна ──────────────────────────────────────────────
  const [showCompress, setShowCompress] = useState(false);
  const [compressQuality, setCompressQuality] = useState(0.7);
  const [compressMode, setCompressMode] = useState<"images" | "raster">("images");
  const [compressResult, setCompressResult] = useState<{
    originalSize: number;
    compressedSize: number;
    ratio: number;
    url: string;
    fileName: string;
    mode: "images" | "raster";
    images?: { total: number; recompressed: number };
  } | null>(null);

  const [showDecorate, setShowDecorate] = useState(false);
  const [pageNumbers, setPageNumbers] = useState({
    enabled: false,
    position: "bottom-center",
    format: "{n} / {total}",
    size: 11,
    color: "#555555",
  });
  const [watermark, setWatermark] = useState({
    enabled: false,
    text: "КОНФИДЕНЦИАЛЬНО",
    opacity: 0.15,
    size: 60,
    color: "#e5484d",
  });

  const [showSplit, setShowSplit] = useState(false);
  const [splitMode, setSplitMode] = useState<"every" | "ranges" | "files">("every");
  const [splitEvery, setSplitEvery] = useState(1);
  const [splitRanges, setSplitRanges] = useState("");
  const [splitReplace, setSplitReplace] = useState(true);
  const [splitError, setSplitError] = useState("");

  const [showPageSetup, setShowPageSetup] = useState(false);
  const [cropDraft, setCropDraft] = useState<Crop>({ top: 10, right: 10, bottom: 10, left: 10 });
  const [cropSame, setCropSame] = useState(true);
  const [cropOn, setCropOn] = useState(false);
  const [fitA4Draft, setFitA4Draft] = useState(false);

  const [showForms, setShowForms] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const files = () => filesRef.current;

  // ─── История: снимки страниц и документов ────────────────────────
  const commit = useCallback(
    (items: PageItem[], docs: OutputDocument[] = outputDocsRef.current, coalesce: string | null = null) => {
      if (!(coalesce && coalesce === coalesceKey.current)) {
        past.current.push({ items: pageItemsRef.current, docs: outputDocsRef.current });
        if (past.current.length > 200) past.current.shift();
        future.current = [];
      }
      coalesceKey.current = coalesce;
      pageItemsRef.current = items;
      outputDocsRef.current = docs;
      setPageItems(items);
      setOutputDocuments(docs);
      setHistoryTick((t) => t + 1);
    },
    [],
  );

  const restore = (snap: Snapshot) => {
    pageItemsRef.current = snap.items;
    outputDocsRef.current = snap.docs;
    setPageItems(snap.items);
    setOutputDocuments(snap.docs);
    const ids = new Set(snap.items.map((i) => i.id));
    setSelectedPages((prev) => new Set([...prev].filter((id) => ids.has(id))));
    coalesceKey.current = null;
    setHistoryTick((t) => t + 1);
  };

  const undo = () => {
    const snap = past.current.pop();
    if (!snap) return;
    future.current.push({ items: pageItemsRef.current, docs: outputDocsRef.current });
    restore(snap);
  };

  const redo = () => {
    const snap = future.current.pop();
    if (!snap) return;
    past.current.push({ items: pageItemsRef.current, docs: outputDocsRef.current });
    restore(snap);
  };

  const updateItems = (ids: Set<string>, patch: (it: PageItem) => PageItem) =>
    commit(pageItemsRef.current.map((it) => (ids.has(it.id) ? patch(it) : it)));

  // ─── Миниатюры ───────────────────────────────────────────────────
  const setThumb = (key: string, info: ThumbInfo | null) => {
    const next = { ...thumbsRef.current };
    if (info) next[key] = info;
    else delete next[key];
    thumbsRef.current = next;
    setThumbs(next);
  };

  const renderOptions = () => ({
    annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
  });

  const renderThumb = async (key: string) => {
    const [fileId, pageIndex] = key.split(":").map(Number);
    const src = files()[fileId];
    if (!src?.pdf) {
      setThumb(key, { url: "", w: 595, h: 842, failed: true });
      return;
    }
    try {
      const page = await src.pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(THUMB_PX / base.width, (THUMB_PX * 1.6) / base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, ...renderOptions() }).promise;
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error("toBlob");
      const old = thumbsRef.current[key];
      if (old?.url) URL.revokeObjectURL(old.url);
      setThumb(key, { url: URL.createObjectURL(blob), w: base.width, h: base.height });
    } catch (err) {
      console.warn("Миниатюра не построена:", err);
      setThumb(key, { url: "", w: 595, h: 842, failed: true });
    }
  };

  const pumpThumbs = () => {
    while (thumbInflight.current.size < 2 && thumbQueue.current.length) {
      const key = thumbQueue.current.pop()!;
      if (thumbsRef.current[key] || thumbInflight.current.has(key)) continue;
      thumbInflight.current.add(key);
      renderThumb(key).finally(() => {
        thumbInflight.current.delete(key);
        pumpThumbs();
      });
    }
  };

  const requestThumb = (key: string) => {
    if (thumbsRef.current[key] || thumbInflight.current.has(key)) return;
    thumbQueue.current = thumbQueue.current.filter((k) => k !== key);
    thumbQueue.current.push(key); // последние увиденные — первыми
    pumpThumbs();
  };

  const observer = useMemo(
    () =>
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                const key = (e.target as HTMLElement).dataset.thumbKey;
                if (!key) continue;
                if (e.isIntersecting && e.target.isConnected) {
                  if (!visible.current.has(key)) visible.current.set(key, new Set());
                  visible.current.get(key)!.add(e.target);
                  requestThumb(key);
                } else forgetVisible(key, e.target);
              }
            },
            { rootMargin: "300px 0px" },
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function forgetVisible(key: string, el: Element) {
    const set = visible.current.get(key);
    set?.delete(el);
    if (set && !set.size) {
      visible.current.delete(key);
      thumbQueue.current = thumbQueue.current.filter((k) => k !== key);
    }
  }

  /** Ref-колбэк для места под миниатюру; стабилен для пары (место, страница). */
  const observeThumb = (slot: string, key: string) => {
    const existing = slots.current.get(slot);
    if (existing && existing.key === key) return existing.cb;
    const entry = {
      key,
      el: null as HTMLElement | null,
      cb: (el: HTMLElement | null) => {
        if (entry.el && entry.el !== el) {
          observer?.unobserve(entry.el);
          forgetVisible(key, entry.el);
        }
        entry.el = el;
        if (!el) {
          slots.current.delete(slot);
          return;
        }
        el.dataset.thumbKey = key;
        if (observer) observer.observe(el);
        else requestThumb(key);
      },
    };
    slots.current.set(slot, entry);
    return entry.cb;
  };

  useEffect(() => () => observer?.disconnect(), [observer]);

  /** Перерисовать миниатюры файла (после заполнения формы). */
  const refreshThumbsOf = (fileId: number) => {
    for (const key of Object.keys(thumbsRef.current)) {
      if (key.startsWith(`${fileId}:`)) {
        if (thumbsRef.current[key].url) URL.revokeObjectURL(thumbsRef.current[key].url);
        setThumb(key, null);
      }
    }
    for (const key of visible.current.keys()) if (key.startsWith(`${fileId}:`)) requestThumb(key);
  };

  useEffect(() => {
    try {
      localStorage.setItem(THUMB_STORE, String(thumbSize));
    } catch {
      /* не критично */
    }
  }, [thumbSize]);

  useEffect(
    () => () => {
      filesRef.current.forEach((f) => f.pdf?.destroy?.());
      Object.values(thumbsRef.current).forEach((t) => t.url && URL.revokeObjectURL(t.url));
    },
    [],
  );

  // ─── Рендер в высоком разрешении (просмотр, фон редактора) ───────
  const renderHighRes = async (fileId: number, pageIndex: number): Promise<string> => {
    const src = files()[fileId];
    if (!src?.pdf) return "";
    try {
      const page = await src.pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1600 / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, ...renderOptions() }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.93);
      canvas.width = 0;
      canvas.height = 0;
      return url;
    } catch (err) {
      console.error("renderHighRes error:", err);
      return "";
    }
  };

  // ─── Загрузка файлов ─────────────────────────────────────────────
  const openPdf = async (data: ArrayBuffer, name: string): Promise<any> => {
    const task = pdfjs.getDocument({ data: data.slice(0), disableAutoFetch: true, verbosity: 0 });
    let asked = 0;
    task.onPassword = (update: (p: string) => void, reason: number) => {
      asked++;
      const msg =
        reason === 2 || asked > 1
          ? `Неверный пароль для «${name}». Попробуйте ещё раз:`
          : `Файл «${name}» защищён паролем. Введите пароль:`;
      const p = window.prompt(msg);
      if (p === null) task.destroy();
      else update(p);
    };
    return task.promise;
  };

  const registerFile = async (src: SourceFile) => {
    const fileId = filesRef.current.length;
    filesRef.current = [...filesRef.current, src];
    if (src.pdf) {
      const fields = await readFormFields(src.pdf, src.arrayBuffer);
      if (fields.length) setFormsByFile((prev) => [...prev, { fileId, fileName: src.fileName, fields }]);
    }
    return fileId;
  };

  const loadFiles = async (list: File[]) => {
    const pdfs = list.filter((f) => f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      if (list.length) alert("Можно добавить только PDF-файлы");
      return;
    }
    if (isLoadingFiles) return;
    setIsLoadingFiles(true);
    const added: PageItem[] = [];
    const failed: string[] = [];
    try {
      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setLoadingText(`${file.name}${pdfs.length > 1 ? ` (${i + 1} из ${pdfs.length})` : ""}`);
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await openPdf(arrayBuffer, file.name);
          const fileId = await registerFile({ fileName: file.name, arrayBuffer, pdf, pageCount: pdf.numPages });
          for (let p = 0; p < pdf.numPages; p++) {
            added.push({ id: generateId(), fileId, pageIndex: p, fileName: file.name, pageNumber: p + 1 });
          }
        } catch (err) {
          console.error(`Ошибка открытия ${file.name}:`, err);
          failed.push(file.name);
        }
      }
      if (added.length) commit([...pageItemsRef.current, ...added]);
      if (failed.length) alert(`Не удалось открыть: ${failed.join(", ")}`);
    } finally {
      setIsLoadingFiles(false);
      setLoadingText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    loadFiles(list);
  };

  // Файлы можно бросить в любое место страницы
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types || []).includes("Files");
  const onShellDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth.current++;
    setIsDraggingFile(true);
  };
  const onShellDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onShellDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (!fileDragDepth.current) setIsDraggingFile(false);
  };
  const onShellDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth.current = 0;
    setIsDraggingFile(false);
    loadFiles(Array.from(e.dataTransfer.files));
  };

  // Брошенный мимо файл не должен открываться вместо приложения
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // ─── Выделение ───────────────────────────────────────────────────
  const handlePageClick = (itemId: string, e: React.MouseEvent) => {
    const items = pageItemsRef.current;
    const currentIndex = items.findIndex((item) => item.id === itemId);
    if (e.shiftKey && lastClickedId) {
      const lastIndex = items.findIndex((item) => item.id === lastClickedId);
      if (lastIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const next = new Set(selectedPages);
        for (let i = start; i <= end; i++) next.add(items[i].id);
        setSelectedPages(next);
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedPages);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      setSelectedPages(next);
      setLastClickedId(itemId);
    } else if (selectedPages.has(itemId) && selectedPages.size === 1) {
      setSelectedPages(new Set());
      setLastClickedId(null);
    } else {
      setSelectedPages(new Set([itemId]));
      setLastClickedId(itemId);
    }
  };

  const selectedItems = () => pageItemsRef.current.filter((p) => selectedPages.has(p.id));

  // ─── Операции со страницами ──────────────────────────────────────
  const deletePages = (ids: Set<string>) => {
    if (!ids.size) return;
    commit(pageItemsRef.current.filter((it) => !ids.has(it.id)));
    setSelectedPages((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    setLastClickedId(null);
  };

  const rotatePages = (ids: string[], delta: number) => {
    if (!ids.length) return;
    updateItems(new Set(ids), (it) => ({ ...it, rotation: ((((it.rotation ?? 0) + delta) % 360) + 360) % 360 }));
  };

  const duplicatePages = (ids: Set<string>) => {
    if (!ids.size) return;
    const next: PageItem[] = [];
    const copies: string[] = [];
    for (const it of pageItemsRef.current) {
      next.push(it);
      if (ids.has(it.id)) {
        const copy = { ...it, id: generateId() };
        next.push(copy);
        copies.push(copy.id);
      }
    }
    commit(next);
    setSelectedPages(new Set(copies));
  };

  /** Пустая страница того же размера, что и соседняя, — после выделения. */
  const insertBlankPage = async () => {
    const items = pageItemsRef.current;
    const sel = items.map((it, i) => (selectedPages.has(it.id) ? i : -1)).filter((i) => i >= 0);
    const at = sel.length ? Math.max(...sel) + 1 : items.length;
    const ref = items[at - 1] ?? items[0];
    let w = 595.28;
    let h = 841.89;
    if (ref) {
      try {
        const vp = (await files()[ref.fileId].pdf.getPage(ref.pageIndex + 1)).getViewport({ scale: 1 });
        const side = ((ref.rotation ?? 0) / 90) % 2 === 1;
        w = side ? vp.height : vp.width;
        h = side ? vp.width : vp.height;
      } catch {
        /* A4 */
      }
    }
    const doc = await PDFDocument.create();
    doc.addPage([w, h]);
    const bytes = await doc.save();
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const pdf = await openPdf(arrayBuffer, BLANK_NAME);
    const fileId = await registerFile({ fileName: BLANK_NAME, arrayBuffer, pdf, pageCount: 1 });
    const blank: PageItem = { id: generateId(), fileId, pageIndex: 0, fileName: BLANK_NAME, pageNumber: 1 };
    commit([...items.slice(0, at), blank, ...items.slice(at)]);
    setSelectedPages(new Set([blank.id]));
    setLastClickedId(blank.id);
  };

  const openPageSetup = () => {
    const target = selectedItems().length ? selectedItems() : pageItemsRef.current;
    const withCrop = target.find((t) => t.crop);
    if (withCrop?.crop) {
      setCropDraft(withCrop.crop);
      const c = withCrop.crop;
      setCropSame(c.top === c.right && c.right === c.bottom && c.bottom === c.left);
    }
    setCropOn(!!withCrop);
    setFitA4Draft(target.length > 0 && target.every((t) => t.fitA4));
    setShowPageSetup(true);
  };

  const applyPageSetup = () => {
    const target = selectedPages.size ? selectedPages : new Set(pageItemsRef.current.map((p) => p.id));
    const crop = cropOn ? (cropSame ? { top: cropDraft.top, right: cropDraft.top, bottom: cropDraft.top, left: cropDraft.top } : cropDraft) : undefined;
    const valid = crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0) ? crop : undefined;
    updateItems(target, (it) => ({ ...it, crop: valid, fitA4: fitA4Draft || undefined }));
    setShowPageSetup(false);
  };

  // ─── Перетаскивание страниц в сетке ──────────────────────────────
  const handlePageDragStart = (e: React.DragEvent<HTMLDivElement>, itemId: string) => {
    const ids = selectedPages.has(itemId) && selectedPages.size > 1 ? Array.from(selectedPages) : [itemId];
    const payload: DragPayload = { type: "grid-page", ids };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const handlePageDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    if (hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const readPayload = (e: React.DragEvent): DragPayload | null => {
    try {
      return JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return null;
    }
  };

  const handlePageDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    if (hasFiles(e)) return;
    e.preventDefault();
    setDragOverIndex(null);
    const data = readPayload(e);
    if (!data || data.type !== "grid-page") return;
    const ids = new Set(data.ids);
    const prev = pageItemsRef.current;
    const targetItem = prev[targetIndex];
    const dragged = prev.filter((p) => ids.has(p.id));
    const remaining = prev.filter((p) => !ids.has(p.id));
    let insertAt = remaining.findIndex((p) => p.id === targetItem?.id);
    if (insertAt === -1) insertAt = remaining.length;
    const next = [...remaining.slice(0, insertAt), ...dragged, ...remaining.slice(insertAt)];
    if (next.some((p, i) => p !== prev[i])) commit(next);
  };

  // ─── Выходные документы ──────────────────────────────────────────
  const commitDocs = (docs: OutputDocument[], coalesce: string | null = null) =>
    commit(pageItemsRef.current, docs, coalesce);

  const copiesOf = (items: PageItem[]) => items.map((p) => ({ ...p, id: generateId() }));

  const createOutputDocument = (initialPages: PageItem[] = [], name?: string) => {
    const doc = { id: generateId(), name: name ?? `Документ ${docCounterRef.current}`, pages: initialPages };
    if (!name) docCounterRef.current += 1;
    commitDocs([...outputDocsRef.current, doc]);
  };

  const addSelectedToNewDocument = () => {
    const sel = selectedItems();
    if (sel.length) createOutputDocument(copiesOf(sel));
  };

  const addToDocument = (docId: string, items: PageItem[], at?: number) => {
    if (!items.length) return;
    commitDocs(
      outputDocsRef.current.map((doc) => {
        if (doc.id !== docId) return doc;
        const pages = [...doc.pages];
        pages.splice(at === undefined ? pages.length : Math.min(at, pages.length), 0, ...copiesOf(items));
        return { ...doc, pages };
      }),
    );
  };

  const removePageFromDocument = (docId: string, pageId: string) =>
    commitDocs(
      outputDocsRef.current.map((doc) => (doc.id === docId ? { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) } : doc)),
    );

  const removeOutputDocument = (docId: string) => commitDocs(outputDocsRef.current.filter((doc) => doc.id !== docId));

  const renameOutputDocument = (docId: string, name: string) =>
    commitDocs(
      outputDocsRef.current.map((doc) => (doc.id === docId ? { ...doc, name } : doc)),
      `rename:${docId}`,
    );

  const handleBinContainerDrop = (e: React.DragEvent<HTMLDivElement>, docId: string) => {
    e.preventDefault();
    setBinDragOverKey(null);
    const data = readPayload(e);
    if (!data || data.type !== "grid-page") return;
    const ids = new Set(data.ids);
    addToDocument(docId, pageItemsRef.current.filter((p) => ids.has(p.id)));
  };

  const handleBinPageDragStart = (e: React.DragEvent<HTMLDivElement>, docId: string, pageId: string) => {
    const payload: DragPayload = { type: "bin-page", docId, id: pageId };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleBinPageDrop = (e: React.DragEvent<HTMLDivElement>, docId: string, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setBinDragOverKey(null);
    const data = readPayload(e);
    if (!data) return;
    if (data.type === "bin-page" && data.docId === docId) {
      commitDocs(
        outputDocsRef.current.map((doc) => {
          if (doc.id !== docId) return doc;
          const pages = [...doc.pages];
          const from = pages.findIndex((p) => p.id === data.id);
          if (from === -1) return doc;
          const [moved] = pages.splice(from, 1);
          pages.splice(Math.min(targetIndex, pages.length), 0, moved);
          return { ...doc, pages };
        }),
      );
    } else if (data.type === "grid-page") {
      const ids = new Set(data.ids);
      addToDocument(docId, pageItemsRef.current.filter((p) => ids.has(p.id)), targetIndex);
    }
  };

  // ─── Разделение по правилу ───────────────────────────────────────
  const docBase = () => {
    const real = pageItemsRef.current.find((p) => p.fileName !== BLANK_NAME);
    return baseName(real?.fileName ?? "документ");
  };

  const runSplit = () => {
    const items = pageItemsRef.current;
    if (!items.length) return;
    const base = docBase();
    const made: OutputDocument[] = [];
    if (splitMode === "every") {
      const n = Math.max(1, Math.floor(splitEvery));
      for (let i = 0; i < items.length; i += n) {
        const part = items.slice(i, i + n);
        const label = part.length > 1 ? `${i + 1}-${i + part.length}` : `${i + 1}`;
        made.push({ id: generateId(), name: `${base}_стр_${label}`, pages: copiesOf(part) });
      }
    } else if (splitMode === "ranges") {
      const groups = parseRanges(splitRanges, items.length);
      if (typeof groups === "string") {
        setSplitError(groups);
        return;
      }
      for (const g of groups) {
        const label = g.length > 1 ? `${g[0]}-${g[g.length - 1]}` : `${g[0]}`;
        made.push({ id: generateId(), name: `${base}_стр_${label}`, pages: copiesOf(g.map((n) => items[n - 1])) });
      }
    } else {
      const byFile = new Map<number, PageItem[]>();
      for (const it of items) byFile.set(it.fileId, [...(byFile.get(it.fileId) ?? []), it]);
      for (const [, group] of byFile) made.push({ id: generateId(), name: baseName(group[0].fileName), pages: copiesOf(group) });
    }
    commitDocs(splitReplace ? made : [...outputDocsRef.current, ...made]);
    setSplitError("");
    setShowSplit(false);
    requestAnimationFrame(() => document.querySelector(".output-documents-section")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // ─── Сборка и скачивание ─────────────────────────────────────────
  const sourcesForBuild = (): SourceFile[] =>
    files().map((f, i) => ({ ...f, formValues: formValues[i] }));

  const build = async (items: PageItem[], extra: Partial<BuildOptions> = {}) => {
    const { buildPdf } = await import("./core/build");
    return buildPdf(items, {
      files: sourcesForBuild(),
      ocr: ocrRef.current,
      pageNumbers,
      watermark,
      ...extra,
    });
  };

  const triggerDownload = (bytes: Uint8Array | Blob, filename: string, type = "application/pdf") => {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Имя файла по содержимому: «договор.pdf», «договор_объединённый.pdf», «договор_стр_1-3.pdf». */
  const nameForItems = (items: PageItem[], selection = false) => {
    const real = items.filter((p) => p.fileName !== BLANK_NAME);
    const base = baseName(real[0]?.fileName ?? docBase());
    if (selection) {
      const pos = new Map(pageItemsRef.current.map((p, i) => [p.id, i + 1]));
      const r = compactRanges(items.map((p) => pos.get(p.id) ?? 0).filter(Boolean));
      return `${safeName(`${base}_стр_${r.length > 40 ? `${items.length}_стр` : r}`)}.pdf`;
    }
    const sources = new Set(real.map((p) => p.fileId));
    return `${safeName(sources.size > 1 ? `${base}_объединённый` : base)}.pdf`;
  };

  const runBusy = async <T,>(text: string, job: () => Promise<T>): Promise<T | undefined> => {
    setIsProcessing(true);
    setBusyText(text);
    try {
      return await job();
    } catch (err) {
      console.error(err);
      alert(`Не удалось: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      setIsProcessing(false);
      setBusyText("");
    }
  };

  const downloadItems = (items: PageItem[], filename: string) =>
    items.length ? runBusy("Собираем PDF…", async () => triggerDownload(await build(items), filename)) : undefined;

  const downloadMergedPdf = () => downloadItems(pageItemsRef.current, nameForItems(pageItemsRef.current));

  const downloadSelectedPdf = () => {
    const sel = selectedItems();
    downloadItems(sel, nameForItems(sel, true));
  };

  const downloadOutputDocument = (docId: string) => {
    const doc = outputDocsRef.current.find((d) => d.id === docId);
    if (doc?.pages.length) downloadItems(doc.pages, `${safeName(doc.name)}.pdf`);
  };

  const downloadAllDocumentsZip = () => {
    const docs = outputDocsRef.current.filter((d) => d.pages.length);
    if (!docs.length) return;
    runBusy("Собираем архив…", async () => {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (let i = 0; i < docs.length; i++) {
        setBusyText(`Собираем документ ${i + 1} из ${docs.length}…`);
        let name = `${safeName(docs[i].name)}.pdf`;
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${safeName(docs[i].name)} (${k}).pdf`;
        used.add(name.toLowerCase());
        zip.file(name, await build(docs[i].pages));
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      triggerDownload(blob, `${safeName(docBase())}_документы.zip`, "application/zip");
    });
  };

  // ─── Сжатие ──────────────────────────────────────────────────────
  const runCompress = async (items: PageItem[]) => {
    if (!items.length) return;
    if (compressResult) URL.revokeObjectURL(compressResult.url);
    setCompressResult(null);
    await runBusy("Сжимаем…", async () => {
      const originalBytes = await build(items);
      let compressedBytes: Uint8Array;
      let images: { total: number; recompressed: number } | undefined;
      if (compressMode === "images") {
        // Разрешение картинок: ~110 DPI на 30% … ~220 DPI на 95%.
        const maxDpi = Math.round(60 + compressQuality * 170);
        compressedBytes = await build(items, {
          transform: async (doc) => {
            images = await compressPdfImages(doc, { quality: compressQuality, maxDpi });
          },
        });
      } else {
        compressedBytes = await build(items, { raster: { quality: compressQuality } });
      }
      // Не отдаём файл больше исходного
      if (compressedBytes.byteLength >= originalBytes.byteLength) compressedBytes = originalBytes;
      const originalSize = originalBytes.byteLength;
      const compressedSize = compressedBytes.byteLength;
      const url = URL.createObjectURL(new Blob([compressedBytes as BlobPart], { type: "application/pdf" }));
      const name = nameForItems(items, items.length !== pageItemsRef.current.length).replace(/\.pdf$/, "");
      setCompressResult({
        originalSize,
        compressedSize,
        ratio: originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0,
        url,
        fileName: `${name}_сжатый.pdf`,
        mode: compressMode,
        images,
      });
    });
  };

  const closeCompress = () => {
    if (compressResult) URL.revokeObjectURL(compressResult.url);
    setCompressResult(null);
    setShowCompress(false);
  };

  // ─── Распознавание сканов ────────────────────────────────────────
  const runOcr = async () => {
    const target = selectedPages.size ? selectedItems() : pageItemsRef.current;
    const keys: { key: string; fileId: number; pageIndex: number }[] = [];
    const seen = new Set<string>();
    for (const it of target) {
      const key = pageKey(it.fileId, it.pageIndex);
      if (seen.has(key) || ocrRef.current.has(key) || it.fileName === BLANK_NAME) continue;
      seen.add(key);
      keys.push({ key, fileId: it.fileId, pageIndex: it.pageIndex });
    }
    ocrCancel.current = false;
    setOcrJob({ done: 0, total: keys.length, stage: "Ищем страницы без текста…", fraction: 0 });
    let recognized = 0;
    let withText = 0;
    let error = "";
    try {
      const { hasTextLayer, recognize } = await import("./core/ocr");
      for (let i = 0; i < keys.length; i++) {
        if (ocrCancel.current) break;
        const { key, fileId, pageIndex } = keys[i];
        const page = await files()[fileId].pdf.getPage(pageIndex + 1);
        if (await hasTextLayer(page)) {
          withText++;
          setOcrJob((j) => j && { ...j, done: i + 1 });
          continue;
        }
        setOcrJob((j) => j && { ...j, done: i, stage: `Страница ${i + 1} из ${keys.length}`, fraction: 0 });
        const words = await recognize(page, (stage, fraction) =>
          setOcrJob((j) => j && { ...j, stage: `Страница ${i + 1} из ${keys.length}: ${stage}`, fraction }),
        );
        ocrRef.current.set(key, words);
        recognized++;
        setOcrKeys(new Set(ocrRef.current.keys()));
        setOcrJob((j) => j && { ...j, done: i + 1 });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const parts: string[] = [];
    if (recognized) parts.push(`Распознано страниц: ${recognized}. Теперь при скачивании в PDF будет текстовый слой — текст можно искать и копировать.`);
    if (withText) parts.push(`Уже с текстом (распознавание не нужно): ${withText}.`);
    if (!keys.length) parts.push("Все выбранные страницы уже распознаны.");
    if (ocrCancel.current) parts.push("Остановлено.");
    if (error) parts.push(`Ошибка: ${error}`);
    setOcrJob((j) => ({ done: j?.done ?? 0, total: keys.length, stage: "", fraction: 1, result: parts.join(" ") }));
  };

  // ─── Формы ───────────────────────────────────────────────────────
  const fieldValue = (fileId: number, f: FormField): FormValue => formValues[fileId]?.[f.name] ?? f.value;

  /** Значения формы — в хранилище pdf.js, чтобы миниатюры показывали заполненное. */
  const pushFormToPdfjs = async (fileId: number, values: Record<string, FormValue>) => {
    const pdf = files()[fileId]?.pdf;
    if (!pdf) return;
    try {
      const objs: Record<string, any[]> | null = await pdf.getFieldObjects();
      if (!objs) return;
      for (const [name, value] of Object.entries(values)) {
        for (const w of objs[name] || []) {
          if (!w?.id) continue;
          if (w.type === "radiobutton") pdf.annotationStorage.setValue(w.id, { value: w.exportValues === value });
          else if (w.type === "checkbox") pdf.annotationStorage.setValue(w.id, { value: !!value });
          else pdf.annotationStorage.setValue(w.id, { value: String(value ?? "") });
        }
      }
    } catch (err) {
      console.warn("Предпросмотр формы не обновлён:", err);
    }
  };

  const setField = (fileId: number, name: string, value: FormValue) =>
    setFormValues((prev) => ({ ...prev, [fileId]: { ...(prev[fileId] ?? {}), [name]: value } }));

  const applyForms = async () => {
    setShowForms(false);
    for (const [id, values] of Object.entries(formValues)) {
      await pushFormToPdfjs(Number(id), values);
      refreshThumbsOf(Number(id));
    }
  };

  // ─── Просмотр и редактор ─────────────────────────────────────────
  const openPreviewAt = async (index: number) => {
    const item = pageItemsRef.current[index];
    if (!item) return;
    setPreviewIndex(index);
    setHighResPreviewUrl("");
    const url = await renderHighRes(item.fileId, item.pageIndex);
    setHighResPreviewUrl(url || thumbsRef.current[pageKey(item.fileId, item.pageIndex)]?.url || "");
  };

  const closePreview = () => {
    setPreviewIndex(-1);
    setHighResPreviewUrl("");
  };

  const navigatePreview = (dir: number) => {
    const next = previewIndex + dir;
    if (next >= 0 && next < pageItemsRef.current.length) openPreviewAt(next);
  };

  const openEditor = async (item: PageItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingLoading(true);
    try {
      const bg = await renderHighRes(item.fileId, item.pageIndex);
      if (bg) setEditing({ item, bg });
    } finally {
      setEditingLoading(false);
    }
  };

  const saveAnnotations = (id: string, annotations: Annotation[]) =>
    updateItems(new Set([id]), (p) => ({ ...p, annotations: annotations.length ? annotations : undefined }));

  // ─── Переход к странице ──────────────────────────────────────────
  const jumpToPage = () => {
    const n = Math.round(Number(jumpValue));
    const items = pageItemsRef.current;
    if (!n || n < 1 || n > items.length) return;
    const item = items[n - 1];
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-item-id="${item.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSelectedPages(new Set([item.id]));
    setLastClickedId(item.id);
    setFlashId(item.id);
    setTimeout(() => setFlashId((f) => (f === item.id ? null : f)), 1400);
  };

  // ─── Очистка ─────────────────────────────────────────────────────
  const clearAll = () => {
    if (pageItemsRef.current.length && !window.confirm("Убрать все страницы и документы? Отменить это будет нельзя.")) return;
    filesRef.current.forEach((f) => f.pdf?.destroy?.());
    filesRef.current = [];
    Object.values(thumbsRef.current).forEach((t) => t.url && URL.revokeObjectURL(t.url));
    thumbsRef.current = {};
    thumbQueue.current = [];
    visible.current.clear();
    setThumbs({});
    ocrRef.current.clear();
    setOcrKeys(new Set());
    setFormsByFile([]);
    setFormValues({});
    past.current = [];
    future.current = [];
    pageItemsRef.current = [];
    outputDocsRef.current = [];
    setPageItems([]);
    setOutputDocuments([]);
    setSelectedPages(new Set());
    setLastClickedId(null);
    closePreview();
    docCounterRef.current = 1;
    setHistoryTick((t) => t + 1);
  };

  // ─── Клавиатура ──────────────────────────────────────────────────
  const anyModal =
    !!editing || showCompress || showDecorate || showSplit || showPageSetup || showForms || !!ocrJob || showInstructions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (previewIndex >= 0) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          navigatePreview(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          navigatePreview(-1);
        } else if (e.key === "Escape") closePreview();
        return;
      }
      if (anyModal || typing) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((mod && k === "z" && e.shiftKey) || (mod && k === "y")) {
        e.preventDefault();
        redo();
      } else if (mod && k === "a") {
        e.preventDefault();
        setSelectedPages(new Set(pageItemsRef.current.map((i) => i.id)));
      } else if (mod && k === "d" && selectedPages.size) {
        e.preventDefault();
        duplicatePages(selectedPages);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPages.size) {
        e.preventDefault();
        deletePages(selectedPages);
      } else if (e.key === "Escape") {
        setSelectedPages(new Set());
        setLastClickedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ─── Производные значения ────────────────────────────────────────
  const selectedCount = selectedPages.size;
  const totalFields = formsByFile.reduce((s, f) => s + f.fields.length, 0);
  const editedForms = Object.values(formValues).some((v) => Object.keys(v).length);
  const previewItem = previewIndex >= 0 ? pageItems[previewIndex] : null;
  const thumbOf = (it: PageItem) => thumbs[pageKey(it.fileId, it.pageIndex)];
  const decorActive = pageNumbers.enabled || watermark.enabled;
  const docsWithPages = outputDocuments.filter((d) => d.pages.length).length;
  const setupTargetCount = selectedCount || pageItems.length;

  // ─── JSX ─────────────────────────────────────────────────────────
  return (
    <PageShell
      title="PDF Studio"
      subtitle="Объединяйте, переставляйте, поворачивайте, подписывайте, распознавайте и сжимайте PDF — прямо в браузере"
      onShowInstructions={() => setShowInstructions(true)}
      width={1720}
    >
      <div
        className="pdf-studio"
        onDragEnter={onShellDragEnter}
        onDragOver={onShellDragOver}
        onDragLeave={onShellDragLeave}
        onDrop={onShellDrop}
      >
        {isDraggingFile && (
          <div className="studio-drop-overlay">
            <div className="studio-drop-card">📄 Отпустите, чтобы добавить PDF</div>
          </div>
        )}

        {/* Плавающая панель инструментов */}
        {pageItems.length > 0 && (
          <div className="floating-toolbar">
            <div className="floating-toolbar-content">
              <div className="floating-toolbar-left">
                <span className="floating-toolbar-title">
                  Страниц: {pageItems.length}
                  {selectedCount > 0 && ` | Выделено: ${selectedCount}`}
                </span>
                <button
                  onClick={undo}
                  disabled={!past.current.length}
                  className="toolbar-button icon-only"
                  title="Отменить (Ctrl/cmd + Z)"
                  aria-label="Отменить"
                >
                  ↶
                </button>
                <button
                  onClick={redo}
                  disabled={!future.current.length}
                  className="toolbar-button icon-only"
                  title="Повторить (Ctrl/cmd + Shift + Z)"
                  aria-label="Повторить"
                >
                  ↷
                </button>
              </div>
              <div className="floating-toolbar-right">
                {selectedCount > 0 && (
                  <>
                    <button onClick={() => rotatePages([...selectedPages], -90)} className="toolbar-button icon-only" title="Повернуть выделенные против часовой">
                      ↺
                    </button>
                    <button onClick={() => rotatePages([...selectedPages], 90)} className="toolbar-button icon-only" title="Повернуть выделенные по часовой">
                      ↻
                    </button>
                    <button onClick={() => duplicatePages(selectedPages)} className="toolbar-button icon-only" title="Дублировать выделенные (Ctrl/cmd + D)">
                      ⧉
                    </button>
                    <button onClick={addSelectedToNewDocument} className="toolbar-button icon-only" title="Выделенные → в новый документ">
                      📂
                    </button>
                    <button onClick={downloadSelectedPdf} disabled={isProcessing} className="toolbar-button icon-only" title={`Скачать выделенные (${selectedCount})`}>
                      💾
                    </button>
                    <button onClick={() => deletePages(selectedPages)} className="toolbar-button icon-only danger" title={`Удалить выделенные (${selectedCount})`}>
                      🗑️
                    </button>
                    <span className="toolbar-divider" />
                  </>
                )}
                <button onClick={insertBlankPage} className="toolbar-button icon-only" title={selectedCount ? "Вставить пустую страницу после выделенных" : "Добавить пустую страницу в конец"}>
                  ＋
                </button>
                <button onClick={openPageSetup} className="toolbar-button icon-only" title="Обрезать поля / вписать в A4">
                  📐
                </button>
                <button onClick={runOcr} disabled={isProcessing} className="toolbar-button icon-only" title="Распознать сканы — PDF с поиском по тексту">
                  🔤
                </button>
                <button onClick={() => setShowSplit(true)} className="toolbar-button icon-only" title="Разделить на файлы по правилу">
                  ✂️
                </button>
                {totalFields > 0 && (
                  <button onClick={() => setShowForms(true)} className={`toolbar-button ${editedForms ? "is-active" : ""}`} title="Заполнить поля формы">
                    📝 Форма
                  </button>
                )}
                <button
                  onClick={() => setShowDecorate(true)}
                  className={`toolbar-button icon-only ${decorActive ? "is-active" : ""}`}
                  title="Номера страниц и водяной знак"
                >
                  🔖
                </button>
                <span className="toolbar-divider" />
                <button onClick={() => setShowCompress(true)} disabled={isProcessing} className="toolbar-button" title="Сжать PDF (уменьшить размер файла)">
                  🗜️ Сжать
                </button>
                <button onClick={downloadMergedPdf} disabled={isProcessing} className="toolbar-button primary">
                  {isProcessing ? "⏳" : "💾"} Скачать
                </button>
                <button onClick={clearAll} className="toolbar-button icon-only" title="Очистить всё">
                  🧹
                </button>
              </div>
            </div>
            {busyText && <div className="toolbar-busy">⏳ {busyText}</div>}
          </div>
        )}

        {/* Зона загрузки: большая — пока пусто, компактная — когда страницы есть */}
        <div className={`pdf-editor-header ${pageItems.length ? "is-compact" : ""}`}>
          {pageItems.length === 0 ? (
            <div
              className={`upload-zone ${isDraggingFile ? "dragging" : ""} ${isLoadingFiles ? "loading" : ""}`}
              onClick={() => !isLoadingFiles && fileInputRef.current?.click()}
            >
              <div className="upload-icon-editor">📄</div>
              {isLoadingFiles ? (
                <>
                  <p className="upload-text">Открываем файлы…</p>
                  <p className="upload-subtext">{loadingText}</p>
                </>
              ) : (
                <>
                  <p className="upload-text">Перетащите PDF файлы сюда</p>
                  <p className="upload-subtext">или</p>
                  <button className="primary-button">Выбрать файлы</button>
                </>
              )}
            </div>
          ) : (
            <div className="upload-strip">
              <span className="upload-strip-text">
                {isLoadingFiles ? `⏳ Открываем: ${loadingText}` : "📄 Перетащите ещё PDF в любое место страницы или"}
              </span>
              <button className="secondary-button" disabled={isLoadingFiles} onClick={() => fileInputRef.current?.click()}>
                Добавить файлы
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            disabled={isLoadingFiles}
            className="file-input-hidden"
          />
        </div>

        {pageItems.length > 0 && (
          <div className="selection-hint">
            <span>
              💡 Клик — выбрать · Ctrl/cmd + клик — добавить · Shift + клик — диапазон · Delete — удалить · Ctrl/cmd + Z /
              Shift + Z — отменить / повторить · Ctrl/cmd + D — дублировать · Ctrl/cmd + A — все · перетащите страницы, чтобы
              изменить порядок или собрать отдельный файл ниже
            </span>
          </div>
        )}

        <div className="pages-and-output-wrapper">
          {pageItems.length > 0 && (
            <div className="pages-container">
              <div className="pages-header">
                <div className="pages-title">
                  <span>Страницы</span>
                  <span className="pages-count">{pageItems.length}</span>
                </div>
                <div className="pages-view-controls">
                  <form
                    className="jump-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      jumpToPage();
                    }}
                  >
                    <label>
                      Перейти к
                      <input
                        type="number"
                        min={1}
                        max={pageItems.length}
                        value={jumpValue}
                        placeholder="№"
                        onChange={(e) => setJumpValue(e.target.value)}
                        aria-label="Номер страницы"
                      />
                    </label>
                    <button type="submit" className="toolbar-button icon-only" title="Перейти">
                      ↵
                    </button>
                  </form>
                  <label className="thumb-size" title="Размер миниатюр">
                    <span aria-hidden>🔍</span>
                    <input
                      type="range"
                      min={110}
                      max={360}
                      step={10}
                      value={thumbSize}
                      onChange={(e) => setThumbSize(Number(e.target.value))}
                      aria-label="Размер миниатюр"
                    />
                  </label>
                </div>
              </div>

              <div className="pages-grid" ref={gridRef} style={{ ["--thumb-w" as string]: `${thumbSize}px` }}>
                {pageItems.map((item, index) => {
                  const key = pageKey(item.fileId, item.pageIndex);
                  const thumb = thumbs[key];
                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      draggable
                      onDragStart={(e) => handlePageDragStart(e, item.id)}
                      onDragOver={(e) => handlePageDragOver(e, index)}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => handlePageDrop(e, index)}
                      onClick={(e) => handlePageClick(item.id, e)}
                      onDoubleClick={() => openPreviewAt(index)}
                      className={`page-item ${dragOverIndex === index ? "dragging-over" : ""} ${
                        selectedPages.has(item.id) ? "selected" : ""
                      } ${flashId === item.id ? "is-flash" : ""}`}
                    >
                      <div className="page-controls">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openPreviewAt(index);
                          }}
                          className="preview-page-button"
                          title="Просмотр"
                        >
                          🔍
                        </button>
                        <button onClick={(e) => openEditor(item, e)} className="preview-page-button" title="Редактировать: текст, фигуры, подпись, вымарывание">
                          ✏️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            rotatePages([item.id], 90);
                          }}
                          className="preview-page-button"
                          title="Повернуть на 90°"
                        >
                          ↻
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePages(new Set([item.id]));
                          }}
                          className="delete-page-button"
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="page-preview-container" ref={observeThumb(item.id, key)}>
                        {thumb?.failed ? (
                          <div className="page-preview-placeholder error-state">
                            <div className="page-preview-icon">⚠️</div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setThumb(key, null);
                                requestThumb(key);
                              }}
                              className="primary-button small-button"
                            >
                              Повторить
                            </button>
                          </div>
                        ) : thumb ? (
                          <PageView item={item} thumb={thumb} alt={`Страница ${item.pageNumber}`} />
                        ) : (
                          <div className="page-preview-placeholder">
                            <div className="preview-spinner" />
                          </div>
                        )}
                        <div className="page-badges">
                          {item.annotations && item.annotations.length > 0 && (
                            <span className="page-badge" title="Есть правки">
                              ✏️ {item.annotations.length}
                            </span>
                          )}
                          {item.annotations?.some((a) => a.type === "redact") && (
                            <span className="page-badge is-dark" title="Есть вымарывание">
                              ⬛
                            </span>
                          )}
                          {ocrKeys.has(key) && (
                            <span className="page-badge" title="Текст распознан">
                              🔤
                            </span>
                          )}
                          {item.crop && (
                            <span className="page-badge" title="Поля обрезаны">
                              ✂
                            </span>
                          )}
                          {item.fitA4 && (
                            <span className="page-badge" title="Вписать в A4">
                              A4
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="page-number-badge">{index + 1}</div>

                      <div className="page-info">
                        <div className="page-filename" title={item.fileName}>
                          {item.fileName}
                        </div>
                        <div className="page-number">
                          {item.fileName === BLANK_NAME ? "пустая" : `Страница ${item.pageNumber}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pages-footer">
                <div className="pages-footer-left">
                  <button onClick={() => fileInputRef.current?.click()} disabled={isLoadingFiles} className="primary-button">
                    📄 Добавить файлы
                  </button>
                </div>
                <div className="pages-footer-right">
                  <button onClick={downloadMergedPdf} disabled={isProcessing} className="success-button">
                    {isProcessing ? "⏳ Обработка..." : "💾 Скачать PDF"}
                  </button>
                  <button onClick={clearAll} className="secondary-button">
                    🗑️ Очистить все
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Разделение на несколько файлов */}
          {pageItems.length > 0 && (
            <div className="output-documents-section">
              <div className="output-documents-header">
                <h3>📂 Разделение на файлы</h3>
                <div className="output-documents-header-actions">
                  <button className="secondary-button" onClick={() => setShowSplit(true)}>
                    ✂️ По правилу
                  </button>
                  <button className="secondary-button" onClick={() => createOutputDocument([])}>
                    + Новый документ
                  </button>
                  {docsWithPages > 0 && (
                    <button className="success-button" onClick={downloadAllDocumentsZip} disabled={isProcessing}>
                      📦 Скачать все ({docsWithPages}) архивом
                    </button>
                  )}
                </div>
              </div>
              <p className="output-documents-hint">
                Перетащите страницы из сетки в документ ниже или нажмите «По правилу» (каждые N страниц, диапазоны, по исходным
                файлам). Исходный набор страниц не меняется — добавляются копии.
              </p>

              {outputDocuments.length === 0 ? (
                <div className="output-documents-empty">
                  Нет созданных документов. Нажмите «+ Новый документ» и перетащите туда нужные страницы (или выделите страницы и
                  нажмите «📂» в панели сверху).
                </div>
              ) : (
                <div className="output-documents-list">
                  {outputDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="output-document-card"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => handleBinContainerDrop(e, doc.id)}
                    >
                      <div className="output-document-header">
                        <input
                          type="text"
                          value={doc.name}
                          onChange={(e) => renameOutputDocument(doc.id, e.target.value)}
                          className="output-document-name-input"
                          aria-label="Имя документа"
                        />
                        <span className="output-document-count">{doc.pages.length} стр.</span>
                        <div className="output-document-actions">
                          {selectedCount > 0 && (
                            <button
                              className="toolbar-button"
                              title="Добавить выделенные страницы в этот документ"
                              onClick={() => addToDocument(doc.id, selectedItems())}
                            >
                              ➕
                            </button>
                          )}
                          <button
                            className="toolbar-button download-button"
                            onClick={() => downloadOutputDocument(doc.id)}
                            disabled={doc.pages.length === 0 || isProcessing}
                            title="Скачать этот документ"
                          >
                            💾
                          </button>
                          <button className="toolbar-button clear-button" onClick={() => removeOutputDocument(doc.id)} title="Удалить документ">
                            🗑️
                          </button>
                        </div>
                      </div>

                      <div className="output-document-pages">
                        {doc.pages.length === 0 ? (
                          <div className="output-document-dropzone-placeholder">Перетащите сюда страницы</div>
                        ) : (
                          doc.pages.map((page, idx) => {
                            const key = pageKey(page.fileId, page.pageIndex);
                            return (
                              <div
                                key={page.id}
                                draggable
                                onDragStart={(e) => handleBinPageDragStart(e, doc.id, page.id)}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBinDragOverKey(`${doc.id}:${idx}`);
                                }}
                                onDragLeave={() => setBinDragOverKey(null)}
                                onDrop={(e) => handleBinPageDrop(e, doc.id, idx)}
                                className={`output-document-page-item ${binDragOverKey === `${doc.id}:${idx}` ? "dragging-over" : ""}`}
                                title={`${page.fileName} — стр. ${page.pageNumber}`}
                              >
                                <div className="output-document-page-thumb" ref={observeThumb(`bin:${page.id}`, key)}>
                                  {thumbs[key]?.url ? <PageView item={page} thumb={thumbs[key]} /> : "📄"}
                                </div>
                                <button
                                  className="output-document-page-remove"
                                  onClick={() => removePageFromDocument(doc.id, page.id)}
                                  title="Убрать из документа"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {pageItems.length === 0 && !isLoadingFiles && (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <h3 className="empty-title">Нет загруженных страниц</h3>
            <p className="empty-text">Загрузите PDF файлы для начала работы</p>
          </div>
        )}
      </div>

      {/* Просмотр */}
      {previewItem && (
        <div className="preview-modal-overlay" onClick={closePreview}>
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <h3>
                {previewItem.fileName} — стр. {previewItem.pageNumber}
              </h3>
              <div className="preview-modal-controls">
                <span className="preview-modal-hint">← → для навигации · Esc — закрыть</span>
                <div className="preview-nav-buttons">
                  <button className="preview-nav-button" onClick={() => navigatePreview(-1)} disabled={previewIndex <= 0} title="Предыдущая (←)">
                    ←
                  </button>
                  <span className="preview-counter">
                    {previewIndex + 1} / {pageItems.length}
                  </span>
                  <button
                    className="preview-nav-button"
                    onClick={() => navigatePreview(1)}
                    disabled={previewIndex >= pageItems.length - 1}
                    title="Следующая (→)"
                  >
                    →
                  </button>
                </div>
                <button className="preview-modal-close" onClick={closePreview}>
                  ✕
                </button>
              </div>
            </div>
            <div className="preview-modal-body">
              {highResPreviewUrl ? (
                <div className="preview-modal-stage">
                  <PageView item={previewItem} thumb={thumbOf(previewItem)} src={highResPreviewUrl} alt={`Страница ${previewItem.pageNumber}`} />
                </div>
              ) : (
                <div className="preview-modal-placeholder">
                  <div className="preview-spinner" />
                  <p>Загрузка высокого разрешения...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Сжатие */}
      {showCompress && (
        <div className="im-overlay" onClick={() => !isProcessing && closeCompress()}>
          <div className="im-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="im-header">
              <h2 className="im-title">🗜️ Сжатие PDF</h2>
              <button className="im-close" onClick={() => !isProcessing && closeCompress()} aria-label="Закрыть">
                ✕
              </button>
            </div>

            {compressResult ? (
              <>
                <div className="im-body">
                  <div className="compress-result">
                    <div className="compress-result__row">
                      <span>Было</span>
                      <strong>{formatBytes(compressResult.originalSize)}</strong>
                    </div>
                    <div className="compress-result__arrow">↓</div>
                    <div className="compress-result__row">
                      <span>Стало</span>
                      <strong>{formatBytes(compressResult.compressedSize)}</strong>
                    </div>
                    <div className={`compress-result__badge ${compressResult.ratio > 0 ? "is-good" : "is-bad"}`}>
                      {compressResult.ratio > 0 ? `Экономия ${compressResult.ratio}%` : "Уже оптимально — сохранён исходный файл"}
                    </div>
                  </div>
                  {compressResult.mode === "images" && compressResult.images && (
                    <p className="studio-note">
                      Пережато изображений: {compressResult.images.recompressed} из {compressResult.images.total}. Текст и
                      векторная графика не изменились.
                    </p>
                  )}
                  {compressResult.ratio <= 0 && (
                    <p className="studio-note">
                      {compressResult.mode === "images"
                        ? "В документе нечего пережимать (обычно так с текстовыми PDF), поэтому отдаём исходный файл без потерь."
                        : "Растеризация не уменьшила вес (обычно так с текстовыми PDF), поэтому отдаём исходный файл без потерь. Для более сильного сжатия сканов снизьте качество."}
                    </p>
                  )}
                </div>
                <div className="im-footer" style={{ gap: 10 }}>
                  <button className="btn-secondary" onClick={() => setCompressResult(null)}>
                    ← Сжать заново
                  </button>
                  <a className="btn-primary" href={compressResult.url} download={compressResult.fileName}>
                    💾 Скачать
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="im-body">
                  <div className="compress-modes" role="radiogroup">
                    <label className={`compress-mode ${compressMode === "images" ? "is-active" : ""}`}>
                      <input type="radio" name="compress-mode" checked={compressMode === "images"} onChange={() => setCompressMode("images")} />
                      <span>
                        <strong>Сжать изображения</strong>
                        <small>Текст остаётся текстом: его можно выделять и искать. Подходит для большинства документов.</small>
                      </span>
                    </label>
                    <label className={`compress-mode ${compressMode === "raster" ? "is-active" : ""}`}>
                      <input type="radio" name="compress-mode" checked={compressMode === "raster"} onChange={() => setCompressMode("raster")} />
                      <span>
                        <strong>Максимальное сжатие</strong>
                        <small>
                          Страницы превращаются в картинки — меньше вес. Поиск по тексту сохраняется (невидимым слоем), но
                          редактировать текст будет нельзя.
                        </small>
                      </span>
                    </label>
                  </div>
                  <p className="studio-note">Учитываются текущий порядок, удаления, повороты и все правки страниц.</p>
                  <label className="ds-section-title" style={{ marginTop: 12, marginBottom: 8 }}>
                    Качество: {Math.round(compressQuality * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    value={compressQuality}
                    onChange={(e) => setCompressQuality(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                  <p className="studio-note">Ниже качество — меньше файл. 70–85% — хороший баланс.</p>
                </div>
                <div className="im-footer" style={{ gap: 10 }}>
                  {selectedCount > 0 && (
                    <button className="btn-secondary" disabled={isProcessing} onClick={() => runCompress(selectedItems())}>
                      Сжать выделенные ({selectedCount})
                    </button>
                  )}
                  <button className="btn-primary" disabled={isProcessing} onClick={() => runCompress(pageItemsRef.current)}>
                    {isProcessing ? "⏳ Обработка..." : "Сжать"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Оформление */}
      {showDecorate && (
        <div className="im-overlay" onClick={() => setShowDecorate(false)}>
          <div className="im-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="im-header">
              <h2 className="im-title">🔖 Оформление</h2>
              <button className="im-close" onClick={() => setShowDecorate(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            <div className="im-body">
              <label className="decorate-toggle">
                <input type="checkbox" checked={pageNumbers.enabled} onChange={(e) => setPageNumbers({ ...pageNumbers, enabled: e.target.checked })} />
                <span className="ds-section-title" style={{ margin: 0 }}>
                  🔢 Номера страниц
                </span>
              </label>
              {pageNumbers.enabled && (
                <div className="decorate-grid">
                  <label>
                    Позиция
                    <select className="ds-select" value={pageNumbers.position} onChange={(e) => setPageNumbers({ ...pageNumbers, position: e.target.value })}>
                      <option value="bottom-center">Снизу по центру</option>
                      <option value="bottom-right">Снизу справа</option>
                      <option value="bottom-left">Снизу слева</option>
                      <option value="top-center">Сверху по центру</option>
                      <option value="top-right">Сверху справа</option>
                      <option value="top-left">Сверху слева</option>
                    </select>
                  </label>
                  <label>
                    Формат
                    <select className="ds-select" value={pageNumbers.format} onChange={(e) => setPageNumbers({ ...pageNumbers, format: e.target.value })}>
                      <option value="{n} / {total}">1 / 10</option>
                      <option value="{n}">1</option>
                      <option value="- {n} -">- 1 -</option>
                      <option value="Стр. {n}">Стр. 1</option>
                      <option value="Страница {n} из {total}">Страница 1 из 10</option>
                    </select>
                  </label>
                  <label>
                    Размер: {pageNumbers.size} pt
                    <input type="range" min={7} max={24} value={pageNumbers.size} onChange={(e) => setPageNumbers({ ...pageNumbers, size: Number(e.target.value) })} />
                  </label>
                  <label>
                    Цвет
                    <input type="color" value={pageNumbers.color} onChange={(e) => setPageNumbers({ ...pageNumbers, color: e.target.value })} />
                  </label>
                </div>
              )}

              <hr className="decorate-sep" />

              <label className="decorate-toggle">
                <input type="checkbox" checked={watermark.enabled} onChange={(e) => setWatermark({ ...watermark, enabled: e.target.checked })} />
                <span className="ds-section-title" style={{ margin: 0 }}>
                  💧 Водяной знак
                </span>
              </label>
              {watermark.enabled && (
                <div className="decorate-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    Текст
                    <input
                      type="text"
                      className="ds-input"
                      value={watermark.text}
                      onChange={(e) => setWatermark({ ...watermark, text: e.target.value })}
                      placeholder="Напр. КОНФИДЕНЦИАЛЬНО"
                    />
                  </label>
                  <label>
                    Прозрачность: {Math.round(watermark.opacity * 100)}%
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.05}
                      value={watermark.opacity}
                      onChange={(e) => setWatermark({ ...watermark, opacity: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Размер: {watermark.size} pt
                    <input type="range" min={24} max={120} value={watermark.size} onChange={(e) => setWatermark({ ...watermark, size: Number(e.target.value) })} />
                  </label>
                  <label>
                    Цвет
                    <input type="color" value={watermark.color} onChange={(e) => setWatermark({ ...watermark, color: e.target.value })} />
                  </label>
                </div>
              )}

              <p className="studio-note">
                Оформление добавляется при скачивании (и при сжатии) настоящим текстом: с кириллицей, ровно на повёрнутых
                страницах. Водяной знак идёт по диагонали страницы.
              </p>
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowDecorate(false)}>
                Готово
              </button>
              <button
                className="btn-primary"
                disabled={isProcessing || pageItems.length === 0}
                onClick={() => {
                  setShowDecorate(false);
                  downloadMergedPdf();
                }}
              >
                💾 Скачать с оформлением
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Разделить по правилу */}
      {showSplit && (
        <div className="im-overlay" onClick={() => setShowSplit(false)}>
          <div className="im-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="im-header">
              <h2 className="im-title">✂️ Разделить на файлы</h2>
              <button className="im-close" onClick={() => setShowSplit(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            <div className="im-body">
              <div className="compress-modes" role="radiogroup">
                <label className={`compress-mode ${splitMode === "every" ? "is-active" : ""}`}>
                  <input type="radio" name="split" checked={splitMode === "every"} onChange={() => setSplitMode("every")} />
                  <span>
                    <strong>Каждые N страниц</strong>
                    <small className="split-inline">
                      По
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pageItems.length)}
                        value={splitEvery}
                        onFocus={() => setSplitMode("every")}
                        onChange={(e) => setSplitEvery(Math.max(1, Number(e.target.value) || 1))}
                        aria-label="Страниц в каждом файле"
                      />
                      стр. → {Math.ceil(pageItems.length / Math.max(1, splitEvery))} файл(ов)
                    </small>
                  </span>
                </label>
                <label className={`compress-mode ${splitMode === "ranges" ? "is-active" : ""}`}>
                  <input type="radio" name="split" checked={splitMode === "ranges"} onChange={() => setSplitMode("ranges")} />
                  <span>
                    <strong>По диапазонам</strong>
                    <small>Каждый диапазон — отдельный файл. Номера — как на миниатюрах.</small>
                    <input
                      type="text"
                      className="ds-input"
                      value={splitRanges}
                      placeholder={`1-3, 5, 8-${pageItems.length}`}
                      onFocus={() => setSplitMode("ranges")}
                      onChange={(e) => {
                        setSplitRanges(e.target.value);
                        setSplitError("");
                      }}
                      aria-label="Диапазоны страниц"
                    />
                  </span>
                </label>
                <label className={`compress-mode ${splitMode === "files" ? "is-active" : ""}`}>
                  <input type="radio" name="split" checked={splitMode === "files"} onChange={() => setSplitMode("files")} />
                  <span>
                    <strong>По исходным файлам</strong>
                    <small>Каждый загруженный PDF — отдельным файлом (с вашими правками).</small>
                  </span>
                </label>
              </div>
              {outputDocuments.length > 0 && (
                <label className="decorate-toggle">
                  <input type="checkbox" checked={splitReplace} onChange={(e) => setSplitReplace(e.target.checked)} />
                  Заменить уже созданные документы ({outputDocuments.length})
                </label>
              )}
              {splitError && <p className="studio-error">{splitError}</p>}
              <p className="studio-note">
                Документы появятся в блоке «Разделение на файлы» — их можно поправить, переименовать и скачать по одному или
                все сразу архивом.
              </p>
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowSplit(false)}>
                Отмена
              </button>
              <button className="btn-primary" onClick={runSplit}>
                Разделить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Размер страницы: обрезка полей и A4 */}
      {showPageSetup && (
        <div className="im-overlay" onClick={() => setShowPageSetup(false)}>
          <div className="im-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="im-header">
              <h2 className="im-title">📐 Страницы: поля и размер</h2>
              <button className="im-close" onClick={() => setShowPageSetup(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            <div className="im-body">
              <p className="studio-note" style={{ marginTop: 0 }}>
                Применится к {selectedCount ? `выделенным страницам (${selectedCount})` : `всем страницам (${setupTargetCount})`}.
              </p>
              <label className="decorate-toggle">
                <input type="checkbox" checked={cropOn} onChange={(e) => setCropOn(e.target.checked)} />
                <span className="ds-section-title" style={{ margin: 0 }}>
                  ✂️ Обрезать поля
                </span>
              </label>
              {cropOn && (
                <div className="crop-grid">
                  <label className="decorate-toggle" style={{ gridColumn: "1 / -1" }}>
                    <input type="checkbox" checked={cropSame} onChange={(e) => setCropSame(e.target.checked)} />
                    Одинаково со всех сторон
                  </label>
                  {(cropSame ? (["top"] as const) : (["top", "right", "bottom", "left"] as const)).map((side) => (
                    <label key={side}>
                      {cropSame ? "Со всех сторон, мм" : { top: "Сверху, мм", right: "Справа, мм", bottom: "Снизу, мм", left: "Слева, мм" }[side]}
                      <input
                        type="number"
                        min={0}
                        max={150}
                        step={1}
                        className="ds-input"
                        value={cropDraft[side]}
                        onChange={(e) => setCropDraft({ ...cropDraft, [side]: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                  ))}
                </div>
              )}
              <hr className="decorate-sep" />
              <label className="decorate-toggle">
                <input type="checkbox" checked={fitA4Draft} onChange={(e) => setFitA4Draft(e.target.checked)} />
                <span className="ds-section-title" style={{ margin: 0 }}>
                  📄 Вписать в A4
                </span>
              </label>
              <p className="studio-note">
                Страница любого размера (A3, Letter, чек, слайд) масштабируется в лист A4 той же ориентации с сохранением
                пропорций — удобно для печати. Поля обрезаются раньше, поэтому можно сначала убрать лишнее, а потом
                растянуть на лист.
              </p>
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setCropOn(false);
                  setFitA4Draft(false);
                }}
              >
                Сбросить
              </button>
              <button className="btn-primary" onClick={applyPageSetup}>
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Формы */}
      {showForms && (
        <div className="im-overlay" onClick={() => setShowForms(false)}>
          <div className="im-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="im-header">
              <h2 className="im-title">📝 Поля формы</h2>
              <button className="im-close" onClick={() => setShowForms(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            <div className="im-body forms-body">
              {formsByFile.map((ff) => (
                <div key={ff.fileId} className="forms-file">
                  {formsByFile.length > 1 && <h4 className="forms-file-title">{ff.fileName}</h4>}
                  {ff.fields.map((f) => {
                    const v = fieldValue(ff.fileId, f);
                    const label = f.name.split(".").pop() || f.name;
                    return (
                      <label key={f.name} className={`form-field form-field--${f.type}`} title={f.name}>
                        {f.type === "checkbox" ? (
                          <>
                            <input
                              type="checkbox"
                              checked={!!v}
                              disabled={f.readOnly}
                              onChange={(e) => setField(ff.fileId, f.name, e.target.checked)}
                            />
                            <span>{label}</span>
                          </>
                        ) : (
                          <>
                            <span className="form-field-label">
                              {label}
                              {f.page !== undefined && <small> · стр. {f.page + 1}</small>}
                            </span>
                            {f.type === "text" &&
                              (f.multiline ? (
                                <textarea
                                  className="ds-input"
                                  rows={3}
                                  value={String(v)}
                                  disabled={f.readOnly}
                                  onChange={(e) => setField(ff.fileId, f.name, e.target.value)}
                                />
                              ) : (
                                <input
                                  type="text"
                                  className="ds-input"
                                  value={String(v)}
                                  disabled={f.readOnly}
                                  onChange={(e) => setField(ff.fileId, f.name, e.target.value)}
                                />
                              ))}
                            {(f.type === "radio" || f.type === "choice") && (
                              <select
                                className="ds-select"
                                value={String(v)}
                                disabled={f.readOnly}
                                onChange={(e) => setField(ff.fileId, f.name, e.target.value)}
                              >
                                <option value="">—</option>
                                {(f.options || []).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
              <p className="studio-note">
                При скачивании значения впечатываются в страницы (форма «сплющивается»), поэтому сохранятся в любой
                программе и при объединении с другими файлами.
              </p>
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              <button
                className="btn-secondary"
                onClick={async () => {
                  setFormValues({});
                  for (const ff of formsByFile) {
                    await pushFormToPdfjs(ff.fileId, Object.fromEntries(ff.fields.map((f) => [f.name, f.value])));
                    refreshThumbsOf(ff.fileId);
                  }
                }}
              >
                Сбросить
              </button>
              <button className="btn-primary" onClick={applyForms}>
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Распознавание */}
      {ocrJob && (
        <div className="im-overlay">
          <div className="im-modal" style={{ maxWidth: 480 }}>
            <div className="im-header">
              <h2 className="im-title">🔤 Распознавание сканов</h2>
            </div>
            <div className="im-body">
              {ocrJob.result ? (
                <p>{ocrJob.result}</p>
              ) : (
                <>
                  <p className="studio-note" style={{ marginTop: 0 }}>
                    {ocrJob.stage || "Готовим…"}
                  </p>
                  <div className="progress-bar-wrapper">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${ocrJob.total ? Math.round(((ocrJob.done + Math.min(1, ocrJob.fraction) * 0.99) / ocrJob.total) * 100) : 100}%`,
                      }}
                    />
                  </div>
                  <p className="studio-note">
                    Русский и английский, без интернета. Страница распознаётся за 10–20 секунд; при первом запуске загружаются
                    файлы распознавания (~15 МБ, дальше из кэша).
                  </p>
                </>
              )}
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              {ocrJob.result ? (
                <>
                  <button className="btn-secondary" onClick={() => setOcrJob(null)}>
                    Закрыть
                  </button>
                  {ocrKeys.size > 0 && (
                    <button
                      className="btn-primary"
                      onClick={() => {
                        setOcrJob(null);
                        downloadMergedPdf();
                      }}
                    >
                      💾 Скачать PDF с поиском
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    ocrCancel.current = true;
                    setOcrJob((j) => j && { ...j, stage: "Останавливаем после текущей страницы…" });
                  }}
                >
                  Остановить
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editingLoading && (
        <div className="pa-overlay">
          <div className="pa-loading">Загрузка страницы…</div>
        </div>
      )}
      {editing && (
        <PageAnnotator
          backgroundUrl={editing.bg}
          initial={editing.item.annotations || []}
          onSave={(anns) => saveAnnotations(editing.item.id, anns)}
          onClose={() => setEditing(null)}
        />
      )}

      <PdfEditorInstructions isOpen={showInstructions} onClose={() => setShowInstructions(false)} />
    </PageShell>
  );
};

export default PdfEditor;
