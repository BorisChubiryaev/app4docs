import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { FountainEncoder } from "./core/fountain";
import {
  DENSITY_PRESETS,
  blockSizeFor,
  formatBytes,
  formatDuration,
  packContainer,
  packFrame,
} from "./core/protocol";
import { drawQr } from "./core/qrRender";

// Ожидаемый избыток фонтанного кода плюс запас на пропущенные кадры —
// только для оценки времени в интерфейсе.
const EXPECTED_OVERHEAD = 1.3;

interface Prepared {
  name: string;
  size: number;
  container: Uint8Array;
}

const Sender: React.FC = () => {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [presetId, setPresetId] = useState("normal");
  const [codes, setCodes] = useState(2);
  const [fps, setFps] = useState(8);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sent, setSent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const preset = DENSITY_PRESETS.find((p) => p.id === presetId)!;
  const blockSize = blockSizeFor(preset);
  const k = prepared ? Math.ceil(prepared.container.length / blockSize) : 0;
  const estimateSec = (k * EXPECTED_OVERHEAD) / (codes * fps);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const stop = useCallback(() => setRunning(false), []);

  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      const files = Array.from(list);
      let name: string;
      let bytes: Uint8Array;
      if (files.length === 1) {
        name = files[0].name;
        bytes = new Uint8Array(await files[0].arrayBuffer());
      } else {
        // Несколько файлов — упаковываем без сжатия (обычно это уже архивы/медиа).
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f);
        bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
        name = `files-${new Date().toISOString().slice(0, 10)}.zip`;
      }
      setPrepared({ name, size: bytes.length, container: packContainer(name, bytes) });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="qrt-grid">
      <section className="ds-card">
        <h2 className="ds-section-title">1. Файл</h2>
        <div
          className={`ds-dropzone${over ? " ds-dropzone--over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          {busy ? (
            <p className="qrt-muted">Подготовка…</p>
          ) : prepared ? (
            <>
              <div className="qrt-file-name">📦 {prepared.name}</div>
              <div className="qrt-muted">
                {formatBytes(prepared.size)} · нажмите, чтобы выбрать другой
              </div>
            </>
          ) : (
            <>
              <div className="qrt-drop-icon">📤</div>
              <div className="qrt-file-name">Перетащите файл или нажмите</div>
              <div className="qrt-muted">
                Несколько файлов будут упакованы в ZIP
              </div>
            </>
          )}
        </div>
      </section>

      <section className="ds-card">
        <h2 className="ds-section-title">2. Параметры</h2>

        <label className="qrt-label">Плотность кода</label>
        <div className="ds-tabs ds-tabs--fill qrt-presets">
          {DENSITY_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`ds-tab${p.id === presetId ? " ds-tab--active" : ""}`}
              onClick={() => setPresetId(p.id)}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="qrt-muted qrt-hint">
          {preset.hint} · {formatBytes(blockSize)} в коде
        </div>

        <label className="qrt-label">Кодов на экране</label>
        <div className="ds-tabs ds-tabs--fill">
          {[1, 2].map((n) => (
            <button
              key={n}
              className={`ds-tab${n === codes ? " ds-tab--active" : ""}`}
              onClick={() => setCodes(n)}
            >
              {n === 1 ? "Один" : "Два рядом"}
            </button>
          ))}
        </div>

        <label className="qrt-label">
          Скорость смены: <strong>{fps} кадр/с</strong>
        </label>
        <input
          type="range"
          min={2}
          max={20}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          className="qrt-range"
        />

        <div className="qrt-estimate">
          {prepared ? (
            <>
              ≈ <strong>{formatDuration(estimateSec)}</strong> ·{" "}
              {formatBytes(blockSize * codes * fps)}/с
            </>
          ) : (
            <>Пропускная способность: {formatBytes(blockSize * codes * fps)}/с</>
          )}
        </div>

        <button
          className="btn-primary qrt-start"
          disabled={!prepared || busy}
          onClick={() => {
            setSent(0);
            setPaused(false);
            setRunning(true);
          }}
        >
          ▶ Начать показ
        </button>
      </section>

      {running && prepared && (
        <Broadcast
          prepared={prepared}
          blockSize={blockSize}
          version={preset.version}
          ecc={preset.ecc}
          codes={codes}
          fps={fps}
          paused={paused}
          sent={sent}
          k={k}
          onSent={setSent}
          onTogglePause={togglePause}
          onStop={stop}
        />
      )}
    </div>
  );
};

interface BroadcastProps {
  prepared: Prepared;
  blockSize: number;
  version: number;
  ecc: "L" | "M";
  codes: number;
  fps: number;
  paused: boolean;
  sent: number;
  k: number;
  onSent: (n: number) => void;
  onTogglePause: () => void;
  onStop: () => void;
}

/** Полноэкранный показ QR-кодов — бесконечный поток фонтанных символов. */
const Broadcast: React.FC<BroadcastProps> = ({
  prepared,
  blockSize,
  version,
  ecc,
  codes,
  fps,
  paused,
  sent,
  k,
  onSent,
  onTogglePause,
  onStop,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const encoder = useMemo(
    () => new FountainEncoder(prepared.container, blockSize),
    [prepared, blockSize],
  );
  const transferId = useMemo(
    () => crypto.getRandomValues(new Uint32Array(1))[0],
    // новый id на каждый файл/размер блока, чтобы приёмник не смешал данные
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prepared, blockSize],
  );
  const nextId = useRef(0);

  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStop();
      if (e.key === " ") {
        e.preventDefault();
        onTogglePause();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStop, onTogglePause]);

  useEffect(() => {
    if (paused) return;
    const interval = 1000 / fps;
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < interval - 2) return;
      last = now;
      for (let i = 0; i < codes; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const id = nextId.current++;
        const frame = packFrame(
          {
            transferId,
            containerLength: prepared.container.length,
            blockSize,
            symbolId: id,
          },
          encoder.symbol(id),
        );
        drawQr(canvas, frame, version, ecc);
      }
      onSent(nextId.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, fps, codes, encoder, transferId, prepared, blockSize, version, ecc, onSent]);

  return (
    <div ref={rootRef} className="qrt-broadcast">
      <div className={`qrt-codes qrt-codes--${codes}`}>
        {Array.from({ length: codes }, (_, i) => (
          <canvas
            key={i}
            ref={(el) => {
              canvasRefs.current[i] = el;
            }}
            className="qrt-code"
          />
        ))}
      </div>
      <div className="qrt-bar">
        <span>
          📦 {prepared.name} · {formatBytes(prepared.size)}
        </span>
        <span>
          показано {sent.toLocaleString("ru")} кодов (нужно ≈{" "}
          {Math.ceil(k * 1.05).toLocaleString("ru")}+)
        </span>
        <span className="qrt-bar__actions">
          <button className="btn-secondary" onClick={onTogglePause}>
            {paused ? "▶ Продолжить" : "⏸ Пауза"}
          </button>
          <button className="btn-danger" onClick={onStop}>
            ✕ Стоп
          </button>
        </span>
      </div>
    </div>
  );
};

export default Sender;
