import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import RowsEditor from "./components/RowsEditor";
import { FONT, isDark } from "./core/draw";
import { copyImage, download, even, renderImage, renderVideo } from "./core/export";
import { SAFE_DARK, SAFE_LIGHT, baseColor, renderFrame, stillTime } from "./core/render";
import type { Control, Frame, Group, Row, Scene, Template, Val } from "./core/types";
import { BG_PRESETS } from "./templates/scenes";
import { GROUPS, PALETTES, TEMPLATES, byId, newScene } from "./templates";
import "./SlideGraphics.css";

// Графика для слайдов: анимированные графики, фразы, фоны и карточки.
// Всё рисуется на canvas в браузере; картинка — любого размера с прозрачным
// фоном, видео — MP4 (H.264), которое вставляется в PowerPoint и Keynote.

type Images = HTMLImageElement[];
type Sample = { at: number; x: number; y: number };

/** Положение курсора в момент at по записанному пути (с интерполяцией) */
function sampleAt(list: Sample[], at: number): [number, number] {
  if (!list.length) return [0.5, 0.5];
  if (at <= list[0].at) return [list[0].x, list[0].y];
  for (let i = list.length - 1; i > 0; i--) {
    if (list[i - 1].at <= at) {
      const a = list[i - 1];
      const b = list[i];
      const k = Math.min(1, (at - a.at) / (b.at - a.at || 1));
      return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
    }
  }
  const last = list[list.length - 1];
  return [last.x, last.y];
}
type Backdrop = "light" | "dark";

const ASPECTS: [string, number, number][] = [
  ["16:9", 16, 9],
  ["4:3", 4, 3],
  ["1:1", 1, 1],
  ["4:5", 4, 5],
  ["9:16", 9, 16],
  ["21:9", 21, 9],
];
const SIZES: [string, number][] = [
  ["Full HD · 1920", 1920],
  ["2K · 2560", 2560],
  ["4K · 3840", 3840],
];
/** Поля, которые относятся к содержанию, — в разделе «Данные» */
const DATA_KEYS = new Set(["title", "subtitle", "value", "caption", "delta", "center", "s1", "s2", "prefix", "unit", "decimals", "text"]);
const FORMATS = [
  ["png", "PNG", "прозрачный фон"],
  ["jpeg", "JPEG", "с фоном"],
  ["mp4", "Видео MP4", "для PowerPoint"],
] as const;
type Format = (typeof FORMATS)[number][0];

const sizeOf = (aspect: string, long: number) => {
  const [, a, b] = ASPECTS.find((x) => x[0] === aspect) ?? ASPECTS[0];
  return a >= b ? { w: even(long), h: even((long * b) / a) } : { w: even((long * a) / b), h: even(long) };
};
const fileName = (tpl: Template, w: number, h: number, ext: string) => `${tpl.name.replace(/[\\/:*?"<>|]+/g, "_")}-${w}x${h}.${ext}`;

/** Подложка просмотра под прозрачным фоном: под цвет текста шаблона */
const autoBackdrop = (scene: Scene): Backdrop => (scene.ink === "light" ? "dark" : "light");
const BACKDROP: Record<Backdrop, string> = { light: "#eceef3", dark: "#16181f" };

// ── Превью в каталоге: стоп-кадр, при наведении — анимация ──

