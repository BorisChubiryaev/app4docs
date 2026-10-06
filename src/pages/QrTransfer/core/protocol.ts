// Формат данных «файл → QR-кадры».
//
// Контейнер (то, что режется на блоки):
//   "QRFT" | u16 длина имени | имя (UTF-8) | u32 размер файла | u32 CRC32 | байты файла
//
// Кадр (содержимое одного QR-кода, байтовый режим):
//   0     u8  MAGIC
//   1     u8  версия протокола
//   2..5  u32 id передачи (случайный — чтобы не смешать два файла)
//   6..9  u32 длина контейнера
//   10..11 u16 размер блока
//   12..15 u32 id символа фонтанного кода
//   16..  полезная нагрузка (ровно «размер блока» байт), «отбеленная»
//         гаммой от id символа: иначе участки из нулей дают почти сплошную
//         шахматку, на которой камера ловит муар и не читает код.

export const FRAME_MAGIC = 0xf7;
export const PROTOCOL_VERSION = 2;
export const FRAME_HEADER = 16;
const CONTAINER_MAGIC = [0x51, 0x52, 0x46, 0x54]; // "QRFT"

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function packContainer(name: string, file: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name).slice(0, 1024);
  const out = new Uint8Array(4 + 2 + nameBytes.length + 8 + file.length);
  const dv = new DataView(out.buffer);
  out.set(CONTAINER_MAGIC, 0);
  dv.setUint16(4, nameBytes.length);
  out.set(nameBytes, 6);
  let o = 6 + nameBytes.length;
  dv.setUint32(o, file.length);
  dv.setUint32(o + 4, crc32(file));
  o += 8;
  out.set(file, o);
  return out;
}

export interface UnpackedFile {
  name: string;
  data: Uint8Array;
  crcOk: boolean;
}

export function unpackContainer(buf: Uint8Array): UnpackedFile {
  if (CONTAINER_MAGIC.some((b, i) => buf[i] !== b)) {
    throw new Error("Повреждённый контейнер");
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(4);
  const name = new TextDecoder().decode(buf.subarray(6, 6 + nameLen)) || "file.bin";
  let o = 6 + nameLen;
  const size = dv.getUint32(o);
  const crc = dv.getUint32(o + 4);
  o += 8;
  const data = buf.slice(o, o + size);
  return { name, data, crcOk: data.length === size && crc32(data) === crc };
}

export interface FrameHeader {
  transferId: number;
  containerLength: number;
  blockSize: number;
  symbolId: number;
}

/** XOR с псевдослучайной гаммой (xorshift32) — операция обратима сама собой. */
function whiten(buf: Uint8Array, seed: number) {
  let x = (seed ^ 0x5bd1e995) >>> 0 || 1;
  for (let i = 0; i < buf.length; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buf[i] ^= x;
    buf[i + 1] ^= x >>> 8;
    buf[i + 2] ^= x >>> 16;
    buf[i + 3] ^= x >>> 24;
  }
}

export function packFrame(h: FrameHeader, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER + payload.length);
  const dv = new DataView(out.buffer);
  out[0] = FRAME_MAGIC;
  out[1] = PROTOCOL_VERSION;
  dv.setUint32(2, h.transferId);
  dv.setUint32(6, h.containerLength);
  dv.setUint16(10, h.blockSize);
  dv.setUint32(12, h.symbolId);
  out.set(payload, FRAME_HEADER);
  whiten(out.subarray(FRAME_HEADER), h.symbolId ^ h.transferId);
  return out;
}

export function parseFrame(bytes: Uint8Array): (FrameHeader & { payload: Uint8Array }) | null {
  if (bytes.length < FRAME_HEADER + 1) return null;
  if (bytes[0] !== FRAME_MAGIC || bytes[1] !== PROTOCOL_VERSION) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blockSize = dv.getUint16(10);
  if (bytes.length < FRAME_HEADER + blockSize) return null;
  const transferId = dv.getUint32(2);
  const symbolId = dv.getUint32(12);
  const payload = bytes.slice(FRAME_HEADER, FRAME_HEADER + blockSize);
  whiten(payload, symbolId ^ transferId);
  return { transferId, containerLength: dv.getUint32(6), blockSize, symbolId, payload };
}

/** Вместимость QR в байтовом режиме по версиям (уровни коррекции L / M). */
const BYTE_CAPACITY: Record<number, { L: number; M: number }> = {
  10: { L: 271, M: 213 },
  15: { L: 520, M: 412 },
  20: { L: 858, M: 666 },
  25: { L: 1273, M: 997 },
  30: { L: 1732, M: 1370 },
  35: { L: 2232, M: 1750 },
  40: { L: 2953, M: 2331 },
};

export interface DensityPreset {
  id: string;
  label: string;
  hint: string;
  version: number;
  ecc: "L" | "M";
}

export const DENSITY_PRESETS: DensityPreset[] = [
  { id: "safe", label: "Надёжно", hint: "старые камеры, блики", version: 15, ecc: "M" },
  { id: "normal", label: "Стандарт", hint: "рекомендуется", version: 25, ecc: "L" },
  { id: "fast", label: "Быстро", hint: "камера 1080p, 30–50 см", version: 30, ecc: "L" },
  { id: "max", label: "Максимум", hint: "только хорошая камера", version: 40, ecc: "L" },
];

export function blockSizeFor(p: DensityPreset): number {
  return BYTE_CAPACITY[p.version][p.ecc] - FRAME_HEADER;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h} ч ${m % 60} мин`;
  if (m) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}
