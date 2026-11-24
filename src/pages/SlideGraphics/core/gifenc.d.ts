declare module "gifenc" {
  export function quantize(rgba: Uint8ClampedArray, maxColors: number): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][]): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(indices: Uint8Array, width: number, height: number, options: {
      palette: number[][]; delay: number; repeat: number; transparent: boolean; transparentIndex: number; dispose: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
