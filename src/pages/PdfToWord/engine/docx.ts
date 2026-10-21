// Сборка .docx из разобранных страниц.
// Размер страницы и поля — как в PDF; многоколоночные зоны — разделы Word
// с колонками; заголовки — со стилями «Заголовок 1–3» (для навигации), но
// с исходным оформлением текста.

import {
  AlignmentType,
  BorderStyle,
  Document,
  FrameAnchorType,
  FrameWrap,
  HorizontalPositionRelativeFrom,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type ISectionOptions,
} from "docx";
import type { Align, Block, DesignPage, HeaderFooter, ImageBlock, PageLayout, ParaBlock, Run, TableBlock } from "./types";

const tw = (pt: number) => Math.round(pt * 20);
const px = (pt: number) => Math.max(1, Math.round((pt * 96) / 72));

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const HEADINGS = [undefined, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

function textRuns(runs: Run[], fields = false): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const base = {
      font: r.font,
      size: Math.round(r.size * 2),
      bold: r.bold || undefined,
      italics: r.italic || undefined,
      color: r.color ?? undefined,
      underline: r.underline ? { type: UnderlineType.SINGLE } : undefined,
      strike: r.strike || undefined,
      superScript: r.script === "super" || undefined,
      subScript: r.script === "sub" || undefined,
    };
    // Табуляции и поля номера страницы — отдельными элементами
    const children: (string | Tab | (typeof PageNumber)[keyof typeof PageNumber])[] = [];
    const parts = r.text.split(/(\t|\{PAGE\}|\{NUMPAGES\})/);
    for (const p of parts) {
      if (!p) continue;
      if (p === "\t") children.push(new Tab());
      else if (fields && p === "{PAGE}") children.push(PageNumber.CURRENT);
      else if (fields && p === "{NUMPAGES}") children.push(PageNumber.TOTAL_PAGES);
      else children.push(p);
    }
    if (children.length) out.push(new TextRun({ ...base, children }));
  }
  return out;
}

type FrameOpt = ConstructorParameters<typeof Paragraph>[0] extends infer O ? (O extends { frame?: infer F } ? F : never) : never;

function paragraph(b: ParaBlock, opts: { inCell?: boolean; frame?: FrameOpt } = {}): Paragraph {
  const indent: { left?: number; right?: number; firstLine?: number; hanging?: number } = {};
  if (b.indentLeft > 0.5) indent.left = tw(b.indentLeft);
  if (b.firstLine > 0.5) indent.firstLine = tw(b.firstLine);
  else if (b.firstLine < -0.5) indent.hanging = tw(-b.firstLine);
  return new Paragraph({
    children: textRuns(b.runs),
    alignment: ALIGN[b.align],
    heading: opts.inCell ? undefined : HEADINGS[b.heading],
    indent,
    spacing: { before: tw(b.spaceBefore), after: 0, line: Math.round(240 * b.lineSpacing), lineRule: LineRuleType.AUTO },
    tabStops: b.tabs.length
      ? b.tabs.map((t) => ({ type: t.type === "right" ? TabStopType.RIGHT : t.type === "center" ? TabStopType.CENTER : TabStopType.LEFT, position: tw(t.pos) }))
      : undefined,
    shading: b.shading ? { type: ShadingType.CLEAR, color: "auto", fill: b.shading } : undefined,
    pageBreakBefore: b.pageBreakBefore || undefined,
    border: b.borderBottom ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 2 } } : undefined,
    keepNext: b.heading ? true : undefined,
    frame: opts.frame,
  });
}

/** Страница-макет: фон за текстом и рамки с текстом на своих местах. */
function designChildren(d: DesignPage, width: number, height: number): Paragraph[] {
  const out: Paragraph[] = [];
  const bg = d.background;
  out.push(
    new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: bg
        ? [
            new ImageRun({
              data: bg.data,
              type: bg.type,
              transformation: { width: px(width), height: px(height) },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
                allowOverlap: true,
                wrap: { type: TextWrappingType.NONE },
              },
            }),
          ]
        : [],
    }),
  );
  for (const f of d.frames) {
    const frame: FrameOpt = {
      type: "absolute",
      position: { x: tw(f.x), y: tw(f.y) },
      width: tw(f.width),
      height: tw(f.height),
      anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
      wrap: FrameWrap.AROUND,
      rule: HeightRule.ATLEAST,
    };
    for (const p of f.paras) out.push(paragraph({ ...p, indentLeft: Math.max(0, p.indentLeft), pageBreakBefore: false }, { frame }));
  }
  return out;
}

