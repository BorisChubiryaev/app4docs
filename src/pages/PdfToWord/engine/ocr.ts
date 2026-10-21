// Распознавание текста на сканах (Tesseract, русский + английский).
//
// Всё работает без интернета: поток, ядро и модели языков лежат в public/ocr
// (scripts/vendor-ocr.mjs). Поток и ядро tesseract.js подключает сам по
// адресу (без blob-ссылок — их может запрещать политика безопасности
// портала), модели языков передаём ему готовыми байтами.
//
// Результат — слова с рамками; из них делаются те же фрагменты текста, что и
// у «настоящего» PDF, и дальше страница раскладывается обычным движком:
// абзацы, отступы, выравнивание, таблицы без рамок.

import { createWorker, OEM, PSM, type Worker as TWorker } from "tesseract.js";
import { openChunkedAssets } from "../../../utils/chunkedAssets";
import type { Item, Seg } from "./types";

let ready: Promise<TWorker> | null = null;

const withTimeout = <T>(p: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

export interface OcrProgress {
  (stage: string, fraction: number): void;
}

/** Загрузить движок (один раз за сеанс). */
export function ensureOcr(onProgress: OcrProgress): Promise<TWorker> {
  if (ready) return ready;
  ready = (async () => {
    let got = 0;
    const assets = await openChunkedAssets("ocr/", "ocr-", (n) => {
      got += n;
      onProgress(`Загружаем распознавание текста: ${Math.round(got / 1048576)} из ${Math.round(total / 1048576)} МБ (только в первый раз)`, total ? got / total : 0);
    });
    const total = assets.total(["worker", "core", "rus", "eng"]);
    const workerPath = await assets.script("worker");
    const corePath = await assets.script("core");
    const rus = await assets.file("rus");
    const eng = await assets.file("eng");
    onProgress("Запускаем распознавание…", 1);
    let failInit: (e: Error) => void = () => undefined;
    const failed = new Promise<never>((_, reject) => (failInit = reject));
    const w = await withTimeout(
      Promise.race([
        failed,
        createWorker(
      [
        { code: "rus", data: rus },
        { code: "eng", data: eng },
      ] as unknown as string[],
      OEM.LSTM_ONLY,
      {
        workerPath,
        corePath,
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true,
        legacyCore: false,
        legacyLang: false,
        errorHandler: (e: unknown) => failInit(new Error(`ошибка движка распознавания: ${String(e)}`)),
      },
        ),
      ]),
      120000,
      "движок распознавания не запустился за 2 минуты",
    );
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
    return w;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TWord {
  text: string;
  confidence: number;
  bbox: TBox;
}
interface TLine {
  words: TWord[];
  bbox: TBox;
  baseline: TBox;
  rowAttributes?: { rowHeight?: number; ascenders?: number; descenders?: number };
}

export interface OcrPage {
  items: Item[];
  /** Страница, выровненная по наклону, — в тех же координатах, что и слова. */
  canvas: HTMLCanvasElement;
  scale: number;
  hSegs: Seg[];
  vSegs: Seg[];
}

async function loadCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0);
  return c;
}

/**
 * Линии на растре (границы таблиц, подчёркивания): длинные непрерывные
 * тёмные отрезки по строкам и столбцам пикселей. Буквы дают только короткие
 * отрезки, поэтому в линии не попадают.
 */
export function rasterLines(canvas: HTMLCanvasElement, scale: number, pageH: number): { hSegs: Seg[]; vSegs: Seg[] } {
  const W = canvas.width;
  const H = canvas.height;
  const px = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const dark = new Uint8Array(W * H);
  for (let i = 0, k = 0; i < px.length; i += 4, k++) dark[k] = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 150 ? 1 : 0;
  const minLen = Math.round(36 * scale); // пт
  const maxGap = Math.max(2, Math.round(scale)); // разрывы линии на скане
  const runs = (horizontal: boolean) => {
    const out: { pos: number; a: number; b: number }[] = [];
    const n1 = horizontal ? H : W;
    const n2 = horizontal ? W : H;
    for (let i = 0; i < n1; i++) {
      let start = -1;
      let gap = 0;
      for (let j = 0; j <= n2; j++) {
        const on = j < n2 && (horizontal ? dark[i * W + j] : dark[j * W + i]);
        if (on) {
          if (start < 0) start = j;
          gap = 0;
        } else if (start >= 0) {
          gap++;
          if (gap > maxGap || j === n2) {
            const end = j - gap;
            if (end - start >= minLen) out.push({ pos: i, a: start, b: end });
            start = -1;
            gap = 0;
          }
        }
      }
    }
    return out;
  };
  // Соседние строки пикселей одной линии → одна линия с толщиной
  const merge = (rs: { pos: number; a: number; b: number }[]) => {
    rs.sort((x, y) => x.a - y.a || x.pos - y.pos);
    const lines: { p0: number; p1: number; a: number; b: number }[] = [];
    for (const r of rs) {
      const l = lines.find((q) => r.pos - q.p1 <= 1 && r.pos >= q.p0 && Math.min(q.b, r.b) - Math.max(q.a, r.a) > (r.b - r.a) * 0.5);
      if (l) {
        l.p1 = Math.max(l.p1, r.pos);
        l.a = Math.min(l.a, r.a);
        l.b = Math.max(l.b, r.b);
      } else lines.push({ p0: r.pos, p1: r.pos, a: r.a, b: r.b });
    }
    return lines.filter((l) => (l.p1 - l.p0 + 1) / scale <= 4); // толще — заливка, не линия
  };
  const hSegs: Seg[] = merge(runs(true)).map((l) => ({
    pos: pageH - (l.p0 + l.p1) / 2 / scale,
    a: l.a / scale,
    b: l.b / scale,
    width: Math.max(0.5, (l.p1 - l.p0 + 1) / scale),
    color: "000000",
  }));
  const vSegs: Seg[] = merge(runs(false)).map((l) => ({
    pos: (l.p0 + l.p1) / 2 / scale,
    a: pageH - l.b / scale,
    b: pageH - l.a / scale,
    width: Math.max(0.5, (l.p1 - l.p0 + 1) / scale),
    color: "000000",
  }));
  return { hSegs, vSegs };
}

// Маркер списка, прочитанный как буква/знак: «®», «e», «°», «o»…
const BULLET_LIKE = /^[®©°•·*eoо◦●○▪■□➢➤»]$/u;

/**
 * Распознать отрисованную страницу. `scale` — пикселей на пункт PDF,
 * `pageH` — высота страницы в пунктах (Y в PDF растёт вверх).
 */
export async function recognizePage(
  canvas: HTMLCanvasElement,
  scale: number,
  pageH: number,
  onProgress: OcrProgress,
  // false — не выравнивать наклон: координаты слов совпадут с исходной
  // страницей (нужно для невидимого текстового слоя поверх скана)
  straighten = true,
): Promise<OcrPage> {
  const w = await ensureOcr(onProgress);
  onProgress("Распознаём текст…", 0);
  // Разрешение известно — Tesseract не гадает (и не пишет об этом в консоль)
  await w.setParameters({ user_defined_dpi: String(Math.round(scale * 72)) });
  const { data } = await withTimeout(
    w.recognize(canvas, { rotateAuto: straighten }, { blocks: true, text: false, imageColor: straighten }),
    300000,
    "распознавание страницы заняло больше 5 минут",
  );
  // Координаты слов — в выровненном изображении; его и берём дальше
  const straight = data.imageColor ? await loadCanvas(data.imageColor as unknown as string) : canvas;
  const k = straight.width / canvas.width || 1;
  scale *= k;
  let blocks = data.blocks ?? [];

  // Линии таблиц и подчёркивания мешают распознаванию (буквы у линии не
  // читаются, сетка превращается в «мусор»): стираем их и читаем ещё раз
  const found = rasterLines(straight, scale, pageH);
  let clean = straight;
  if (found.hSegs.length + found.vSegs.length) {
    clean = document.createElement("canvas");
    clean.width = straight.width;
    clean.height = straight.height;
    const cx = clean.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(straight, 0, 0);
    cx.fillStyle = "#ffffff";
    const pad = Math.max(1, Math.round(scale * 0.4));
    for (const sg of found.hSegs) {
      const y = (pageH - sg.pos) * scale;
      const t = sg.width * scale;
      cx.fillRect(sg.a * scale - pad, y - t / 2 - pad, (sg.b - sg.a) * scale + pad * 2, t + pad * 2);
    }
    for (const sg of found.vSegs) {
      const x = sg.pos * scale;
      const t = sg.width * scale;
      cx.fillRect(x - t / 2 - pad, (pageH - sg.b) * scale - pad, t + pad * 2, (sg.b - sg.a) * scale + pad * 2);
    }
    onProgress("Распознаём текст без линий таблиц…", 0.5);
    const again = await withTimeout(w.recognize(clean, {}, { blocks: true, text: false }), 300000, "распознавание страницы заняло больше 5 минут");
    blocks = again.data.blocks ?? blocks;
  }
  const lines: TLine[] = [];
  for (const b of blocks) for (const p of b.paragraphs) for (const l of p.lines) lines.push(l as unknown as TLine);

  // Жирность — по толщине штриха (средняя длина тёмных отрезков по
  // горизонтали): от формы букв она почти не зависит, в отличие от «плотности»
  const ink = clean.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, clean.width, clean.height).data;
  const stroke = (b: TBox) => {
    let sum = 0;
    let runs = 0;
    const maxRun = (b.y1 - b.y0) * 0.35;
    for (let y = Math.max(0, b.y0); y < Math.min(clean.height, b.y1); y += 2) {
      let run = 0;
      for (let x = Math.max(0, b.x0); x <= Math.min(clean.width, b.x1); x++) {
        const o = (y * clean.width + x) * 4;
        const dark = x < b.x1 && ink[o] * 0.3 + ink[o + 1] * 0.59 + ink[o + 2] * 0.11 < 128;
        if (dark) run++;
        else if (run) {
          if (run <= maxRun) {
            sum += run;
            runs++;
          }
          run = 0;
        }
      }
    }
    return runs ? sum / runs : 0;
  };

  const items: Item[] = [];
  // Кегль по высоте строки (от верха прописных до низа выносных) ≈ 0.9 кегля
  const sizeOf = (l: TLine) => {
    const h = l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0;
    return h / scale / 1.0;
  };
  const sizes = lines.map(sizeOf);
  // Сводим близкие кегли к общим значениям: распознанная высота «дрожит»
  const sorted = [...sizes].sort((a, b) => a - b);
  const snap = (s: number) => {
    const near = sorted.filter((v) => Math.abs(v - s) < Math.max(0.8, s * 0.08));
    const m = near[Math.floor(near.length / 2)] ?? s;
    return Math.max(5, Math.round(m * 2) / 2);
  };
  // Толщина штриха растёт с кеглем — сравниваем относительно высоты строки
  const dens = lines.map((l) => l.words.map((wd) => stroke(wd.bbox) / Math.max(1, l.bbox.y1 - l.bbox.y0)));
  const bodyDensity = [...dens.flat()].sort((a, b) => a - b)[Math.floor(dens.flat().length / 2)] || 0.05;
  lines.forEach((l, li) => {
    const size = snap(sizes[li]);
    const bl = l.baseline;
    l.words.forEach((wd, wi) => {
      let text = wd.text.trim();
      if (!text || wd.confidence < 25) return;
      // Обрывки линий таблиц, прочитанные как символы
      if (/^[|_—–\-=~/[\]()]+$/.test(text) && wd.confidence < 70) return;
      // Маркер списка: одиночный знак в начале строки, отбитый от текста
      const next = l.words[wi + 1];
      if (wi === 0 && next && BULLET_LIKE.test(text) && next.bbox.x0 - wd.bbox.x1 > (l.bbox.y1 - l.bbox.y0) * 0.4) text = "•";
      const cx = (wd.bbox.x0 + wd.bbox.x1) / 2;
      // Базовая линия строки в точке слова (строка может быть слегка наклонной)
      const by = bl.x1 !== bl.x0 ? bl.y0 + ((bl.y1 - bl.y0) * (cx - bl.x0)) / (bl.x1 - bl.x0) : bl.y0;
      items.push({
        str: text,
        x: wd.bbox.x0 / scale,
        y: pageH - by / scale,
        width: (wd.bbox.x1 - wd.bbox.x0) / scale,
        idx: items.length,
        font: "Times New Roman",
        size,
        bold: dens[li][wi] > bodyDensity * 1.3 && text.length > 1,
        italic: false,
        color: null,
      });
    });
  });
  return { items, canvas: straight, scale, ...found };
}
