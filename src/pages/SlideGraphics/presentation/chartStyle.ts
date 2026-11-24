import { NS, desc, insertOrdered, kid, kids, make, num } from "../../PptxRestyle/engine/xml";

export const chartPalettes = [
  { name: "Ирис", colors: ["#7560b7", "#ad97da", "#54447d", "#d2c1ec"] },
  { name: "Море", colors: ["#147782", "#74b7af", "#376a9c", "#a1ced6"] },
  { name: "Терракота", colors: ["#b85842", "#da9d55", "#934866", "#e3bd95"] },
];

function paint(parent: Element, color: string, line: boolean) {
  const doc = parent.ownerDocument;
  let spPr = kid(parent, "spPr");
  if (!spPr) {
    spPr = make(doc, NS.c, "spPr");
    const preceding = parent.localName === "ser" ? ["idx", "order", "tx"] : ["idx", "invertIfNegative", "marker", "bubble3D", "explosion"];
    const before = kids(parent).find(child => !preceding.includes(child.localName));
    parent.insertBefore(spPr, before ?? null);
  }
  const container = line ? kid(spPr, "ln") ?? insertOrdered(spPr, make(doc, NS.a, "ln"), ["effectLst", "effectDag", "sp3d", "extLst"]) : spPr;
  for (const child of kids(container)) if (["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"].includes(child.localName)) child.remove();
  const fill = make(doc, NS.a, "solidFill");
  fill.append(make(doc, NS.a, "srgbClr", { val: color.slice(1).toUpperCase() }));
  insertOrdered(container, fill, ["ln", "prstDash", "custDash", "round", "bevel", "miter", "headEnd", "tailEnd", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"]);
}

/** Recolour the chart's own series, retaining cached values, formulas and embedded workbook. */
export function colorChart(doc: Document, colors: string[]) {
  for (const [i, ser] of desc(doc, "ser", NS.c).entries()) {
    const type = ser.parentElement?.localName ?? "";
    const line = ["lineChart", "line3DChart", "radarChart", "scatterChart", "stockChart"].includes(type);
    paint(ser, colors[i % colors.length], line);
    const perPoint = /pie|doughnut/i.test(type);
    const points = new Map(kids(ser, "dPt").map(pt => [num(kid(pt, "idx"), "val"), pt]));
    if (perPoint) {
      for (const value of desc(kid(ser, "val"), "pt", NS.c)) {
        const idx = num(value, "idx");
        if (idx === undefined || points.has(idx)) continue;
        const point = make(doc, NS.c, "dPt");
        point.append(make(doc, NS.c, "idx", { val: idx }));
        insertOrdered(ser, point, ["dLbls", "cat", "val", "extLst"]);
        points.set(idx, point);
      }
    }
    for (const [idx, pt] of points) paint(pt, colors[(perPoint ? idx ?? i : i) % colors.length], line);
  }
}