function imageParagraph(b: ImageBlock, maxW: number, align: Align = b.align): Paragraph {
  let w = b.width;
  let h = b.height;
  if (w > maxW) {
    h *= maxW / w;
    w = maxW;
  }
  return new Paragraph({
    children: [new ImageRun({ data: b.data, type: b.type, transformation: { width: px(w), height: px(h) } })],
    alignment: ALIGN[align],
    indent: align === "left" && b.indentLeft > 1 ? { left: tw(b.indentLeft) } : undefined,
    spacing: { before: tw(b.spaceBefore ?? 0), after: 0 },
    pageBreakBefore: b.pageBreakBefore || undefined,
  });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" };

function table(b: TableBlock, maxW: number): (Table | Paragraph)[] {
  const total = b.colWidths.reduce((a, c) => a + c, 0);
  const k = total > maxW ? maxW / total : 1;
  // Толщина рамки в восьмых долях пункта, как в Word
  const SINGLE = { style: BorderStyle.SINGLE, size: Math.max(2, Math.min(24, Math.round((b.borderWidth ?? 0.5) * 8))), color: b.borderColor ?? "000000" };
  const widths = b.colWidths.map((w) => Math.max(tw(8), tw(w * k)));
  const rows = b.rows.map(
    (row, ri) =>
      new TableRow({
        tableHeader: ri < b.headerRows || undefined,
        height: b.rowHeights[ri] ? { value: tw(b.rowHeights[ri] * (b.borders ? 0.9 : 1)), rule: HeightRule.ATLEAST } : undefined,
        children: row
          .map((cell, ci) => ({ cell, ci }))
          .filter(({ cell }) => !cell.covered)
          .map(({ cell, ci }) => {
            const width = widths.slice(ci, ci + cell.colSpan).reduce((a, c) => a + c, 0);
            const children: Paragraph[] = [
              ...cell.paras.map((p) => paragraph(p, { inCell: true })),
              ...cell.images.map((im) => imageParagraph(im, (width / 20) * 0.95)),
            ];
            if (!children.length) children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0 } }));
            return new TableCell({
              children,
              columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              width: { size: width, type: WidthType.DXA },
              shading: cell.shading ? { type: ShadingType.CLEAR, color: "auto", fill: cell.shading } : undefined,
              verticalAlign: cell.vAlign === "center" ? VerticalAlign.CENTER : cell.vAlign === "bottom" ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
              margins: { top: 20, bottom: 20, left: b.borders ? 60 : 0, right: b.borders ? 60 : 80 },
              borders: b.borders ? { top: SINGLE, bottom: SINGLE, left: SINGLE, right: SINGLE } : { top: NONE, bottom: NONE, left: NONE, right: NONE },
            });
          }),
      }),
  );
  const t = new Table({
    rows,
    columnWidths: widths,
    width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    indent: b.x0 > 1 ? { size: tw(b.x0), type: WidthType.DXA } : undefined,
    borders: b.borders
      ? undefined
      : { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
  });
  const out: (Table | Paragraph)[] = [];
  // Таблица в Word не имеет интервала перед собой — даём его пустым абзацем
  const gap = b.spaceBefore ?? 0;
  if (b.pageBreakBefore || gap >= 3)
    out.push(
      new Paragraph({
        children: [],
        pageBreakBefore: b.pageBreakBefore || undefined,
        spacing: { before: 0, after: 0, line: tw(Math.max(1, gap)), lineRule: LineRuleType.EXACT },
      }),
    );
  out.push(t);
  return out;
}

function blocksToChildren(blocks: Block[], maxW: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "para") out.push(paragraph(b));
    else if (b.kind === "image") out.push(imageParagraph(b, maxW));
    else {
      out.push(...table(b, maxW));
      // Word склеивает таблицы, идущие подряд, — между ними нужен абзац
      const next = blocks[i + 1];
      if (!next || next.kind === "table")
        out.push(new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 40, lineRule: LineRuleType.EXACT } }));
    }
  });
  return out;
}

function hfChildren(hf: HeaderFooter | null): Paragraph[] {
  if (!hf) return [];
  return hf.lines.map(
    (l) =>
      new Paragraph({
        children: textRuns(l.runs, true),
        alignment: ALIGN[l.align],
        spacing: { before: 0, after: 0 },
      }),
  );
}

export interface DocMeta {
  bodyFont: string;
  bodySize: number;
  margins: { left: number; right: number; top: number; bottom: number };
  header: HeaderFooter | null;
  footer: HeaderFooter | null;
  title: string;
}