const Thumb: React.FC<{ tpl: Template; scene: Scene; images: Images; aspect: string; hover: boolean }> = ({ tpl, scene, images, aspect, hover }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = sizeOf(aspect, 720);
  const transparent = !tpl.ownBackground && scene.background.kind === "transparent";
  const drawAt = useCallback(
    (t: number) => {
      const c = ref.current;
      if (!c) return;
      renderFrame(c.getContext("2d")!, w, h, t, scene, tpl, images, tpl.duration, transparent ? BACKDROP[autoBackdrop(scene)] : undefined);
    },
    [w, h, scene, tpl, images, transparent],
  );
  useEffect(() => {
    if (!hover) {
      drawAt(stillTime(tpl, tpl.duration, tpl.duration * 0.3));
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      drawAt((performance.now() - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover, drawAt, tpl]);
  return <canvas ref={ref} width={w} height={h} className="sg-thumb" />;
};

// ── Поле настройки ──

const Field: React.FC<{ c: Control; value: Val | undefined; onChange: (v: Val) => void }> = ({ c, value, onChange }) => {
  switch (c.type) {
    case "text":
      return (
        <label className="sg-field">
          <span className="sg-field__label">{c.label}</span>
          <input value={String(value ?? "")} placeholder={c.placeholder} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
          <input
            type="number"
            value={Number.isFinite(Number(value)) ? Number(value) : 0}
            min={c.min}
            max={c.max}
            step={c.step ?? "any"}
            onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </label>
      );
    case "range":
      return (
        <label className="sg-field">
          <span className="sg-field__label">
            {c.label}
            <b>{`${value}${c.unit ?? ""}`}</b>
          </span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={Number(value ?? c.min)}
            style={{ "--k": `${((Number(value ?? c.min) - c.min) / (c.max - c.min || 1)) * 100}%` } as React.CSSProperties}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </label>
      );
    case "select":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {c.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      );
    case "toggle":
      return (
        <label className="sg-switch">
          <span className="sg-field__label">{c.label}</span>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <i aria-hidden="true" />
        </label>
      );
    case "color":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
          <span className="sg-colorpick">
            <input type="color" value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />
            <code>{String(value ?? "")}</code>
          </span>
        </label>
      );
  }
};

const Section: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open = true }) => (
  <details className="sg-sec" open={open}>
    <summary>{title}</summary>
    <div className="sg-sec__body">{children}</div>
  </details>
);

// ── Страница ──

