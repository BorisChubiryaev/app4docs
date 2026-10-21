import type { PDFDocument } from "pdf-lib";
import type { Annotation } from "../components/PageAnnotator";

/** Поля обрезки в миллиметрах — со сторон страницы в итоговой ориентации. */
export type Crop = { top: number; right: number; bottom: number; left: number };

export type PageItem = {
  id: string;
  fileId: number;
  pageIndex: number;
  fileName: string;
  pageNumber: number;
  /** Дополнительный поворот страницы в градусах (0/90/180/270) */
  rotation?: number;
  /** Аннотации (текст, фигуры, рисование, картинки, вымарывание) */
  annotations?: Annotation[];
  crop?: Crop;
  /** Вписать страницу в лист A4 */
  fitA4?: boolean;
};

/**
 * Слово для невидимого текстового слоя. Координаты — в пунктах страницы
 * с учётом её собственного поворота (как на экране), Y растёт вверх,
 * y — базовая линия.
 */
export type TextWord = { str: string; x: number; y: number; width: number; size: number };

export type FormValue = string | boolean;

export type SourceFile = {
  fileName: string;
  arrayBuffer: ArrayBuffer;
  /** Документ pdf.js (для растеризации и текста) */
  pdf: any;
  pageCount: number;
  /** Значения полей формы, заданные пользователем */
  formValues?: Record<string, FormValue>;
};

export type PageNumbersOptions = {
  enabled: boolean;
  position: string;
  format: string;
  size: number;
  color: string;
};

export type WatermarkOptions = {
  enabled: boolean;
  text: string;
  opacity: number;
  size: number;
  color: string;
};

export type BuildOptions = {
  files: SourceFile[];
  /** Распознанный текст сканов: ключ `${fileId}:${pageIndex}` */
  ocr?: Map<string, TextWord[]>;
  pageNumbers?: PageNumbersOptions;
  watermark?: WatermarkOptions;
  /** Обработка документа до наложения аннотаций (сжатие картинок) */
  transform?: (doc: PDFDocument) => Promise<void>;
  /** Растеризовать все страницы в JPEG (максимальное сжатие) */
  raster?: { quality: number };
};

export const pageKey = (fileId: number, pageIndex: number) => `${fileId}:${pageIndex}`;

export const MM = 72 / 25.4;
