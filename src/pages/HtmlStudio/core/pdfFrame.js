// Executed only in the export iframe. renderer, jsPDF and font are supplied by pdf.ts.
const send = (data) => parent.postMessage({ type: "html-studio-pdf", ...data }, "*");

// A PDF has no scrollbars. Open scrollable panels in this disposable copy
// from the inside out so that a nested report or wide table is captured in full.
function expandScrollPanels() {
  const nodes = [document.documentElement, document.body, ...document.body.querySelectorAll("*")];
  for (const el of nodes.reverse()) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    for (const axis of ["width", "height"]) {
      const horizontal = axis === "width";
      const overflow = horizontal ? style.overflowX : style.overflowY;
      if (!["auto", "scroll"].includes(overflow)) continue;
      const scroll = horizontal ? el.scrollWidth : el.scrollHeight;
      if (scroll <= (horizontal ? el.clientWidth : el.clientHeight) + 1) continue;
      const sides = horizontal ? ["Left", "Right"] : ["Top", "Bottom"];
      let size = scroll;
      for (const side of sides) {
        size += style.boxSizing === "border-box" ? parseFloat(style["border" + side + "Width"]) : -parseFloat(style["padding" + side]);
      }
      el.style.setProperty("max-" + axis, "none", "important");
      el.style.setProperty("min-" + axis, size + "px", "important");
      el.style.setProperty("overflow-" + (horizontal ? "x" : "y"), "visible", "important");
    }
  }
}

function measure(pageHeight) {
  const protectedBands = [];
  const forced = new Set();
  const words = [];
  const links = [];
  const protect = (rect) => {
    if (rect.height > 0 && rect.height < pageHeight) protectedBands.push([rect.top, rect.bottom]);
  };
  for (const el of document.body.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (!rect.height || !rect.width) continue;
    const style = getComputedStyle(el);
    if (el.matches("tr, img, svg, canvas, figure") || style.breakInside.startsWith("avoid")) protect(rect);
    if (el.matches("h1, h2, h3, h4, h5, h6, thead")) {
      const next = el.nextElementSibling?.getBoundingClientRect();
      const bottom = next && next.top >= rect.top ? Math.max(rect.bottom, Math.min(next.bottom, next.top + 24)) : rect.bottom;
      protect({ top: rect.top, bottom, height: bottom - rect.top });
    }
    if (["page", "always", "left", "right"].includes(style.breakBefore)) forced.add(Math.floor(rect.top));
    if (["page", "always", "left", "right"].includes(style.breakAfter)) forced.add(Math.ceil(rect.bottom));
    if (el instanceof HTMLAnchorElement && /^(https?:|mailto:)$/.test(el.protocol)) {
      for (const r of el.getClientRects()) links.push({ x: r.x, y: r.y, w: r.width, h: r.height, url: el.href });
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.data.trim() || !parent || parent.closest("script,style,noscript,template")) continue;
    const style = getComputedStyle(parent);
    if (style.visibility !== "visible") continue;
    if (style.display !== "contents" && parent.checkVisibility?.({ opacityProperty: true }) === false) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) protect(rect);
    for (const match of node.data.matchAll(/\S+/g)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const r = range.getBoundingClientRect();
      const size = parseFloat(style.fontSize);
      if (r.width && r.height && size > 0) words.push({ text: match[0], x: r.left, y: r.bottom - size * 0.2, w: r.width, size });
    }
  }
  return { protectedBands, forced: [...forced].sort((a, b) => a - b), words, links };
}

// A cut may cross several columns. Move it above every intersecting line or
// unbreakable row. A figure taller than a sheet can span sheets.
function pageEnds(height, capacity, layout) {
  const ends = [];
  let top = 0;
  while (top < height) {
    const limit = Math.min(height, top + capacity);
    const explicit = layout.forced.find(y => y > top && y <= limit);
    let end = explicit ?? limit;
    if (!explicit && end < height) {
      let previous;
      do {
        previous = end;
        for (const [a, b] of layout.protectedBands) {
          if (a < end - 0.01 && b > end + 0.01) end = a;
        }
      } while (end > top && end < previous);
      if (end <= top) end = limit;
    }
    ends.push(end);
    top = end;
  }
  return ends;
}

