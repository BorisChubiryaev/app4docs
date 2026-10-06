// Автономная версия «Передачи файлов через QR» — один HTML без React.
// Логика та же, что в приложении (Sender.tsx / Receiver.tsx), и протокол
// общий: файл, показанный в приложении, принимается этим HTML и наоборот.
import JSZip from "jszip";
import { FountainDecoder, FountainEncoder } from "../core/fountain";
import {
  DENSITY_PRESETS,
  blockSizeFor,
  formatBytes,
  formatDuration,
  packContainer,
  packFrame,
  parseFrame,
  unpackContainer,
  type UnpackedFile,
} from "../core/protocol";
import { drawQr } from "../core/qrRender";

declare const __SCAN_WORKER_SRC__: string;

const EXPECTED_OVERHEAD = 1.3;
const WORKERS = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// ───────────── Вкладки ─────────────
function setMode(m: "send" | "receive") {
  $("tab-send").classList.toggle("active", m === "send");
  $("tab-receive").classList.toggle("active", m === "receive");
  $("panel-send").hidden = m !== "send";
  $("panel-receive").hidden = m !== "receive";
  if (m === "send") stopCamera();
}
$("tab-send").onclick = () => setMode("send");
$("tab-receive").onclick = () => setMode("receive");

// ───────────── Отправка ─────────────
interface Prepared {
  name: string;
  size: number;
  container: Uint8Array;
}
let prepared: Prepared | null = null;
let presetId = "normal";
let codes = 2;
let fps = 8;

const preset = () => DENSITY_PRESETS.find((p) => p.id === presetId)!;

function renderSendSettings() {
  const p = preset();
  const bs = blockSizeFor(p);
  for (const b of $("presets").querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.id === presetId);
  }
  for (const b of $("codes").querySelectorAll("button")) {
    b.classList.toggle("active", Number(b.dataset.n) === codes);
  }
  $("preset-hint").textContent = `${p.hint} · ${formatBytes(bs)} в коде`;
  $("fps-value").textContent = String(fps);
  const rate = `${formatBytes(bs * codes * fps)}/с`;
  if (prepared) {
    const k = Math.ceil(prepared.container.length / bs);
    $("estimate").innerHTML = `≈ <strong>${formatDuration(
      (k * EXPECTED_OVERHEAD) / (codes * fps),
    )}</strong> · ${rate}`;
  } else {
    $("estimate").textContent = `Пропускная способность: ${rate}`;
  }
  $<HTMLButtonElement>("start").disabled = !prepared;
}

for (const p of DENSITY_PRESETS) {
  const b = document.createElement("button");
  b.textContent = p.label;
  b.title = p.hint;
  b.dataset.id = p.id;
  b.onclick = () => {
    presetId = p.id;
    renderSendSettings();
  };
  $("presets").appendChild(b);
}
for (const b of $("codes").querySelectorAll<HTMLButtonElement>("button")) {
  b.onclick = () => {
    codes = Number(b.dataset.n);
    renderSendSettings();
  };
}
$<HTMLInputElement>("fps").oninput = (e) => {
  fps = Number((e.target as HTMLInputElement).value);
  renderSendSettings();
};

async function handleFiles(list: FileList | null) {
  if (!list || list.length === 0) return;
  $("drop-text").textContent = "Подготовка…";
  $("drop-sub").textContent = "";
  const files = Array.from(list);
  let name: string;
  let bytes: Uint8Array;
  if (files.length === 1) {
    name = files[0].name;
    bytes = new Uint8Array(await files[0].arrayBuffer());
  } else {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f);
    bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    name = `files-${new Date().toISOString().slice(0, 10)}.zip`;
  }
  prepared = { name, size: bytes.length, container: packContainer(name, bytes) };
  $("drop-icon").textContent = "📦";
  $("drop-text").textContent = name;
  $("drop-sub").textContent = `${formatBytes(bytes.length)} · нажмите, чтобы выбрать другой`;
  renderSendSettings();
}

const drop = $("drop");
const fileInput = $<HTMLInputElement>("file");
drop.onclick = () => fileInput.click();
fileInput.onchange = () => handleFiles(fileInput.files);
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("over");
};
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  handleFiles(e.dataTransfer?.files ?? null);
};

// Полноэкранный показ
let broadcastRaf = 0;
let paused = false;

