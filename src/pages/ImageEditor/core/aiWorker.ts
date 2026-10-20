// Нейросеть удаления фона в отдельном потоке (onnxruntime-web, WebAssembly).
//
// Служебный модуль движка («клей» Emscripten) встроен в сборку текстом и
// подключается через blob-ссылку: так не нужен отдельный .mjs на сервере
// (Qlik отдаёт не все типы файлов). Сам wasm и модель приходят байтами из
// основного потока (aiAssets), поэтому движок ничего не скачивает сам.
import * as ort from "onnxruntime-web/wasm";
import glueSource from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?raw";

export type AiRequest =
  | { type: "init"; model: ArrayBuffer; wasm: ArrayBuffer }
  | { type: "run"; id: number; input: Float32Array; size: number };

export type AiResponse =
  | { type: "ready" }
  | { type: "error"; id?: number; message: string }
  | { type: "result"; id: number; output: Float32Array };

let session: ort.InferenceSession | null = null;

const reply = (m: AiResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      // «Клей» вычисляет адрес wasm относительно себя — у blob-ссылки его нет.
      // wasm мы передаём байтами, поэтому адрес подменяем на любой.
      const glue = glueSource.replace('(new URL("ort-wasm-simd-threaded.wasm",import.meta.url)).href', '"ort-wasm-simd-threaded.wasm"');
      const glueUrl = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      ort.env.wasm.wasmPaths = { mjs: glueUrl, wasm: new URL("ort.wasm", self.location.href).href };
      ort.env.wasm.wasmBinary = msg.wasm;
      // Потоки WebAssembly требуют cross-origin isolation, которой у Qlik нет
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      session = await ort.InferenceSession.create(new Uint8Array(msg.model), { executionProviders: ["wasm"] });
      reply({ type: "ready" });
      return;
    }
    if (msg.type === "run") {
      if (!session) throw new Error("Нейросеть не загружена");
      const feeds: Record<string, ort.Tensor> = {
        [session.inputNames[0]]: new ort.Tensor("float32", msg.input, [1, 3, msg.size, msg.size]),
      };
      const out = await session.run(feeds);
      const data = out[session.outputNames[0]].data as Float32Array;
      const output = new Float32Array(data);
      reply({ type: "result", id: msg.id, output }, [output.buffer]);
    }
  } catch (err) {
    reply({ type: "error", id: msg.type === "run" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
