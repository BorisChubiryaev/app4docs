// Воркер для автономного HTML: WASM встроен строкой base64 при сборке,
// поэтому файл работает с file:// без сервера и сети.
import { prepareZXingModule } from "zxing-wasm/reader";
import { serveScans } from "../core/scanCore";

declare const __ZXING_WASM_B64__: string;

const bin = atob(__ZXING_WASM_B64__);
const wasmBinary = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) wasmBinary[i] = bin.charCodeAt(i);

prepareZXingModule({
  overrides: { wasmBinary: wasmBinary.buffer },
  fireImmediately: true,
});

serveScans();
