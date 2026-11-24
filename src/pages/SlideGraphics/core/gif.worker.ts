import { GIFEncoder, applyPalette, quantize } from "gifenc";

export type GifFrame = { pixels: ImageData; delay: number; loop: boolean; transparent: boolean; last: boolean };

const gif = GIFEncoder();
let previous: GifFrame | undefined;

function samePixels(a: ImageData, b: ImageData) {
  const old = new Uint32Array(a.data.buffer), next = new Uint32Array(b.data.buffer);
  for (let i = 0; i < old.length; i++) if (old[i] !== next[i]) return false;
  return true;
}

function write({ pixels, delay, loop, transparent }: GifFrame) {
  const { data, width, height } = pixels;
  const palette = quantize(data, transparent ? 255 : 256);
  const indices = applyPalette(data, palette);
  if (transparent) {
    // GIF disposal restores background index zero between transparent frames.
    palette.unshift([0, 0, 0]);
    for (let i = 0; i < indices.length; i++) indices[i] = data[i * 4 + 3] < 128 ? 0 : indices[i] + 1;
  }
  gif.writeFrame(indices, width, height, {
    palette, delay, repeat: loop ? 0 : -1, transparent, transparentIndex: 0, dispose: transparent ? 2 : 1,
  });
}

self.onmessage = ({ data: frame }: MessageEvent<GifFrame>) => {
  if (previous && samePixels(previous.pixels, frame.pixels)) previous.delay += frame.delay;
  else {
    if (previous) write(previous);
    previous = frame;
  }
  if (!frame.last) { self.postMessage(null); return; }
  write(previous);
  gif.finish();
  const result = gif.bytes();
  self.postMessage(result, { transfer: [result.buffer] });
};
