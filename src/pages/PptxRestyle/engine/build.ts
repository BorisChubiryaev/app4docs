// Сборка: шаблон без слайдов-примеров + слайды исходных презентаций,
// перенесённые на фон шаблона и перекрашенные под него.
import { colorChild, resolveColor, rgbToHex, hexToRgb, type ColorCtx } from "./color";
import { loadDeck, type Deck, type SlideInfo } from "./deck";
import { Pkg, RT, relIs, baseOf, dirOf, relsPathOf, type Rel } from "./pkg";
import { ColorMapper, collectColors, placeTitle, restyleTree, type RestyleOptions } from "./restyle";
import { biggestText, findTitle, hasText, maxSize, placedShapes, shapesIn } from "./shapes";
import { RPR_ORDER, materializeBody, materializeText, phOf, setOrdered } from "./styles";
import { analyzeTemplate, type Role, type TemplateProfile } from "./template";
import { NS, attrR, desc, kid, kids, make, num, parseXml, removeEl, serializeXml, textOf } from "./xml";

export interface BuildOptions extends RestyleOptions {
  /** Заголовки — на место и в стиль шаблона */
  titles: boolean;
  /** Убрать картинки-фоны старого оформления (во весь слайд) */
  dropBackgroundPictures: boolean;
  /** Разделы по исходным файлам */
  sections: boolean;
  /** Перенести заметки докладчика */
  notes: boolean;
}

export const DEFAULT_OPTIONS: BuildOptions = {
  fonts: true,
  colors: true,
  titles: true,
  dropBackgroundPictures: true,
  sections: true,
  notes: true,
};

export interface SourceSlide {
  deck: number;
  index: number;
  title: string;
  role: Role;
}

export interface PlanItem {
  deck: number;
  index: number;
  /** id фона из профиля шаблона */
  bg: string | null;
  role: Role;
}

export interface SourceFile {
  name: string;
  data: ArrayBuffer | Uint8Array;
}

const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

const ctxOf = (s: SlideInfo): ColorCtx => ({ scheme: s.scheme, map: s.map });

/** Закрепить оформление всего текста слайда (фигуры и таблицы). */
function materializeSlide(doc: Document, s: SlideInfo, deck: Deck) {
  for (const sp of desc(doc, "sp", NS.p)) materializeText(sp, { layout: s.layout, master: s.master, defaults: deck.defaults });
  for (const tc of desc(doc, "tc", NS.a)) {
    const b = kid(tc, "txBody");
    if (b) materializeBody(b, [deck.defaults]);
  }
}

/** Предположить роль слайда исходника. */
export function guessRole(doc: Document, s: SlideInfo, deck: Deck, first: boolean): Role {
  const tree = doc.getElementsByTagNameNS(NS.p, "spTree")[0];
  if (!tree) return "content";
  const texts = placedShapes(tree).filter((p) => p.el.localName === "sp" && hasText(p.el));
  const big = Math.max(0, ...texts.map((p) => maxSize(p.el)));
  const chars = texts.reduce((n, p) => n + textOf(p.el).trim().length, 0);
  const others = placedShapes(tree).filter((p) => p.depth === 0 && p.el.localName !== "sp").length;
  if (s.layoutType === "title" || (first && !findTitle(tree, deck.cy) && big >= 2400)) return "title";
  if (s.layoutType === "secHead") return "section";
  if (!findTitle(tree, deck.cy) && chars < 60 && big >= 2400 && others <= 1) return "section";
  return "content";
}

/** Слайды исходника с заголовками и ролями — для списка в интерфейсе. */
export async function describeSource(data: ArrayBuffer | Uint8Array, name: string, deckIndex: number): Promise<{ slides: SourceSlide[]; cx: number; cy: number }> {
  const pkg = await Pkg.load(data);
  const deck = await loadDeck(pkg, name);
  const slides: SourceSlide[] = [];
  for (const s of deck.slides) {
    const doc = parseXml(serializeXml(await pkg.xml(s.part)));
    materializeSlide(doc, s, deck);
    const tree = doc.getElementsByTagNameNS(NS.p, "spTree")[0];
    const t = findTitle(tree, deck.cy) ?? biggestText(tree);
    slides.push({
      deck: deckIndex,
      index: s.index,
      // Строки заголовка — через пробел, а не слитно
      title: t
        ? desc(t.el, "p", NS.a)
            .map((p) => textOf(p))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
        : "",
      role: guessRole(doc, s, deck, s.index === 0),
    });
  }
  return { slides, cx: deck.cx, cy: deck.cy };
}