export async function buildDocx(pages: PageLayout[], meta: DocMeta): Promise<Blob> {
  const sections: ISectionOptions[] = [];
  const header = meta.header ? new Header({ children: hfChildren(meta.header) }) : undefined;
  const footer = meta.footer ? new Footer({ children: hfChildren(meta.footer) }) : undefined;
  const m = meta.margins;

  let afterDesign = false;
  let cur: { key: string; columns: number; gap: number; children: (Paragraph | Table)[]; page: PageLayout; type: "next" | "cont" } | null = null;
  const flush = () => {
    if (!cur || !cur.children.length) return;
    const p = cur.page;
    const landscape = p.width > p.height;
    sections.push({
      properties: {
        type: sections.length === 0 ? undefined : cur.type === "cont" ? SectionType.CONTINUOUS : SectionType.NEXT_PAGE,
        page: {
          size: landscape
            ? { width: tw(p.height), height: tw(p.width), orientation: PageOrientation.LANDSCAPE }
            : { width: tw(p.width), height: tw(p.height), orientation: PageOrientation.PORTRAIT },
          margin: {
            left: tw(m.left),
            right: tw(m.right),
            top: tw(m.top),
            bottom: tw(m.bottom),
            header: tw(Math.max(12, m.top * 0.4)),
            footer: tw(Math.max(12, m.bottom * 0.4)),
          },
        },
        column: cur.columns > 1 ? { count: cur.columns, space: tw(cur.gap), equalWidth: true } : undefined,
      },
      // После страницы-макета (с пустыми колонтитулами) колонтитулы задаём заново
      headers: header && (sections.length === 0 || afterDesign) ? { default: new Header({ children: hfChildren(meta.header) }) } : undefined,
      footers: footer && (sections.length === 0 || afterDesign) ? { default: new Footer({ children: hfChildren(meta.footer) }) } : undefined,
      children: cur.children,
    });
    afterDesign = false;
  };

  for (const p of pages) {
    if (p.design) {
      flush();
      const landscape = p.width > p.height;
      sections.push({
        properties: {
          type: sections.length ? SectionType.NEXT_PAGE : undefined,
          page: {
            size: landscape
              ? { width: tw(p.height), height: tw(p.width), orientation: PageOrientation.LANDSCAPE }
              : { width: tw(p.width), height: tw(p.height), orientation: PageOrientation.PORTRAIT },
            margin: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 },
          },
        },
        // Колонтитулы документа на макете не нужны
        headers: { default: new Header({ children: [] }) },
        footers: { default: new Footer({ children: [] }) },
        children: designChildren(p.design, p.width, p.height),
      });
      afterDesign = true;
      cur = null;
      continue;
    }
    const sizeKey = `${Math.round(p.width)}x${Math.round(p.height)}`;
    const textW = p.width - m.left - m.right;
    for (const z of p.zones) {
      const key = `${sizeKey}|${z.columns}`;
      const maxW = z.columns > 1 ? (textW - z.gap * (z.columns - 1)) / z.columns : textW;
      const children = blocksToChildren(z.blocks, maxW);
      if (!children.length) continue;
      if (cur && cur.key === key) cur.children.push(...children);
      else {
        const prevKey: string | null = cur ? (cur as { key: string }).key : null;
        const sameSize: boolean = prevKey !== null && prevKey.split("|")[0] === sizeKey;
        flush();
        cur = { key, columns: z.columns, gap: z.gap, children, page: p, type: sameSize ? "cont" : "next" };
      }
    }
  }
  flush();
  if (!sections.length)
    sections.push({ children: [new Paragraph({ children: [new TextRun({ text: "(В PDF нет текста и картинок)", italics: true, color: "999999" })] })] });

  const doc = new Document({
    title: meta.title,
    creator: "Конвертер документов",
    styles: {
      default: {
        document: { run: { font: meta.bodyFont, size: Math.round(meta.bodySize * 2) }, paragraph: { spacing: { after: 0 } } },
        // Заголовки — для навигации и оглавления, внешний вид задаёт сам текст
        heading1: { run: { color: "000000", bold: false, italics: false }, paragraph: { spacing: { after: 0 } } },
        heading2: { run: { color: "000000", bold: false, italics: false }, paragraph: { spacing: { after: 0 } } },
        heading3: { run: { color: "000000", bold: false, italics: false }, paragraph: { spacing: { after: 0 } } },
      },
    },
    sections,
  });
  return Packer.toBlob(doc);
}
