import { toPng, toSvg } from "html-to-image";
import { saveAs } from "file-saver";
import type { ChartConfig, ParsedData } from "../types";

export async function exportToPng(
  el: HTMLElement,
  name: string,
): Promise<void> {
  const url = await toPng(el, {
    quality: 1,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
  });
  saveAs(url, `${name}.png`);
}

export async function exportToSvg(
  el: HTMLElement,
  name: string,
): Promise<void> {
  const url = await toSvg(el, { backgroundColor: "#ffffff" });
  const res = await fetch(url);
  saveAs(await res.blob(), `${name}.svg`);
}

export function exportToHtml(
  config: ChartConfig,
  data: ParsedData,
  name: string,
): void {
  const cd = data.rows.map((r) => {
    const o: any = { name: r[config.xColumn] };
    config.yColumns.forEach((c) => {
      o[c] = typeof r[c] === "number" ? r[c] : Number(r[c]) || 0;
    });
    return o;
  });

  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>${config.title || "Chart"}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:${config.backgroundColor};padding:20px}.c{width:100%;max-width:900px;background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)}h1{text-align:center;margin-bottom:8px;color:#2c3e50}h2{text-align:center;margin-bottom:20px;color:#7f8c8d;font-weight:400;font-size:14px}</style>
</head><body><div class="c">${config.title ? `<h1>${config.title}</h1>` : ""}${config.subtitle ? `<h2>${config.subtitle}</h2>` : ""}<canvas id="ch"></canvas></div>
<script>
const m={bar:'bar',line:'line',area:'line',pie:'pie',radar:'radar',scatter:'scatter',composed:'bar'};
new Chart(document.getElementById('ch'),{type:m['${config.chartType}'],data:{labels:${JSON.stringify(cd.map((d) => d.name))},datasets:${JSON.stringify(config.yColumns.map((c, i) => ({ label: c, data: cd.map((d) => d[c]), backgroundColor: config.chartType === "pie" ? config.colors.slice(0, cd.length) : config.colors[i % config.colors.length] + "CC", borderColor: config.colors[i % config.colors.length], borderWidth: config.strokeWidth, fill: config.chartType === "area", tension: 0.4 })))}},options:{responsive:true,plugins:{legend:{display:${config.showLegend},position:'${config.legendPosition}'},tooltip:{enabled:${config.showTooltip},callbacks:{label:function(c){return c.dataset.label+': '+c.parsed.y.toLocaleString('ru-RU')}}}},scales:${config.chartType !== "pie" && config.chartType !== "radar" ? `{x:{grid:{display:${config.showGrid}}},y:{grid:{display:${config.showGrid}},ticks:{callback:function(v){return v.toLocaleString('ru-RU')}}}}` : "{}"}}});
<\/script></body></html>`;
  saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${name}.html`);
}

export async function exportCanvasToPng(
  el: HTMLElement,
  name: string,
  bg: string = "#f5f6fa",
): Promise<void> {
  const url = await toPng(el, {
    quality: 1,
    pixelRatio: 2,
    backgroundColor: bg,
  });
  saveAs(url, `${name}.png`);
}

export async function exportCanvasToSvg(
  el: HTMLElement,
  name: string,
  bg: string = "#f5f6fa",
): Promise<void> {
  const url = await toSvg(el, { backgroundColor: bg });
  const res = await fetch(url);
  saveAs(await res.blob(), `${name}.svg`);
}
