// Пакет OOXML (pptx): части, связи (.rels), типы содержимого.
import JSZip from "jszip";
import { NS, kids, parseXml, serializeXml } from "./xml";

export interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
  /** Абсолютный путь части внутри пакета (для внутренних связей). */
  abs: string;
}

export const RT = {
  slide: "/slide",
  slideLayout: "/slideLayout",
  slideMaster: "/slideMaster",
  theme: "/theme",
  notesSlide: "/notesSlide",
  notesMaster: "/notesMaster",
  image: "/image",
  chart: "/chart",
  comments: "/comments",
  commentAuthors: "/commentAuthors",
  hyperlink: "/hyperlink",
};

export const relIs = (r: Rel, kind: string) => r.type.endsWith(kind);

export function dirOf(part: string) {
  const i = part.lastIndexOf("/");
  return i < 0 ? "" : part.slice(0, i);
}

export function baseOf(part: string) {
  return part.slice(part.lastIndexOf("/") + 1);
}

/** Путь цели связи относительно части-источника. */
export function resolvePath(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(fromPart) ? dirOf(fromPart).split("/") : []).concat(target.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

/** Относительный путь от части-источника к цели. */
export function relativePath(fromPart: string, toPart: string): string {
  const a = dirOf(fromPart) ? dirOf(fromPart).split("/") : [];
  const b = toPart.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

export const relsPathOf = (part: string) => `${dirOf(part) ? dirOf(part) + "/" : ""}_rels/${baseOf(part)}.rels`;

export class Pkg {
  private zip: JSZip;
  private docs = new Map<string, Document>();
  private bin = new Map<string, Uint8Array>();
  private removed = new Set<string>();
  private ct!: Document;

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async load(data: ArrayBuffer | Uint8Array): Promise<Pkg> {
    const zip = await JSZip.loadAsync(data);
    const p = new Pkg(zip);
    p.ct = parseXml(await zip.file("[Content_Types].xml")!.async("string"));
    return p;
  }

  /** Все части пакета (без удалённых). */
  parts(): string[] {
    const set = new Set<string>();
    this.zip.forEach((path, f) => {
      if (!f.dir) set.add(path);
    });
    for (const k of this.docs.keys()) set.add(k);
    for (const k of this.bin.keys()) set.add(k);
    for (const r of this.removed) set.delete(r);
    set.delete("[Content_Types].xml");
    return [...set].sort();
  }

  has(part: string) {
    if (this.removed.has(part)) return false;
    return this.docs.has(part) || this.bin.has(part) || !!this.zip.file(part);
  }

  async xml(part: string): Promise<Document> {
    const hit = this.docs.get(part);
    if (hit) return hit;
    if (this.removed.has(part)) throw new Error(`Нет части ${part}`);
    const f = this.zip.file(part);
    if (!f) throw new Error(`Нет части ${part}`);
    const doc = parseXml(await f.async("string"));
    this.docs.set(part, doc);
    return doc;
  }

  setXml(part: string, doc: Document) {
    this.removed.delete(part);
    this.bin.delete(part);
    this.docs.set(part, doc);
  }

  async bytes(part: string): Promise<Uint8Array> {
    const d = this.docs.get(part);
    if (d) return new TextEncoder().encode(serializeXml(d));
    const b = this.bin.get(part);
    if (b) return b;
    const f = this.zip.file(part);
    if (!f || this.removed.has(part)) throw new Error(`Нет части ${part}`);
    return f.async("uint8array");
  }

  setBytes(part: string, data: Uint8Array) {
    this.removed.delete(part);
    this.docs.delete(part);
    this.bin.set(part, data);
  }

  remove(part: string) {
    this.docs.delete(part);
    this.bin.delete(part);
    this.removed.add(part);
    this.removeOverride(part);
  }

  // ── Связи ──
  async rels(part: string): Promise<Rel[]> {
    const rp = relsPathOf(part);
    if (!this.has(rp)) return [];
    const doc = await this.xml(rp);
    return kids(doc.documentElement, "Relationship").map((r) => {
      const target = r.getAttribute("Target") || "";
      const external = r.getAttribute("TargetMode") === "External";
      return {
        id: r.getAttribute("Id") || "",
        type: r.getAttribute("Type") || "",
        target,
        external,
        abs: external ? target : resolvePath(part, target),
      };
    });
  }

  setRels(part: string, rels: Rel[]) {
    const doc = parseXml(`<Relationships xmlns="${NS.rel}"/>`);
    for (const r of rels) {
      const el = doc.createElementNS(NS.rel, "Relationship");
      el.setAttribute("Id", r.id);
      el.setAttribute("Type", r.type);
      el.setAttribute("Target", r.external ? r.target : relativePath(part, r.abs));
      if (r.external) el.setAttribute("TargetMode", "External");
      doc.documentElement.appendChild(el);
    }
    this.setXml(relsPathOf(part), doc);
  }

  // ── Типы содержимого ──
  contentType(part: string): string | undefined {
    const root = this.ct.documentElement;
    for (const o of kids(root, "Override")) if (o.getAttribute("PartName") === `/${part}`) return o.getAttribute("ContentType") || undefined;
    const ext = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
    for (const d of kids(root, "Default")) if ((d.getAttribute("Extension") || "").toLowerCase() === ext) return d.getAttribute("ContentType") || undefined;
    return undefined;
  }

  hasDefault(ext: string) {
    return kids(this.ct.documentElement, "Default").some((d) => (d.getAttribute("Extension") || "").toLowerCase() === ext.toLowerCase());
  }

  setOverride(part: string, type: string) {
    this.removeOverride(part);
    const o = this.ct.createElementNS(NS.ct, "Override");
    o.setAttribute("PartName", `/${part}`);
    o.setAttribute("ContentType", type);
    this.ct.documentElement.appendChild(o);
  }

  addDefault(ext: string, type: string) {
    if (this.hasDefault(ext)) return;
    const d = this.ct.createElementNS(NS.ct, "Default");
    d.setAttribute("Extension", ext);
    d.setAttribute("ContentType", type);
    const first = kids(this.ct.documentElement)[0];
    this.ct.documentElement.insertBefore(d, first ?? null);
  }

  private removeOverride(part: string) {
    for (const o of kids(this.ct.documentElement, "Override")) if (o.getAttribute("PartName") === `/${part}`) o.parentNode?.removeChild(o);
  }

  /** Свободное имя части по образцу: ppt/slides/slide{n}.xml */
  freeName(dir: string, stem: string, ext: string): string {
    const taken = new Set(this.parts().map((p) => p.toLowerCase()));
    for (let i = 1; ; i++) {
      const name = `${dir}/${stem}${i}.${ext}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }

  /** Удалить части, до которых нельзя дойти по связям от корня пакета. */
  async collectGarbage() {
    const seen = new Set<string>();
    const visit = async (part: string) => {
      for (const r of await this.rels(part)) {
        if (r.external || seen.has(r.abs)) continue;
        if (!this.has(r.abs)) continue;
        seen.add(r.abs);
        await visit(r.abs);
      }
    };
    // Корневые связи пакета лежат в _rels/.rels
    const rootRels = this.has("_rels/.rels") ? kids((await this.xml("_rels/.rels")).documentElement, "Relationship") : [];
    for (const r of rootRels) {
      if (r.getAttribute("TargetMode") === "External") continue;
      const abs = resolvePath("x", r.getAttribute("Target") || "");
      seen.add(abs);
      await visit(abs);
    }
    for (const part of this.parts()) {
      if (part.endsWith(".rels")) continue;
      if (!seen.has(part)) {
        this.remove(part);
        const rp = relsPathOf(part);
        if (this.has(rp)) this.remove(rp);
      }
    }
  }

  async save(): Promise<Uint8Array> {
    const out = new JSZip();
    out.file("[Content_Types].xml", serializeXml(this.ct));
    for (const part of this.parts()) {
      const d = this.docs.get(part);
      if (d) out.file(part, serializeXml(d));
      else out.file(part, await this.bytes(part));
    }
    return out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }
}
