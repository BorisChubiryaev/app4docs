import { GifReader } from "omggif";

export type GifClip = {
  part: string; reader: GifReader; ends: number[]; period: number; duration: number; loop: boolean; background: number;
};

export function readGif(part: string, bytes: Uint8Array): GifClip | undefined {
  try {
    const reader = new GifReader(bytes);
    const { width, height } = reader;
    if (reader.numFrames() < 2 || !width || !height || width * height > 16_777_216) return;
    const ends: number[] = [];
    let milliseconds = 0;
    for (let i = 0; i < reader.numFrames(); i++) {
      const f = reader.frameInfo(i);
      if (!f.width || !f.height || f.x + f.width > width || f.y + f.height > height) return;
      milliseconds += f.delay < 2 ? 100 : f.delay * 10;
      ends.push(milliseconds);
    }
    const repeats = reader.loopCount(), period = milliseconds / 1000;
    const bg = 13 + 3 * bytes[11];
    const rgba = bytes[10] & 0x80 ? new Uint8Array([bytes[bg], bytes[bg + 1], bytes[bg + 2], 255]) : new Uint8Array(4);
    return { part, reader, ends, period, duration: period * ((repeats ?? 0) + 1), loop: repeats === 0,
      background: new Uint32Array(rgba.buffer)[0] };
  } catch { return undefined; }
}

/** Composite GIF patches as the slide clock passes each frame. Only the current canvas and disposal buffer are kept. */
export function gifPainter(clip: GifClip, img: HTMLImageElement) {
  const { reader, ends } = clip;
  const width = reader.width, height = reader.height;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = img.style.cssText;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  const pixels = new Uint32Array(image.data.buffer);
  const initial = reader.frameInfo(0).transparent_index === null ? clip.background : 0;
  let previous: Uint32Array | undefined, drawn = -1;
  img.replaceWith(canvas);
  return (seconds: number | null) => {
    const t = seconds ?? (clip.loop ? 0 : clip.duration);
    const ms = !clip.loop && t >= clip.duration ? ends[ends.length - 1] : Math.round((t % clip.period) * 1000);
    let lo = 0, hi = ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ms < ends[mid]) hi = mid; else lo = mid + 1;
    }
    const target = lo;
    if (drawn === target) return;
    if (drawn > target || drawn < 0) { pixels.fill(initial); drawn = -1; }
    for (let i = drawn + 1; i <= target; i++) {
      const last = i > 0 ? reader.frameInfo(i - 1) : null;
      if (last?.disposal === 3 && previous) pixels.set(previous);
      if (last?.disposal === 2) {
        const color = last.transparent_index === null ? clip.background : 0;
        for (let y = last.y; y < last.y + last.height; y++) {
          const start = y * width + last.x;
          pixels.fill(color, start, start + last.width);
        }
      }
      if (reader.frameInfo(i).disposal === 3) {
        previous ??= new Uint32Array(pixels.length);
        previous.set(pixels);
      }
      reader.decodeAndBlitFrameRGBA(i, image.data);
    }
    ctx.putImageData(image, 0, 0);
    drawn = target;
  };
}
