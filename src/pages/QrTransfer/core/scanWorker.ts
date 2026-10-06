// Распознавание QR в отдельном потоке (zxing-cpp, WebAssembly).
// WASM лежит в сборке рядом с приложением — сеть/CDN не нужны.
import { prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { serveScans } from "./scanCore";

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
  fireImmediately: true,
});

serveScans();