function startBroadcast() {
  if (!prepared) return;
  const p = preset();
  const bs = blockSizeFor(p);
  const src = prepared;
  const encoder = new FountainEncoder(src.container, bs);
  const transferId = crypto.getRandomValues(new Uint32Array(1))[0];
  const needed = Math.ceil(encoder.k * 1.05);

  const overlay = $("broadcast");
  const holder = $("codes-holder");
  holder.innerHTML = "";
  holder.className = `codes codes-${codes}`;
  const canvases = Array.from({ length: codes }, () => {
    const c = document.createElement("canvas");
    c.className = "code";
    holder.appendChild(c);
    return c;
  });
  $("bc-file").textContent = `📦 ${src.name} · ${formatBytes(src.size)}`;
  overlay.hidden = false;
  overlay.requestFullscreen?.().catch(() => {});

  let next = 0;
  let last = 0;
  paused = false;
  $("bc-pause").textContent = "⏸ Пауза";
  const interval = 1000 / fps;
  const tick = (now: number) => {
    broadcastRaf = requestAnimationFrame(tick);
    if (paused || now - last < interval - 2) return;
    last = now;
    for (const canvas of canvases) {
      const id = next++;
      const frame = packFrame(
        { transferId, containerLength: src.container.length, blockSize: bs, symbolId: id },
        encoder.symbol(id),
      );
      drawQr(canvas, frame, p.version, p.ecc);
    }
    $("bc-count").textContent = `показано ${next.toLocaleString("ru")} кодов (нужно ≈ ${needed.toLocaleString("ru")}+)`;
  };
  broadcastRaf = requestAnimationFrame(tick);
}

function stopBroadcast() {
  cancelAnimationFrame(broadcastRaf);
  $("broadcast").hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function togglePause() {
  paused = !paused;
  $("bc-pause").textContent = paused ? "▶ Продолжить" : "⏸ Пауза";
}

$("start").onclick = startBroadcast;
$("bc-stop").onclick = stopBroadcast;
$("bc-pause").onclick = togglePause;
document.addEventListener("keydown", (e) => {
  if ($("broadcast").hidden) return;
  if (e.key === "Escape") stopBroadcast();
  if (e.key === " ") {
    e.preventDefault();
    togglePause();
  }
});

// ───────────── Приём ─────────────
const video = $<HTMLVideoElement>("video");
let stream: MediaStream | null = null;
let workers: Worker[] = [];
let captureRaf = 0;
let statsTimer = 0;
let current: { id: number; dec: FountainDecoder; start: number } | null = null;
let foreign = 0;
let decodedTimes: number[] = [];
let lastHit = 0;
let result: UnpackedFile | null = null;

const workerUrl = URL.createObjectURL(
  new Blob([__SCAN_WORKER_SRC__], { type: "text/javascript" }),
);

function showError(msg: string) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
}

async function startCamera(deviceId?: string) {
  showError("");
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    showError("Браузер не даёт доступ к камере. Откройте файл в Google Chrome.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  } catch (e) {
    showError(
      e instanceof Error && e.name === "NotAllowedError"
        ? "Нет доступа к камере. Разрешите его в Chrome (значок камеры в адресной строке) и в «Системные настройки → Конфиденциальность → Камера»."
        : `Не удалось включить камеру: ${e instanceof Error ? e.message : e}`,
    );
    return;
  }
  video.srcObject = stream;
  await video.play();
  const s = stream.getVideoTracks()[0].getSettings();
  $("resolution").textContent = `${s.width}×${s.height}${
    s.frameRate ? ` @ ${Math.round(s.frameRate)} к/с` : ""
  }`;
  const select = $<HTMLSelectElement>("camera");
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput",
  );
  select.innerHTML = "";
  cams.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `Камера ${i + 1}`;
    select.appendChild(o);
  });
  select.value = s.deviceId || deviceId || "";
  $("camera-placeholder").hidden = true;
  $("camera-row").hidden = false;
  startCapture();
}

function stopCamera() {
  cancelAnimationFrame(captureRaf);
  clearInterval(statsTimer);
  workers.forEach((w) => w.terminate());
  workers = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("camera-placeholder").hidden = false;
  $("camera-row").hidden = true;
  $("video-wrap").classList.remove("hit");
}

