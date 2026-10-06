// Общий обработчик воркера распознавания: кадр камеры → байты QR-кодов.
// Модуль zxing готовит сам воркер — в приложении WASM лежит отдельным
// файлом, в автономном HTML встроен в base64.
import { readBarcodes } from "zxing-wasm/reader";

export function serveScans() {
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
}