/** Удалить из шаблона слайды-примеры (части удалятся при сборке мусора). */
async function clearSlides(dst: Pkg) {
  const presPart = "ppt/presentation.xml";
  const pres = await dst.xml(presPart);
  const lst = pres.getElementsByTagNameNS(NS.p, "sldIdLst")[0];
  if (lst) while (lst.firstChild) lst.removeChild(lst.firstChild);
  const all = await dst.rels(presPart);
  // Сами слайды-примеры и их заметки удаляем сразу (номера освобождаются),
  // картинки — позже, сборкой мусора: часть из них станет фоном новых слайдов
  for (const r of all.filter((x) => relIs(x, RT.slide))) {
    for (const sr of await dst.rels(r.abs)) if (relIs(sr, RT.notesSlide) && dst.has(sr.abs)) {
      dst.remove(sr.abs);
      if (dst.has(relsPathOf(sr.abs))) dst.remove(relsPathOf(sr.abs));
    }
    dst.remove(r.abs);
    if (dst.has(relsPathOf(r.abs))) dst.remove(relsPathOf(r.abs));
  }
  dst.setRels(presPart, all.filter((r) => !relIs(r, RT.slide)));
  // Разделы и произвольные показы шаблона ссылались на удалённые слайды
  for (const ext of desc(pres, "ext", NS.p)) if (desc(ext, "sectionLst", "*").length) removeEl(ext);
  removeEl(pres.getElementsByTagNameNS(NS.p, "custShowLst")[0]);
}

class Copier {
  private memo = new Map<string, string>();
  constructor(
    private src: Pkg,
    private dst: Pkg,
    private tag: string,
    private onChart: (part: string, doc: Document) => void,
  ) {}

  /** Скопировать часть со всеми её связями; вернуть новый путь. */
  async copy(part: string): Promise<string> {
    const hit = this.memo.get(part);
    if (hit) return hit;
    const dir = dirOf(part);
    const base = baseOf(part);
    const dot = base.lastIndexOf(".");
    const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\d+$/, "");
    const ext = dot > 0 ? base.slice(dot + 1) : "bin";
    const name = this.dst.freeName(dir, `${stem}${this.tag}_`, ext);
    this.memo.set(part, name);
    const ct = this.src.contentType(part);
    const isXml = /\.(xml|rels)$/i.test(part);
    if (isXml) {
      const doc = parseXml(serializeXml(await this.src.xml(part)));
      if (ct?.includes("drawingml.chart+xml")) this.onChart(name, doc);
      this.dst.setXml(name, doc);
    } else this.dst.setBytes(name, await this.src.bytes(part));
    if (ct) {
      const srcDefault = this.src.hasDefault(ext) && !isXml;
      if (srcDefault) this.dst.addDefault(ext, ct);
      else this.dst.setOverride(name, ct);
    }
    const rels = await this.src.rels(part);
    if (rels.length) {
      const out: Rel[] = [];
      for (const r of rels) {
        if (r.external) out.push(r);
        else if (this.src.has(r.abs)) out.push({ ...r, abs: await this.copy(r.abs) });
      }
      this.dst.setRels(name, out);
    }
    return name;
  }
}

