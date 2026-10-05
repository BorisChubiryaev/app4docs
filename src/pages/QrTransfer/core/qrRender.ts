import QRCode from "qrcode";

/**
 * Рисует QR-код байтового режима на canvas «пиксель в модуль» —
 * масштабирование делает CSS (image-rendering: pixelated). Маска
 * фиксирована: перебор 8 масок — самая дорогая часть генерации,
 * а камере маска почти безразлична.
 */
export function drawQr(
  canvas: HTMLCanvasElement,
  bytes: Uint8Array,
  version: number,
  ecc: "L" | "M",
) {
  const qr = QRCode.create([{ data: bytes, mode: "byte" }], {
    version,
    errorCorrectionLevel: ecc,
    maskPattern: 0,
  });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 4;
  const full = size + quiet * 2;
  if (canvas.width !== full) {
    canvas.width = full;
    canvas.height = full;
  }
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(full, full);
  const px = new Uint32Array(img.data.buffer);
  px.fill(0xffffffff);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) px[(y + quiet) * full + x + quiet] = 0xff000000;
    }
  }
  ctx.putImageData(img, 0, 0);
}
