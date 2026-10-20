import { useEffect, useState, type ReactNode } from "react";
import type { FilterDef } from "../core/filters";
import type { BgOptions } from "../core/bgremove";
import { Ico } from "./icons";

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  side,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  wide?: boolean;
  /** Сбоку и без затемнения — чтобы видеть предпросмотр на холсте. */
  side?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className={`ie-modal-back ${side ? "is-side" : ""}`} onMouseDown={(e) => !side && e.target === e.currentTarget && onClose()}>
      <div className={`ie-modal ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ie-modal-head">
          <h2>{title}</h2>
          <button className="ie-icon-btn" onClick={onClose} aria-label="Закрыть">
            <Ico name="close" />
          </button>
        </header>
        <div className="ie-modal-body">{children}</div>
        <footer className="ie-modal-foot">{footer}</footer>
      </div>
    </div>
  );
}

const PRESETS: [string, number, number][] = [
  ["Full HD 1920 × 1080", 1920, 1080],
  ["HD 1280 × 720", 1280, 720],
  ["Квадрат для соцсетей 1080 × 1080", 1080, 1080],
  ["Сторис 1080 × 1920", 1080, 1920],
  ["Слайд 16:9 — 1600 × 900", 1600, 900],
  ["A4 при 150 dpi — 1240 × 1754", 1240, 1754],
  ["A4 при 300 dpi — 2480 × 3508", 2480, 3508],
  ["Иконка 512 × 512", 512, 512],
];

export function NewDocDialog({ onCreate, onClose }: { onCreate: (w: number, h: number, bg: string | null) => void; onClose: () => void }) {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [bg, setBg] = useState<"white" | "transparent" | "color">("white");
  const [color, setColor] = useState("#f4f5f7");
  const ok = w >= 1 && h >= 1 && w <= 12000 && h <= 12000;
  return (
    <Modal
      title="Новый документ"
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn ie-btn--primary" disabled={!ok} onClick={() => onCreate(w, h, bg === "white" ? "#ffffff" : bg === "color" ? color : null)}>
            Создать
          </button>
        </>
      }
    >
      <div className="ie-presets">
        {PRESETS.map(([l, pw, ph]) => (
          <button
            key={l}
            className={`ie-preset ${pw === w && ph === h ? "is-active" : ""}`}
            onClick={() => {
              setW(pw);
              setH(ph);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="ie-form-row">
        <label>
          Ширина, пкс
          <input type="number" className="ie-input" min={1} max={12000} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label>
          Высота, пкс
          <input type="number" className="ie-input" min={1} max={12000} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
      </div>
      <div className="ie-form-row">
        <span className="ie-label">Фон</span>
        <div className="ie-seg">
          {(
            [
              ["white", "Белый"],
              ["transparent", "Прозрачный"],
              ["color", "Цвет"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={bg === v ? "is-active" : ""} onClick={() => setBg(v)}>
              {l}
            </button>
          ))}
        </div>
        {bg === "color" && <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="ie-color-input" />}
      </div>
      {!ok && <p className="ie-warn">Размер — от 1 до 12 000 пикселей по каждой стороне.</p>}
    </Modal>
  );
}

export function ImageSizeDialog({
  w0,
  h0,
  onApply,
  onClose,
}: {
  w0: number;
  h0: number;
  onApply: (w: number, h: number) => void;
  onClose: () => void;
}) {
  const [w, setW] = useState(w0);
  const [h, setH] = useState(h0);
  const [lock, setLock] = useState(true);
  const ratio = w0 / h0;
  const ok = w >= 1 && h >= 1 && w <= 12000 && h <= 12000;
  return (
    <Modal
      title="Размер изображения"
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn ie-btn--primary" disabled={!ok} onClick={() => onApply(Math.round(w), Math.round(h))}>
            Применить
          </button>
        </>
      }
    >
      <p className="ie-note">
        Сейчас: {w0} × {h0} пкс. Все слои масштабируются вместе.
      </p>
      <div className="ie-form-row">
        <label>
          Ширина
          <input
            type="number"
            className="ie-input"
            value={w}
            onChange={(e) => {
              const v = Number(e.target.value);
              setW(v);
              if (lock) setH(Math.round(v / ratio));
            }}
          />
        </label>
        <label>
          Высота
          <input
            type="number"
            className="ie-input"
            value={h}
            onChange={(e) => {
              const v = Number(e.target.value);
              setH(v);
              if (lock) setW(Math.round(v * ratio));
            }}
          />
        </label>
        <label className="ie-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Сохранять пропорции
        </label>
      </div>
      <div className="ie-chips">
        {[25, 50, 75, 150, 200].map((p) => (
          <button
            key={p}
            className="ie-chip"
            onClick={() => {
              setW(Math.round((w0 * p) / 100));
              setH(Math.round((h0 * p) / 100));
            }}
          >
            {p}%
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CanvasSizeDialog({
  w0,
  h0,
  onApply,
  onClose,
}: {
  w0: number;
  h0: number;
  onApply: (w: number, h: number, ax: number, ay: number) => void;
  onClose: () => void;
}) {
  const [w, setW] = useState(w0);
  const [h, setH] = useState(h0);
  const [anchor, setAnchor] = useState([0.5, 0.5]);
  return (
    <Modal
      title="Размер холста"
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn ie-btn--primary" disabled={w < 1 || h < 1} onClick={() => onApply(Math.round(w), Math.round(h), anchor[0], anchor[1])}>
            Применить
          </button>
        </>
      }
    >
      <p className="ie-note">
        Изображение не масштабируется — холст расширяется или обрезается. Сейчас: {w0} × {h0} пкс.
      </p>
      <div className="ie-form-row">
        <label>
          Ширина
          <input type="number" className="ie-input" value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label>
          Высота
          <input type="number" className="ie-input" value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <div>
          <span className="ie-label">Привязка</span>
          <div className="ie-anchor">
            {[0, 0.5, 1].flatMap((ay) =>
              [0, 0.5, 1].map((ax) => (
                <button
                  key={`${ax}-${ay}`}
                  className={anchor[0] === ax && anchor[1] === ay ? "is-active" : ""}
                  onClick={() => setAnchor([ax, ay])}
                  aria-label="Точка привязки"
                />
              )),
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function FilterDialog({
  def,
  values,
  setValues,
  previewOn,
  setPreviewOn,
  busy,
  onApply,
  onClose,
  target,
}: {
  def: FilterDef;
  values: Record<string, number>;
  setValues: (v: Record<string, number>) => void;
  previewOn: boolean;
  setPreviewOn: (v: boolean) => void;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
  target: string;
}) {
  return (
    <Modal
      title={def.title}
      side
      onClose={onClose}
      footer={
        <>
          <label className="ie-check ie-foot-left">
            <input type="checkbox" checked={previewOn} onChange={(e) => setPreviewOn(e.target.checked)} /> Предпросмотр
            {busy && <span className="ie-spin" aria-label="Считаем" />}
          </label>
          <button className="ie-btn" onClick={() => setValues(Object.fromEntries(def.params.map((p) => [p.key, p.value])))} disabled={!def.params.length}>
            Сбросить
          </button>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn ie-btn--primary" onClick={onApply}>
            Применить
          </button>
        </>
      }
    >
      <p className="ie-note">Применяется к: {target}</p>
      {def.params.map((p) => (
        <label key={p.key} className="ie-slider">
          <span>
            {p.label}
            <b>
              {Number.isInteger(p.step ?? 1) ? Math.round(values[p.key]) : values[p.key].toFixed(2)}
              {p.unit ?? ""}
            </b>
          </span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step ?? 1}
            value={values[p.key]}
            onChange={(e) => setValues({ ...values, [p.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      {!def.params.length && <p className="ie-note">У этой коррекции нет настроек — посмотрите результат и нажмите «Применить».</p>}
    </Modal>
  );
}

export function BgRemoveDialog({
  opts,
  setOpts,
  busy,
  status,
  error,
  hasResult,
  onPreview,
  onApplyMask,
  onSelect,
  onClose,
}: {
  opts: BgOptions;
  setOpts: (o: BgOptions) => void;
  busy: boolean;
  status: string | null;
  error: string | null;
  hasResult: boolean;
  onPreview: () => void;
  onApplyMask: () => void;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Удалить фон"
      side
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn ie-foot-left" onClick={onPreview} disabled={busy}>
            {busy ? <span className="ie-spin" /> : <Ico name="sparkles" size={16} />} {hasResult ? "Пересчитать" : "Найти объект"}
          </button>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn" onClick={onSelect} disabled={!hasResult || busy}>
            Выделить объект
          </button>
          <button className="ie-btn ie-btn--primary" onClick={onApplyMask} disabled={!hasResult || busy}>
            Убрать фон (маска)
          </button>
        </>
      }
    >
      <div className="ie-seg ie-seg--wide">
        <button className={opts.mode === "ai" ? "is-active" : ""} onClick={() => setOpts({ ...opts, mode: "ai" })}>
          Нейросеть (рекомендуется)
        </button>
        <button className={opts.mode === "color" ? "is-active" : ""} onClick={() => setOpts({ ...opts, mode: "color" })}>
          Однотонный фон
        </button>
      </div>
      {opts.mode === "color" && (
        <label className="ie-slider">
          <span>
            Чувствительность<b>{opts.tolerance}</b>
          </span>
          <input type="range" min={1} max={100} value={opts.tolerance} onChange={(e) => setOpts({ ...opts, tolerance: Number(e.target.value) })} />
        </label>
      )}
      <label className="ie-slider">
        <span>
          Смягчение края<b>{opts.feather} пкс</b>
        </span>
        <input type="range" min={0} max={10} step={0.5} value={opts.feather} onChange={(e) => setOpts({ ...opts, feather: Number(e.target.value) })} />
      </label>
      <label className="ie-check">
        <input type="checkbox" checked={opts.cleanup} onChange={(e) => setOpts({ ...opts, cleanup: e.target.checked })} /> Убрать мелкий
        мусор и заполнить мелкие дырки
      </label>
      {status && (
        <p className="ie-note ie-note--status">
          <span className="ie-spin" /> {status}
        </p>
      )}
      {error && !busy && (
        <p className="ie-warn" role="alert">
          {error}
        </p>
      )}
      <p className="ie-note">
        {opts.mode === "ai"
          ? "Нейросеть находит главный объект — человека, животное, предмет, машину — даже на пёстром фоне. Работает без интернета, прямо в браузере: при первом запуске загружает ~56 МБ с сервера приложения, дальше берёт из кэша. Один снимок — несколько секунд."
          : "Без нейросети: убирает фон, похожий по цвету на края кадра (студийная съёмка, скриншоты, логотипы)."}{" "}
        Фон убирается маской, а не стирается: потом её можно доправить кистью (кликните по миниатюре маски в панели слоёв: кисть
        возвращает, ластик убирает).
      </p>
    </Modal>
  );
}

export type ExportKind = "png" | "jpeg" | "webp" | "psd" | "cvxproj";

export function ExportDialog({
  name0,
  w,
  h,
  onExport,
  onClose,
  busy,
}: {
  name0: string;
  w: number;
  h: number;
  onExport: (o: { kind: ExportKind; name: string; quality: number; scale: number; background: string }) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [kind, setKind] = useState<ExportKind>("png");
  const [name, setName] = useState(name0);
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(100);
  const [background, setBackground] = useState("#ffffff");
  const raster = kind === "png" || kind === "jpeg" || kind === "webp";
  return (
    <Modal
      title="Сохранить / экспортировать"
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="ie-btn ie-btn--primary"
            disabled={busy || !name.trim()}
            onClick={() => onExport({ kind, name: name.trim(), quality: quality / 100, scale: scale / 100, background })}
          >
            {busy ? <span className="ie-spin" /> : <Ico name="download" size={16} />} Скачать
          </button>
        </>
      }
    >
      <div className="ie-formats">
        {(
          [
            ["png", "PNG", "без потерь, с прозрачностью"],
            ["jpeg", "JPEG", "фото, меньше размер"],
            ["webp", "WebP", "современный, лёгкий"],
            ["psd", "PSD", "слои для Photoshop"],
            ["cvxproj", "Проект", "все слои, маски и текст — продолжить позже"],
          ] as const
        ).map(([v, l, d]) => (
          <button key={v} className={`ie-format ${kind === v ? "is-active" : ""}`} onClick={() => setKind(v)}>
            <b>{l}</b>
            <small>{d}</small>
          </button>
        ))}
      </div>
      <label className="ie-field">
        Имя файла
        <input className="ie-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {raster && (
        <>
          <label className="ie-slider">
            <span>
              Масштаб<b>
                {scale}% · {Math.round((w * scale) / 100)} × {Math.round((h * scale) / 100)}
              </b>
            </span>
            <input type="range" min={10} max={300} step={5} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          </label>
          {kind !== "png" && (
            <label className="ie-slider">
              <span>
                Качество<b>{quality}%</b>
              </span>
              <input type="range" min={30} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </label>
          )}
          {kind === "jpeg" && (
            <label className="ie-field ie-field--inline">
              Фон вместо прозрачности
              <input type="color" className="ie-color-input" value={background} onChange={(e) => setBackground(e.target.value)} />
            </label>
          )}
        </>
      )}
      {kind === "psd" && <p className="ie-note">Слои, их порядок, видимость, непрозрачность и режимы наложения сохранятся. Маски «запекаются» в пиксели, текст — растром.</p>}
      {kind === "cvxproj" && <p className="ie-note">Файл .cvxproj открывается здесь же через «Открыть» — со всеми слоями, масками и редактируемым текстом.</p>}
    </Modal>
  );
}

export function NumberDialog({
  title,
  label,
  initial,
  min,
  max,
  onApply,
  onClose,
}: {
  title: string;
  label: string;
  initial: number;
  min: number;
  max: number;
  onApply: (v: number) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="ie-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="ie-btn ie-btn--primary" onClick={() => onApply(v)} disabled={v < min || v > max}>
            Применить
          </button>
        </>
      }
    >
      <label className="ie-field">
        {label}
        <input type="number" className="ie-input" min={min} max={max} value={v} autoFocus onChange={(e) => setV(Number(e.target.value))} />
      </label>
    </Modal>
  );
}
