import { paintText, easeOut, fitFont, prog } from "../core/draw";
import type { Frame } from "../core/types";

export const title = { key: "title", label: "Заголовок", type: "text" } as const;

export function label(f: Frame, text: string, x: number, y: number, width: number, size: number, color = f.ink, align: CanvasTextAlign = "left") {
  f.ctx.fillStyle = color;
  f.ctx.textAlign = align;
  f.ctx.textBaseline = "middle";
  fitFont(f.ctx, text, width, size, 650, size * 0.7);
  paintText(f, text, x, y, width);
}

export function reveal(f: Frame, index: number) {
  return easeOut(prog(f.t, f.dur * Math.min(0.55, index * 0.035), f.dur * 0.4));
}

export function heading(f: Frame) {
  label(f, String(f.p.title), f.w * 0.08, f.h * 0.13, f.w * 0.84, 68 * f.s);
}
