// src/components/PdfEditor.tsx
import React, { useState, useRef, ChangeEvent, useEffect } from "react";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import PageShell from "../../components/PageShell";
import { PdfEditorInstructions } from "./components/PdfEditorInstructions";
import PageAnnotator, { type Annotation } from "./components/PageAnnotator";

import "./PdfEditor.css";

import * as pdfjs from "pdfjs-dist";
import pdfWorkerContent from "pdfjs-dist/build/pdf.worker.mjs?raw";

const workerBlob = new Blob([pdfWorkerContent], {
  type: "application/javascript",
});
const workerBlobUrl = URL.createObjectURL(workerBlob);
pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl;

type LoadedFile = {
  file: File;
  arrayBuffer: ArrayBuffer;
  pdfInstance?: any;
  pageCount: number;
};

type PageItem = {
  id: string;
  fileId: number;
  pageIndex: number;
  previewUrl: string;
  fileName: string;
  pageNumber: number;
  isGeneratingPreview: boolean;
  /** Дополнительный поворот страницы в градусах (0/90/180/270) */
  rotation?: number;
  /** Аннотации (текст, фигуры, рисование, картинки) поверх страницы */
  annotations?: Annotation[];
};

type OutputDocument = {
  id: string;
  name: string;
  pages: PageItem[];
};

type DeleteHistory = {
  items: PageItem[];
  indices: number[];
  timestamp: number;
};

type LoadingProgress = {
  current: number;
  total: number;
  fileName: string;
  phase: "reading" | "parsing" | "previews" | "done";
};

type DragPayload =
  | { type: "grid-page"; ids: string[] }
  | { type: "bin-page"; docId: string; id: string };

