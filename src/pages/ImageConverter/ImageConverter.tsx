import React, { useState, useCallback, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";
import { saveAs } from "file-saver";
import ImageConverterInstructions from "./components/ImageConverterInstructions";
import PageShell from "../../components/PageShell";
import {
  decodeFile,
  decodeSvgCode,
  getSvgIntrinsicSize,
  ACCEPTED_INPUT,
  SUPPORTED_INPUT_LABEL,
  type DecodedRaster,
} from "./core/decode";
import {
  encodeCanvas,
  getFormatInfo,
  IMAGE_FORMATS,
  isWebpEncodingSupported,
  type ImageFormat,
} from "./core/encode";
import { composeExport } from "./core/render";
import "./ImageConverter.css";

/** Куда конвертируем: многостраничный PDF или растровый формат. */
type OutputFormat = "pdf" | ImageFormat;

interface ImageFile {
  id: string;
  /** Исходный файл (отсутствует, если источник — вставленный SVG-код). */
  file?: File;
  previewUrl: string;
  /** Полноразмерный растр источника — используется для image-экспорта. */
  raster: DecodedRaster;
  name: string;
  customName: string;
  size: number;
  width: number;
  height: number;
  /** Тип источника для подписи (SVG/PDF/PSD и т.п.). */
  sourceLabel?: string;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
}

interface TextSettings {
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

interface LayoutSettings {
  imagesPerPage: number;
  columns: number;
  rows: number;
  gap: number;
  margin: number;
  autoRotate: boolean;
}

interface ConversionSettings {
  pageSize: "a4" | "letter" | "original";
  orientation: "portrait" | "landscape" | "auto";
  quality: number;
  fitMode: "fill" | "fit" | "stretch";
  layoutMode: "single" | "grid";
  backgroundColor: string;
  addPageNumbers: boolean;
  pageNumberPosition:
    | "bottom-right"
    | "bottom-center"
    | "bottom-left"
    | "top-right"
    | "top-center"
    | "top-left";
  pageNumberFormat: string;
  addFileName: boolean;
  fileNamePosition: "below" | "above";
  textSettings: TextSettings;
  pageNumberTextSettings: TextSettings;
}

const ImageConverter: React.FC = () => {
  const [images, setImages] = useState<ImageFile[]>([]);

  // Выходной формат: PDF (полный layout-движок) или растровый формат.
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");

  // Настройки растрового экспорта (для не-PDF форматов).
  const [imgSizeMode, setImgSizeMode] = useState<"original" | "custom">(
    "original",
  );
  const [imgWidth, setImgWidth] = useState<number>(800);
  const [imgHeight, setImgHeight] = useState<number>(600);
  const [imgBackground, setImgBackground] = useState<string>("transparent");
  const [imgMaintainRatio, setImgMaintainRatio] = useState<boolean>(true);
  const [imgQuality, setImgQuality] = useState<number>(0.92);
  // Масштаб выходного разрешения (%) — уменьшает вес файла.
  const [imgScale, setImgScale] = useState<number>(100);
  // Оценка веса результата (по первому изображению).
  const [sizeEstimate, setSizeEstimate] = useState<{
    full: number;
    current: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);

  // Вставка SVG-кода как источника.
  const [showSvgInput, setShowSvgInput] = useState(false);
  const [svgCode, setSvgCode] = useState("");

  const webpSupported = React.useMemo(() => isWebpEncodingSupported(), []);

  const [settings, setSettings] = useState<ConversionSettings>({
    pageSize: "a4",
    orientation: "auto",
    quality: 0.95,
    fitMode: "fit",
    layoutMode: "single",
    backgroundColor: "#ffffff",
    addPageNumbers: false,
    pageNumberPosition: "bottom-center",
    pageNumberFormat: "Page {page} of {total}",
    addFileName: false,
    fileNamePosition: "below",
    textSettings: {
      fontSize: 10,
      fontFamily: "helvetica",
      fontColor: "#666666",
      bold: false,
      italic: false,
      align: "center",
    },
    pageNumberTextSettings: {
      fontSize: 8,
      fontFamily: "helvetica",
      fontColor: "#999999",
      bold: false,
      italic: false,
      align: "center",
    },
  });

  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({
    imagesPerPage: 4,
    columns: 2,
    rows: 2,
    gap: 5,
    margin: 10,
    autoRotate: true,
  });

  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingNameIndex, setEditingNameIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, []);

  // Преобразуем canvas растра в blob-URL для превью и PDF-движка.
  const rasterToPreviewUrl = (raster: DecodedRaster): Promise<string> =>
    new Promise((resolve) => {
      raster.canvas.toBlob(
        (blob) => {
          resolve(blob ? URL.createObjectURL(blob) : "");
        },
        "image/png",
      );
    });

  const rasterToImageFile = async (
    raster: DecodedRaster,
    file: File | undefined,
    sourceLabel: string,
    approxSize: number,
  ): Promise<ImageFile> => {
    const previewUrl = await rasterToPreviewUrl(raster);
    return {
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      file,
      previewUrl,
      raster,
      name: raster.name,
      customName: raster.name,
      size: approxSize,
      width: raster.width,
      height: raster.height,
      sourceLabel,
      status: "pending" as const,
    };
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);

    const collected: ImageFile[] = [];
    const failed: string[] = [];

    for (const file of files) {
      try {
        const rasters = await decodeFile(file);
        const ext = (file.name.split(".").pop() || "").toUpperCase();
        // Для многостраничных источников (PDF) размер файла делим на страницы.
        const per = Math.max(1, Math.round(file.size / rasters.length));
        for (const raster of rasters) {
          collected.push(
            await rasterToImageFile(raster, file, ext, per),
          );
        }
      } catch (err) {
        console.error("Decode error:", file.name, err);
        failed.push(file.name);
      }
    }

    if (collected.length === 0) {
      setError(
        `Не удалось прочитать файлы. Поддерживаются: ${SUPPORTED_INPUT_LABEL}`,
      );
      return;
    }

    if (failed.length > 0) {
      setError(`Пропущены нечитаемые файлы: ${failed.join(", ")}`);
    }

    setImages((prev) => [...prev, ...collected]);
  };

  // Добавление источника из вставленного SVG-кода.
  const addSvgFromCode = async () => {
    const code = svgCode.trim();
    if (!code) return;
    try {
      const { width, height } = getSvgIntrinsicSize(code);
      // Рендерим SVG в чуть увеличенном масштабе для чёткого растра.
      const scale = Math.max(1, Math.min(4, 2048 / Math.max(width, height)));
      const raster = await decodeSvgCode(code, "svg-code", scale);
      const imageFile = await rasterToImageFile(
        raster,
        undefined,
        "SVG",
        new Blob([code]).size,
      );
      setImages((prev) => [...prev, imageFile]);
      setSvgCode("");
      setShowSvgInput(false);
      setError(null);
    } catch {
      setError("Неверный SVG-код. Проверьте синтаксис.");
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      await processFiles(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);

  const handleDragOverCard = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(index);
  };

  const handleDragLeaveCard = () => setDragOverIndex(null);

  const handleDropCard = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    setImages((prev) => {
      const newImages = [...prev];
      const [draggedItem] = newImages.splice(draggedIndex, 1);
      newImages.splice(dropIndex, 0, draggedItem);
      return newImages;
    });
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  };

  const moveImage = (index: number, direction: "up" | "down") => {
    setImages((prev) => {
      const newImages = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newImages.length) return prev;
      [newImages[index], newImages[targetIndex]] = [
        newImages[targetIndex],
        newImages[index],
      ];
      return newImages;
    });
  };

  const updateCustomName = (index: number, name: string) => {
    setImages((prev) => {
      const newImages = [...prev];
      newImages[index] = { ...newImages[index], customName: name };
      return newImages;
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Ошибка загрузки изображения"));
      img.src = url;
    });
  };

  // Получаем ориентацию страницы для конкретного изображения
  const getPageOrientation = (image: ImageFile): "portrait" | "landscape" => {
    if (settings.orientation === "auto") {
      return image.width > image.height ? "landscape" : "portrait";
    }
    return settings.orientation as "portrait" | "landscape";
  };

  // Вычисление формата страницы — при original возвращаем [width, height] в мм
  const getPageFormat = (
    image: ImageFile,
    orientation: "portrait" | "landscape",
  ): string | [number, number] => {
    if (settings.pageSize !== "original") return settings.pageSize;

    const pxToMm = (px: number) => (px / 96) * 25.4;

    let widthMm = pxToMm(image.width);
    let heightMm = pxToMm(image.height);

    // Минимальный размер 50мм, максимальный 1000мм
    widthMm = Math.min(Math.max(widthMm, 50), 1000);
    heightMm = Math.min(Math.max(heightMm, 50), 1000);

    if (orientation === "landscape" && widthMm < heightMm) {
      [widthMm, heightMm] = [heightMm, widthMm];
    } else if (orientation === "portrait" && widthMm > heightMm) {
      [widthMm, heightMm] = [heightMm, widthMm];
    }

    return [widthMm, heightMm];
  };

  // Вычисление размеров изображения для вписывания в область
  const calculateImageFit = (
    imgWidth: number,
    imgHeight: number,
    maxWidth: number,
    maxHeight: number,
    offsetX: number,
    offsetY: number,
    fitMode: string,
  ) => {
    let drawWidth: number;
    let drawHeight: number;
    let x: number;
    let y: number;

    if (fitMode === "fill") {
      const ratio = Math.max(maxWidth / imgWidth, maxHeight / imgHeight);
      drawWidth = imgWidth * ratio;
      drawHeight = imgHeight * ratio;
      x = offsetX + (maxWidth - drawWidth) / 2;
      y = offsetY + (maxHeight - drawHeight) / 2;
    } else if (fitMode === "stretch") {
      drawWidth = maxWidth;
      drawHeight = maxHeight;
      x = offsetX;
      y = offsetY;
    } else {
      // fit
      const ratio = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
      drawWidth = imgWidth * ratio;
      drawHeight = imgHeight * ratio;
      x = offsetX + (maxWidth - drawWidth) / 2;
      y = offsetY + (maxHeight - drawHeight) / 2;
    }

    return { drawWidth, drawHeight, x, y };
  };

  // Транслитерация и очистка текста для jsPDF
  const sanitizeTextForPdf = (text: string): string => {
    const cyrillicMap: Record<string, string> = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "yo",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "kh",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ъ: "",
      ы: "y",
      ь: "",
      э: "e",
      ю: "yu",
      я: "ya",
      А: "A",
      Б: "B",
      В: "V",
      Г: "G",
      Д: "D",
      Е: "E",
      Ё: "Yo",
      Ж: "Zh",
      З: "Z",
      И: "I",
      Й: "Y",
      К: "K",
      Л: "L",
      М: "M",
      Н: "N",
      О: "O",
      П: "P",
      Р: "R",
      С: "S",
      Т: "T",
      У: "U",
      Ф: "F",
      Х: "Kh",
      Ц: "Ts",
      Ч: "Ch",
      Ш: "Sh",
      Щ: "Sch",
      Ъ: "",
      Ы: "Y",
      Ь: "",
      Э: "E",
      Ю: "Yu",
      Я: "Ya",
    };

    return text
      .split("")
      .map((char) => cyrillicMap[char] ?? char)
      .join("");
  };

  // Форматирование номера страницы
  const formatPageNumber = (
    format: string,
    page: number,
    total: number,
  ): string => {
    let result = format
      .replace("{page}", String(page))
      .replace("{total}", String(total));
    result = sanitizeTextForPdf(result);
    return result;
  };

  // Добавление номера страницы
  const addPageNumber = (
    pdf: jsPDF,
    currentPage: number,
    totalPages: number,
    pageWidth: number,
    pageHeight: number,
    margin: number,
  ) => {
    const ts = settings.pageNumberTextSettings;
    let fontStyle = "normal";
    if (ts.bold && ts.italic) fontStyle = "bolditalic";
    else if (ts.bold) fontStyle = "bold";
    else if (ts.italic) fontStyle = "italic";

    pdf.setFont(ts.fontFamily, fontStyle);
    pdf.setFontSize(ts.fontSize);

    const hex = ts.fontColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    pdf.setTextColor(r, g, b);

    const text = formatPageNumber(
      settings.pageNumberFormat,
      currentPage,
      totalPages,
    );

    const isTop = settings.pageNumberPosition.includes("top");

    // Минимальный отступ 5мм чтобы текст не уходил за край при margin = 0
    const safeMargin = Math.max(margin, 5);
    const y = isTop ? safeMargin : pageHeight - safeMargin + ts.fontSize * 0.35;

    let x: number;
    let align: "left" | "center" | "right" = "center";
    if (settings.pageNumberPosition.includes("left")) {
      x = safeMargin;
      align = "left";
    } else if (settings.pageNumberPosition.includes("right")) {
      x = pageWidth - safeMargin;
      align = "right";
    } else {
      x = pageWidth / 2;
      align = "center";
    }

    pdf.text(text, x, y, { align });
  };

  // Добавление имени файла
  const addFileNameText = (
    pdf: jsPDF,
    text: string,
    pageWidth: number,
    _pageHeight: number,
    margin: number,
    position: "below" | "above",
    imageY: number,
    imageHeight: number,
  ) => {
    const ts = settings.textSettings;
    let fontStyle = "normal";
    if (ts.bold && ts.italic) fontStyle = "bolditalic";
    else if (ts.bold) fontStyle = "bold";
    else if (ts.italic) fontStyle = "italic";

    pdf.setFont(ts.fontFamily, fontStyle);
    pdf.setFontSize(ts.fontSize);

    const hex = ts.fontColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    pdf.setTextColor(r, g, b);

    let y: number;
    if (position === "above") {
      // Минимум 5мм от верха при margin = 0
      y = Math.max(imageY - 2, 5);
    } else {
      y = imageY + imageHeight + ts.fontSize * 0.4 + 2;
    }

    // Минимальный отступ по горизонтали
    const safeMargin = Math.max(margin, 5);

    let x: number;
    let align: "left" | "center" | "right" = "center";
    if (ts.align === "left") {
      x = safeMargin;
      align = "left";
    } else if (ts.align === "right") {
      x = pageWidth - safeMargin;
      align = "right";
    } else {
      x = pageWidth / 2;
      align = "center";
    }

    pdf.text(text, x, y, { align });
  };

  // Добавление одного изображения на страницу
  const addSingleImageToPage = async (
    pdf: jsPDF,
    image: ImageFile,
    index: number,
    total: number,
  ) => {
    const imgElement = await loadImage(image.previewUrl);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // При original отступы = 0
    const margin = settings.pageSize === "original" ? 0 : layoutSettings.margin;

    const textFontSize = settings.textSettings.fontSize;
    const pageNumFontSize = settings.pageNumberTextSettings.fontSize;

    let topReserve = margin;
    let bottomReserve = margin;

    if (settings.addPageNumbers) {
      const isTop = settings.pageNumberPosition.includes("top");
      if (isTop) topReserve += pageNumFontSize + 4;
      else bottomReserve += pageNumFontSize + 4;
    }

    if (settings.addFileName) {
      if (settings.fileNamePosition === "above") {
        topReserve += textFontSize + 4;
      } else {
        bottomReserve += textFontSize + 4;
      }
    }

    const usableWidth = pageWidth - 2 * margin;
    const usableHeight = pageHeight - topReserve - bottomReserve;
    const offsetX = margin;
    const offsetY = topReserve;

    // При original принудительно используем "fit"
    const fitMode = settings.pageSize === "original" ? "fit" : settings.fitMode;

    const { drawWidth, drawHeight, x, y } = calculateImageFit(
      imgElement.width,
      imgElement.height,
      usableWidth,
      usableHeight,
      offsetX,
      offsetY,
      fitMode,
    );

    const canvas = document.createElement("canvas");
    canvas.width = imgElement.width;
    canvas.height = imgElement.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(imgElement, 0, 0);
    }
    const imgData = canvas.toDataURL("image/jpeg", settings.quality);

    pdf.addImage(imgData, "JPEG", x, y, drawWidth, drawHeight);

    if (settings.addFileName) {
      addFileNameText(
        pdf,
        sanitizeTextForPdf(image.customName),
        pageWidth,
        pageHeight,
        margin,
        settings.fileNamePosition,
        y,
        drawHeight,
      );
    }

    if (settings.addPageNumbers) {
      addPageNumber(pdf, index + 1, total, pageWidth, pageHeight, margin);
    }
  };

  // Добавление сетки изображений на страницу
  const addGridToPage = async (
    pdf: jsPDF,
    pageImages: ImageFile[],
    currentPage: number,
    totalPages: number,
  ) => {
    const { columns, rows, gap } = layoutSettings;

    // При original отступы = 0
    const margin = settings.pageSize === "original" ? 0 : layoutSettings.margin;

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const pageNumFontSize = settings.pageNumberTextSettings.fontSize;
    let bottomReserve = margin;
    let topReserve = margin;

    if (settings.addPageNumbers) {
      const isTop = settings.pageNumberPosition.includes("top");
      if (isTop) topReserve += pageNumFontSize + 4;
      else bottomReserve += pageNumFontSize + 4;
    }

    const usableWidth = pageWidth - 2 * margin;
    const usableHeight = pageHeight - topReserve - bottomReserve;

    const cellWidth = (usableWidth - (columns - 1) * gap) / columns;
    const cellHeight = (usableHeight - (rows - 1) * gap) / rows;

    for (let j = 0; j < pageImages.length; j++) {
      const img = pageImages[j];
      const imgElement = await loadImage(img.previewUrl);

      const row = Math.floor(j / columns);
      const col = j % columns;

      const cellX = margin + col * (cellWidth + gap);
      const cellY = topReserve + row * (cellHeight + gap);

      let imgCellHeight = cellHeight;
      const fileNameReserve = settings.addFileName
        ? settings.textSettings.fontSize + 4
        : 0;
      imgCellHeight -= fileNameReserve;

      const { drawWidth, drawHeight, x, y } = calculateImageFit(
        imgElement.width,
        imgElement.height,
        cellWidth,
        imgCellHeight,
        cellX,
        cellY,
        "fit",
      );

      const canvas = document.createElement("canvas");
      canvas.width = imgElement.width;
      canvas.height = imgElement.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(imgElement, 0, 0);
      const imgData = canvas.toDataURL("image/jpeg", settings.quality);

      pdf.addImage(imgData, "JPEG", x, y, drawWidth, drawHeight);

      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.2);
      pdf.rect(cellX, cellY, cellWidth, cellHeight);

      if (settings.addFileName) {
        const nameY =
          cellY + imgCellHeight + settings.textSettings.fontSize * 0.4 + 2;
        const ts = settings.textSettings;
        let fontStyle = "normal";
        if (ts.bold && ts.italic) fontStyle = "bolditalic";
        else if (ts.bold) fontStyle = "bold";
        else if (ts.italic) fontStyle = "italic";
        pdf.setFont(ts.fontFamily, fontStyle);
        pdf.setFontSize(Math.min(ts.fontSize, 7));

        const hex = ts.fontColor.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        pdf.setTextColor(r, g, b);

        const maxChars = Math.floor(cellWidth / 2.5);
        const name =
          img.customName.length > maxChars
            ? img.customName.substring(0, maxChars - 3) + "..."
            : img.customName;
        pdf.text(sanitizeTextForPdf(name), cellX + cellWidth / 2, nameY, {
          align: "center",
        });
      }
    }

    if (settings.addPageNumbers) {
      addPageNumber(
        pdf,
        currentPage,
        totalPages,
        pageWidth,
        pageHeight,
        margin,
      );
    }
  };

  // Генерация предпросмотра
  const generatePreview = async () => {
    if (images.length === 0) return;
    setPreviewLoading(true);
    setPreviewImageUrl(null);

    try {
      const orientationForPage =
        settings.orientation === "auto"
          ? settings.layoutMode === "single" && images[previewPage]
            ? getPageOrientation(images[previewPage])
            : "portrait"
          : (settings.orientation as "portrait" | "landscape");

      // Правильный формат при original
      const currentImage =
        settings.layoutMode === "single" ? images[previewPage] : images[0];
      const pageFormat =
        settings.pageSize === "original" && currentImage
          ? getPageFormat(currentImage, orientationForPage)
          : settings.pageSize === "original"
            ? "a4"
            : settings.pageSize;

      const pdf = new jsPDF({
        orientation: orientationForPage,
        unit: "mm",
        format: pageFormat,
      });

      if (settings.layoutMode === "single") {
        const img = images[previewPage];
        if (img) {
          await addSingleImageToPage(pdf, img, previewPage, images.length);
        }
      } else {
        const imagesPerPage = layoutSettings.columns * layoutSettings.rows;
        const startIndex = previewPage * imagesPerPage;
        const pageImages = images.slice(startIndex, startIndex + imagesPerPage);
        const totalPages = Math.ceil(images.length / imagesPerPage);
        if (pageImages.length > 0) {
          await addGridToPage(pdf, pageImages, previewPage + 1, totalPages);
        }
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = 2;
      const pxPerMm = 3.7795275591 * scale;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(pageWidth * pxPerMm);
      canvas.height = Math.round(pageHeight * pxPerMm);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);

      // При original отступы = 0
      const margin =
        settings.pageSize === "original" ? 0 : layoutSettings.margin;

      if (settings.layoutMode === "single") {
        const image = images[previewPage];
        if (image) {
          const imgEl = await loadImage(image.previewUrl);

          const marginPx = margin * pxPerMm;

          let topReserve = marginPx;
          let bottomReserve = marginPx;
          const textFontSize = settings.textSettings.fontSize;
          const pageNumFontSize = settings.pageNumberTextSettings.fontSize;

          if (settings.addPageNumbers) {
            const isTop = settings.pageNumberPosition.includes("top");
            if (isTop) topReserve += ((pageNumFontSize + 4) * pxPerMm) / scale;
            else bottomReserve += ((pageNumFontSize + 4) * pxPerMm) / scale;
          }
          if (settings.addFileName) {
            if (settings.fileNamePosition === "above")
              topReserve += ((textFontSize + 4) * pxPerMm) / scale;
            else bottomReserve += ((textFontSize + 4) * pxPerMm) / scale;
          }

          const usableW = canvas.width - 2 * marginPx;
          const usableH = canvas.height - topReserve - bottomReserve;

          const ratio = Math.min(usableW / imgEl.width, usableH / imgEl.height);
          const dw = imgEl.width * ratio;
          const dh = imgEl.height * ratio;
          const dx = marginPx + (usableW - dw) / 2;
          const dy = topReserve + (usableH - dh) / 2;

          ctx.drawImage(imgEl, dx, dy, dw, dh);

          if (settings.addFileName) {
            const ts = settings.textSettings;
            ctx.fillStyle = ts.fontColor;
            ctx.font = `${ts.italic ? "italic " : ""}${ts.bold ? "bold " : ""}${ts.fontSize * scale}px ${
              ts.fontFamily === "helvetica"
                ? "Arial"
                : ts.fontFamily === "times"
                  ? "Times New Roman"
                  : "Courier New"
            }`;
            ctx.textAlign = ts.align;

            // Безопасный отступ для текста
            const safeMarginPx = Math.max(marginPx, 5 * pxPerMm);
            const tx =
              ts.align === "left"
                ? safeMarginPx
                : ts.align === "right"
                  ? canvas.width - safeMarginPx
                  : canvas.width / 2;
            const ty =
              settings.fileNamePosition === "above"
                ? Math.max(topReserve - 4, 5 * pxPerMm)
                : dy + dh + ts.fontSize * scale + 4;
            ctx.fillText(image.customName, tx, ty);
          }

          if (settings.addPageNumbers) {
            const ts = settings.pageNumberTextSettings;
            ctx.fillStyle = ts.fontColor;
            ctx.font = `${ts.fontSize * scale}px Arial`;
            ctx.textAlign = settings.pageNumberPosition.includes("left")
              ? "left"
              : settings.pageNumberPosition.includes("right")
                ? "right"
                : "center";
            const isTop = settings.pageNumberPosition.includes("top");

            // Безопасный отступ для номера страницы
            const safeMarginPx = Math.max(marginPx, 5 * pxPerMm);
            const py = isTop ? safeMarginPx : canvas.height - safeMarginPx / 2;
            const px =
              ctx.textAlign === "left"
                ? safeMarginPx
                : ctx.textAlign === "right"
                  ? canvas.width - safeMarginPx
                  : canvas.width / 2;
            const text = settings.pageNumberFormat
              .replace("{page}", String(previewPage + 1))
              .replace("{total}", String(images.length));
            ctx.fillText(text, px, py);
          }
        }
      } else {
        // Grid mode
        const { columns, rows, gap } = layoutSettings;
        const imagesPerPage = columns * rows;
        const startIndex = previewPage * imagesPerPage;
        const pageImages = images.slice(startIndex, startIndex + imagesPerPage);
        const totalPages = Math.ceil(images.length / imagesPerPage);

        const marginPx = margin * pxPerMm;
        const gapPx = gap * pxPerMm;

        let topReserve = marginPx;
        let bottomReserve = marginPx;
        const pageNumFontSize = settings.pageNumberTextSettings.fontSize;
        if (settings.addPageNumbers) {
          const isTop = settings.pageNumberPosition.includes("top");
          if (isTop) topReserve += (pageNumFontSize + 4) * (pxPerMm / scale);
          else bottomReserve += (pageNumFontSize + 4) * (pxPerMm / scale);
        }

        const usableW = canvas.width - 2 * marginPx;
        const usableH = canvas.height - topReserve - bottomReserve;
        const cellW = (usableW - (columns - 1) * gapPx) / columns;
        const cellH = (usableH - (rows - 1) * gapPx) / rows;

        for (let j = 0; j < pageImages.length; j++) {
          const img = pageImages[j];
          const imgEl = await loadImage(img.previewUrl);

          const row = Math.floor(j / columns);
          const col = j % columns;
          const cellX = marginPx + col * (cellW + gapPx);
          const cellY = topReserve + row * (cellH + gapPx);

          const fileNameReserve = settings.addFileName
            ? (settings.textSettings.fontSize + 4) * (pxPerMm / scale)
            : 0;
          const imgCellH = cellH - fileNameReserve;

          const ratio = Math.min(cellW / imgEl.width, imgCellH / imgEl.height);
          const dw = imgEl.width * ratio;
          const dh = imgEl.height * ratio;
          const dx = cellX + (cellW - dw) / 2;
          const dy = cellY + (imgCellH - dh) / 2;

          ctx.drawImage(imgEl, dx, dy, dw, dh);

          ctx.strokeStyle = "#ddd";
          ctx.lineWidth = 1;
          ctx.strokeRect(cellX, cellY, cellW, cellH);

          if (settings.addFileName) {
            const ts = settings.textSettings;
            ctx.fillStyle = ts.fontColor;
            ctx.font = `${Math.min(ts.fontSize, 7) * scale}px Arial`;
            ctx.textAlign = "center";
            const maxChars = Math.floor(cellW / (ts.fontSize * scale * 0.5));
            const name =
              img.customName.length > maxChars
                ? img.customName.substring(0, maxChars - 3) + "..."
                : img.customName;
            ctx.fillText(
              name,
              cellX + cellW / 2,
              cellY +
                imgCellH +
                fileNameReserve / 2 +
                ts.fontSize * scale * 0.4,
            );
          }
        }

        if (settings.addPageNumbers) {
          const ts = settings.pageNumberTextSettings;
          ctx.fillStyle = ts.fontColor;
          ctx.font = `${ts.fontSize * scale}px Arial`;
          ctx.textAlign = settings.pageNumberPosition.includes("left")
            ? "left"
            : settings.pageNumberPosition.includes("right")
              ? "right"
              : "center";
          const isTop = settings.pageNumberPosition.includes("top");

          // Безопасный отступ для номера страницы
          const safeMarginPx = Math.max(marginPx, 5 * pxPerMm);
          const py = isTop
            ? safeMarginPx / 2
            : canvas.height - safeMarginPx / 4;
          const px =
            ctx.textAlign === "left"
              ? safeMarginPx
              : ctx.textAlign === "right"
                ? canvas.width - safeMarginPx
                : canvas.width / 2;
          const text = settings.pageNumberFormat
            .replace("{page}", String(previewPage + 1))
            .replace("{total}", String(totalPages));
          ctx.fillText(text, px, py);
        }
      }

      setPreviewImageUrl(canvas.toDataURL("image/png"));
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const convertToPdf = async () => {
    if (images.length === 0) {
      setError("Нет изображений для конвертации");
      return;
    }

    setConverting(true);
    setProgress(0);
    setError(null);

    try {
      let pdf: jsPDF | null = null;

      if (settings.layoutMode === "single") {
        for (let i = 0; i < images.length; i++) {
          setProgress(Math.round(((i + 1) / images.length) * 100));

          const orientation = getPageOrientation(images[i]);
          const pageFormat = getPageFormat(images[i], orientation);

          if (i === 0) {
            pdf = new jsPDF({
              orientation,
              unit: "mm",
              format: pageFormat,
            });
          } else {
            pdf!.addPage(pageFormat, orientation);
          }

          await addSingleImageToPage(pdf!, images[i], i, images.length);
        }
      } else {
        const imagesPerPage = layoutSettings.columns * layoutSettings.rows;
        const totalPages = Math.ceil(images.length / imagesPerPage);
        const orientation =
          settings.orientation === "auto"
            ? "portrait"
            : (settings.orientation as "portrait" | "landscape");

        // Для grid в "original" берём размер первого изображения как эталон для всех страниц
        const pageFormat =
          settings.pageSize === "original"
            ? getPageFormat(images[0], orientation)
            : settings.pageSize;

        pdf = new jsPDF({ orientation, unit: "mm", format: pageFormat });

        for (let i = 0; i < images.length; i += imagesPerPage) {
          setProgress(
            Math.round(
              (Math.min(i + imagesPerPage, images.length) / images.length) *
                100,
            ),
          );

          if (i > 0) pdf.addPage(pageFormat, orientation);

          const pageImages = images.slice(i, i + imagesPerPage);
          const currentPage = Math.floor(i / imagesPerPage) + 1;
          await addGridToPage(pdf, pageImages, currentPage, totalPages);
        }
      }

      if (pdf) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        pdf.save(`converted_${timestamp}.pdf`);
      }
    } catch (err: any) {
      setError(`Ошибка при конвертации: ${err.message}`);
    } finally {
      setConverting(false);
      setProgress(100);
    }
  };

  // Эффективный фон: форматы без альфы не могут быть прозрачными.
  const effectiveBackground = (format: ImageFormat): string => {
    const info = getFormatInfo(format);
    return !info.alpha && imgBackground === "transparent"
      ? "#ffffff"
      : imgBackground;
  };

  // Собирает выходной canvas одного изображения по текущим настройкам.
  const buildCanvas = (image: ImageFile, format: ImageFormat, scale: number) =>
    composeExport(image.raster, {
      sizeMode: imgSizeMode,
      customWidth: imgWidth,
      customHeight: imgHeight,
      maintainAspectRatio: imgMaintainRatio,
      background: effectiveBackground(format),
      scalePercent: scale,
    });

  // Экспорт в растровый формат (PNG/JPEG/WEBP/BMP/ICO).
  const convertToImages = async () => {
    if (images.length === 0) {
      setError("Нет изображений для конвертации");
      return;
    }
    const format = outputFormat as ImageFormat;
    const info = getFormatInfo(format);

    setConverting(true);
    setProgress(0);
    setError(null);

    try {
      for (let i = 0; i < images.length; i++) {
        setProgress(Math.round(((i + 1) / images.length) * 100));
        const image = images[i];
        const canvas = await buildCanvas(image, format, imgScale);
        const blob = await encodeCanvas(canvas, format, imgQuality);
        const fileName = `${image.customName || "image"}.${info.ext}`;
        saveAs(blob, fileName);
        // Небольшая пауза, чтобы браузер не блокировал серию загрузок.
        if (images.length > 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    } catch (err) {
      setError(`Ошибка при конвертации: ${(err as Error).message}`);
    } finally {
      setConverting(false);
      setProgress(100);
    }
  };

  // Пересчёт оценки веса результата (по первому изображению) при
  // изменении настроек растрового экспорта.
  useEffect(() => {
    if (outputFormat === "pdf" || images.length === 0) {
      setSizeEstimate(null);
      return;
    }
    const format = outputFormat as ImageFormat;
    const image = images[0];
    let cancelled = false;
    setEstimating(true);

    const timer = setTimeout(async () => {
      try {
        const fullCanvas = await buildCanvas(image, format, 100);
        const fullBlob = await encodeCanvas(fullCanvas, format, 1);
        const curCanvas = await buildCanvas(image, format, imgScale);
        const curBlob = await encodeCanvas(curCanvas, format, imgQuality);
        if (!cancelled) {
          setSizeEstimate({ full: fullBlob.size, current: curBlob.size });
        }
      } catch {
        if (!cancelled) setSizeEstimate(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    outputFormat,
    images,
    imgSizeMode,
    imgWidth,
    imgHeight,
    imgMaintainRatio,
    imgBackground,
    imgScale,
    imgQuality,
  ]);

  // Единая точка запуска конвертации по выбранному формату.
  const handleConvert = () => {
    if (outputFormat === "pdf") {
      convertToPdf();
    } else {
      convertToImages();
    }
  };

  const clearAll = () => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    setProgress(0);
    setError(null);
    setShowPreview(false);
    setPreviewImageUrl(null);
  };

  const getTotalPages = () => {
    if (images.length === 0) return 0;
    if (settings.layoutMode === "single") return images.length;
    return Math.ceil(
      images.length / (layoutSettings.columns * layoutSettings.rows),
    );
  };

  useEffect(() => {
    if (showPreview && images.length > 0) {
      generatePreview();
    }
  }, [showPreview, previewPage, settings, layoutSettings, images]);

  useEffect(() => {
    setPreviewPage(0);
  }, [settings.layoutMode]);

  return (
    <PageShell
      title="Универсальный конвертер изображений"
      subtitle="SVG, PNG, JPG, WebP, GIF, BMP, PDF, PSD → PNG, JPEG, WebP, BMP, ICO или PDF. Всё в браузере — без загрузки на сервер."
      onShowInstructions={() => setShowInstructions(true)}
    >

        {/* Зона загрузки */}
        <div
          className={`upload-zone ${dragOver ? "drag-over" : ""} ${
            images.length > 0 ? "has-images" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !images.length && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_INPUT}
            multiple
            onChange={handleFileSelect}
            className="file-input-hidden"
          />

          {images.length === 0 ? (
            <div className="upload-prompt">
              <div className="upload-icon-large">🖼️</div>
              <h2>Перетащите файлы сюда</h2>
              <p>или нажмите, чтобы выбрать</p>
              <div className="supported-formats">
                Поддерживаемые форматы: {SUPPORTED_INPUT_LABEL}
              </div>
              <button
                type="button"
                className="btn-paste-svg"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSvgInput(true);
                }}
              >
                📝 Вставить SVG-код
              </button>
            </div>
          ) : (
            <div
              className="upload-add-more"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <span className="add-more-icon">+</span>
              <span>Добавить ещё файлы</span>
            </div>
          )}
        </div>

        {/* Вставка SVG-кода */}
        {showSvgInput && (
          <div className="svg-code-panel">
            <div className="svg-code-header">
              <h3>📝 Вставьте SVG-код</h3>
              <button
                className="error-close"
                onClick={() => setShowSvgInput(false)}
              >
                ✕
              </button>
            </div>
            <textarea
              className="svg-code-area"
              value={svgCode}
              onChange={(e) => setSvgCode(e.target.value)}
              placeholder={`<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="100" cy="100" r="80" fill="#4f46e5" />\n</svg>`}
              rows={6}
            />
            <div className="svg-code-actions">
              <button
                className="btn-convert"
                disabled={!svgCode.trim()}
                onClick={addSvgFromCode}
              >
                ➕ Добавить как изображение
              </button>
            </div>
          </div>
        )}

        {/* Выбор выходного формата */}
        <div className="output-format-bar">
          <span className="output-format-label">Конвертировать в:</span>
          <div className="output-format-options">
            <button
              className={`format-chip ${outputFormat === "pdf" ? "active" : ""}`}
              onClick={() => setOutputFormat("pdf")}
            >
              📄 PDF
            </button>
            {IMAGE_FORMATS.map((f) => {
              const disabled = f.id === "webp" && !webpSupported;
              return (
                <button
                  key={f.id}
                  className={`format-chip ${
                    outputFormat === f.id ? "active" : ""
                  }`}
                  disabled={disabled}
                  title={
                    disabled
                      ? "WebP-кодирование не поддерживается этим браузером"
                      : undefined
                  }
                  onClick={() => setOutputFormat(f.id)}
                >
                  🖼️ {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="error-close">
              ✕
            </button>
          </div>
        )}

        {images.length > 0 && (
          <div className="images-section">
            <div className="images-header">
              <h2>
                Загруженные изображения{" "}
                <span className="images-count">({images.length})</span>
              </h2>
              <div className="images-actions">
                {outputFormat === "pdf" && (
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="btn-preview"
                  >
                    👁️ Предпросмотр
                  </button>
                )}
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="btn-settings"
                >
                  ⚙️ Настройки
                </button>
                <button onClick={clearAll} className="btn-clear-images">
                  🗑️ Очистить всё
                </button>
              </div>
            </div>

            {/* Предпросмотр */}
            {showPreview && (
              <div className="preview-panel">
                <div className="preview-header">
                  <h3>Предпросмотр PDF</h3>
                  <div className="preview-controls">
                    <button
                      onClick={() =>
                        setPreviewPage(Math.max(0, previewPage - 1))
                      }
                      disabled={previewPage === 0}
                    >
                      ◀
                    </button>
                    <span>
                      Страница {previewPage + 1} из {getTotalPages()}
                    </span>
                    <button
                      onClick={() =>
                        setPreviewPage(
                          Math.min(getTotalPages() - 1, previewPage + 1),
                        )
                      }
                      disabled={previewPage >= getTotalPages() - 1}
                    >
                      ▶
                    </button>
                  </div>
                </div>
                <div className="preview-canvas-container">
                  {previewLoading ? (
                    <div className="preview-loading">
                      <div className="preview-spinner"></div>
                      <span>Генерация предпросмотра...</span>
                    </div>
                  ) : previewImageUrl ? (
                    <img
                      src={previewImageUrl}
                      alt="Предпросмотр PDF"
                      className="preview-image"
                    />
                  ) : (
                    <div className="preview-empty">
                      Нет данных для отображения
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Настройки экспорта в растровый формат */}
            {showSettings && outputFormat !== "pdf" && (
              <div className="settings-panel">
                <h3>
                  Параметры экспорта в{" "}
                  {getFormatInfo(outputFormat as ImageFormat).label}
                </h3>

                <div className="settings-section">
                  <h4>Размер</h4>
                  <div className="layout-mode-selector">
                    <button
                      className={`layout-btn ${
                        imgSizeMode === "original" ? "active" : ""
                      }`}
                      onClick={() => setImgSizeMode("original")}
                    >
                      🔁 Оригинальный
                    </button>
                    <button
                      className={`layout-btn ${
                        imgSizeMode === "custom" ? "active" : ""
                      }`}
                      onClick={() => setImgSizeMode("custom")}
                    >
                      ✏️ Задать размер
                    </button>
                  </div>

                  {imgSizeMode === "custom" && (
                    <div className="settings-grid settings-grid--3">
                      <div className="setting-item">
                        <label>Ширина, px</label>
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          value={imgWidth}
                          onChange={(e) => setImgWidth(Number(e.target.value))}
                        />
                      </div>
                      <div className="setting-item">
                        <label>Высота, px</label>
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          value={imgHeight}
                          onChange={(e) => setImgHeight(Number(e.target.value))}
                        />
                      </div>
                      <div className="setting-item checkbox-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={imgMaintainRatio}
                            onChange={(e) =>
                              setImgMaintainRatio(e.target.checked)
                            }
                          />
                          Сохранять пропорции
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <h4>Фон</h4>
                  <div className="bg-controls">
                    <input
                      type="color"
                      value={
                        imgBackground === "transparent"
                          ? "#ffffff"
                          : imgBackground
                      }
                      disabled={imgBackground === "transparent"}
                      onChange={(e) => setImgBackground(e.target.value)}
                      className="color-picker"
                    />
                    <input
                      type="text"
                      className="bg-hex-input"
                      value={imgBackground}
                      onChange={(e) => setImgBackground(e.target.value)}
                      placeholder="#ffffff"
                    />
                    {getFormatInfo(outputFormat as ImageFormat).alpha && (
                      <button
                        type="button"
                        className={`transparent-btn ${
                          imgBackground === "transparent" ? "active" : ""
                        }`}
                        onClick={() =>
                          setImgBackground(
                            imgBackground === "transparent"
                              ? "#ffffff"
                              : "transparent",
                          )
                        }
                        title="Прозрачный фон"
                      >
                        <span className="checker-swatch" />
                        Прозрачный
                      </button>
                    )}
                  </div>
                  {!getFormatInfo(outputFormat as ImageFormat).alpha && (
                    <small className="setting-hint">
                      {getFormatInfo(outputFormat as ImageFormat).label} не
                      поддерживает прозрачность — используется сплошной фон
                    </small>
                  )}
                </div>

                <div className="settings-section">
                  <h4>Сжатие и вес</h4>
                  <div className="settings-grid">
                    {getFormatInfo(outputFormat as ImageFormat).quality ? (
                      <div className="setting-item">
                        <label>Качество: {Math.round(imgQuality * 100)}%</label>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={Math.round(imgQuality * 100)}
                          onChange={(e) =>
                            setImgQuality(Number(e.target.value) / 100)
                          }
                        />
                      </div>
                    ) : (
                      <div className="setting-item">
                        <label>Разрешение: {imgScale}%</label>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={imgScale}
                          onChange={(e) => setImgScale(Number(e.target.value))}
                        />
                        <small className="setting-hint">
                          Уменьшает вес за счёт размера. Прозрачность
                          сохраняется.
                        </small>
                      </div>
                    )}
                    {getFormatInfo(outputFormat as ImageFormat).quality && (
                      <div className="setting-item">
                        <label>Разрешение: {imgScale}%</label>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={imgScale}
                          onChange={(e) => setImgScale(Number(e.target.value))}
                        />
                      </div>
                    )}
                  </div>

                  {/* Живая оценка веса результата */}
                  <div className="size-estimate">
                    {estimating ? (
                      <span className="size-estimate__loading">
                        Расчёт веса…
                      </span>
                    ) : sizeEstimate ? (
                      (() => {
                        const saved =
                          sizeEstimate.full > 0
                            ? Math.round(
                                (1 - sizeEstimate.current / sizeEstimate.full) *
                                  100,
                              )
                            : 0;
                        return (
                          <>
                            <span className="size-estimate__label">
                              Примерный вес (1-е изображение):
                            </span>
                            <span className="size-estimate__value">
                              {formatFileSize(sizeEstimate.current)}
                            </span>
                            {saved > 0 && (
                              <span className="size-estimate__saved">
                                −{saved}% от максимума (
                                {formatFileSize(sizeEstimate.full)})
                              </span>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      <span className="size-estimate__loading">
                        Добавьте изображение для оценки веса
                      </span>
                    )}
                  </div>

                  {outputFormat === "ico" && (
                    <small className="setting-hint">
                      ICO создаётся квадратным, до 256×256 px
                    </small>
                  )}
                </div>
              </div>
            )}

            {/* Настройки PDF */}
            {showSettings && outputFormat === "pdf" && (
              <div className="settings-panel">
                <h3>Параметры конвертации</h3>

                <div className="settings-section">
                  <h4>Режим компоновки</h4>
                  <div className="layout-mode-selector">
                    <button
                      className={`layout-btn ${
                        settings.layoutMode === "single" ? "active" : ""
                      }`}
                      onClick={() =>
                        setSettings({ ...settings, layoutMode: "single" })
                      }
                    >
                      📄 Одна на странице
                    </button>
                    <button
                      className={`layout-btn ${
                        settings.layoutMode === "grid" ? "active" : ""
                      }`}
                      onClick={() =>
                        setSettings({ ...settings, layoutMode: "grid" })
                      }
                    >
                      🔲 Сетка
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <h4>Страница и качество</h4>
                  <div className="settings-grid">
                    <div className="setting-item">
                      <label>Размер страницы</label>
                      <select
                        value={settings.pageSize}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            pageSize: e.target.value as any,
                          })
                        }
                      >
                        <option value="a4">A4 (210×297 мм)</option>
                        <option value="letter">Letter (216×279 мм)</option>
                        <option value="original">Оригинальный размер</option>
                      </select>
                    </div>

                    <div className="setting-item">
                      <label>Ориентация</label>
                      <select
                        value={settings.orientation}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            orientation: e.target.value as any,
                          })
                        }
                      >
                        <option value="auto">Авто (по размеру фото)</option>
                        <option value="portrait">Портретная</option>
                        <option value="landscape">Альбомная</option>
                      </select>
                    </div>

                    <div className="setting-item">
                      <label>Режим подгонки</label>
                      <select
                        value={settings.fitMode}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            fitMode: e.target.value as any,
                          })
                        }
                      >
                        <option value="fit">Вписать (с полями)</option>
                        <option value="fill">Заполнить (обрезка)</option>
                        <option value="stretch">Растянуть</option>
                      </select>
                    </div>

                    <div className="setting-item">
                      <label>Отступ от края: {layoutSettings.margin} мм</label>
                      <input
                        type="range"
                        min="0"
                        max="30"
                        value={layoutSettings.margin}
                        onChange={(e) =>
                          setLayoutSettings({
                            ...layoutSettings,
                            margin: Number(e.target.value),
                          })
                        }
                      />
                    </div>

                    <div className="setting-item">
                      <label>
                        Качество JPEG: {Math.round(settings.quality * 100)}%
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={Math.round(settings.quality * 100)}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            quality: Number(e.target.value) / 100,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {settings.layoutMode === "grid" && (
                  <div className="settings-section">
                    <h4>Параметры сетки</h4>
                    <div className="settings-grid">
                      <div className="setting-item">
                        <label>Колонок: {layoutSettings.columns}</label>
                        <input
                          type="range"
                          min="1"
                          max="6"
                          value={layoutSettings.columns}
                          onChange={(e) => {
                            const cols = Number(e.target.value);
                            setLayoutSettings({
                              ...layoutSettings,
                              columns: cols,
                              imagesPerPage: cols * layoutSettings.rows,
                            });
                          }}
                        />
                      </div>

                      <div className="setting-item">
                        <label>Строк: {layoutSettings.rows}</label>
                        <input
                          type="range"
                          min="1"
                          max="6"
                          value={layoutSettings.rows}
                          onChange={(e) => {
                            const r = Number(e.target.value);
                            setLayoutSettings({
                              ...layoutSettings,
                              rows: r,
                              imagesPerPage: layoutSettings.columns * r,
                            });
                          }}
                        />
                      </div>

                      <div className="setting-item">
                        <label>
                          Отступ между фото: {layoutSettings.gap} мм
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="20"
                          value={layoutSettings.gap}
                          onChange={(e) =>
                            setLayoutSettings({
                              ...layoutSettings,
                              gap: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="settings-section">
                  <h4>Текст и нумерация</h4>

                  <div className="subsection">
                    <div className="setting-item checkbox-item">
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.addFileName}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              addFileName: e.target.checked,
                            })
                          }
                        />
                        Добавлять название изображения
                      </label>
                    </div>

                    {settings.addFileName && (
                      <div className="settings-grid settings-grid--3">
                        <div className="setting-item">
                          <label>Позиция</label>
                          <select
                            value={settings.fileNamePosition}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                fileNamePosition: e.target.value as
                                  | "below"
                                  | "above",
                              })
                            }
                          >
                            <option value="below">Под изображением</option>
                            <option value="above">Над изображением</option>
                          </select>
                        </div>

                        <div className="setting-item">
                          <label>Шрифт</label>
                          <select
                            value={settings.textSettings.fontFamily}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                textSettings: {
                                  ...settings.textSettings,
                                  fontFamily: e.target.value,
                                },
                              })
                            }
                          >
                            <option value="helvetica">Helvetica</option>
                            <option value="times">Times</option>
                            <option value="courier">Courier</option>
                          </select>
                        </div>

                        <div className="setting-item">
                          <label>Выравнивание</label>
                          <select
                            value={settings.textSettings.align}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                textSettings: {
                                  ...settings.textSettings,
                                  align: e.target.value as
                                    | "left"
                                    | "center"
                                    | "right",
                                },
                              })
                            }
                          >
                            <option value="left">Слева</option>
                            <option value="center">По центру</option>
                            <option value="right">Справа</option>
                          </select>
                        </div>

                        <div className="setting-item">
                          <label>
                            Размер шрифта: {settings.textSettings.fontSize}
                          </label>
                          <input
                            type="range"
                            min="6"
                            max="24"
                            value={settings.textSettings.fontSize}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                textSettings: {
                                  ...settings.textSettings,
                                  fontSize: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </div>

                        <div className="setting-item">
                          <label>Цвет текста</label>
                          <input
                            type="color"
                            value={settings.textSettings.fontColor}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                textSettings: {
                                  ...settings.textSettings,
                                  fontColor: e.target.value,
                                },
                              })
                            }
                            className="color-picker"
                          />
                        </div>

                        <div className="setting-item">
                          <label>Начертание</label>
                          <div className="style-toggles">
                            <button
                              className={`style-btn ${settings.textSettings.bold ? "active" : ""}`}
                              onClick={() =>
                                setSettings({
                                  ...settings,
                                  textSettings: {
                                    ...settings.textSettings,
                                    bold: !settings.textSettings.bold,
                                  },
                                })
                              }
                            >
                              <b>B</b>
                            </button>
                            <button
                              className={`style-btn ${settings.textSettings.italic ? "active" : ""}`}
                              onClick={() =>
                                setSettings({
                                  ...settings,
                                  textSettings: {
                                    ...settings.textSettings,
                                    italic: !settings.textSettings.italic,
                                  },
                                })
                              }
                            >
                              <i>I</i>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="subsection">
                    <div className="setting-item checkbox-item">
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.addPageNumbers}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              addPageNumbers: e.target.checked,
                            })
                          }
                        />
                        Добавлять номера страниц
                      </label>
                    </div>

                    {settings.addPageNumbers && (
                      <div className="settings-grid settings-grid--3">
                        <div className="setting-item">
                          <label>Позиция</label>
                          <select
                            value={settings.pageNumberPosition}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                pageNumberPosition: e.target.value as any,
                              })
                            }
                          >
                            <option value="bottom-center">
                              Снизу по центру
                            </option>
                            <option value="bottom-right">Снизу справа</option>
                            <option value="bottom-left">Снизу слева</option>
                            <option value="top-center">Сверху по центру</option>
                            <option value="top-right">Сверху справа</option>
                            <option value="top-left">Сверху слева</option>
                          </select>
                        </div>

                        <div className="setting-item">
                          <label>Формат</label>
                          <select
                            value={settings.pageNumberFormat}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                pageNumberFormat: e.target.value,
                              })
                            }
                          >
                            <option value="Page {page} of {total}">
                              Страница 1 из 10
                            </option>
                            <option value="{page}/{total}">1/10</option>
                            <option value="- {page} -">- 1 -</option>
                            <option value="{page}">1</option>
                          </select>
                        </div>

                        <div className="setting-item">
                          <label>Цвет номера</label>
                          <input
                            type="color"
                            value={settings.pageNumberTextSettings.fontColor}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                pageNumberTextSettings: {
                                  ...settings.pageNumberTextSettings,
                                  fontColor: e.target.value,
                                },
                              })
                            }
                            className="color-picker"
                          />
                        </div>

                        <div className="setting-item">
                          <label>
                            Размер шрифта:{" "}
                            {settings.pageNumberTextSettings.fontSize}
                          </label>
                          <input
                            type="range"
                            min="6"
                            max="16"
                            value={settings.pageNumberTextSettings.fontSize}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                pageNumberTextSettings: {
                                  ...settings.pageNumberTextSettings,
                                  fontSize: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Сетка изображений */}
            <div className="images-grid">
              {images.map((image, index) => (
                <div
                  key={image.id}
                  className={`image-card ${
                    draggedIndex === index ? "dragging" : ""
                  } ${dragOverIndex === index ? "drag-over-card" : ""}`}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOverCard(e, index)}
                  onDragLeave={handleDragLeaveCard}
                  onDrop={(e) => handleDropCard(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="image-preview">
                    <img src={image.previewUrl} alt={image.name} />
                    <div
                      className="drag-handle"
                      title="Перетащите для изменения порядка"
                    >
                      ⋮⋮
                    </div>
                  </div>
                  <div className="image-info">
                    <div className="image-name-display">
                      {editingNameIndex === index ? (
                        <input
                          type="text"
                          value={image.customName}
                          onChange={(e) =>
                            updateCustomName(index, e.target.value)
                          }
                          onBlur={() => setEditingNameIndex(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setEditingNameIndex(null);
                          }}
                          className="name-edit-input"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="editable-name"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNameIndex(index);
                          }}
                          title="Нажмите для редактирования"
                        >
                          {image.customName} ✏️
                        </span>
                      )}
                    </div>
                    <div className="image-size">
                      {formatFileSize(image.size)} • {image.width}×
                      {image.height}
                    </div>
                  </div>
                  <div className="image-controls">
                    <button
                      onClick={() => moveImage(index, "up")}
                      disabled={index === 0}
                      className="btn-move"
                      title="Переместить вверх"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveImage(index, "down")}
                      disabled={index === images.length - 1}
                      className="btn-move"
                      title="Переместить вниз"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeImage(image.id)}
                      className="btn-remove"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="image-number">{index + 1}</div>
                </div>
              ))}
            </div>

            {/* Информация */}
            <div className="layout-info">
              <div className="layout-stats">
                <span className="stat">📸 Изображений: {images.length}</span>
                {outputFormat === "pdf" ? (
                  <>
                    {settings.layoutMode === "grid" && (
                      <span className="stat">
                        📐 Сетка: {layoutSettings.columns}×{layoutSettings.rows}
                      </span>
                    )}
                    <span className="stat">
                      📄 Страниц в PDF: {getTotalPages()}
                    </span>
                    {settings.layoutMode === "grid" && (
                      <span className="stat">
                        📏 На странице:{" "}
                        {layoutSettings.columns * layoutSettings.rows} изобр.
                      </span>
                    )}
                  </>
                ) : (
                  <span className="stat">
                    📦 Формат: {getFormatInfo(outputFormat as ImageFormat).label}
                    {images.length > 1 ? " • отдельными файлами" : ""}
                  </span>
                )}
              </div>
            </div>

            {/* Конвертация */}
            <div className="conversion-section">
              {converting && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                  ></div>
                  <span className="progress-text">{progress}%</span>
                </div>
              )}
              <button
                onClick={handleConvert}
                disabled={converting || images.length === 0}
                className="btn-convert"
              >
                {converting
                  ? `⏳ Конвертация... ${progress}%`
                  : outputFormat === "pdf"
                    ? `📄 Создать PDF (${images.length} изображ.)`
                    : `⬇️ Сохранить ${
                        getFormatInfo(outputFormat as ImageFormat).label
                      } (${images.length})`}
              </button>
            </div>
          </div>
        )}
      <ImageConverterInstructions
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </PageShell>
  );
};

export default ImageConverter;
