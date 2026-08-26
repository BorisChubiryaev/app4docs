// Работа с .docx как с zip-контейнером OOXML.
import JSZip from "jszip";

export interface DocxParts {
  zip: JSZip;
  document: string; // word/document.xml
  footnotes: string | null; // word/footnotes.xml (может отсутствовать)
  numbering: string | null; // word/numbering.xml (для восстановления нумерации)
}

export async function loadDocx(data: Uint8Array | ArrayBuffer): Promise<DocxParts> {
  const zip = await JSZip.loadAsync(data);
  const document = await zip.file("word/document.xml")!.async("string");
  const fnFile = zip.file("word/footnotes.xml");
  const footnotes = fnFile ? await fnFile.async("string") : null;
  const nbFile = zip.file("word/numbering.xml");
  const numbering = nbFile ? await nbFile.async("string") : null;
  return { zip, document, footnotes, numbering };
}

/** Записать изменённые части обратно и отдать байты .docx. */
export async function saveDocx(
  parts: DocxParts,
  patched: { document?: string; footnotes?: string },
): Promise<Uint8Array> {
  if (patched.document !== undefined) {
    parts.zip.file("word/document.xml", patched.document);
  }
  if (patched.footnotes !== undefined && patched.footnotes !== null) {
    parts.zip.file("word/footnotes.xml", patched.footnotes);
  }
  return parts.zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
