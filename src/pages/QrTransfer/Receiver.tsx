import React, { useCallback, useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { FountainDecoder } from "./core/fountain";
import {
  formatBytes,
  formatDuration,
  parseFrame,
  unpackContainer,
  type UnpackedFile,
} from "./core/protocol";

// Сколько потоков распознают кадры параллельно.
const WORKERS = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));

interface Stats {
  transferId: number | null;
  k: number;
  blockSize: number;
  known: number;
  unique: number;
  codesPerSec: number;
  bytesPerSec: number;
  foreign: number;
}

const EMPTY: Stats = {
  transferId: null,
  k: 0,
  blockSize: 0,
  known: 0,
  unique: 0,
  codesPerSec: 0,
  bytesPerSec: 0,
  foreign: 0,
};

const Receiver: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<{ id: number; dec: FountainDecoder; start: number } | null>(null);
  const foreignRef = useRef(0);
  const decodedTimes = useRef<number[]>([]);
  const lastHit = useRef(0);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [resolution, setResolution] = useState("");
  const [hit, setHit] = useState(false);
  const [result, setResult] = useState<UnpackedFile | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const reset = useCallback(() => {
    decoderRef.current = null;
    foreignRef.current = 0;
    decodedTimes.current = [];
    setStats(EMPTY);
    setResult(null);
  }, []);

  const startCamera = useCallback(
    async (id?: string) => {
      setError("");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(id ? { deviceId: { exact: id } } : {}),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const s = stream.getVideoTracks()[0].getSettings();
        setResolution(`${s.width}×${s.height}${s.frameRate ? ` @ ${Math.round(s.frameRate)} к/с` : ""}`);
        setDeviceId(s.deviceId || id || "");
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
        setActive(true);
      } catch (e) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Нет доступа к камере. Разрешите его в настройках браузера (и в «Системные настройки → Конфиденциальность → Камера»)."
            : `Не удалось включить камеру: ${e instanceof Error ? e.message : e}`,
        );
      }
    },
    [],
  );

  const refreshStats = useCallback(() => {
    const cur = decoderRef.current;
    if (!cur) return;
    const now = performance.now();
    const recent = decodedTimes.current.filter((t) => now - t < 3000);
    decodedTimes.current = recent;
    const cps = recent.length / Math.min(3, Math.max(1, (now - cur.start) / 1000));
    setStats({
      transferId: cur.id,
      k: cur.dec.k,
      blockSize: cur.dec.blockSize,
      known: cur.dec.knownCount,
      unique: cur.dec.uniqueSymbols,
      codesPerSec: cps,
      bytesPerSec: cps * cur.dec.blockSize,
      foreign: foreignRef.current,
    });
  }, []);

  // Приём одного распознанного QR.
  const onPayload = useCallback((bytes: Uint8Array) => {
    const f = parseFrame(bytes);
    if (!f) return;
    let cur = decoderRef.current;
    if (!cur || (cur.id !== f.transferId && cur.dec.complete)) {
      cur = {
        id: f.transferId,
        dec: new FountainDecoder(f.containerLength, f.blockSize),
        start: performance.now(),
      };
      decoderRef.current = cur;
      foreignRef.current = 0;
      decodedTimes.current = [];
      setResult(null);
    }
    if (cur.id !== f.transferId) {
      foreignRef.current++;
      return;
    }
    lastHit.current = performance.now();
    if (cur.dec.complete) return;
    if (cur.dec.add(f.symbolId, f.payload)) decodedTimes.current.push(performance.now());
    if (cur.dec.complete) {
      refreshStats();
      try {
        setResult(unpackContainer(cur.dec.result()));
      } catch (e) {
        setError(String(e));
      }
    }
  }, [refreshStats]);

  // Цикл захвата: свободный воркер получает свежий кадр с камеры.
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const workers = Array.from(
      { length: WORKERS },
      () => new Worker(new URL("./core/scanWorker.ts", import.meta.url), { type: "module" }),
    );
    const idle = workers.map(() => true);
    let lastTime = -1;
    let raf = 0;
    let msgId = 0;

    workers.forEach((w, i) => {
      w.onmessage = (e: MessageEvent<{ payloads: Uint8Array[] }>) => {
        idle[i] = true;
        for (const p of e.data.payloads) onPayload(p);
      };
    });

    const loop = () => {
      raf = requestAnimationFrame(loop);
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
    raf = requestAnimationFrame(loop);

    const statsTimer = window.setInterval(() => {
      setHit(performance.now() - lastHit.current < 400);
      refreshStats();
    }, 250);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(statsTimer);
      workers.forEach((w) => w.terminate());
    };
  }, [active, onPayload, refreshStats]);

  // Файл собран — камера больше не нужна.
  useEffect(() => {
    if (result) stopCamera();
  }, [result, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  // Прогресс по числу полезных символов: блоки восстанавливаются лавиной
  // в самом конце, поэтому «восстановлено блоков» долго стоит около нуля.
  const needed = Math.ceil(stats.k * 1.05);
  const progress = result ? 1 : stats.k ? Math.min(0.99, stats.unique / needed) : 0;
  const eta = stats.codesPerSec > 0 ? Math.max(0, needed - stats.unique) / stats.codesPerSec : NaN;

  return (
    <div className="qrt-grid qrt-grid--receiver">
      <section className="ds-card qrt-camera-card">
        <div className={`qrt-video-wrap${hit ? " qrt-video-wrap--hit" : ""}`}>
          <video ref={videoRef} className="qrt-video" muted playsInline />
          {!active && (
            <div className="qrt-video-placeholder">
              <div className="qrt-drop-icon">📷</div>
              <button className="btn-primary" onClick={() => startCamera()}>
                Включить камеру
              </button>
            </div>
          )}
        </div>
        {active && (
          <div className="qrt-camera-row">
            <select
              className="ds-select"
              value={deviceId}
              onChange={(e) => startCamera(e.target.value)}
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Камера ${i + 1}`}
                </option>
              ))}
            </select>
            <span className="qrt-muted">{resolution}</span>
            <button className="btn-secondary" onClick={stopCamera}>
              Выключить
            </button>
          </div>
        )}
        {error && <div className="qrt-error">{error}</div>}
      </section>

      <section className="ds-card">
        <h2 className="ds-section-title">Приём</h2>
        {!stats.transferId && !result ? (
          <p className="qrt-muted">
            {active
              ? "Наведите камеру на экран с QR-кодами. Рамка видео подсветится зелёным, когда коды начнут читаться."
              : "Включите камеру и направьте её на экран отправителя."}
          </p>
        ) : (
          <>
            <div className="qrt-progress">
              <div className="qrt-progress__fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="qrt-progress-label">
              {Math.floor(progress * 100)}%
              {!result && <span className="qrt-muted"> · осталось ≈ {formatDuration(eta)}</span>}
            </div>
            <dl className="qrt-stats">
              <dt>Объём</dt>
              <dd>{formatBytes(stats.k * stats.blockSize)}</dd>
              <dt>Принято кодов</dt>
              <dd>
                {stats.unique.toLocaleString("ru")} из ≈ {needed.toLocaleString("ru")}
              </dd>
              <dt>Восстановлено блоков</dt>
              <dd>
                {stats.known.toLocaleString("ru")} / {stats.k.toLocaleString("ru")}
              </dd>
              <dt>Скорость</dt>
              <dd>
                {stats.codesPerSec.toFixed(1)} код/с · {formatBytes(Math.round(stats.bytesPerSec))}/с
              </dd>
              {stats.foreign > 0 && (
                <>
                  <dt>Чужие коды</dt>
                  <dd>{stats.foreign} — идёт другая передача</dd>
                </>
              )}
            </dl>
          </>
        )}

        {result && (
          <div className={`qrt-result${result.crcOk ? "" : " qrt-result--bad"}`}>
            <div className="qrt-file-name">📦 {result.name}</div>
            <div className="qrt-muted">
              {formatBytes(result.data.length)} ·{" "}
              {result.crcOk ? "✓ контрольная сумма совпала" : "⚠ контрольная сумма не совпала"}
            </div>
            <button
              className="btn-primary"
              onClick={() => saveAs(new Blob([result.data as BlobPart]), result.name)}
            >
              ⬇ Сохранить файл
            </button>
          </div>
        )}

        {(stats.transferId || result) && (
          <button
            className="btn-secondary qrt-reset"
            onClick={() => {
              reset();
              if (!active) startCamera(deviceId || undefined);
            }}
          >
            ↺ Принять другой файл
          </button>
        )}
      </section>
    </div>
  );
};

export default Receiver;