function startCapture() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  workers = Array.from({ length: WORKERS }, () => new Worker(workerUrl));
  const idle = workers.map(() => true);
  let lastTime = -1;
  let msgId = 0;

  workers.forEach((w, i) => {
    w.onmessage = (e: MessageEvent<{ payloads: Uint8Array[]; error?: string }>) => {
      idle[i] = true;
      if (e.data.error) console.warn(e.data.error);
      for (const p of e.data.payloads) onPayload(p);
    };
    w.onerror = (e) => showError(`Ошибка распознавателя: ${e.message}`);
  });

  const loop = () => {
    captureRaf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === lastTime) return;
    const i = idle.indexOf(true);
    if (i < 0) return;
    lastTime = video.currentTime;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    idle[i] = false;
    workers[i].postMessage({ id: msgId++, image }, [image.data.buffer]);
  };
  captureRaf = requestAnimationFrame(loop);

  statsTimer = window.setInterval(() => {
    $("video-wrap").classList.toggle("hit", performance.now() - lastHit < 400);
    renderStats();
  }, 250);
}

function onPayload(bytes: Uint8Array) {
  const f = parseFrame(bytes);
  if (!f) return;
  if (!current || (current.id !== f.transferId && current.dec.complete)) {
    current = {
      id: f.transferId,
      dec: new FountainDecoder(f.containerLength, f.blockSize),
      start: performance.now(),
    };
    foreign = 0;
    decodedTimes = [];
    result = null;
    renderResult();
  }
  if (current.id !== f.transferId) {
    foreign++;
    return;
  }
  lastHit = performance.now();
  if (current.dec.complete) return;
  if (current.dec.add(f.symbolId, f.payload)) decodedTimes.push(performance.now());
  if (current.dec.complete) {
    try {
      result = unpackContainer(current.dec.result());
    } catch (e) {
      showError(String(e));
    }
    renderStats();
    renderResult();
    stopCamera();
  }
}

function renderStats() {
  if (!current) return;
  const dec = current.dec;
  const now = performance.now();
  decodedTimes = decodedTimes.filter((t) => now - t < 3000);
  const cps = decodedTimes.length / Math.min(3, Math.max(1, (now - current.start) / 1000));
  const needed = Math.ceil(dec.k * 1.05);
  const progress = result ? 1 : Math.min(0.99, dec.uniqueSymbols / needed);
  const eta = cps > 0 ? Math.max(0, needed - dec.uniqueSymbols) / cps : NaN;

  $("rx-idle").hidden = true;
  $("rx-progress").hidden = false;
  $("rx-fill").style.width = `${progress * 100}%`;
  $("rx-percent").innerHTML = `${Math.floor(progress * 100)}%${
    result ? "" : ` <span class="muted">· осталось ≈ ${formatDuration(eta)}</span>`
  }`;
  $("st-size").textContent = formatBytes(dec.k * dec.blockSize);
  $("st-codes").textContent = `${dec.uniqueSymbols.toLocaleString("ru")} из ≈ ${needed.toLocaleString("ru")}`;
  $("st-blocks").textContent = `${dec.knownCount.toLocaleString("ru")} / ${dec.k.toLocaleString("ru")}`;
  $("st-speed").textContent = `${cps.toFixed(1)} код/с · ${formatBytes(Math.round(cps * dec.blockSize))}/с`;
  $("st-foreign-row").hidden = foreign === 0;
  $("st-foreign").textContent = `${foreign} — идёт другая передача`;
  $("rx-reset").hidden = false;
}

function renderResult() {
  const box = $("rx-result");
  box.hidden = !result;
  if (!result) return;
  box.classList.toggle("bad", !result.crcOk);
  $("res-name").textContent = `📦 ${result.name}`;
  $("res-info").textContent = `${formatBytes(result.data.length)} · ${
    result.crcOk ? "✓ контрольная сумма совпала" : "⚠ контрольная сумма не совпала"
  }`;
}

function saveResult() {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([result.data as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = result.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

$("camera-on").onclick = () => startCamera();
$("camera-off").onclick = stopCamera;
$<HTMLSelectElement>("camera").onchange = (e) =>
  startCamera((e.target as HTMLSelectElement).value);
$("res-save").onclick = saveResult;
$("rx-reset").onclick = () => {
  current = null;
  result = null;
  foreign = 0;
  decodedTimes = [];
  renderResult();
  $("rx-idle").hidden = false;
  $("rx-progress").hidden = true;
  $("rx-reset").hidden = true;
  if (!stream) startCamera($<HTMLSelectElement>("camera").value || undefined);
};

renderSendSettings();
setMode("send");
