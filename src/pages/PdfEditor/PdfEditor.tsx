// src/components/PdfEditor.tsx
import React, { useState, useRef, ChangeEvent, useEffect } from "react";
import { PDFDocument } from "pdf-lib";
import Header from "../../components/header/Header";
import { PdfEditorInstructions } from "./components/PdfEditorInstructions";

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

  const downloadPdfFromItems = async (
    items: PageItem[],
    filenamePrefix: string,
  ) => {
    if (items.length === 0) return;
    setIsProcessing(true);

    try {
      const mergedPdf = await PDFDocument.create();

      const uniqueFileIds = [...new Set(items.map((it) => it.fileId))];
      const loadedDocs = new Map<number, PDFDocument>();

      for (const fileId of uniqueFileIds) {
        const lf = loadedFilesRef.current[fileId];
        if (lf) {
          try {
            const doc = await PDFDocument.load(
              cloneArrayBuffer(lf.arrayBuffer),
            );
            loadedDocs.set(fileId, doc);
          } catch (err) {
            console.error(`Ошибка загрузки PDFDocument fileId=${fileId}:`, err);
          }
        }
      }

      for (const item of items) {
        const srcDoc = loadedDocs.get(item.fileId);
        if (srcDoc) {
          try {
            const [page] = await mergedPdf.copyPages(srcDoc, [item.pageIndex]);
            mergedPdf.addPage(page);
          } catch (err) {
            console.error(`Ошибка копирования стр. ${item.pageIndex}:`, err);
          }
        }
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenamePrefix}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
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
    <div className="pdf-editor-container">
      <Header
        title="PDF Редактор"
        description="Объединяйте, переставляйте и удаляйте страницы PDF файлов"
        onShowInstructions={() => setShowInstructions(true)}
        showHomeButton={true}
        showInstructionsButton={true}
      />

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
                  className="toolbar-button undo-button"
                  title="Отменить удаление (Ctrl/cmd + Z)"
                >
                  ↩️ Отменить
                </button>
              )}
              {selectedCount > 0 && (
                <>
                  <button
                    onClick={downloadSelectedPdf}
                    className="toolbar-button download-button"
                    title="Скачать только выделенные страницы"
                  >
                    💾 Скачать выделенные ({selectedCount})
                  </button>
                  <button
                    onClick={addSelectedToNewDocument}
                    className="toolbar-button"
                    title="Создать отдельный документ из выделенных страниц"
                  >
                    📂 В новый документ
                  </button>
                  <button
                    onClick={deleteSelectedPages}
                    className="toolbar-button delete-selected-button"
                    title="Удалить выделенные (Delete)"
                  >
                    🗑️ Удалить ({selectedCount})
                  </button>
                </>
              )}
              <button
                onClick={downloadMergedPdf}
                disabled={isProcessing}
                className="toolbar-button download-button"
              >
                {isProcessing ? "⏳" : "💾"} Скачать всё
              </button>
              <button
                onClick={clearAll}
                className="toolbar-button clear-button"
              >
                🗑️ Очистить
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
                      onClick={(e) => removePage(item.id, e)}
                      className="delete-page-button"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>

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

      <PdfEditorInstructions
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </div>
  );
};

export default PdfEditor;
