// Экспорт графиков и холста: PNG, SVG, копирование в буфер, HTML-отчёт.
// Всё работает без интернета — HTML не тянет библиотек с CDN
// (приложение живёт в закрытой сети Qlik).

import { toBlob, toPng, toSvg } from "html-to-image";
import { saveAs } from "file-saver";
import type { ChartConfig, ColumnInfo, ParsedData } from "../types";
import { buildChartData } from "./chartData";
import { formatValue } from "./formatUtils";

/** В снимок не попадают: ползунок прокрутки, всплывающая подсказка, кнопки карточек. */
const exportFilter = (node: HTMLElement | Node): boolean => {
  const cl = (node as Element).classList;
  if (!cl) return true;
  return !(
    cl.contains("recharts-brush") ||
    cl.contains("recharts-tooltip-wrapper") ||
    cl.contains("cc-no-export")
  );
};

export const safeFileName = (name: string) =>
  (name || "chart").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) ||
  "chart";

const baseOpts = (bg: string) => ({ backgroundColor: bg, filter: exportFilter, pixelRatio: 2 });

export async function exportNodePng(el: HTMLElement, name: string, bg: string) {
  saveAs(await toPng(el, baseOpts(bg)), `${safeFileName(name)}.png`);
}

export async function exportNodeSvg(el: HTMLElement, name: string, bg: string) {
  const url = await toSvg(el, baseOpts(bg));
  saveAs(await (await fetch(url)).blob(), `${safeFileName(name)}.svg`);
}

/**
 * Картинка в буфер обмена — вставляется сразу в PowerPoint/Word/Outlook.
 * Работает только по https (так устроен браузер); иначе — понятная ошибка.
 */
export async function copyNodePng(el: HTMLElement, bg: string): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined")
    throw new Error("Браузер не разрешает копировать картинки на этой странице — скачайте PNG.");
  // Promise в ClipboardItem — чтобы Safari не терял «жест пользователя» во время отрисовки.
  const blob = toBlob(el, baseOpts(bg)).then((b) => {
    if (!b) throw new Error("Не удалось нарисовать картинку.");
    return b;
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Холст: на экране он уменьшен (масштаб), в файл — в полном размере. */
const canvasOpts = (el: HTMLElement, bg: string) => ({
  ...baseOpts(bg),
  width: el.offsetWidth,
  height: el.offsetHeight,
  style: { transform: "none" },
});

export async function exportCanvasPng(el: HTMLElement, name: string, bg: string) {
  saveAs(await toPng(el, canvasOpts(el, bg)), `${safeFileName(name)}.png`);
}

export async function exportCanvasSvg(el: HTMLElement, name: string, bg: string) {
  const url = await toSvg(el, canvasOpts(el, bg));
  saveAs(await (await fetch(url)).blob(), `${safeFileName(name)}.svg`);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * HTML-отчёт: векторный снимок графика + таблица данных. Один файл,
 * открывается в любом браузере без интернета, таблицу можно скопировать.
 */
export async function exportChartHtml(
  el: HTMLElement,
  config: ChartConfig,
  data: ParsedData,
  columns: ColumnInfo[],
  bg: string,
) {
  const svg = await toSvg(el, baseOpts(bg));
  const cd = buildChartData(data, config, columns);
  const nfmt = { unit: "none" as const, decimals: config.decimals, prefix: config.prefix, suffix: config.suffix };

  let table = "";
  if (cd.kind === "category") {
    const head = [config.xColumn, ...cd.series.map((s) => s.name)];
    const body = cd.points
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}</td>${cd.series
            .map((s) => `<td class="n">${esc(formatValue(p[s.key], nfmt, false))}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    table = `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  } else if (cd.kind === "scatter") {
    const body = cd.series
      .flatMap((s) =>
        s.points.map(
          (p) =>
            `<tr><td>${esc(s.name)}</td><td class="n">${esc(formatValue(p.x, nfmt, false))}</td><td class="n">${esc(formatValue(p.y, nfmt, false))}</td></tr>`,
        ),
      )
      .join("");
    table = `<table><thead><tr><th>Ряд</th><th class="n">${esc(config.xColumn)}</th><th class="n">Значение</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  const title = config.title || "График";
  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;padding:24px;background:#f4f5f7;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0b0b0b}
main{max-width:1000px;margin:0 auto}
.chart{background:${esc(bg)};border-radius:12px;padding:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.chart img{width:100%;height:auto;display:block}
details{margin-top:16px;background:#fff;border-radius:12px;padding:12px 16px}
summary{cursor:pointer;font-weight:600}
table{border-collapse:collapse;width:100%;margin-top:10px}
th,td{padding:6px 10px;border-bottom:1px solid #e1e0d9;text-align:left}
th{color:#52514e;font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}
footer{margin-top:12px;color:#898781;font-size:12px}
</style></head><body><main>
<div class="chart"><img src="${svg}" alt="${esc(title)}"></div>
${table ? `<details open><summary>Данные графика</summary>${table}</details>` : ""}
<footer>Источник: ${esc(data.fileName)}${data.sheetName && data.sheetName !== "CSV" ? `, лист «${esc(data.sheetName)}»` : ""} · Convertix</footer>
</main></body></html>`;
  saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${safeFileName(title)}.html`);
}