async function buildPdf() {
  const root = document.documentElement;
  const body = document.body;
  for (const img of document.images) img.loading = "eager";
  // Script-driven charts often animate after the load event.
  if (document.scripts.length) await new Promise(done => setTimeout(done, 1100));
  await Promise.all([document.fonts.ready, ...Array.from(document.images, img =>
    img.currentSrc || img.src ? img.decode() : undefined)]);
  window.scrollTo(0, 0);
  document.getAnimations().forEach(animation => animation.pause());
  expandScrollPanels();
  const width = Math.ceil(Math.max(root.clientWidth, root.scrollWidth, body.scrollWidth));
  const height = Math.ceil(Math.max(1, root.getBoundingClientRect().bottom, body.getBoundingClientRect().bottom,
    root.scrollHeight > root.clientHeight ? root.scrollHeight : 0));
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: document.title });
  const margin = 28.35; // 10 mm
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const unit = contentWidth / width;
  const capacity = Math.max(1, Math.floor((pdf.internal.pageSize.getHeight() - margin * 2) / unit));
  const layout = measure(capacity);
  const ends = pageEnds(height, capacity, layout);
  send({ stage: "Сохраняем оформление…" });
  // html-to-image deep-clones inline SVG trees. Embed their computed styles
  // before removing the document head, including stylesheet-defined chart colours.
  const svgStyles = Array.from(body.querySelectorAll("svg *"), el => {
    const cs = getComputedStyle(el);
    return [el, Array.from(cs, key => key + ":" + cs.getPropertyValue(key)).join(";")];
  });
  for (const [el, css] of svgStyles) if (el.style) el.style.cssText = css;
  for (const img of document.images) {
    if (!img.currentSrc) continue;
    const chosen = img.currentSrc;
    img.closest("picture")?.querySelectorAll("source").forEach(source => source.remove());
    img.removeAttribute("srcset");
    img.src = chosen;
  }
  // A failed background-image fetch would otherwise silently produce an empty box.
  const missingAsset = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#html-studio-missing";
  const svg = await renderer.toSvg(root, {
    width, height, includeQueryParams: true, imagePlaceholder: missingAsset,
    filter: el => !["HEAD", "SCRIPT", "NOSCRIPT"].includes(el.tagName),
  });
  // Reuse one self-contained browser layout. Decode only one A4 slice at a
  // time so that long documents never need a document-height bitmap.
  const svgText = decodeURIComponent(svg.slice(svg.indexOf(",") + 1));
  if (svgText.includes(missingAsset)) throw new Error("External resource unavailable");
  const start = svgText.indexOf(">", svgText.indexOf("<foreignObject")) + 1;
  const content = encodeURIComponent(svgText.slice(start, svgText.lastIndexOf("</foreignObject>")));
  const ratio = 1700 / width;
  const canvas = document.createElement("canvas");
  canvas.width = 1700;
  const ctx = canvas.getContext("2d");
  pdf.addFileToVFS("LiberationSans.ttf", font);
  pdf.addFont("LiberationSans.ttf", "LiberationSans", "normal");
  pdf.setFont("LiberationSans");
  let top = 0;
  for (const [index, end] of ends.entries()) {
    send({ stage: "Страница " + (index + 1) + " из " + ends.length });
    const h = end - top;
    const image = new Image();
    const header = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + h +
      '" viewBox="0 ' + top + ' ' + width + ' ' + h + '"><foreignObject width="' + width + '" height="' + height + '">';
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(header) + content + "%3C/foreignObject%3E%3C/svg%3E";
    await image.decode();
    canvas.height = Math.max(1, Math.round(h * ratio));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (index) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, contentWidth, h * unit, undefined, "FAST");
    for (const word of layout.words) {
      if (word.y < top || word.y >= end || word.x < 0 || word.x >= width) continue;
      pdf.setFontSize(word.size * unit);
      // Keep Unicode characters absent from the search font (e.g. ₽) copyable.
      const face = pdf.getFont().metadata;
      const missing = Array.from(word.text).some(c => !face.characterToGlyph(c.codePointAt(0)));
      const text = missing ? "M" : word.text;
      if (missing) {
        let hex = "FEFF";
        for (let i = 0; i < word.text.length; i++) hex += word.text.charCodeAt(i).toString(16).padStart(4, "0");
        pdf.internal.write("/Span << /ActualText <" + hex + "> >> BDC");
      }
      const natural = pdf.getTextWidth(text);
      pdf.text(text, margin + word.x * unit, margin + (word.y - top) * unit, {
        renderingMode: "invisible", horizontalScale: natural > 0 ? word.w * unit / natural : 1,
      });
      if (missing) pdf.internal.write("EMC");
    }
    for (const link of layout.links) {
      const y = Math.max(link.y, top);
      const bottom = Math.min(link.y + link.h, end);
      if (bottom > y) pdf.link(margin + link.x * unit, margin + (y - top) * unit, link.w * unit, (bottom - y) * unit, { url: link.url });
    }
    top = end;
  }
  canvas.width = canvas.height = 0;
  return pdf.output("blob");
}

window.addEventListener("load", async () => {
  try {
    send({ stage: "Готовим страницу…" });
    send({ blob: await buildPdf() });
  } catch (error) {
    console.error("HTML → PDF", error);
    send({ error: "Не удалось собрать PDF. Проверьте в просмотре загрузку изображений и шрифтов. Внешние изображения можно заменить файлами в редакторе." });
  }
}, { once: true });
