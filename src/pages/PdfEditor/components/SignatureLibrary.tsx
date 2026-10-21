import React, { useEffect, useRef, useState } from "react";

// Подпись или печать: нарисовать от руки, загрузить скан (белый фон
// убирается автоматически) или взять сохранённую. Сохранённые лежат в
// браузере этого пользователя и никуда не отправляются.

const STORE_KEY = "pdfstudio.signatures.v1";
const MAX_SAVED = 12;

type Saved = { id: string; dataUrl: string; created: number };

const loadSaved = (): Saved[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.dataUrl === "string") : [];
  } catch {
    return [];
  }
};

const storeSaved = (list: Saved[]): boolean => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
};

/** Обрезать прозрачные поля и уменьшить до разумного размера. */
function trimCanvas(src: HTMLCanvasElement, maxSide = 900): string | null {
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = src;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const k = Math.min(1, maxSide / Math.max(cw, ch));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/**
 * Белый фон → прозрачность. Яркие пиксели исчезают, тёмные остаются, а
 * цвет полупрозрачных краёв восстанавливается «из-под белого», поэтому
 * синяя печать остаётся синей без белого ореола.
 */
export function removeWhite(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hi = 236; // всё светлее — фон
  const lo = 150; // всё темнее — полностью непрозрачно
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // «Белизна» — по самому тёмному каналу: цветные чернила тоже сохраняются
    const m = Math.min(r, g, b);
    let a = m >= hi ? 0 : m <= lo ? 1 : (hi - m) / (hi - lo);
    a *= d[i + 3] / 255;
    if (a <= 0) {
      d[i + 3] = 0;
      continue;
    }
    if (a < 1) {
      d[i] = Math.max(0, Math.min(255, (r - 255 * (1 - a)) / a));
      d[i + 1] = Math.max(0, Math.min(255, (g - 255 * (1 - a)) / a));
      d[i + 2] = Math.max(0, Math.min(255, (b - 255 * (1 - a)) / a));
    }
    d[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
}

interface Props {
  onPick: (dataUrl: string) => void;
  onClose: () => void;
}

type Tab = "draw" | "upload" | "saved";

const SignatureLibrary: React.FC<Props> = ({ onPick, onClose }) => {
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [tab, setTab] = useState<Tab>(saved.length ? "saved" : "draw");
  const [remember, setRemember] = useState(true);
  const [ink, setInk] = useState("#1a2b8c");
  const [width, setWidth] = useState(3);
  const [hasInk, setHasInk] = useState(false);
  const [upload, setUpload] = useState<{ original: HTMLImageElement; result: string } | null>(null);
  const [cleanBg, setCleanBg] = useState(true);
  const [note, setNote] = useState("");

  const padRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const mid = useRef<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ── Рисование ──
  const padPos = (e: React.PointerEvent) => {
    const c = padRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const padScale = () => {
    const c = padRef.current!;
    return c.width / c.getBoundingClientRect().width || 1;
  };
  const onPadDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = padPos(e);
    last.current = p;
    mid.current = p;
    const ctx = padRef.current!.getContext("2d")!;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (width * padScale()) / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasInk(true);
  };
  const onPadMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current || !mid.current) return;
    const ctx = padRef.current!.getContext("2d")!;
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    ctx.strokeStyle = ink;
    ctx.lineWidth = width * padScale();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const ev of events) {
      const p = padPos(ev as unknown as React.PointerEvent);
      // Сглаживание: кривая через середины отрезков
      const m = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(mid.current.x, mid.current.y);
      ctx.quadraticCurveTo(last.current.x, last.current.y, m.x, m.y);
      ctx.stroke();
      last.current = p;
      mid.current = m;
    }
  };
  const onPadUp = () => {
    last.current = null;
    mid.current = null;
  };
  const clearPad = () => {
    const c = padRef.current;
    c?.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  // ── Загрузка ──
  const processUpload = (img: HTMLImageElement, clean: boolean) => {
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    if (clean) removeWhite(c);
    return trimCanvas(c) ?? c.toDataURL("image/png");
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setUpload({ original: img, result: processUpload(img, cleanBg) });
      img.onerror = () => setNote("Не удалось открыть картинку");
      img.src = reader.result as string;
    };
    reader.readAsDataURL(f);
  };
  useEffect(() => {
    if (upload) setUpload({ ...upload, result: processUpload(upload.original, cleanBg) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanBg]);

  // ── Вставка ──
  const pick = (dataUrl: string, save: boolean) => {
    if (save) {
      const list = [{ id: Math.random().toString(36).slice(2), dataUrl, created: Date.now() }, ...saved].slice(0, MAX_SAVED);
      if (storeSaved(list)) setSaved(list);
    }
    onPick(dataUrl);
  };
  const insertDrawn = () => {
    const c = padRef.current;
    if (!c || !hasInk) return;
    const url = trimCanvas(c, 900);
    if (url) pick(url, remember);
  };
  const removeSaved = (id: string) => {
    const list = saved.filter((s) => s.id !== id);
    storeSaved(list);
    setSaved(list);
  };

  return (
    <div className="sig-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sig-modal" role="dialog" aria-label="Подпись или печать">
        <div className="sig-header">
          <h3>✍️ Подпись или печать</h3>
          <button className="sig-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="sig-tabs" role="tablist">
          {(
            [
              ["draw", "Нарисовать"],
              ["upload", "Загрузить скан"],
              ["saved", `Сохранённые (${saved.length})`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`sig-tab ${tab === id ? "is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="sig-body">
          {tab === "draw" && (
            <>
              <canvas
                ref={padRef}
                className="sig-pad"
                width={1200}
                height={440}
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadUp}
              />
              <div className="sig-row">
                <span className="sig-label">Цвет</span>
                {["#1a2b8c", "#111111", "#0b5d1e"].map((c) => (
                  <button
                    key={c}
                    className={`sig-swatch ${ink === c ? "is-active" : ""}`}
                    style={{ background: c }}
                    onClick={() => setInk(c)}
                    aria-label={c}
                  />
                ))}
                <label className="sig-label">
                  Толщина
                  <input type="range" min={1} max={8} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                </label>
                <button className="btn-secondary" onClick={clearPad} disabled={!hasInk}>
                  Очистить
                </button>
              </div>
            </>
          )}

          {tab === "upload" && (
            <>
              <div className="sig-drop" onClick={() => fileRef.current?.click()}>
                {upload ? (
                  <img src={upload.result} alt="Подпись" className="sig-preview" />
                ) : (
                  <span>Выберите фото или скан подписи / печати на белом фоне</span>
                )}
              </div>
              <div className="sig-row">
                <label className="sig-label">
                  <input type="checkbox" checked={cleanBg} onChange={(e) => setCleanBg(e.target.checked)} />
                  Убрать белый фон
                </label>
                <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
                  {upload ? "Другая картинка" : "Выбрать файл"}
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            </>
          )}

          {tab === "saved" &&
            (saved.length ? (
              <div className="sig-saved">
                {saved.map((s) => (
                  <div key={s.id} className="sig-saved-item">
                    <button className="sig-saved-pick" onClick={() => pick(s.dataUrl, false)} title="Вставить">
                      <img src={s.dataUrl} alt="Сохранённая подпись" />
                    </button>
                    <button className="sig-saved-del" onClick={() => removeSaved(s.id)} title="Удалить из библиотеки">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sig-empty">Пока ничего не сохранено. Нарисуйте или загрузите подпись.</p>
            ))}
          {note && <p className="sig-empty">{note}</p>}
        </div>

        {tab !== "saved" && (
          <div className="sig-footer">
            <label className="sig-label">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Сохранить в библиотеку (только в этом браузере)
            </label>
            <button
              className="btn-primary"
              disabled={tab === "draw" ? !hasInk : !upload}
              onClick={() => (tab === "draw" ? insertDrawn() : upload && pick(upload.result, remember))}
            >
              Вставить
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SignatureLibrary;
