// Выгрузка: картинка PNG/JPEG любого размера и видео MP4 (H.264).
//
// Видео кодируется покадрово через WebCodecs: каждый кадр рисуется заново
// для своего момента времени, поэтому ролик ровный и не зависит от скорости
// компьютера. Если браузер не умеет WebCodecs, ролик пишется в реальном
// времени через MediaRecorder (MP4, если поддерживается, иначе WebM).

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { renderFrame } from "./render";
import type { Scene, Template } from "./types";

type Images = (HTMLImageElement | ImageBitmap)[];

export const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export async function renderImage(
  scene: Scene,
  tpl: Template,
  images: Images,
  w: number,
  h: number,
  t: number,
  dur: number,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d")!;
  renderFrame(ctx, w, h, t, scene, tpl, images, dur, type === "image/jpeg" ? "#ffffff" : undefined);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Браузер не смог сохранить картинку"))), type, 0.93));
}

const CODECS = ["avc1.640034", "avc1.640033", "avc1.640028", "avc1.4d0034", "avc1.4d0028", "avc1.42003e", "avc1.42001f"];

async function pickCodec(w: number, h: number, fps: number, bitrate: number) {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate });
      if (r.supported) return codec;
    } catch {
      /* пробуем следующий профиль */
    }
  }
  return null;
}

export interface VideoOptions {
  w: number;
  h: number;
  fps: number;
  dur: number;
  /** Подложка вместо прозрачного фона — в видео прозрачности нет */
  fallbackBase: string;
  onProgress: (k: number) => void;
  signal: AbortSignal;
}

export async function renderVideo(scene: Scene, tpl: Template, images: Images, o: VideoOptions): Promise<{ blob: Blob; ext: string }> {
  const w = even(o.w);
  const h = even(o.h);
  const bitrate = Math.min(60e6, Math.round(w * h * o.fps * 0.14));
  const codec = await pickCodec(w, h, o.fps, bitrate);
  if (!codec) return recordRealtime(scene, tpl, images, { ...o, w, h });

  const c = canvasOf(w, h);
  const ctx = c.getContext("2d", { alpha: false })!;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: w, height: h, frameRate: o.fps }, fastStart: "in-memory" });
  let failure: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  enc.configure({ codec, width: w, height: h, bitrate, framerate: o.fps, latencyMode: "quality" });
  const frames = Math.max(1, Math.round(o.dur * o.fps));
  const usec = 1e6 / o.fps;
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal.aborted) throw new DOMException("Отменено", "AbortError");
      if (failure) throw failure;
      renderFrame(ctx, w, h, i / o.fps, scene, tpl, images, o.dur, o.fallbackBase);
      const frame = new VideoFrame(c, { timestamp: Math.round(i * usec), duration: Math.round(usec) });
      enc.encode(frame, { keyFrame: i % (o.fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 5 === 0) {
        o.onProgress(i / frames);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await enc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (enc.state !== "closed") enc.close();
  }
  o.onProgress(1);
  return { blob: new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" }), ext: "mp4" };
}

/** Запасной путь: запись холста в реальном времени */
async function recordRealtime(scene: Scene, tpl: Template, images: Images, o: VideoOptions): Promise<{ blob: Blob; ext: string }> {
  if (typeof MediaRecorder === "undefined") throw new Error("Браузер не умеет записывать видео. Обновите Chrome или Edge.");
  const c = canvasOf(o.w, o.h);
  const ctx = c.getContext("2d", { alpha: false })!;
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mime = types.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  renderFrame(ctx, o.w, o.h, 0, scene, tpl, images, o.dur, o.fallbackBase);
  const stream = c.captureStream(o.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.min(40e6, o.w * o.h * 6) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (o.signal.aborted) {
        rec.stop();
        reject(new DOMException("Отменено", "AbortError"));
        return;
      }
      const t = (performance.now() - start) / 1000;
      if (t >= o.dur) {
        rec.stop();
        resolve();
        return;
      }
      renderFrame(ctx, o.w, o.h, t, scene, tpl, images, o.dur, o.fallbackBase);
      o.onProgress(t / o.dur);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  const type = rec.mimeType || mime || "video/webm";
  return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function copyImage(blob: Blob) {
  const png = blob.type === "image/png" ? blob : blob;
  await navigator.clipboard.write([new ClipboardItem({ [png.type]: png })]);
}
