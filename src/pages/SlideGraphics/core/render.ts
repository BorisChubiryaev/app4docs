// Отрисовка кадра сцены в заданном размере и в заданный момент времени.

import { isDark } from "./draw";
import type { Background, Frame, Scene, Template } from "./types";

// Категориальная палитра, проверенная на различимость (в т.ч. при нарушениях
// цветовосприятия) отдельно для светлого и тёмного фона — валидатор скилла
// dataviz. Порядок фиксирован: цвет закреплён за позицией, а не за рангом.
export const SAFE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
// «Сбер» на тёмном фоне подменяется своей тёмной парой (обе проверены валидатором)
const SBER_LIGHT = "#21a038,#1971c2,#e8a317,#7048e8";
const SBER_DARK = ["#21a038", "#3d8be0", "#b77c00", "#8a6cf0"];
export const SAFE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const BG_COLORS: Record<Exclude<Background["kind"], "custom" | "transparent">, string> = {
  white: "#ffffff",
  light: "#f4f5f8",
  dark: "#0e1016",
};

/** Цвет подложки или null, если фон прозрачный */
export function baseColor(scene: Scene, tpl: Template): string | null {
  if (tpl.ownBackground) return String(scene.params.base ?? "#000000");
  const b = scene.background;
  if (b.kind === "transparent") return null;
  if (b.kind === "custom") return b.color;
  return BG_COLORS[b.kind];
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  scene: Scene,
  tpl: Template,
  images: (HTMLImageElement | ImageBitmap)[],
  dur: number,
  /** Залить прозрачный фон (для JPEG и видео) */
  forceBase?: string,
  follow: Frame["follow"] = null,
) {
  const base = baseColor(scene, tpl);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const fill = base ?? forceBase;
  if (fill && !tpl.ownBackground) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  const dark = scene.ink === "light" ? true : scene.ink === "dark" ? false : base ? isDark(base) : forceBase ? isDark(forceBase) : false;
  const f: Frame = {
    ctx,
    w,
    h,
    t: tpl.loop ? ((t % dur) + dur) % dur : Math.min(Math.max(0, t), dur),
    dur,
    s: Math.min(w, h) / 1080,
    p: scene.params,
    rows: scene.rows,
    phrases: scene.phrases,
    images,
    pal: scene.paletteAuto ? (dark ? SAFE_DARK : SAFE_LIGHT) : !scene.palette.length ? ["#4f6ef7"] : dark && scene.palette.join() === SBER_LIGHT ? SBER_DARK : scene.palette,
    ink: dark ? "#ffffff" : "#15171c",
    muted: dark ? "rgba(255,255,255,0.66)" : "rgba(21,23,28,0.58)",
    dark,
    base,
    follow,
  };
  try {
    tpl.draw(f);
  } finally {
    ctx.restore();
  }
}

/** Момент, который сохраняется картинкой: конец анимации появления */
export const stillTime = (tpl: Template, dur: number, current: number) => (tpl.loop ? current : dur);
