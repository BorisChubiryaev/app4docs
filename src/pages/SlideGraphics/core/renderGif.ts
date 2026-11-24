import { baseColor, renderFrame } from "./render";
import type { GraphicEdit } from "./presentation";
import type { Template } from "./types";
import type { GifFrame } from "./gif.worker";

/** Render in slide coordinates. The worker quantizes and compresses one frame at a time. */
export function renderGif(edit: GraphicEdit, tpl: Template, signal: AbortSignal, progress: (value: number) => void) {
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  const transparent = baseColor(edit.scene, tpl) === null;
  const dense = tpl.loop || !transparent || edit.images.length > 0;
  const frames = Math.max(2, Math.round(edit.duration * (dense ? 12.5 : 20)));
  const centiseconds = Math.round(edit.duration * 100);
  // Bound raster work and output size for photographic loops and browsers without an H.264 encoder.
  const budgetScale = dense ? Math.sqrt(12_000_000 / (frames * edit.box.w * edit.box.h)) : 1.5;
  const scale = Math.min(budgetScale, 1.5, 1024 / Math.max(edit.box.w, edit.box.h));
  canvas.width = Math.max(1, Math.round(edit.box.w * scale));
  canvas.height = Math.max(1, Math.round(edit.box.h * scale));
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const worker = new Worker(new URL("./gif.worker.ts", import.meta.url), { type: "module" });
  const lifetime = new AbortController();
  const encoded = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { signal: lifetime.signal, once: true });
    let i = 0;
    function next() {
      try {
        signal.throwIfAborted();
        const last = i === frames - 1;
        const t = last && !tpl.loop ? edit.duration : i * edit.duration / frames;
        renderFrame(ctx, width, height, t, edit.scene, tpl, edit.images, edit.duration);
        const pixels = ctx.getImageData(0, 0, width, height);
        const delay = 10 * (Math.round((i + 1) * centiseconds / frames) - Math.round(i * centiseconds / frames));
        const frame: GifFrame = { pixels, delay, loop: tpl.loop, transparent, last };
        worker.postMessage(frame, [pixels.data.buffer]);
        i++;
      } catch (err) { reject(err); }
    }
    worker.onerror = e => reject(new Error(e.message || "Не удалось создать анимацию."));
    worker.onmessageerror = () => reject(new Error("Не удалось прочитать кадр анимации."));
    worker.onmessage = ({ data }: MessageEvent<Uint8Array<ArrayBuffer> | null>) => {
      progress(i / frames);
      if (data) resolve(data); else next();
    };
    next();
  });
  return encoded.finally(() => { lifetime.abort(); worker.terminate(); });
}