const generateId = () =>
  `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const PdfEditor: React.FC = () => {
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const loadedFilesRef = useRef<LoadedFile[]>([]);

  const [pageItems, setPageItems] = useState<PageItem[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [deleteHistory, setDeleteHistory] = useState<DeleteHistory[]>([]);
  const [previewPage, setPreviewPage] = useState<PageItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const [highResPreviewUrl, setHighResPreviewUrl] = useState<string>("");
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingProgress, setLoadingProgress] =
    useState<LoadingProgress | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  // ─── Редактор-слой ───────────────────────────────────────────────
  const [editing, setEditing] = useState<{ item: PageItem; bg: string } | null>(
    null,
  );
  const [editingLoading, setEditingLoading] = useState(false);

  // ─── Сжатие ──────────────────────────────────────────────────────
  const [showCompress, setShowCompress] = useState(false);
  const [compressQuality, setCompressQuality] = useState(0.85);
  const [compressResult, setCompressResult] = useState<{
    originalSize: number;
    compressedSize: number;
    ratio: number;
    url: string;
    fileName: string;
  } | null>(null);

  // ─── Оформление: номера страниц и водяной знак ───────────────────
  const [showDecorate, setShowDecorate] = useState(false);
  const [pageNumbers, setPageNumbers] = useState({
    enabled: false,
    position: "bottom-center",
    format: "{n} / {total}",
    size: 12,
    color: "#555555",
  });
  const [watermark, setWatermark] = useState({
    enabled: false,
    text: "КОНФИДЕНЦИАЛЬНО",
    opacity: 0.15,
    size: 52,
    color: "#e5484d",
  });

  // ─── НОВОЕ: выходные документы (для разделения на несколько файлов) ──
  const [outputDocuments, setOutputDocuments] = useState<OutputDocument[]>([]);
  const docCounterRef = useRef(1);
  const [binDragOverKey, setBinDragOverKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageItemsRef = useRef<PageItem[]>([]);

  useEffect(() => {
    pageItemsRef.current = pageItems;
  }, [pageItems]);

  useEffect(() => {
    loadedFilesRef.current = loadedFiles;
  }, [loadedFiles]);

  useEffect(() => {
    return () => {
      loadedFilesRef.current.forEach((file) => {
        if (file.pdfInstance?.destroy) file.pdfInstance.destroy();
      });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewPage) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          navigatePreview(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          navigatePreview(-1);
        } else if (e.key === "Escape") {
          setPreviewPage(null);
          setHighResPreviewUrl("");
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoLastDelete();
      }
      if (e.key === "Delete" && selectedPages.size > 0) {
        e.preventDefault();
        deleteSelectedPages();
      }
      if (e.key === "Escape") {
        setSelectedPages(new Set());
        setLastClickedId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedPages(new Set(pageItemsRef.current.map((i) => i.id)));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPages, deleteHistory, previewPage, previewIndex]);

  const cloneArrayBuffer = (buffer: ArrayBuffer): ArrayBuffer => {
    const newBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(newBuffer).set(new Uint8Array(buffer));
    return newBuffer;
  };

  // ─── Рендер превью ───────────────────────────────────────────────

  const renderPageAtScale = async (
    pdf: any,
    pageIndex: number,
    scale: number,
    quality = 0.92,
  ): Promise<string> => {
    try {
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas context");

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } catch (err) {
      console.error("renderPageAtScale error:", err);
      return "";
    }
  };

  const renderPagePreview = (pdf: any, pageIndex: number) =>
    renderPageAtScale(pdf, pageIndex, 0.4, 0.85);

  const renderHighResPreview = async (
    fileId: number,
    pageIndex: number,
  ): Promise<string> => {
    const file = loadedFilesRef.current[fileId];
    if (!file?.pdfInstance) return "";

    try {
      const page = await file.pdfInstance.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });

      const targetWidth = 1600;
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas context");

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } catch (err) {
      console.error("renderHighResPreview error:", err);
      return "";
    }
  };

  // ─── Навигация в превью ──────────────────────────────────────────

  const navigatePreview = (direction: number) => {
    const items = pageItemsRef.current;
    if (items.length === 0) return;

    setPreviewIndex((currentIndex) => {
      const newIndex = currentIndex + direction;
      if (newIndex < 0 || newIndex >= items.length) return currentIndex;

      const newPage = items[newIndex];
      setPreviewPage(newPage);
      setHighResPreviewUrl("");

      renderHighResPreview(newPage.fileId, newPage.pageIndex).then((url) =>
        setHighResPreviewUrl(url || newPage.previewUrl),
      );

      return newIndex;
    });
  };

  // ─── Загрузка файлов ─────────────────────────────────────────────

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (isLoadingFiles) {
      alert("Подождите, идёт загрузка предыдущих файлов...");
      return;
    }

    setIsLoadingFiles(true);
    setIsProcessing(true);

    const totalFiles = files.length;

    try {
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];

        if (
          !file.type.includes("pdf") &&
          !file.name.toLowerCase().endsWith(".pdf")
        ) {
          console.warn(`Файл ${file.name} не является PDF`);
          continue;
        }

        setLoadingProgress({
          current: 0,
          total: 100,
          fileName: file.name,
          phase: "reading",
        });

        const arrayBuffer = await file.arrayBuffer();

        setLoadingProgress({
          current: 20,
          total: 100,
          fileName: file.name,
          phase: "parsing",
        });

        let pdf: any;
        let pageCount = 0;

        try {
          const loadingTask = pdfjs.getDocument({
            data: cloneArrayBuffer(arrayBuffer),
            disableAutoFetch: true,
            verbosity: 0,
          });
          pdf = await loadingTask.promise;
          pageCount = pdf.numPages;
        } catch (err) {
          console.error(`Ошибка парсинга ${file.name}:`, err);
        }

        const newFileId = loadedFilesRef.current.length;
        const newLoadedFile: LoadedFile = {
          file,
          arrayBuffer: cloneArrayBuffer(arrayBuffer),
          pdfInstance: pdf,
          pageCount: pageCount || 1,
        };
        loadedFilesRef.current = [...loadedFilesRef.current, newLoadedFile];
        setLoadedFiles([...loadedFilesRef.current]);

        const newPages: PageItem[] = [];
        for (let p = 0; p < (pageCount || 1); p++) {
          newPages.push({
            id: generateId(),
            fileId: newFileId,
            pageIndex: p,
            previewUrl: "",
            fileName: file.name,
            pageNumber: p + 1,
            isGeneratingPreview: !!pdf,
          });
        }

        setPageItems((prev) => {
          const updated = [...prev, ...newPages];
          pageItemsRef.current = updated;
          return updated;
        });

        if (pdf) {
          for (let p = 0; p < newPages.length; p++) {
            const pageItem = newPages[p];
            const progress = 20 + Math.round(((p + 1) / newPages.length) * 80);

            setLoadingProgress({
              current: progress,
              total: 100,
              fileName: `${file.name} (стр. ${p + 1}/${newPages.length})`,
              phase: "previews",
            });

            try {
              const previewUrl = await renderPagePreview(
                pdf,
                pageItem.pageIndex,
              );

              setPageItems((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((it) => it.id === pageItem.id);
                if (idx !== -1) {
                  updated[idx] = {
                    ...updated[idx],
                    previewUrl: previewUrl || "",
                    isGeneratingPreview: false,
                  };
                  if (!previewUrl) {
                    setFailedPreviews((f) => new Set(f).add(pageItem.id));
                  }
                }
                pageItemsRef.current = updated;
                return updated;
              });
            } catch (err) {
              console.error(`Preview error page ${p + 1}:`, err);
              setPageItems((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((it) => it.id === pageItem.id);
                if (idx !== -1) {
                  updated[idx] = {
                    ...updated[idx],
                    isGeneratingPreview: false,
                  };
                }
                pageItemsRef.current = updated;
                return updated;
              });
              setFailedPreviews((f) => new Set(f).add(pageItem.id));
            }

            await new Promise((r) => setTimeout(r, 50));
          }
        }
      }
    } catch (err) {
      console.error("Ошибка загрузки файлов:", err);
      alert("Ошибка при загрузке файлов");
    } finally {
      setIsLoadingFiles(false);
      setIsProcessing(false);
      setLoadingProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Retry превью ────────────────────────────────────────────────

  const retryPreview = async (
    itemId: string,
    fileId: number,
    pageIndex: number,
  ) => {
    setFailedPreviews((prev) => {
      const s = new Set(prev);
      s.delete(itemId);
      return s;
    });
    setPageItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, isGeneratingPreview: true } : it,
      ),
    );

    const file = loadedFilesRef.current[fileId];
    if (!file?.pdfInstance) return;

    try {
      const url = await renderPagePreview(file.pdfInstance, pageIndex);
      setPageItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? { ...it, previewUrl: url || "", isGeneratingPreview: false }
            : it,
        ),
      );
      if (!url) setFailedPreviews((f) => new Set(f).add(itemId));
    } catch {
      setPageItems((prev) =>
        prev.map((it) =>
          it.id === itemId ? { ...it, isGeneratingPreview: false } : it,
        ),
      );
      setFailedPreviews((f) => new Set(f).add(itemId));
    }
  };

  // ─── Выделение страниц ───────────────────────────────────────────

  const handlePageClick = (itemId: string, e: React.MouseEvent) => {
    const currentIndex = pageItems.findIndex((item) => item.id === itemId);

    if (e.shiftKey && lastClickedId) {
      const lastIndex = pageItems.findIndex(
        (item) => item.id === lastClickedId,
      );
      if (lastIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const newSelected = new Set(selectedPages);
        for (let i = start; i <= end; i++) newSelected.add(pageItems[i].id);
        setSelectedPages(newSelected);
      }
    } else if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set(selectedPages);
      if (newSelected.has(itemId)) newSelected.delete(itemId);
      else newSelected.add(itemId);
      setSelectedPages(newSelected);
      setLastClickedId(itemId);
    } else {
      if (selectedPages.has(itemId) && selectedPages.size === 1) {
        setSelectedPages(new Set());
        setLastClickedId(null);
      } else {
        setSelectedPages(new Set([itemId]));
        setLastClickedId(itemId);
      }
    }
  };

  // ─── Удаление страниц ────────────────────────────────────────────

  const deleteSelectedPages = () => {
    if (selectedPages.size === 0) return;

    const itemsToDelete: PageItem[] = [];
    const indicesToDelete: number[] = [];

    pageItems.forEach((item, index) => {
      if (selectedPages.has(item.id)) {
        itemsToDelete.push({ ...item });
        indicesToDelete.push(index);
      }
    });

    indicesToDelete.sort((a, b) => a - b);

    setDeleteHistory((prev) => [
      ...prev,
      { items: itemsToDelete, indices: indicesToDelete, timestamp: Date.now() },
    ]);
    setPageItems((prev) => {
      const updated = prev.filter((item) => !selectedPages.has(item.id));
      pageItemsRef.current = updated;
      return updated;
    });
    setSelectedPages(new Set());
    setLastClickedId(null);
  };

  const removePage = (itemId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const index = pageItems.findIndex((item) => item.id === itemId);
    if (index === -1) return;

    setDeleteHistory((prev) => [
      ...prev,
      {
        items: [{ ...pageItems[index] }],
        indices: [index],
        timestamp: Date.now(),
      },
    ]);
    setPageItems((prev) => {
      const updated = prev.filter((item) => item.id !== itemId);
      pageItemsRef.current = updated;
      return updated;
    });
    setSelectedPages((prev) => {
      const s = new Set(prev);
      s.delete(itemId);
      return s;
    });
  };

  const undoLastDelete = () => {
    if (deleteHistory.length === 0) return;

    const lastDelete = deleteHistory[deleteHistory.length - 1];
    setDeleteHistory((prev) => prev.slice(0, -1));

    setPageItems((prev) => {
      const newItems = [...prev];
      const sorted = lastDelete.items
        .map((item, i) => ({ ...item, _idx: lastDelete.indices[i] }))
        .sort((a, b) => a._idx - b._idx);

      for (const item of sorted) {
        const insertAt = Math.min(item._idx, newItems.length);
        const { _idx, ...clean } = item as any;
        newItems.splice(insertAt, 0, clean);
      }

      pageItemsRef.current = newItems;
      return newItems;
    });
  };

  // ─── Открытие превью ─────────────────────────────────────────────

  const openPreview = async (item: PageItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const index = pageItems.findIndex((p) => p.id === item.id);
    setPreviewPage(item);
    setPreviewIndex(index);
    setHighResPreviewUrl("");

    const url = await renderHighResPreview(item.fileId, item.pageIndex);
    setHighResPreviewUrl(url || item.previewUrl);
  };

  // ─── Drag & Drop файлов ──────────────────────────────────────────

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    if (isLoadingFiles) {
      alert("Подождите, идёт загрузка...");
      return;
    }

    const files = e.dataTransfer.files;
    if (!files.length) return;

    const dt = new DataTransfer();
    Array.from(files).forEach((f) => dt.items.add(f));

    if (fileInputRef.current) {
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFile(false);
    }
  };

  // ─── Drag & Drop страниц в основной сетке ────────────────────────

  const handlePageDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    itemId: string,
  ) => {
    const ids =
      selectedPages.has(itemId) && selectedPages.size > 1
        ? Array.from(selectedPages)
        : [itemId];
    const payload: DragPayload = { type: "grid-page", ids };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const handlePageDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handlePageDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetIndex: number,
  ) => {
    e.preventDefault();
    setDragOverIndex(null);

    let data: DragPayload | null = null;
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!data || data.type !== "grid-page") return;

    const ids = data.ids;

    setPageItems((prev) => {
      const targetItem = prev[targetIndex];
      const draggedItems = prev.filter((p) => ids.includes(p.id));
      const remaining = prev.filter((p) => !ids.includes(p.id));

      let insertAt = remaining.findIndex((p) => p.id === targetItem?.id);
      if (insertAt === -1) insertAt = remaining.length;

      const newItems = [
        ...remaining.slice(0, insertAt),
        ...draggedItems,
        ...remaining.slice(insertAt),
      ];
      pageItemsRef.current = newItems;
      return newItems;
    });
  };

  // ─── НОВОЕ: Выходные документы (разделение на файлы) ─────────────

  const createOutputDocument = (initialPages: PageItem[] = []) => {
    const name = `Документ ${docCounterRef.current}`;
    docCounterRef.current += 1;
    setOutputDocuments((prev) => [
      ...prev,
      { id: generateId(), name, pages: initialPages },
    ]);
  };

  const addSelectedToNewDocument = () => {
    const selected = pageItems.filter((p) => selectedPages.has(p.id));
    if (selected.length === 0) return;
    const cloned = selected.map((p) => ({ ...p, id: generateId() }));
    createOutputDocument(cloned);
  };

  const addSelectedToDocument = (docId: string) => {
    const selected = pageItems.filter((p) => selectedPages.has(p.id));
    if (selected.length === 0) return;
    const cloned = selected.map((p) => ({ ...p, id: generateId() }));
    setOutputDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId ? { ...doc, pages: [...doc.pages, ...cloned] } : doc,
      ),
    );
  };

  const removePageFromDocument = (docId: string, pageId: string) => {
    setOutputDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId
          ? { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) }
          : doc,
      ),
    );
  };

  const removeOutputDocument = (docId: string) => {
    setOutputDocuments((prev) => prev.filter((doc) => doc.id !== docId));
  };

  const renameOutputDocument = (docId: string, name: string) => {
    setOutputDocuments((prev) =>
      prev.map((doc) => (doc.id === docId ? { ...doc, name } : doc)),
    );
  };

  const handleBinContainerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleBinContainerDrop = (
    e: React.DragEvent<HTMLDivElement>,
    docId: string,
  ) => {
    e.preventDefault();
    let data: DragPayload | null = null;
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!data || data.type !== "grid-page") return;

    const sourceItems = pageItemsRef.current.filter((p) =>
      data!.type === "grid-page" ? data!.ids.includes(p.id) : false,
    );
    if (sourceItems.length === 0) return;

    const cloned = sourceItems.map((p) => ({ ...p, id: generateId() }));
    setOutputDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId ? { ...doc, pages: [...doc.pages, ...cloned] } : doc,
      ),
    );
    setBinDragOverKey(null);
  };

  const handleBinPageDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    docId: string,
    pageId: string,
  ) => {
    const payload: DragPayload = { type: "bin-page", docId, id: pageId };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleBinPageDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    docId: string,
    index: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setBinDragOverKey(`${docId}:${index}`);
  };

  const handleBinPageDrop = (
    e: React.DragEvent<HTMLDivElement>,
    docId: string,
    targetIndex: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setBinDragOverKey(null);

    let data: DragPayload | null = null;
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!data) return;

    if (data.type === "bin-page" && data.docId === docId) {
      setOutputDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id !== docId) return doc;
          const pages = [...doc.pages];
          const fromIndex = pages.findIndex((p) =>
            (p.id === data!.type) === "bin-page" ? (data as any).id : "",
          );
          return doc;
        }),
      );
      // корректная реализация ниже
      setOutputDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id !== docId) return doc;
          const pages = [...doc.pages];
          const fromIndex = pages.findIndex((p) => p.id === (data as any).id);
          if (fromIndex === -1) return doc;
          const [moved] = pages.splice(fromIndex, 1);
          const insertAt = Math.min(targetIndex, pages.length);
          pages.splice(insertAt, 0, moved);
          return { ...doc, pages };
        }),
      );
    } else if (data.type === "grid-page") {
      // добавление страниц из основной сетки прямо на конкретную позицию
      const sourceItems = pageItemsRef.current.filter((p) =>
        (data as any).ids.includes(p.id),
      );
      if (sourceItems.length === 0) return;
      const cloned = sourceItems.map((p) => ({ ...p, id: generateId() }));
      setOutputDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id !== docId) return doc;
          const pages = [...doc.pages];
          const insertAt = Math.min(targetIndex, pages.length);
          pages.splice(insertAt, 0, ...cloned);
          return { ...doc, pages };
        }),
      );
    }
  };

  // ─── Скачивание PDF ──────────────────────────────────────────────

  // ─── Поворот страниц ─────────────────────────────────────────────

  const rotatePages = (ids: string[], delta: number) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setPageItems((prev) =>
      prev.map((it) =>
        idSet.has(it.id)
          ? { ...it, rotation: ((((it.rotation ?? 0) + delta) % 360) + 360) % 360 }
          : it,
      ),
    );
  };

  const rotateSelected = (delta: number) =>
    rotatePages([...selectedPages], delta);

  // ─── Редактор-слой: открытие и сохранение ────────────────────────

  const openEditor = async (item: PageItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingLoading(true);
    try {
      const bg = await renderHighResPreview(item.fileId, item.pageIndex);
      if (bg) setEditing({ item, bg });
    } finally {
      setEditingLoading(false);
    }
  };

  // Миниатюра страницы с «запечёнными» аннотациями (для предпросмотра в сетке)
  const makeAnnotatedThumb = async (
    bgUrl: string,
    anns: Annotation[],
  ): Promise<string | null> => {
    try {
      const loadImg = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
      const bg = await loadImg(bgUrl);
      const W = bg.naturalWidth;
      const H = bg.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bg, 0, 0);
      const sw = W / 640; // масштаб толщины линий под размер холста

      for (const a of anns) {
        if (a.type === "highlight") {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = a.color;
          ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H);
          ctx.globalAlpha = 1;
        } else if (a.type === "rect") {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = a.strokeWidth * sw;
          ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H);
        } else if (a.type === "line" || a.type === "arrow") {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = a.strokeWidth * sw;
          ctx.lineCap = "round";
          const x1 = a.x1 * W;
          const y1 = a.y1 * H;
          const x2 = a.x2 * W;
          const y2 = a.y2 * H;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (a.type === "arrow") {
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const len = (8 + a.strokeWidth * 2.2) * sw;
            for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
              ctx.beginPath();
              ctx.moveTo(x2, y2);
              ctx.lineTo(
                x2 + len * Math.cos(ang + da),
                y2 + len * Math.sin(ang + da),
              );
              ctx.stroke();
            }
          }
        } else if (a.type === "draw") {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = a.strokeWidth * sw;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          a.points.forEach((p, i) => {
            const px = p.x * W;
            const py = p.y * H;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
        } else if (a.type === "image") {
          try {
            const im = await loadImg(a.dataUrl);
            ctx.drawImage(im, a.x * W, a.y * H, a.w * W, a.h * H);
          } catch {
            /* пропускаем битую картинку */
          }
        } else if (a.type === "text") {
          const fs = a.fontSize * H;
          ctx.fillStyle = a.color;
          ctx.font = `${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
          ctx.textBaseline = "top";
          const maxW = a.w * W;
          const lineH = fs * 1.2;
          let ly = a.y * H;
          for (const raw of (a.text || "").split("\n")) {
            const words = raw.split(" ");
            let cur = "";
            for (const w of words) {
              const test = cur ? `${cur} ${w}` : w;
              if (ctx.measureText(test).width > maxW && cur) {
                ctx.fillText(cur, a.x * W, ly);
                ly += lineH;
                cur = w;
              } else {
                cur = test;
              }
            }
            ctx.fillText(cur, a.x * W, ly);
            ly += lineH;
          }
        }
      }
      return canvas.toDataURL("image/jpeg", 0.78);
    } catch (err) {
      console.warn("Ошибка генерации превью с аннотациями:", err);
      return null;
    }
  };

  const saveAnnotations = async (
    id: string,
    annotations: Annotation[],
    bgUrl: string,
  ) => {
    let previewUrl: string | null = null;
    if (annotations.length > 0) {
      previewUrl = await makeAnnotatedThumb(bgUrl, annotations);
    }
    setPageItems((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, annotations, ...(previewUrl ? { previewUrl } : {}) }
          : p,
      ),
    );
  };

  // ─── Оформление: рендер текста в PNG (кириллица через canvas) ─────

  const renderTextToImage = (
    text: string,
    opts: { fontSize: number; color: string; bold?: boolean },
  ) => {
    const s = 3; // супер-сэмплинг для чёткости
    const font = `${opts.bold ? "bold " : ""}${
      opts.fontSize * s
    }px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    measureCtx.font = font;
    const w = Math.ceil(measureCtx.measureText(text).width) + 12 * s;
    const h = Math.ceil(opts.fontSize * s * 1.4);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    ctx.fillStyle = opts.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: w / s,
      height: h / s,
    };
  };

  const applyDecorations = async (pdfDoc: PDFDocument) => {
    const pages = pdfDoc.getPages();
    const total = pages.length;

    let wmImg: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
    let wmW = 0;
    let wmH = 0;
    if (watermark.enabled && watermark.text.trim()) {
      const img = renderTextToImage(watermark.text, {
        fontSize: watermark.size,
        color: watermark.color,
        bold: true,
      });
      wmImg = await pdfDoc.embedPng(img.dataUrl);
      wmW = img.width;
      wmH = img.height;
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width: pw, height: ph } = page.getSize();

      if (wmImg) {
        const scale = Math.min((pw * 0.85) / wmW, 4);
        const w = wmW * scale;
        const h = wmH * scale;
        const angle = 45;
        const rad = (angle * Math.PI) / 180;
        // Центрируем изображение с учётом поворота вокруг нижнего-левого угла
        const rx = (w / 2) * Math.cos(rad) - (h / 2) * Math.sin(rad);
        const ry = (w / 2) * Math.sin(rad) + (h / 2) * Math.cos(rad);
        page.drawImage(wmImg, {
          x: pw / 2 - rx,
          y: ph / 2 - ry,
          width: w,
          height: h,
          opacity: watermark.opacity,
          rotate: degrees(angle),
        });
      }

      if (pageNumbers.enabled) {
        const label = pageNumbers.format
          .replace("{n}", String(i + 1))
          .replace("{total}", String(total));
        const numImg = renderTextToImage(label, {
          fontSize: pageNumbers.size,
          color: pageNumbers.color,
        });
        const png = await pdfDoc.embedPng(numImg.dataUrl);
        const margin = 24;
        let x = pw / 2 - numImg.width / 2;
        let y = margin;
        if (pageNumbers.position.includes("top"))
          y = ph - margin - numImg.height;
        if (pageNumbers.position.includes("left")) x = margin;
        if (pageNumbers.position.includes("right"))
          x = pw - margin - numImg.width;
        page.drawImage(png, {
          x,
          y,
          width: numImg.width,
          height: numImg.height,
        });
      }
    }
  };

  // ─── Запекание аннотаций редактора в PDF ─────────────────────────

  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
    return rgb(
      parseInt(n.slice(0, 2), 16) / 255,
      parseInt(n.slice(2, 4), 16) / 255,
      parseInt(n.slice(4, 6), 16) / 255,
    );
  };

  const embedImageSmart = async (pdfDoc: PDFDocument, dataUrl: string) => {
    try {
      if (dataUrl.startsWith("data:image/png"))
        return await pdfDoc.embedPng(dataUrl);
      if (/^data:image\/jpe?g/.test(dataUrl))
        return await pdfDoc.embedJpg(dataUrl);
    } catch {
      /* конвертируем ниже */
    }
    // Прочие форматы → через canvas в PNG
    const png: string = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d")!.drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
    return await pdfDoc.embedPng(png);
  };

  // Текст аннотации → PNG (перенос по ширине бокса, поддержка кириллицы)
  const renderTextBlock = (
    text: string,
    boxWidthPt: number,
    fontSizePt: number,
    color: string,
  ) => {
    const s = 3;
    const font = `${fontSizePt * s}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;
    const maxW = Math.max(boxWidthPt * s, fontSizePt * s);
    const lines: string[] = [];
    for (const raw of (text || "").split("\n")) {
      const words = raw.split(" ");
      let cur = "";
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (measure.measureText(test).width > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      lines.push(cur);
    }
    const lineH = fontSizePt * s * 1.2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(maxW);
    canvas.height = Math.max(1, Math.ceil(lines.length * lineH));
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    lines.forEach((ln, i) => ctx.fillText(ln, 0, i * lineH));
    return {
      dataUrl: canvas.toDataURL("image/png"),
      heightPt: canvas.height / s,
    };
  };

  const applyAnnotations = async (pdfDoc: PDFDocument, items: PageItem[]) => {
    const pages = pdfDoc.getPages();
    for (let i = 0; i < items.length; i++) {
      const anns = items[i].annotations;
      if (!anns || anns.length === 0) continue;
      const page = pages[i];
      if (!page) continue;
      const { width: W, height: H } = page.getSize();

      for (const a of anns) {
        if (a.type === "highlight") {
          page.drawRectangle({
            x: a.x * W,
            y: H - (a.y + a.h) * H,
            width: a.w * W,
            height: a.h * H,
            color: hexToRgb(a.color),
            opacity: 0.35,
          });
        } else if (a.type === "rect") {
          page.drawRectangle({
            x: a.x * W,
            y: H - (a.y + a.h) * H,
            width: a.w * W,
            height: a.h * H,
            borderColor: hexToRgb(a.color),
            borderWidth: a.strokeWidth,
          });
        } else if (a.type === "line" || a.type === "arrow") {
          const start = { x: a.x1 * W, y: H - a.y1 * H };
          const end = { x: a.x2 * W, y: H - a.y2 * H };
          const col = hexToRgb(a.color);
          page.drawLine({ start, end, thickness: a.strokeWidth, color: col });
          if (a.type === "arrow") {
            const ang = Math.atan2(end.y - start.y, end.x - start.x);
            const len = 8 + a.strokeWidth * 2.2;
            for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
              page.drawLine({
                start: end,
                end: {
                  x: end.x + len * Math.cos(ang + da),
                  y: end.y + len * Math.sin(ang + da),
                },
                thickness: a.strokeWidth,
                color: col,
              });
            }
          }
        } else if (a.type === "draw") {
          const col = hexToRgb(a.color);
          for (let k = 1; k < a.points.length; k++) {
            const p0 = a.points[k - 1];
            const p1 = a.points[k];
            page.drawLine({
              start: { x: p0.x * W, y: H - p0.y * H },
              end: { x: p1.x * W, y: H - p1.y * H },
              thickness: a.strokeWidth,
              color: col,
            });
          }
        } else if (a.type === "image") {
          try {
            const img = await embedImageSmart(pdfDoc, a.dataUrl);
            page.drawImage(img, {
              x: a.x * W,
              y: H - (a.y + a.h) * H,
              width: a.w * W,
              height: a.h * H,
            });
          } catch (err) {
            console.warn("Не удалось вставить картинку-аннотацию:", err);
          }
        } else if (a.type === "text") {
          const block = renderTextBlock(a.text, a.w * W, a.fontSize * H, a.color);
          try {
            const png = await pdfDoc.embedPng(block.dataUrl);
            page.drawImage(png, {
              x: a.x * W,
              y: H - a.y * H - block.heightPt,
              width: a.w * W,
              height: block.heightPt,
            });
          } catch (err) {
            console.warn("Не удалось вставить текст-аннотацию:", err);
          }
        }
      }
    }
  };

  // ─── Сборка PDF из выбранных страниц (с учётом поворотов) ─────────

  const buildMergedBytes = async (
    items: PageItem[],
    decorate = false,
  ): Promise<Uint8Array> => {
    const mergedPdf = await PDFDocument.create();
    const uniqueFileIds = [...new Set(items.map((it) => it.fileId))];
    const loadedDocs = new Map<number, PDFDocument>();

    for (const fileId of uniqueFileIds) {
      const lf = loadedFilesRef.current[fileId];
      if (!lf) continue;
      try {
        loadedDocs.set(
          fileId,
          await PDFDocument.load(cloneArrayBuffer(lf.arrayBuffer)),
        );
      } catch (err) {
        console.error(`Ошибка загрузки PDFDocument fileId=${fileId}:`, err);
      }
    }

    for (const item of items) {
      const srcDoc = loadedDocs.get(item.fileId);
      if (!srcDoc) continue;
      try {
        const [page] = await mergedPdf.copyPages(srcDoc, [item.pageIndex]);
        if (item.rotation) {
          const current = page.getRotation().angle;
          page.setRotation(degrees((current + item.rotation) % 360));
        }
        mergedPdf.addPage(page);
      } catch (err) {
        console.error(`Ошибка копирования стр. ${item.pageIndex}:`, err);
      }
    }

    await applyAnnotations(mergedPdf, items);
    if (decorate) await applyDecorations(mergedPdf);
    return mergedPdf.save();
  };

  const triggerDownload = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} Б`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
    return `${(n / 1024 / 1024).toFixed(2)} МБ`;
  };

  // ─── Сжатие (растеризация страниц в JPEG и пересборка) ────────────

  const buildCompressedBytes = async (
    items: PageItem[],
    quality: number,
    decorate = false,
  ): Promise<Uint8Array> => {
    const dpi = 150;
    const scale = dpi / 72;
    const maxDimension = 4096;
    const outPdf = await PDFDocument.create();

    for (const item of items) {
      const lf = loadedFilesRef.current[item.fileId];
      const pdfjsDoc = lf?.pdfInstance;
      if (!pdfjsDoc) continue;

      try {
        const page = await pdfjsDoc.getPage(item.pageIndex + 1);
        const rotation = ((page.rotate || 0) + (item.rotation ?? 0)) % 360;
        const viewport = page.getViewport({ scale, rotation });

        let width = Math.floor(viewport.width);
        let height = Math.floor(viewport.height);
        if (width > maxDimension || height > maxDimension) {
          const r = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * r);
          height = Math.floor(height * r);
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) continue;
        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const renderViewport = page.getViewport({
          scale: scale * (width / viewport.width),
          rotation,
        });
        await page.render({
          canvasContext: ctx,
          viewport: renderViewport,
          background: "white",
          intent: "print",
        }).promise;

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const img = await outPdf.embedJpg(dataUrl);
        const pdfPage = outPdf.addPage([width, height]);
        pdfPage.drawImage(img, { x: 0, y: 0, width, height });

        canvas.width = 0;
        canvas.height = 0;
      } catch (err) {
        console.warn(`Ошибка сжатия страницы:`, err);
      }
    }

    await applyAnnotations(outPdf, items);
    if (decorate) await applyDecorations(outPdf);
    return outPdf.save();
  };

  const runCompress = async (items: PageItem[]) => {
    if (items.length === 0) return;
    setIsProcessing(true);
    if (compressResult) URL.revokeObjectURL(compressResult.url);
    setCompressResult(null);
    try {
      const originalBytes = await buildMergedBytes(items, true);
      const compressedBytes = await buildCompressedBytes(
        items,
        compressQuality,
        true,
      );
      const originalSize = originalBytes.byteLength;
      const compressedSize = compressedBytes.byteLength;
      const url = URL.createObjectURL(
        new Blob([compressedBytes], { type: "application/pdf" }),
      );
      setCompressResult({
        originalSize,
        compressedSize,
        ratio:
          originalSize > 0
            ? Math.round((1 - compressedSize / originalSize) * 100)
            : 0,
        url,
        fileName: `compressed-${Date.now()}.pdf`,
      });
    } catch (err) {
      console.error("Ошибка сжатия:", err);
      alert("Произошла ошибка при сжатии PDF");
    } finally {
      setIsProcessing(false);
    }
  };

  const closeCompress = () => {
    if (compressResult) URL.revokeObjectURL(compressResult.url);
    setCompressResult(null);
    setShowCompress(false);
  };

  const downloadPdfFromItems = async (
    items: PageItem[],
    filenamePrefix: string,
  ) => {
    if (items.length === 0) return;
    setIsProcessing(true);
    try {
      const pdfBytes = await buildMergedBytes(items, true);
      triggerDownload(pdfBytes, `${filenamePrefix}-${Date.now()}.pdf`);
    } catch (err) {
      console.error("Ошибка создания PDF:", err);
      alert("Произошла ошибка при создании PDF");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadMergedPdf = () => downloadPdfFromItems(pageItems, "merged");

  const downloadSelectedPdf = () =>
    downloadPdfFromItems(
      pageItems.filter((p) => selectedPages.has(p.id)),
      "selected",
    );

  const downloadOutputDocument = (docId: string) => {
    const doc = outputDocuments.find((d) => d.id === docId);
    if (!doc || doc.pages.length === 0) return;
    downloadPdfFromItems(doc.pages, doc.name.replace(/\s+/g, "_"));
  };

  // ─── Очистка ─────────────────────────────────────────────────────

  const clearAll = () => {
    loadedFilesRef.current.forEach((f) => f.pdfInstance?.destroy?.());
    loadedFilesRef.current = [];
    pageItemsRef.current = [];

    setLoadedFiles([]);
    setPageItems([]);
    setSelectedPages(new Set());
    setLastClickedId(null);
    setDeleteHistory([]);
    setPreviewPage(null);
    setPreviewIndex(-1);
    setHighResPreviewUrl("");
    setFailedPreviews(new Set());
    setLoadingProgress(null);
    setOutputDocuments([]);
    docCounterRef.current = 1;
  };

  const selectedCount = selectedPages.size;

  // ─── JSX ─────────────────────────────────────────────────────────

  return (
    <PageShell
      title="PDF Studio"
      subtitle="Объединяйте, переставляйте, поворачивайте, удаляйте и сжимайте страницы PDF — прямо в браузере"
      onShowInstructions={() => setShowInstructions(true)}
      width={1720}
    >

      {/* Плавающая панель инструментов */}
      {pageItems.length > 0 && (
        <div className="floating-toolbar">
          <div className="floating-toolbar-content">
            <div className="floating-toolbar-left">
              <span className="floating-toolbar-title">
                Страниц: {pageItems.length}
                {selectedCount > 0 && ` | Выделено: ${selectedCount}`}
              </span>
            </div>
            <div className="floating-toolbar-right">
              {deleteHistory.length > 0 && (
                <button
                  onClick={undoLastDelete}
                  className="toolbar-button icon-only"
                  title="Отменить удаление (Ctrl/cmd + Z)"
                >
                  ↩️
                </button>
              )}
              {selectedCount > 0 && (
                <>
                  <button
                    onClick={() => rotateSelected(90)}
                    className="toolbar-button icon-only"
                    title={`Повернуть выделенные на 90° (${selectedCount})`}
                  >
                    ↻
                  </button>
                  <button
                    onClick={addSelectedToNewDocument}
                    className="toolbar-button icon-only"
                    title="Выделенные → в новый документ"
                  >
                    📂
                  </button>
                  <button
                    onClick={downloadSelectedPdf}
                    className="toolbar-button icon-only"
                    title={`Скачать выделенные (${selectedCount})`}
                  >
                    💾
                  </button>
                  <button
                    onClick={deleteSelectedPages}
                    className="toolbar-button icon-only danger"
                    title={`Удалить выделенные (${selectedCount})`}
                  >
                    🗑️
                  </button>
                  <span className="toolbar-divider" />
                </>
              )}
              <button
                onClick={downloadMergedPdf}
                disabled={isProcessing}
                className="toolbar-button primary"
              >
                {isProcessing ? "⏳" : "💾"} Скачать
              </button>
              <button
                onClick={() => setShowCompress(true)}
                disabled={isProcessing}
                className="toolbar-button"
                title="Сжать PDF (уменьшить размер файла)"
              >
                🗜️ Сжать
              </button>
              <button
                onClick={() => setShowDecorate(true)}
                disabled={isProcessing}
                className={`toolbar-button icon-only ${
                  pageNumbers.enabled || watermark.enabled ? "is-active" : ""
                }`}
                title="Номера страниц и водяной знак"
              >
                🔖
              </button>
              <button
                onClick={clearAll}
                className="toolbar-button icon-only"
                title="Очистить всё"
              >
                🧹
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Зона загрузки */}
      <div className="pdf-editor-header">
        <div
          className={`upload-zone ${isDraggingFile ? "dragging" : ""} ${isLoadingFiles ? "loading" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !isLoadingFiles && fileInputRef.current?.click()}
        >
          <div className="upload-icon-editor">📄</div>
          {isLoadingFiles && loadingProgress ? (
            <>
              <p className="upload-text">Загрузка файлов...</p>
              <p className="upload-subtext">{loadingProgress.fileName}</p>
              <div className="progress-bar-wrapper">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${loadingProgress.current}%` }}
                />
              </div>
              <p className="upload-subtext progress-phase-label">
                {loadingProgress.phase === "reading" && "Чтение файла..."}
                {loadingProgress.phase === "parsing" &&
                  "Анализ структуры PDF..."}
                {loadingProgress.phase === "previews" &&
                  "Генерация миниатюр..."}
              </p>
            </>
          ) : (
            <>
              <p className="upload-text">Перетащите PDF файлы сюда</p>
              <p className="upload-subtext">или</p>
              <button className="primary-button">Выбрать файлы</button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf"
            onChange={handleFileChange}
            disabled={isLoadingFiles}
            className="file-input-hidden"
          />
        </div>
      </div>

      {/* Подсказка */}
      {pageItems.length > 0 && (
        <div className="selection-hint">
          <span>
            💡 Клик — выбрать | Ctrl/cmd + клик — добавить | Shift + клик —
            диапазон | Delete — удалить | Ctrl/cmd + Z — отменить | Ctrl/cmd + A
            — все | Стрелки — навигация в просмотре | Перетащите выделенные
            страницы в документ ниже, чтобы разделить файл
          </span>
        </div>
      )}

      <div className="pages-and-output-wrapper">
        {/* Сетка страниц */}
        {pageItems.length > 0 && (
          <div className="pages-container">
            <div className="pages-header">
              <div className="pages-title">
                <span>Страницы</span>
                <span className="pages-count">{pageItems.length}</span>
              </div>
            </div>

            <div className="pages-grid">
              {pageItems.map((item, index) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handlePageDragStart(e, item.id)}
                  onDragOver={(e) => handlePageDragOver(e, index)}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={(e) => handlePageDrop(e, index)}
                  onClick={(e) => handlePageClick(item.id, e)}
                  className={`page-item
              ${dragOverIndex === index ? "dragging-over" : ""}
              ${selectedPages.has(item.id) ? "selected" : ""}
            `}
                >
                  <div className="page-controls">
                    <button
                      onClick={(e) => openPreview(item, e)}
                      className="preview-page-button"
                      title="Просмотр"
                    >
                      🔍
                    </button>
                    <button
                      onClick={(e) => openEditor(item, e)}
                      className="preview-page-button"
                      title="Редактировать (текст, фигуры, подпись)"
                    >
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
                      onClick={(e) => removePage(item.id, e)}
                      className="delete-page-button"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                  {item.annotations && item.annotations.length > 0 && (
                    <span className="page-annot-badge" title="Есть аннотации">
                      ✏️ {item.annotations.length}
                    </span>
                  )}

                  <div className="page-preview-container">
                    {item.isGeneratingPreview ? (
                      <div className="page-preview-placeholder">
                        <div className="preview-spinner" />
                        <span className="page-preview-text">Загрузка...</span>
                      </div>
                    ) : item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={`Страница ${item.pageNumber}`}
                        className="page-preview-image"
                        loading="lazy"
                        style={
                          item.rotation
                            ? { transform: `rotate(${item.rotation}deg)` }
                            : undefined
                        }
                      />
                    ) : failedPreviews.has(item.id) ? (
                      <div className="page-preview-placeholder error-state">
                        <div className="page-preview-icon">⚠️</div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            retryPreview(item.id, item.fileId, item.pageIndex);
                          }}
                          className="primary-button small-button"
                        >
                          Повторить
                        </button>
                      </div>
                    ) : (
                      <div className="page-preview-placeholder">
                        <div className="page-preview-icon">📄</div>
                      </div>
                    )}
                  </div>

                  <div className="page-number-badge">{index + 1}</div>

                  <div className="page-info">
                    <div className="page-filename" title={item.fileName}>
                      {item.fileName}
                    </div>
                    <div className="page-number">
                      Страница {item.pageNumber}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pages-footer">
              <div className="pages-footer-left">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoadingFiles}
                  className="primary-button"
                >
                  📄 Добавить файлы
                </button>
              </div>
              <div className="pages-footer-right">
                <button
                  onClick={downloadMergedPdf}
                  disabled={isProcessing}
                  className="success-button"
                >
                  {isProcessing ? "⏳ Обработка..." : "💾 Скачать PDF"}
                </button>
                <button onClick={clearAll} className="secondary-button">
                  🗑️ Очистить все
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── НОВОЕ: Разделение на несколько файлов ─────────────────── */}
        {pageItems.length > 0 && (
          <div className="output-documents-section">
            <div className="output-documents-header">
              <h3>📂 Разделение на файлы</h3>
              <button
                className="secondary-button"
                onClick={() => createOutputDocument([])}
              >
                + Новый документ
              </button>
            </div>
            <p className="output-documents-hint">
              Перетащите страницы из сетки слева в документ ниже, чтобы собрать
              отдельный файл. Исходный набор страниц при этом не меняется —
              добавляются копии.
            </p>

            {outputDocuments.length === 0 ? (
              <div className="output-documents-empty">
                Нет созданных документов. Нажмите «+ Новый документ» и
                перетащите туда нужные страницы (или выделите страницы и нажмите
                «📂 В новый документ» в панели сверху).
              </div>
            ) : (
              <div className="output-documents-list">
                {outputDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="output-document-card"
                    onDragOver={handleBinContainerDragOver}
                    onDrop={(e) => handleBinContainerDrop(e, doc.id)}
                  >
                    <div className="output-document-header">
                      <input
                        type="text"
                        value={doc.name}
                        onChange={(e) =>
                          renameOutputDocument(doc.id, e.target.value)
                        }
                        className="output-document-name-input"
                      />
                      <span className="output-document-count">
                        {doc.pages.length} стр.
                      </span>
                      <div className="output-document-actions">
                        {selectedCount > 0 && (
                          <button
                            className="toolbar-button"
                            title="Добавить выделенные страницы в этот документ"
                            onClick={() => addSelectedToDocument(doc.id)}
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
                        <button
                          className="toolbar-button clear-button"
                          onClick={() => removeOutputDocument(doc.id)}
                          title="Удалить документ"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    <div className="output-document-pages">
                      {doc.pages.length === 0 ? (
                        <div className="output-document-dropzone-placeholder">
                          Перетащите сюда страницы
                        </div>
                      ) : (
                        doc.pages.map((page, idx) => (
                          <div
                            key={page.id}
                            draggable
                            onDragStart={(e) =>
                              handleBinPageDragStart(e, doc.id, page.id)
                            }
                            onDragOver={(e) =>
                              handleBinPageDragOver(e, doc.id, idx)
                            }
                            onDragLeave={() => setBinDragOverKey(null)}
                            onDrop={(e) => handleBinPageDrop(e, doc.id, idx)}
                            className={`output-document-page-item ${
                              binDragOverKey === `${doc.id}:${idx}`
                                ? "dragging-over"
                                : ""
                            }`}
                            title={`${page.fileName} — стр. ${page.pageNumber}`}
                          >
                            {page.previewUrl ? (
                              <img
                                src={page.previewUrl}
                                alt=""
                                className="output-document-page-thumb"
                              />
                            ) : (
                              <div className="output-document-page-thumb placeholder">
                                📄
                              </div>
                            )}
                            <button
                              className="output-document-page-remove"
                              onClick={() =>
                                removePageFromDocument(doc.id, page.id)
                              }
                              title="Убрать из документа"
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Модальное окно просмотра */}
      {previewPage && (
        <div
          className="preview-modal-overlay"
          onClick={() => {
            setPreviewPage(null);
            setHighResPreviewUrl("");
          }}
        >
          <div
            className="preview-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-modal-header">
              <h3>
                {previewPage.fileName} — стр. {previewPage.pageNumber}
              </h3>
              <div className="preview-modal-controls">
                <span className="preview-modal-hint">
                  ← → для навигации · Esc — закрыть
                </span>
                <div className="preview-nav-buttons">
                  <button
                    className="preview-nav-button"
                    onClick={() => navigatePreview(-1)}
                    disabled={previewIndex <= 0}
                    title="Предыдущая (←)"
                  >
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
                <button
                  className="preview-modal-close"
                  onClick={() => {
                    setPreviewPage(null);
                    setHighResPreviewUrl("");
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="preview-modal-body">
              {highResPreviewUrl ? (
                <div className="preview-modal-image-container">
                  <img
                    src={highResPreviewUrl}
                    alt={`Страница ${previewPage.pageNumber}`}
                    className="preview-modal-image"
                  />
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

      {/* Пустое состояние */}
      {pageItems.length === 0 && !isLoadingFiles && (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <h3 className="empty-title">Нет загруженных страниц</h3>
          <p className="empty-text">Загрузите PDF файлы для начала работы</p>
        </div>
      )}

      {showCompress && (
        <div
          className="im-overlay"
          onClick={() => !isProcessing && closeCompress()}
        >
          <div
            className="im-modal"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="im-header">
              <h2 className="im-title">🗜️ Сжатие PDF</h2>
              <button
                className="im-close"
                onClick={() => !isProcessing && closeCompress()}
                aria-label="Закрыть"
              >
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
                      <strong>
                        {formatBytes(compressResult.compressedSize)}
                      </strong>
                    </div>
                    <div
                      className={`compress-result__badge ${
                        compressResult.ratio > 0
                          ? "is-good"
                          : "is-bad"
                      }`}
                    >
                      {compressResult.ratio > 0
                        ? `Экономия ${compressResult.ratio}%`
                        : `Файл не уменьшился (${compressResult.ratio}%)`}
                    </div>
                  </div>
                  {compressResult.ratio <= 0 && (
                    <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      Для текстовых PDF растеризация может не уменьшить размер.
                      Попробуйте качество ниже или оставьте исходный файл.
                    </p>
                  )}
                </div>
                <div className="im-footer" style={{ gap: 10 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => setCompressResult(null)}
                  >
                    ← Сжать заново
                  </button>
                  <a
                    className="btn-primary"
                    href={compressResult.url}
                    download={compressResult.fileName}
                  >
                    💾 Скачать
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="im-body">
                  <p>
                    Страницы будут перерисованы в изображения — это эффективно
                    уменьшает вес PDF со сканами и картинками. Учитываются
                    текущий порядок, удаления и повороты страниц.
                  </p>
                  <label
                    className="ds-section-title"
                    style={{ marginTop: 12, marginBottom: 8 }}
                  >
                    Качество: {Math.round(compressQuality * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    value={compressQuality}
                    onChange={(e) =>
                      setCompressQuality(Number(e.target.value))
                    }
                    style={{ width: "100%" }}
                  />
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    Ниже качество — меньше файл. 70–85% — хороший баланс.
                  </p>
                </div>
                <div className="im-footer" style={{ gap: 10 }}>
                  {selectedCount > 0 && (
                    <button
                      className="btn-secondary"
                      disabled={isProcessing}
                      onClick={() =>
                        runCompress(
                          pageItems.filter((p) => selectedPages.has(p.id)),
                        )
                      }
                    >
                      Сжать выделенные ({selectedCount})
                    </button>
                  )}
                  <button
                    className="btn-primary"
                    disabled={isProcessing}
                    onClick={() => runCompress(pageItems)}
                  >
                    {isProcessing ? "⏳ Обработка..." : "Сжать"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showDecorate && (
        <div className="im-overlay" onClick={() => setShowDecorate(false)}>
          <div
            className="im-modal"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="im-header">
              <h2 className="im-title">🔖 Оформление</h2>
              <button
                className="im-close"
                onClick={() => setShowDecorate(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <div className="im-body">
              {/* Номера страниц */}
              <label className="decorate-toggle">
                <input
                  type="checkbox"
                  checked={pageNumbers.enabled}
                  onChange={(e) =>
                    setPageNumbers({
                      ...pageNumbers,
                      enabled: e.target.checked,
                    })
                  }
                />
                <span className="ds-section-title" style={{ margin: 0 }}>
                  🔢 Номера страниц
                </span>
              </label>
              {pageNumbers.enabled && (
                <div className="decorate-grid">
                  <label>
                    Позиция
                    <select
                      className="ds-select"
                      value={pageNumbers.position}
                      onChange={(e) =>
                        setPageNumbers({
                          ...pageNumbers,
                          position: e.target.value,
                        })
                      }
                    >
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
                    <select
                      className="ds-select"
                      value={pageNumbers.format}
                      onChange={(e) =>
                        setPageNumbers({
                          ...pageNumbers,
                          format: e.target.value,
                        })
                      }
                    >
                      <option value="{n} / {total}">1 / 10</option>
                      <option value="{n}">1</option>
                      <option value="- {n} -">- 1 -</option>
                      <option value="Стр. {n}">Стр. 1</option>
                    </select>
                  </label>
                  <label>
                    Размер: {pageNumbers.size}
                    <input
                      type="range"
                      min={8}
                      max={28}
                      value={pageNumbers.size}
                      onChange={(e) =>
                        setPageNumbers({
                          ...pageNumbers,
                          size: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Цвет
                    <input
                      type="color"
                      value={pageNumbers.color}
                      onChange={(e) =>
                        setPageNumbers({
                          ...pageNumbers,
                          color: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              )}

              <hr className="decorate-sep" />

              {/* Водяной знак */}
              <label className="decorate-toggle">
                <input
                  type="checkbox"
                  checked={watermark.enabled}
                  onChange={(e) =>
                    setWatermark({ ...watermark, enabled: e.target.checked })
                  }
                />
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
                      onChange={(e) =>
                        setWatermark({ ...watermark, text: e.target.value })
                      }
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
                      onChange={(e) =>
                        setWatermark({
                          ...watermark,
                          opacity: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Размер: {watermark.size}
                    <input
                      type="range"
                      min={24}
                      max={96}
                      value={watermark.size}
                      onChange={(e) =>
                        setWatermark({
                          ...watermark,
                          size: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Цвет
                    <input
                      type="color"
                      value={watermark.color}
                      onChange={(e) =>
                        setWatermark({ ...watermark, color: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}

              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                Оформление применяется при скачивании (в т.ч. при сжатии).
                Кириллица поддерживается.
              </p>
            </div>
            <div className="im-footer" style={{ gap: 10 }}>
              <button
                className="btn-secondary"
                onClick={() => setShowDecorate(false)}
              >
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

      {editingLoading && (
        <div className="pa-overlay">
          <div className="pa-loading">Загрузка страницы…</div>
        </div>
      )}
      {editing && (
        <PageAnnotator
          backgroundUrl={editing.bg}
          initial={editing.item.annotations || []}
          onSave={(anns) => saveAnnotations(editing.item.id, anns, editing.bg)}
          onClose={() => setEditing(null)}
        />
      )}

      <PdfEditorInstructions
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </PageShell>
  );
};

export default PdfEditor;
