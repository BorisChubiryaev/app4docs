declare module "omggif" {
  export interface GifFrameInfo {
    x: number; y: number; width: number; height: number;
    delay: number; disposal: number; transparent_index: number | null;
  }
  export class GifReader {
    constructor(bytes: Uint8Array);
    width: number; height: number;
    numFrames(): number;
    loopCount(): number | null;
    frameInfo(index: number): GifFrameInfo;
    decodeAndBlitFrameRGBA(index: number, rgba: Uint8ClampedArray): void;
  }
}
