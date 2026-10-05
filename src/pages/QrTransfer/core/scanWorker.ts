// Распознавание QR в отдельном потоке (zxing-cpp, WebAssembly).
// WASM лежит в сборке рядом с приложением — сеть/CDN не нужны.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
  fireImmediately: true,
});

self.onmessage = async (e: MessageEvent<{ id: number; image: ImageData }>) => {
  const { id, image } = e.data;
  try {
    const results = await readBarcodes(image, {
      formats: ["QRCode"],
      tryHarder: true,
      tryRotate: false,
      tryInvert: false,
      tryDownscale: true,
      maxNumberOfSymbols: 4,
    });
    const payloads = results.filter((r) => r.isValid).map((r) => r.bytes.slice());
    (self as unknown as Worker).postMessage(
      { id, payloads },
      payloads.map((p) => p.buffer as ArrayBuffer),
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, payloads: [], error: String(err) });
  }
};