const SlideGraphics: React.FC = () => {
  const [view, setView] = useState<"catalog" | "editor">("catalog");
  const [group, setGroup] = useState<Group | "all">("all");
  const [scenes, setScenes] = useState<Record<string, Scene>>(() => Object.fromEntries(TEMPLATES.map((t) => [t.id, newScene(t)])));
  const [tplId, setTplId] = useState(TEMPLATES[0].id);
  const [images, setImages] = useState<Images>([]);
  const [aspect, setAspect] = useState("16:9");
  const [hovered, setHovered] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [durs, setDurs] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<Format>("png");
  const [long, setLong] = useState(1920);
  const [custom, setCustom] = useState(false);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  // Закреплённое положение: путь мыши до момента клика. Лента-змейка — это
  // модель верёвки, которая каждый кадр пересчитывается по последним секундам
  // движения; если запомнить только точку, верёвка распрямится. С путём форма
  // замирает ровно такой, какой была в момент клика.
  const [pinned, setPinned] = useState<{ at: number; list: Sample[] } | null>(null);
  const [following, setFollowing] = useState(false);
  // Запись движения для видео: путь мыши во времени ролика (0…dur)
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Sample[] | null>(null);
  const recRef = useRef<Sample[]>([]);
  const recordingRef = useRef(false);

  const tpl = byId(tplId);
  const scene = scenes[tplId];
  const dur = durs[tplId] ?? tpl.duration;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const samples = useRef<Sample[]>([]);
  const [stageSize, setStageSize] = useState({ w: 960, h: 540 });

  // Шрифт Inter должен загрузиться до первой отрисовки, иначе canvas возьмёт запасной
  useEffect(() => {
    Promise.all([400, 500, 600, 700, 800, 900].map((wgt) => document.fonts.load(`${wgt} 40px ${FONT}`)))
      .catch(() => undefined)
      .then(() => setFontsReady((n) => n + 1));
  }, []);

  // Освобождаем загруженные фото
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.src)), [images]);

  // Всплывающее меню выгрузки закрывается кликом мимо
  useEffect(() => {
    if (!showExport) return;
    const close = (e: PointerEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setShowExport(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [showExport]);

  const update = (patch: Partial<Scene>) => setScenes((all) => ({ ...all, [tplId]: { ...all[tplId], ...patch } }));
  const setParam = (k: string, v: Val) => update({ params: { ...scene.params, [k]: v } });

  const open = (id: string) => {
    setTplId(id);
    setView("editor");
    timeRef.current = 0;
    setTime(0);
    setPlaying(true);
    setMsg("");
    setPinned(null);
    setFollowing(false);
    samples.current = [];
    stopRecording(null);
    setBackdrop(null);
    setShowExport(false);
  };

  // ── Курсор для живых шаблонов ──
  const follow = useMemo<Frame["follow"]>(() => {
    // Записанное движение проигрывается вместе с роликом
    if (recorded && !recording) return (ago: number) => sampleAt(recorded, timeRef.current - ago);
    if (pinned) return (ago: number) => sampleAt(pinned.list, pinned.at - ago);
    if (!following) return null;
    return (ago: number) => sampleAt(samples.current, performance.now() / 1000 - ago);
  }, [pinned, following, recorded, recording]);

  function stopRecording(list: Sample[] | null) {
    recordingRef.current = false;
    setRecording(false);
    setRecorded(list && list.length > 1 ? list : null);
  }
  const startRecording = () => {
    setPinned(null);
    setRecorded(null);
    samples.current = [];
    recRef.current = [];
    recordingRef.current = true;
    setRecording(true);
    setFollowing(true);
    timeRef.current = 0;
    setTime(0);
    setPlaying(true);
  };

  const pointerAt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as [number, number];
  };
  const onMove = (e: React.PointerEvent) => {
    if (!tpl.interactive || pinned) return;
    const [x, y] = pointerAt(e);
    const now = performance.now() / 1000;
    samples.current.push({ at: now, x, y });
    if (recordingRef.current) recRef.current.push({ at: timeRef.current, x, y });
    while (samples.current.length > 2 && samples.current[0].at < now - 5) samples.current.shift();
    if (!following) {
      setFollowing(true);
      setPlaying(true);
    }
  };
  const onClick = (e: React.PointerEvent) => {
    if (!tpl.interactive || recording) return;
    if (recorded) setRecorded(null);
    if (pinned) {
      setPinned(null);
      setFollowing(true);
      return;
    }
    const [x, y] = pointerAt(e);
    const now = performance.now() / 1000;
    samples.current.push({ at: now, x, y });
    if (samples.current.length < 2) {
      // Мышь ещё не водили — сначала начинаем следить, закрепить можно следующим кликом
      setFollowing(true);
      setPlaying(true);
      return;
    }
    setPinned({ at: now, list: samples.current.map((p) => ({ ...p })) });
  };

  // ── Размер сцены под область просмотра ──
  const out = sizeOf(aspect, 1920);
  useEffect(() => {
    if (view !== "editor") return;
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const bw = el.clientWidth - 64;
      const bh = el.clientHeight - 150;
      const k = Math.min(bw / out.w, bh / out.h);
      setStageSize({ w: Math.max(80, Math.floor(out.w * k)), h: Math.max(45, Math.floor(out.h * k)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, out.w, out.h]);

  // ── Проигрывание ──
  const draw = useCallback(
    (t: number) => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(stageSize.w * dpr);
      const h = Math.round(stageSize.h * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      renderFrame(c.getContext("2d")!, w, h, t, scene, tpl, images, dur, undefined, follow);
    },
    [stageSize, scene, tpl, images, dur, follow],
  );

  useEffect(() => {
    if (view !== "editor") return;
    if (!playing) {
      draw(timeRef.current);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const tick = (now: number) => {
      // Метка кадра бывает чуть раньше старта цикла — время не должно уходить в минус
      timeRef.current = Math.max(0, timeRef.current + (now - last) / 1000);
      last = now;
      // Запись движения идёт ровно один проход ролика, потом он проигрывается с начала
      if (recordingRef.current && timeRef.current >= dur) {
        stopRecording(recRef.current.slice());
        setFollowing(false);
        timeRef.current = 0;
      }
      if (!tpl.loop && timeRef.current >= dur) {
        timeRef.current = dur;
        draw(dur);
        setTime(dur);
        setPlaying(false);
        return;
      }
      if (tpl.loop) timeRef.current %= dur;
      draw(timeRef.current);
      if (now - shown > 66) {
        shown = now;
        setTime(timeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view, playing, draw, dur, tpl.loop, fontsReady]);

  const restart = () => {
    timeRef.current = 0;
    setTime(0);
    setPlaying(true);
  };

  // ── Фото ──
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const loaded: Images = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const img = new Image();
      img.src = URL.createObjectURL(f);
      try {
        await img.decode();
        loaded.push(img);
      } catch {
        URL.revokeObjectURL(img.src);
      }
    }
    setImages((prev) => [...prev, ...loaded]);
  };
  const removePhoto = (i: number) =>
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].src);
      return prev.filter((_, j) => j !== i);
    });

  // ── Выгрузка ──
  const exportSize = custom ? { w: even(long), h: even(long / (out.w / out.h)) } : sizeOf(aspect, long);
  const exportFollow: Frame["follow"] = pinned ? follow : null;
  const exportFollowAt = recorded ? (t: number) => (ago: number) => sampleAt(recorded, t - ago) : undefined;
  const save = async (copy = false) => {
    setMsg("");
    const { w, h } = exportSize;
    try {
      if (format === "mp4" && !copy) {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy(0);
        setPlaying(false);
        const fallback = baseColor(scene, tpl) ?? "#ffffff";
        const { blob, ext } = await renderVideo(scene, tpl, images, { w, h, fps, dur, fallbackBase: fallback, onProgress: setBusy, signal: ac.signal, follow: exportFollow, followAt: exportFollowAt });
        download(blob, fileName(tpl, even(w), even(h), ext));
        setMsg(ext === "mp4" ? "Видео сохранено — вставьте его в PowerPoint или Keynote." : "Браузер записал WebM — для PowerPoint лучше Chrome или Edge последней версии.");
      } else {
        const type = format === "jpeg" && !copy ? "image/jpeg" : "image/png";
        const blob = await renderImage(scene, tpl, images, w, h, stillTime(tpl, dur, timeRef.current), dur, type, exportFollowAt ? exportFollowAt(stillTime(tpl, dur, timeRef.current)) : exportFollow);
        if (copy) {
          await copyImage(blob);
          setMsg("Картинка в буфере — вставьте в слайд (Ctrl+V).");
        } else {
          download(blob, fileName(tpl, w, h, type === "image/png" ? "png" : "jpg"));
          setMsg("Картинка сохранена.");
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setMsg("Запись остановлена.");
      else setMsg(`Не получилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  const shown = useMemo(() => TEMPLATES.filter((t) => group === "all" || t.group === group), [group]);
  const dataControls = tpl.controls.filter((c) => DATA_KEYS.has(c.key));
  const lookControls = tpl.controls.filter((c) => !DATA_KEYS.has(c.key) && (!c.when || c.when(scene.params)));
  // Выбор палитры: шаблон может переключить свои цвета на неё
  const pickPalette = (pal: string[], auto: boolean) =>
    update({ palette: [...pal], paletteAuto: auto, params: { ...scene.params, ...(tpl.onPalette?.(scene.params, pal) ?? {}) } });
  const transparent = !tpl.ownBackground && scene.background.kind === "transparent";
  const cardTpl = ["carousel", "deck", "flow"].includes(tpl.id);
  const usesPhrases = tpl.input === "phrases" || cardTpl;
  const usesRows = tpl.input === "rows" || tpl.input === "pairs" || tpl.input === "people";
  const usesPhotos = tpl.input === "photos" || tpl.input === "people";
  const stageBackdrop = backdrop ?? autoBackdrop(scene);
  const previewDark = transparent ? stageBackdrop === "dark" : isDark(baseColor(scene, tpl) ?? "#ffffff");
  const fmtLabel = FORMATS.find((x) => x[0] === format)![1];
  const autoPal = previewDark ? SAFE_DARK : SAFE_LIGHT;

  return (
    <PageShell title="Графика для слайдов" onShowInstructions={() => setShowHelp(true)} width={1480} fill={view === "editor"}>
      {view === "catalog" ? (
        <div className="sg-catalog">
          <header className="sg-hero">
            <h2>
              Графика, которая <span>оживает</span> на слайде
            </h2>
            <p>Выберите шаблон, впишите свои числа или фразы и заберите картинку без фона в 4K или видео MP4. Бесплатно и без ограничений — всё считается в браузере.</p>
          </header>
          <div className="sg-filters">
            <div className="sg-tray" role="tablist">
              {GROUPS.map(([g, l]) => (
                <button key={g} role="tab" aria-selected={group === g} className={group === g ? "is-on" : ""} onClick={() => setGroup(g)}>
                  {l}
                  <small>{g === "all" ? TEMPLATES.length : TEMPLATES.filter((t) => t.group === g).length}</small>
                </button>
              ))}
            </div>
            <div className="sg-tray sg-tray--mono" role="radiogroup" aria-label="Формат кадра">
              {ASPECTS.slice(0, 5).map(([a]) => (
                <button key={a} role="radio" aria-checked={aspect === a} className={aspect === a ? "is-on" : ""} onClick={() => setAspect(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="sg-grid">
            {shown.map((t) => (
              <button key={t.id} className="sg-card" onClick={() => open(t.id)} onMouseEnter={() => setHovered(t.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(t.id)} onBlur={() => setHovered(null)}>
                <div className="sg-card__pic">
                  <Thumb tpl={t} scene={scenes[t.id]} images={images} aspect={aspect} hover={hovered === t.id} />
                  <div className="sg-card__tags">
                    {t.loop && <span>петля</span>}
                    {t.interactive && <span>за курсором</span>}
                  </div>
                </div>
                <div className="sg-card__body">
                  <strong>{t.name}</strong>
                  <span>{t.about}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="sg-editor">
          <aside className="sg-panel">
            <button className="sg-back" onClick={() => setView("catalog")}>
              ← Каталог
            </button>
            <h2 className="sg-panel__title">{tpl.name}</h2>
            <p className="sg-panel__about">{tpl.about}</p>

            {(dataControls.length > 0 || usesRows || usesPhotos || usesPhrases) && (
              <Section title="Данные">
                {dataControls.map((c) => (
                  <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
                ))}
                {usesRows && <RowsEditor input={tpl.input} rows={scene.rows} names={[String(scene.params.s1 ?? ""), String(scene.params.s2 ?? "")]} onChange={(rows: Row[]) => update({ rows })} />}
                {usesPhotos && (
                  <div className="sg-photos">
                    <div className="sg-photos__head">
                      <span className="sg-field__label">{tpl.input === "people" ? "Фото — по порядку строк" : "Фото"}</span>
                      <label className="sg-btn sg-btn--sm">
                        ＋ Добавить
                        <input type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
                      </label>
                    </div>
                    {images.length ? (
                      <>
                      {cardTpl && <p className="sg-hint">Подписи ниже ложатся на фото по порядку. Если подписей больше, чем фото, — остальные карточки будут цветными.</p>}
                      <div className="sg-photos__list">
                        {images.map((img, i) => (
                          <div key={img.src} className="sg-photo">
                            <img src={img.src} alt="" />
                            <button onClick={() => removePhoto(i)} aria-label="Убрать фото">
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      </>
                    ) : (
                      <p className="sg-hint">{tpl.id === "glass" ? "Без фото под стеклом — цветные пятна." : "Без фото — цветные карточки с подписями."} Фото остаются только в вашем браузере.</p>
                    )}
                  </div>
                )}
                {usesPhrases && (
                  <label className="sg-field">
                    <span className="sg-field__label">{cardTpl ? "Подписи карточек — по одной в строке, вторая часть после «|»" : "Фразы — по одной в строке, вторая часть после «|»"}</span>
                    <textarea rows={6} value={scene.phrases.join("\n")} onChange={(e) => update({ phrases: e.target.value.split("\n") })} />
                  </label>
                )}
              </Section>
            )}

            {lookControls.length > 0 && (
              <Section title="Вид">
                {tpl.ownBackground && !["cover", "spiral", "magnet"].includes(tpl.id) && (
                  <div className="sg-presets">
                    {BG_PRESETS.map(([name, base, pal]) => (
                      <button
                        key={name}
                        className="sg-preset"
                        style={{ background: `radial-gradient(circle at 28% 30%, ${pal[0]}, transparent 62%), radial-gradient(circle at 76% 72%, ${pal[1]}, transparent 60%), ${base}` }}
                        onClick={() => update({ palette: [...pal], paletteAuto: false, params: { ...scene.params, base } })}
                      >
                        <span>{name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {lookControls.map((c) => (
                  <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
                ))}
              </Section>
            )}

            <Section title="Цвета">
              <div className="sg-pals">
                <button className={`sg-pal ${scene.paletteAuto ? "is-on" : ""}`} onClick={() => pickPalette(autoPal, true)} title="Проверенная палитра: цвета различимы, в том числе при нарушениях цветовосприятия">
                  <span className="sg-pal__dots">
                    {autoPal.slice(0, 5).map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  Проверенная
                </button>
                {PALETTES.map(([name, pal]) => (
                  <button key={name} className={`sg-pal ${!scene.paletteAuto && scene.palette.join() === pal.join() ? "is-on" : ""}`} onClick={() => pickPalette(pal, false)}>
                    <span className="sg-pal__dots">
                      {pal.map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    {name}
                  </button>
                ))}
              </div>
              {!scene.paletteAuto && (
                <div className="sg-swatches">
                  {scene.palette.map((c, i) => (
                    <span key={i} className="sg-swatch">
                      <input type="color" value={c} onChange={(e) => update({ palette: scene.palette.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Цвет ${i + 1}`} />
                      {scene.palette.length > 1 && (
                        <button onClick={() => update({ palette: scene.palette.filter((_, j) => j !== i) })} aria-label="Убрать цвет">
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                  {scene.palette.length < 8 && (
                    <button className="sg-btn sg-btn--sm" onClick={() => update({ palette: [...scene.palette, scene.palette[scene.palette.length - 1] ?? "#4f6ef7"] })}>
                      ＋
                    </button>
                  )}
                </div>
              )}
            </Section>

            {!tpl.ownBackground && (
              <Section title="Фон">
                <div className="sg-chips">
                  {(
                    [
                      ["transparent", "Прозрачный"],
                      ["white", "Белый"],
                      ["light", "Светлый"],
                      ["dark", "Тёмный"],
                      ["custom", "Свой"],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} className={scene.background.kind === k ? "is-on" : ""} onClick={() => update({ background: { ...scene.background, kind: k } })}>
                      {k !== "transparent" && <i style={{ background: k === "custom" ? scene.background.color : k === "white" ? "#fff" : k === "light" ? "#f4f5f8" : "#0e1016" }} />}
                      {l}
                    </button>
                  ))}
                </div>
                {scene.background.kind === "custom" && (
                  <label className="sg-field sg-field--row">
                    <span className="sg-field__label">Цвет фона</span>
                    <span className="sg-colorpick">
                      <input type="color" value={scene.background.color} onChange={(e) => update({ background: { kind: "custom", color: e.target.value } })} />
                      <code>{scene.background.color}</code>
                    </span>
                  </label>
                )}
                <label className="sg-field sg-field--row">
                  <span className="sg-field__label">Цвет текста</span>
                  <select value={scene.ink} onChange={(e) => update({ ink: e.target.value as Scene["ink"] })}>
                    <option value="auto">По фону</option>
                    <option value="dark">Тёмный — для светлых слайдов</option>
                    <option value="light">Светлый — для тёмных слайдов</option>
                  </select>
                </label>
              </Section>
            )}
            <button className="sg-reset" onClick={() => update(newScene(tpl))}>
              Вернуть настройки шаблона
            </button>
          </aside>

          <section className={`sg-stage ${previewDark ? "is-dark" : ""}`} ref={stageRef}>
            <div className="sg-stage__top">
              <div className="sg-tray sg-tray--mono" role="radiogroup" aria-label="Формат кадра">
                {ASPECTS.map(([a]) => (
                  <button key={a} role="radio" aria-checked={aspect === a} className={aspect === a ? "is-on" : ""} onClick={() => setAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
              <div className="sg-stage__actions">
                {transparent && (
                  <button className="sg-ghost" onClick={() => setBackdrop(stageBackdrop === "dark" ? "light" : "dark")} title="Подложка только для просмотра — при выгрузке PNG фон прозрачный">
                    {stageBackdrop === "dark" ? "☀ Светлая подложка" : "☾ Тёмная подложка"}
                  </button>
                )}
                {tpl.shuffle && (
                  <button className="sg-ghost" onClick={() => setParam("seed", Math.floor(Math.random() * 1e6))}>
                    ⟳ Перемешать
                  </button>
                )}
                <div className="sg-export" ref={exportRef}>
                  <button className="sg-primary" onClick={() => setShowExport((v) => !v)} aria-expanded={showExport}>
                    ⬇ {fmtLabel} <span aria-hidden="true">▾</span>
                  </button>
                  {showExport && (
                    <div className="sg-pop" role="dialog" aria-label="Выгрузка">
                      <div className="sg-pop__formats">
                        {FORMATS.map(([k, l, d]) => (
                          <button key={k} className={format === k ? "is-on" : ""} onClick={() => setFormat(k)}>
                            <b>{l}</b>
                            <small>{d}</small>
                          </button>
                        ))}
                      </div>
                      <label className="sg-field sg-field--row">
                        <span className="sg-field__label">Размер</span>
                        <select
                          value={custom ? "custom" : String(long)}
                          onChange={(e) => {
                            if (e.target.value === "custom") setCustom(true);
                            else {
                              setCustom(false);
                              setLong(Number(e.target.value));
                            }
                          }}
                        >
                          {SIZES.map(([l, v]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                          <option value="custom">Своя ширина…</option>
                        </select>
                      </label>
                      {custom && (
                        <label className="sg-field sg-field--row">
                          <span className="sg-field__label">Ширина, px</span>
                          <input type="number" min={200} max={7680} value={long} onChange={(e) => setLong(Math.min(7680, Math.max(200, Number(e.target.value) || 1920)))} />
                        </label>
                      )}
                      {format === "mp4" && (
                        <label className="sg-field sg-field--row">
                          <span className="sg-field__label">Кадров в секунду</span>
                          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                            <option value={25}>25</option>
                            <option value={30}>30</option>
                            <option value={60}>60 — плавнее</option>
                          </select>
                        </label>
                      )}
                      <p className="sg-hint">
                        {exportSize.w} × {exportSize.h} px{format === "mp4" ? ` · ${dur} с` : tpl.loop ? " · текущий кадр" : " · финальный кадр"}
                      </p>
                      {format === "mp4" && transparent && <p className="sg-note">В видео нет прозрачности — фон будет белым. Выберите фон под слайд в разделе «Фон».</p>}
                      {format === "mp4" && tpl.loop && <p className="sg-hint">Ролик зациклен: включите в PowerPoint «Повторять до остановки».</p>}
                      {format === "mp4" && tpl.interactive && (
                        <p className="sg-hint">
                          {recorded ? "В видео войдёт записанное движение мыши." : pinned ? "В видео войдёт закреплённая форма." : "Чтобы в видео было ваше движение, нажмите под кадром «● Записать движение» и водите мышью один проход ролика."}
                        </p>
                      )}
                      {format === "png" && !transparent && !tpl.ownBackground && <p className="sg-hint">Для прозрачного PNG выберите фон «Прозрачный».</p>}
                      <div className="sg-pop__actions">
                        <button className="sg-primary" disabled={busy !== null} onClick={() => save(false)}>
                          {format === "mp4" ? "Записать видео" : "Скачать"}
                        </button>
                        {format !== "mp4" && (
                          <button className="sg-ghost" disabled={busy !== null} onClick={() => save(true)}>
                            Копировать
                          </button>
                        )}
                      </div>
                      {busy !== null && (
                        <div className="sg-progress">
                          <div className="sg-progress__bar">
                            <i style={{ width: `${Math.round(busy * 100)}%` }} />
                          </div>
                          <span>{Math.round(busy * 100)} %</span>
                          <button className="sg-ghost" onClick={() => abortRef.current?.abort()}>
                            Стоп
                          </button>
                        </div>
                      )}
                      {msg && <p className="sg-msg">{msg}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="sg-canvas-wrap" style={{ background: transparent ? BACKDROP[stageBackdrop] : undefined }}>
              <canvas
                ref={canvasRef}
                style={{ width: stageSize.w, height: stageSize.h, cursor: tpl.interactive ? (pinned ? "pointer" : "crosshair") : undefined }}
                onPointerMove={onMove}
                onPointerDown={onClick}
              />
            </div>

            <div className="sg-stage__bottom">
              {tpl.interactive && (
                <div className="sg-pill">
                  <i className={recording ? "is-rec" : pinned || recorded ? "is-pinned" : following ? "is-live" : ""} />
                  {recording
                    ? `Запись ${time.toFixed(1).replace(".", ",")} из ${dur} с — водите мышью по кадру`
                    : recorded
                      ? "Движение записано — так и будет в видео"
                      : pinned
                        ? "Закреплено · клик по кадру — снова следить"
                        : following
                          ? "Следует за курсором · клик закрепляет"
                          : tpl.interactive}
                  {!recording && (
                    <button className="sg-rec" onClick={startRecording} title="Ролик начнётся сначала; всё, что вы нарисуете мышью за один проход, попадёт в видео">
                      ● {recorded ? "Перезаписать" : "Записать движение"}
                    </button>
                  )}
                  {recording && (
                    <button
                      onClick={() => {
                        // Остановили раньше — ролик становится длиной с запись, без пустого хвоста
                        const len = Math.max(1, Math.ceil(timeRef.current * 2) / 2);
                        stopRecording(recRef.current.slice());
                        setFollowing(false);
                        setDurs((d) => ({ ...d, [tplId]: len }));
                        timeRef.current = 0;
                        setTime(0);
                      }}
                    >
                      Стоп
                    </button>
                  )}
                  {(following || pinned || recorded) && !recording && (
                    <button
                      onClick={() => {
                        setPinned(null);
                        setFollowing(false);
                        setRecorded(null);
                        samples.current = [];
                      }}
                    >
                      Авто
                    </button>
                  )}
                </div>
              )}
              <div className="sg-timeline">
                <button className="sg-play" onClick={() => (playing ? setPlaying(false) : time >= dur && !tpl.loop ? restart() : setPlaying(true))} aria-label={playing ? "Пауза" : "Воспроизвести"}>
                  {playing ? "❚❚" : "▶"}
                </button>
                <button className="sg-round" onClick={restart} aria-label="С начала" title="С начала">
                  ↺
                </button>
                <input
                  type="range"
                  min={0}
                  max={dur}
                  step={0.01}
                  value={time}
                  style={{ "--k": `${(time / dur) * 100}%` } as React.CSSProperties}
                  onChange={(e) => {
                    setPlaying(false);
                    timeRef.current = Number(e.target.value);
                    setTime(timeRef.current);
                    draw(timeRef.current);
                  }}
                  aria-label="Время"
                />
                <span className="sg-time">
                  {time.toFixed(1)} / {dur.toFixed(1)} с
                </span>
                <label className="sg-dur" title="Длительность ролика">
                  <input type="number" min={1} max={60} step={0.5} value={dur} onChange={(e) => setDurs((d) => ({ ...d, [tplId]: Math.min(60, Math.max(1, Number(e.target.value) || tpl.duration)) }))} />с
                </label>
              </div>
            </div>
          </section>
        </div>
      )}

      <InstructionsModalShell isOpen={showHelp} onClose={() => setShowHelp(false)} title="🎬 Графика для слайдов" footerLabel="Понятно!" maxWidth={720}>
        <div className="instructions-section">
          <h3>Как пользоваться</h3>
          <ol>
            <li>Выберите шаблон в каталоге — при наведении он показывает анимацию.</li>
            <li>Слева впишите свои числа или вставьте диапазон из Excel, добавьте фразы или фото.</li>
            <li>Настройте вид, цвета и фон. «Проверенная» палитра различима даже при нарушениях цветовосприятия.</li>
            <li>Кнопка справа вверху — выгрузка картинкой или видео нужного размера.</li>
          </ol>
        </div>
        <div className="instructions-section">
          <h3>Что можно сохранить</h3>
          <ul>
            <li>PNG с прозрачным фоном — ложится на любой слайд.</li>
            <li>JPEG с фоном, размер до 4K и больше (своя ширина до 7680 px).</li>
            <li>Видео MP4 — вставляется в PowerPoint и Keynote. Фоны и карусели зациклены без шва.</li>
            <li>«Копировать» кладёт картинку в буфер — сразу Ctrl+V в слайд.</li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>Живые шаблоны</h3>
          <p>«Лента-змейка» и «Магнитное поле» следуют за курсором. Клик по кадру закрепляет положение — так его и сохранит картинка или видео. Без курсора шаблон движется сам — так пишется видео по умолчанию.</p>
        </div>
        <div className="instructions-section">
          <h3>Конфиденциальность</h3>
          <p>Всё рисуется в браузере, данные и фото никуда не отправляются. Ограничений на число картинок и видео нет.</p>
        </div>
      </InstructionsModalShell>
    </PageShell>
  );
};

export default SlideGraphics;
