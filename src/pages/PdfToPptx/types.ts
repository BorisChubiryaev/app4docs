// src/apps/PdfToPptx/types.ts

export interface ExtractedTextBlock {
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  rotation: number;
}

export interface ExtractedImage {
  type: "image";
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExtractedElement = ExtractedTextBlock | ExtractedImage;

export interface ParsedPage {
  pageNumber: number;
  widthInches: number;
  heightInches: number;
  elements: ExtractedElement[];
  backgroundDataUrl: string;
}

export interface ConversionProgress {
  stage:
    | "idle"
    | "loading"
    | "rendering"
    | "extracting"
    | "building"
    | "done"
    | "error";
  currentPage: number;
  totalPages: number;
  message: string;
  percent: number;
}
