// Нейросеть удаления фона: загрузка (один раз за сеанс) и поиск объекта.
//
// Модель (silueta, U²-Net) работает в отдельном потоке (aiWorker.ts), чтобы
// интерфейс не замирал. На вход — картинка 320×320, на выходе — вероятность
// «это объект» для каждой точки; её доводит до полного размера refineMask.

import { createCanvas, ctx2d, ctxRead } from "./canvas";
import { loadAiFiles } from "./aiAssets";
import { refineMask, type BgOptions } from "./bgremove";
import type { AiRequest, AiResponse } from "./aiWorker";

const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (o: Float32Array) => void; reject: (e: Error) => void }>();

/** Нейросеть уже загружена (повторный запуск — без скачивания). */
export const aiLoaded = () => worker !== null;

/** Загружает файлы нейросети и запускает поток. Прогресс — в байтах. */
export function ensureAi(onProgress: (loaded: number, total: number) => void): Promise<Worker> {
  if (ready) return ready;
  ready = (async () => {
    const { model, wasm } = await loadAiFiles(onProgress);
    const w = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
    await new Promise<void>((resolve, reject) => {
      w.onerror = (e) => reject(new Error(`Не удалось запустить нейросеть: ${e.message || "ошибка потока"}`));
      w.onmessage = (e: MessageEvent<AiResponse>) => {
        if (e.data.type === "ready") resolve();
        else if (e.data.type === "error") reject(new Error(`Не удалось запустить нейросеть: ${e.data.message}`));
      };
      w.postMessage({ type: "init", model, wasm } satisfies AiRequest, [model, wasm]);
    });
    w.onerror = null;
    w.onmessage = (e: MessageEvent<AiResponse>) => {
      const m = e.data;
      if (m.type === "ready" || m.id === undefined) return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "result") p.resolve(m.output);
      else p.reject(new Error(m.message));
    };
    worker = w;
    return w;
  })();
  ready.catch(() => {
    ready = null; // следующая попытка — заново
  });
  return ready;
}

function preprocess(src: HTMLCanvasElement): Float32Array {
  const c = createCanvas(SIZE, SIZE);
  const ctx = ctx2d(c);
  // Прозрачные места — на белом, как их видит человек
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, SIZE, SIZE);
  const px = ctxRead(c).getImageData(0, 0, SIZE, SIZE).data;
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const n = SIZE * SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let ch = 0; ch < 3; ch++) out[ch * n + i] = (px[i * 4 + ch] / max - MEAN[ch]) / STD[ch];
  return out;
}

// Ответ сети по слою запоминаем: смена «смягчения» не требует пересчёта
const probCache = new WeakMap<HTMLCanvasElement, Float32Array>();

async function predict(src: HTMLCanvasElement): Promise<Float32Array> {
  const hit = probCache.get(src);
  if (hit) return hit;
  const w = await ready;
  if (!w) throw new Error("Нейросеть не загружена");
  const id = nextId++;
  const input = preprocess(src);
  const raw = await new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "run", id, input, size: SIZE } satisfies AiRequest, [input.buffer]);
  });
  const prob = raw.subarray(0, SIZE * SIZE);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of prob) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const norm = new Float32Array(prob.length);
  for (let i = 0; i < prob.length; i++) norm[i] = (prob[i] - lo) / span;
  probCache.set(src, norm);
  return norm;
}

/** Маска объекта (альфа) размером с картинку. Перед вызовом — ensureAi. */
export async function aiMask(src: HTMLCanvasElement, o: BgOptions): Promise<HTMLCanvasElement> {
  const prob = await predict(src);
  return refineMask(src, prob, SIZE, SIZE, o);
}
