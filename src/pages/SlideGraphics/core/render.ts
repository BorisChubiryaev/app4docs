// Отрисовка кадра сцены в заданном размере и в заданный момент времени.

import { isDark } from "./draw";
import type { Background, Frame, Scene, Template } from "./types";

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
    t: tpl.loop ? ((t % dur) + dur) % dur : Math.min(t, dur),
    dur,
    s: Math.min(w, h) / 1080,
    p: scene.params,
    rows: scene.rows,
    phrases: scene.phrases,
    images,
    pal: scene.palette.length ? scene.palette : ["#4f6ef7"],
    ink: dark ? "#ffffff" : "#15171c",
    muted: dark ? "rgba(255,255,255,0.66)" : "rgba(21,23,28,0.58)",
    dark,
    base,
  };
  try {
    tpl.draw(f);
  } finally {
    ctx.restore();
  }
}

/** Момент, который сохраняется картинкой: конец анимации появления */
export const stillTime = (tpl: Template, dur: number, current: number) => (tpl.loop ? current : dur);
