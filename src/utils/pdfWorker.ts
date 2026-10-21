// Поток pdf.js — один на всё приложение, с полифиллами.
//
// pdfjs-dist 5.x внутри своего потока вызывает новые функции языка
// (Math.sumPrecise — при разборе встроенных шрифтов, Map.getOrInsertComputed).
// Полифиллы приложения (utils/mapPolyfill) в поток не попадают, а без них
// шрифты PDF не загружаются: текст рисуется запасным шрифтом, ширины плывут.
// Поэтому полифиллы дописываются в начало кода потока.

import pdfWorkerContent from "pdfjs-dist/build/pdf.worker.mjs?raw";

const POLYFILLS = `
if (typeof Math.sumPrecise !== "function") {
  Math.sumPrecise = function (values) {
    let sum = 0, c = 0;
    for (const v of values) { const y = v - c; const t = sum + y; c = (t - sum) - y; sum = t; }
    return sum;
  };
}
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", { configurable: true, writable: true, value: function (k, f) { if (this.has(k)) return this.get(k); const v = f(k); this.set(k, v); return v; } });
}
if (typeof Map.prototype.getOrInsert !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsert", { configurable: true, writable: true, value: function (k, d) { if (!this.has(k)) this.set(k, d); return this.get(k); } });
}
if (typeof WeakMap !== "undefined" && typeof WeakMap.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(WeakMap.prototype, "getOrInsertComputed", { configurable: true, writable: true, value: function (k, f) { if (this.has(k)) return this.get(k); const v = f(k); this.set(k, v); return v; } });
}
`;

let url: string | null = null;

/** Адрес кода потока pdf.js (blob, создаётся один раз). */
export function pdfWorkerUrl(): string {
  url ??= URL.createObjectURL(new Blob([POLYFILLS, pdfWorkerContent], { type: "text/javascript" }));
  return url;
}