/** Цвета текста и линий диаграммы — под фон шаблона. */
function restyleChart(doc: Document, src: ColorCtx, profile: TemplateProfile, mapper: ColorMapper, opts: BuildOptions) {
  if (!opts.colors && !opts.fonts) return;
  const body = hexToRgb(profile.body.color);
  for (const f of desc(doc, "solidFill", NS.a)) {
    const c = resolveColor(colorChild(f), src);
    if (!c || !opts.colors) continue;
    const inText = !!(f.parentNode && /^(rPr|defRPr)$/.test((f.parentNode as Element).localName));
    const rgb = inText ? body : mapper.fill(c.rgb);
    const old = colorChild(f);
    if (old) {
      const el = make(doc, NS.a, "srgbClr", { val: rgbToHex(rgb) });
      f.replaceChild(el, old);
    }
  }
  // Текст: у всех стилей текста диаграммы — цвет и шрифт шаблона
  const space = doc.documentElement;
  if (!kid(space, "txPr")) {
    const txPr = parseXml(`<c:txPr xmlns:c="${NS.c}" xmlns:a="${NS.a}"><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>`).documentElement;
    const before = kids(space).find((k) => ["externalData", "printSettings", "userShapes", "extLst"].includes(k.localName));
    space.insertBefore(doc.importNode(txPr, true), before ?? null);
  }
  for (const r of [...desc(doc, "defRPr", NS.a), ...desc(doc, "rPr", NS.a)]) {
    if (opts.colors && !kid(r, "solidFill")) {
      const f = make(doc, NS.a, "solidFill");
      f.appendChild(make(doc, NS.a, "srgbClr", { val: profile.body.color }));
      setOrdered(r, f, RPR_ORDER, [["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]]);
    }
    if (opts.fonts) setOrdered(r, make(doc, NS.a, "latin", { typeface: profile.body.font }), RPR_ORDER);
  }
  // Ряды без своего цвета красятся темой — у шаблона она может быть «чужой»: даём фирменные цвета
  if (opts.colors && profile.palette.length) {
    let i = 0;
    for (const chartType of kids(desc(doc, "plotArea", NS.c)[0])) {
      if (/^(pie|pie3D|doughnut|ofPie)Chart$/.test(chartType.localName)) continue;
      const line = /^(line|line3D|scatter|radar)Chart$/.test(chartType.localName);
      for (const ser of kids(chartType, "ser")) {
        const color = profile.palette[i++ % profile.palette.length];
        let spPr = kid(ser, "spPr");
        if (spPr && (kids(spPr).some((k) => ["solidFill", "gradFill", "pattFill", "blipFill"].includes(k.localName)) || desc(spPr, "solidFill", NS.a).length)) continue;
        if (!spPr) {
          spPr = make(doc, NS.c, "spPr");
          const after = kid(ser, "tx") ?? kid(ser, "order") ?? kid(ser, "idx");
          ser.insertBefore(spPr, after ? after.nextSibling : ser.firstChild);
        }
        const fill = parseXml(`<a:solidFill xmlns:a="${NS.a}"><a:srgbClr val="${color}"/></a:solidFill>`).documentElement;
        if (line) {
          const ln = parseXml(`<a:ln xmlns:a="${NS.a}" w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>`).documentElement;
          spPr.appendChild(doc.importNode(ln, true));
        } else spPr.insertBefore(doc.importNode(fill, true), spPr.firstChild);
      }
    }
  }
}

export async function buildPresentation(
  template: SourceFile,
  sources: SourceFile[],
  plan: PlanItem[] | null,
  options: Partial<BuildOptions> = {},
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<Uint8Array> {
  const opts: BuildOptions = { ...DEFAULT_OPTIONS, ...options };
  const dst = await Pkg.load(template.data);
  const { deck: tdeck, profile } = await analyzeTemplate(dst, template.name);
  // Фоны слайдов-примеров нужно прочитать до их удаления
  const bgElements = new Map<string, { bg: Element; rels: Rel[] }>();
  for (const b of profile.backgrounds) {
    if (b.kind !== "slide") continue;
    const doc = await dst.xml(b.part);
    const bg = doc.getElementsByTagNameNS(NS.p, "bg")[0];
    const s = tdeck.slides.find((x) => x.part === b.part);
    if (bg && s) bgElements.set(b.id, { bg, rels: s.rels });
  }
  await clearSlides(dst);
  // Шаблон в формате .potx — результат должен быть обычной презентацией
  const mainCt = dst.contentType("ppt/presentation.xml");
  if (mainCt?.includes("template.main")) dst.setOverride("ppt/presentation.xml", mainCt.replace("template.main", "presentation.main"));

  const presPart = "ppt/presentation.xml";
  const pres = await dst.xml(presPart);
  const presRels = await dst.rels(presPart);
  let sldIdLst = pres.getElementsByTagNameNS(NS.p, "sldIdLst")[0];
  if (!sldIdLst) {
    sldIdLst = make(pres, NS.p, "sldIdLst");
    const after = pres.getElementsByTagNameNS(NS.p, "sldMasterIdLst")[0];
    const notes = pres.getElementsByTagNameNS(NS.p, "notesMasterIdLst")[0];
    const handout = pres.getElementsByTagNameNS(NS.p, "handoutMasterIdLst")[0];
    const anchor = handout ?? notes ?? after;
    anchor.parentNode!.insertBefore(sldIdLst, anchor.nextSibling);
  }
  const notesMaster = presRels.find((r) => relIs(r, RT.notesMaster))?.abs ?? null;
  let nextSldId = 256;
  let nextRid = Math.max(0, ...presRels.map((r) => Number(r.id.replace(/\D/g, "")) || 0)) + 1;

  const decks: Deck[] = [];
  for (const f of sources) decks.push(await loadDeck(await Pkg.load(f.data), f.name));

  // План по умолчанию: все слайды всех файлов, фон — по роли
  const items: PlanItem[] =
    plan ??
    (
      await Promise.all(
        decks.map(async (d, di) => {
          const out: PlanItem[] = [];
          for (const s of d.slides) {
            const doc = parseXml(serializeXml(await d.pkg.xml(s.part)));
            materializeSlide(doc, s, d);
            const role = guessRole(doc, s, d, s.index === 0);
            out.push({ deck: di, index: s.index, role, bg: profile.roles[role] ?? profile.roles.content });
          }
          return out;
        }),
      )
    ).flat();

  // Палитра каждого исходника — для устойчивого сопоставления цветов
  const mappers = new Map<number, ColorMapper>();
  for (const [di, d] of decks.entries()) {
    const counts = new Map<string, number>();
    for (const s of d.slides) collectColors(await d.pkg.xml(s.part), ctxOf(s), counts);
    mappers.set(di, new ColorMapper(profile, counts));
  }
  const copiers = new Map<number, Copier>();
  const sections: { name: string; ids: number[] }[] = [];
  const slideBg = hexToRgb(profile.bg);

  for (const [n, item] of items.entries()) {
    onProgress(n, items.length);
    // Дать браузеру перерисовать прогресс
    await new Promise((r) => setTimeout(r, 0));
    const d = decks[item.deck];
    const s = d.slides[item.index];
    if (!s) continue;
    const mapper = mappers.get(item.deck)!;
    const src = ctxOf(s);
    const doc = parseXml(serializeXml(await d.pkg.xml(s.part)));
    const root = doc.documentElement;
    const cSld = kid(root, "cSld")!;
    const tree = kid(cSld, "spTree")!;
    materializeSlide(doc, s, d);

    // Масштаб, если размер слайдов разный
    const k = Math.min(profile.cx / d.cx, profile.cy / d.cy);
    if (Math.abs(k - 1) > 0.01) {
      const dx = (profile.cx - d.cx * k) / 2;
      const dy = (profile.cy - d.cy * k) / 2;
      for (const sh of shapesIn(tree)) {
        const pr = sh.localName === "graphicFrame" ? sh : kids(sh).find((x) => x.localName === "spPr" || x.localName === "grpSpPr");
        const xfrm = sh.localName === "graphicFrame" ? kid(sh, "xfrm") : kid(pr, "xfrm");
        const off = kid(xfrm, "off");
        const ext = kid(xfrm, "ext");
        if (off) {
          off.setAttribute("x", String(Math.round((num(off, "x") ?? 0) * k + dx)));
          off.setAttribute("y", String(Math.round((num(off, "y") ?? 0) * k + dy)));
        }
        if (ext) {
          ext.setAttribute("cx", String(Math.round((num(ext, "cx") ?? 0) * k)));
          ext.setAttribute("cy", String(Math.round((num(ext, "cy") ?? 0) * k)));
        }
      }
      for (const r of [...desc(tree, "rPr", NS.a), ...desc(tree, "endParaRPr", NS.a)]) {
        const sz = num(r, "sz");
        if (sz) r.setAttribute("sz", String(Math.max(100, Math.round(sz * k))));
      }
    }

    // Старый фон слайда и картинки-фоны во весь слайд
    removeEl(kid(cSld, "bg"));
    // Пустые плейсхолдеры старого макета — в шаблоне они превратились бы в «Введите текст»
    for (const sh of shapesIn(tree)) if (sh.localName === "sp" && phOf(sh) && !hasText(sh)) removeEl(sh);
    if (opts.dropBackgroundPictures) {
      const top = shapesIn(tree);
      for (const p of placedShapes(tree)) {
        if (p.depth > 0 || p.el.localName !== "pic") continue;
        const area = (p.box.cx * p.box.cy) / (profile.cx * profile.cy);
        // Под картинкой нет ничего видимого — значит, это фон
        const below = top.slice(0, top.indexOf(p.el));
        const nothingBelow = below.every((b) => b.localName === "sp" && !hasText(b) && !kid(kid(b, "spPr"), "solidFill"));
        if (area >= 0.95 && nothingBelow) removeEl(p.el);
      }
    }
    // Схема цветов — как у мастера шаблона
    const ovr = kid(root, "clrMapOvr");
    if (ovr) {
      while (ovr.firstChild) ovr.removeChild(ovr.firstChild);
      ovr.appendChild(make(doc, NS.a, "masterClrMapping"));
    }

    // Заголовок и перекраска
    const title = item.role === "content" ? findTitle(tree, profile.cy)?.el ?? null : null;
    const hero = item.role !== "content" ? biggestText(tree)?.el ?? null : null;
    restyleTree(tree, { src, profile, mapper, opts, slideBg, title, hero });
    if (title && opts.titles) placeTitle(title, tree, { src, profile, mapper, opts, slideBg, title, hero }, profile.cy);
    // Плейсхолдеры, кроме заголовка, становятся обычными фигурами: всё уже закреплено
    for (const sh of [...desc(tree, "sp", NS.p), ...desc(tree, "pic", NS.p), ...desc(tree, "graphicFrame", NS.p)]) {
      const ph = phOf(sh);
      if (!ph) continue;
      const phEl = desc(sh, "ph", NS.p)[0];
      if (sh === title && (ph.type === "title" || ph.type === "ctrTitle")) {
        phEl.setAttribute("type", "title");
        phEl.removeAttribute("idx");
      } else removeEl(phEl);
    }

    // ── Запись слайда ──
    let copier = copiers.get(item.deck);
    if (!copier) {
      copier = new Copier(d.pkg, dst, `_f${item.deck + 1}`, (_part, chartDoc) => restyleChart(chartDoc, src, profile, mapper, opts));
      copiers.set(item.deck, copier);
    }
    const part = dst.freeName("ppt/slides", "slide", "xml");
    const bgOpt = profile.backgrounds.find((b) => b.id === item.bg) ?? null;
    const layoutPart = bgOpt?.kind === "layout" ? bgOpt.part : profile.blankLayout;
    const rels: Rel[] = [];
    const used = new Set(desc(doc, "*").flatMap((el) => Array.from(el.attributes).filter((a) => a.namespaceURI === NS.r || a.name.startsWith("r:")).map((a) => a.value)));
    for (const r of s.rels) {
      if (relIs(r, RT.slideLayout)) rels.push({ ...r, abs: layoutPart });
      else if (relIs(r, RT.notesSlide)) {
        if (opts.notes && notesMaster && d.pkg.has(r.abs)) rels.push({ ...r, abs: await copyNotes(d.pkg, dst, r.abs, part, notesMaster) });
      } else if (r.external) rels.push(r);
      else if (relIs(r, RT.slide) || relIs(r, RT.comments) || relIs(r, RT.commentAuthors)) {
        // Ссылки на другие слайды и комментарии не переносим
        if (used.has(r.id)) for (const el of desc(doc, "*")) if (attrR(el, "id") === r.id && /^hlink/.test(el.localName)) removeEl(el);
      } else if (d.pkg.has(r.abs)) rels.push({ ...r, abs: await copier.copy(r.abs) });
    }
    // Фон шаблона
    if (bgOpt?.kind === "slide") {
      const b = bgElements.get(bgOpt.id);
      if (b) {
        const bg = doc.importNode(b.bg, true) as Element;
        for (const el of desc(bg, "*")) {
          const id = attrR(el, "embed") ?? attrR(el, "link");
          if (!id) continue;
          const tr = b.rels.find((r) => r.id === id);
          if (!tr) continue;
          const nid = `rIdBg${rels.length + 1}`;
          rels.push({ ...tr, id: nid });
          if (el.hasAttributeNS(NS.r, "embed") || el.hasAttribute("r:embed")) el.setAttributeNS(NS.r, "r:embed", nid);
          else el.setAttributeNS(NS.r, "r:link", nid);
        }
        cSld.insertBefore(bg, cSld.firstChild);
      }
    }
    dst.setXml(part, doc);
    dst.setRels(part, rels);
    dst.setOverride(part, SLIDE_CT);

    const rid = `rId${nextRid++}`;
    presRels.push({ id: rid, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", target: "", external: false, abs: part });
    const sid = make(pres, NS.p, "sldId", { id: nextSldId });
    sid.setAttributeNS(NS.r, "r:id", rid);
    sldIdLst.appendChild(sid);
    const secName = d.name.replace(/\.pptx$/i, "");
    if (!sections.length || sections[sections.length - 1].name !== secName) sections.push({ name: secName, ids: [] });
    sections[sections.length - 1].ids.push(nextSldId);
    nextSldId++;
  }
  dst.setRels(presPart, presRels);

  // Разделы по исходным файлам
  if (opts.sections && sources.length > 1) {
    let extLst = kid(pres.documentElement, "extLst");
    if (!extLst) extLst = pres.documentElement.appendChild(make(pres, NS.p, "extLst")) as Element;
    const xml = `<p:ext xmlns:p="${NS.p}" uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${NS.p14}">${sections
      .map(
        (s, i) =>
          `<p14:section name="${s.name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}" id="{${uuid(i)}}"><p14:sldIdLst>${s.ids
            .map((id) => `<p14:sldId id="${id}"/>`)
            .join("")}</p14:sldIdLst></p14:section>`,
      )
      .join("")}</p14:sectionLst></p:ext>`;
    extLst.insertBefore(pres.importNode(parseXml(xml).documentElement, true), extLst.firstChild);
  }

  await dst.collectGarbage();
  onProgress(items.length, items.length);
  return dst.save();
}

const uuid = (i: number) => {
  const h = (n: number, len: number) => n.toString(16).toUpperCase().padStart(len, "0").slice(-len);
  return `${h(0x5ec7 + i, 8)}-${h(i, 4)}-4${h(i, 3)}-8${h(i, 3)}-${h(Date.now() + i, 12)}`;
};

/** Заметки докладчика: копия с привязкой к мастеру заметок шаблона. */
async function copyNotes(src: Pkg, dst: Pkg, part: string, slidePart: string, notesMaster: string): Promise<string> {
  const name = dst.freeName("ppt/notesSlides", "notesSlide", "xml");
  dst.setXml(name, parseXml(serializeXml(await src.xml(part))));
  dst.setOverride(name, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
  const rels: Rel[] = [];
  for (const r of await src.rels(part)) {
    if (relIs(r, RT.notesMaster)) rels.push({ ...r, abs: notesMaster });
    else if (relIs(r, RT.slide)) rels.push({ ...r, abs: slidePart });
  }
  dst.setRels(name, rels);
  return name;
}

export { analyzeTemplate };

/** Шаблон: профиль и картинки фонов (для превью). */
export async function inspectTemplate(data: ArrayBuffer | Uint8Array, name: string) {
  const pkg = await Pkg.load(data);
  const { profile } = await analyzeTemplate(pkg, name);
  const images: Record<string, { bytes: Uint8Array; type: string }> = {};
  for (const b of profile.backgrounds) {
    if (!b.image || !pkg.has(b.image)) continue;
    const ext = b.image.slice(b.image.lastIndexOf(".") + 1).toLowerCase();
    const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "";
    if (type) images[b.id] = { bytes: await pkg.bytes(b.image), type };
  }
  return { profile, images };
}
