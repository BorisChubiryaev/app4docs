// Генерация «объединённого файла с вносимыми изменениями»:
// все инструкции из нескольких документов «Изменения», выстроенные
// В ПОРЯДКЕ СЛЕДОВАНИЯ ПУНКТОВ ОФЕРТЫ (порядок задаётся orderKey из движка).
import JSZip from "jszip";
import { escapeXml } from "./ooxml";
import type { Operation } from "./types";

function para(text: string, opts: { bold?: boolean; size?: number; center?: boolean } = {}): string {
  const rpr =
    opts.bold || opts.size
      ? `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}</w:rPr>`
      : "";
  const ppr = opts.center ? `<w:pPr><w:jc w:val="center"/></w:pPr>` : "";
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows: string[][]): string {
  const trs = rows
    .map(
      (r) =>
        `<w:tr>${r
          .map(
            (c) =>
              `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${escapeXml(
                c,
              )}</w:t></w:r></w:p></w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>${trs}</w:tbl>`;
}

export interface CombinedMeta {
  title?: string;
  subtitle?: string;
}

/** Собрать docx объединённого файла изменений. */
export async function buildCombinedDocx(
  orderedOps: Operation[],
  meta: CombinedMeta = {},
): Promise<Uint8Array> {
  const title = meta.title ?? "ИЗМЕНЕНИЯ в Публичную оферту «Удобный доступ»";
  const subtitle =
    meta.subtitle ??
    "Объединённый перечень изменений (в порядке следования пунктов Оферты)";

  const bodyParts: string[] = [];
  bodyParts.push(para(title, { bold: true, size: 28, center: true }));
  bodyParts.push(para(subtitle, { center: true }));
  bodyParts.push(para(""));
  bodyParts.push(
    para("Внести следующие изменения в Приложение 7 «Публичная оферта о присоединении к услуге «Удобный доступ»:"),
  );
  bodyParts.push(para(""));

  orderedOps.forEach((op, i) => {
    bodyParts.push(para(`${i + 1}. ${op.rawText}`));
    if (op.type === "append_table_rows" && op.rows && op.rows.length) {
      bodyParts.push(tableXml(op.rows));
    }
    bodyParts.push(para(`(источник: ${op.sourceDoc})`, { size: 18 }));
    bodyParts.push(para(""));
  });

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyParts.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  zip.file("word/document.xml", documentXml);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
