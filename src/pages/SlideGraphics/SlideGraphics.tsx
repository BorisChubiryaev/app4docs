import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import PresentationEditor from "./components/PresentationEditor";
import PresentationStart from "./presentation/PresentationStart";
import Thumb from "./components/TemplateThumb";
import { loadPhoto, type Presentation } from "./core/presentation";
import "./presentation/workspace.css";
import TemplateSettings from "./components/TemplateSettings";
import AnimationTimeline from "./components/AnimationTimeline";
import { FONT, isDark } from "./core/draw";
import { copyImage, download, even, renderImage, renderVideo } from "./core/export";
import { baseColor, renderFrame, stillTime } from "./core/render";
import type { Frame, Group, Scene, Template, Val } from "./core/types";
import { featuredIds, GROUPS, TEMPLATES, byId, newScene } from "./templates";
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

// ── Страница ──

const SlideGraphics: React.FC = () => {
  const [view, setView] = useState<"catalog" | "editor" | "presentation">("catalog");
  const [project, setProject] = useState<{ deck: Presentation; initialObject?: string } | null>(null);
  const deck = project?.deck ?? null;
  const [deckDirty, setDeckDirty] = useState(false);
  const [session, setSession] = useState(0);
  const [group, setGroup] = useState<Group | "all">("all");
  const [query, setQuery] = useState("");
  const catalogCard = useRef<string | null>(null);
  const editorTitle = useRef<HTMLHeadingElement>(null);
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

  useEffect(() => {
    if (view === "editor") {
      window.scrollTo(0, 0);
      editorTitle.current?.focus({ preventScroll: true });
    } else if (view === "catalog" && catalogCard.current) {
      document.getElementById(catalogCard.current)?.focus();
    }
  }, [view]);

  const open = (id: string) => {
    catalogCard.current = `sg-card-${id}`;
    setHovered(null);
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
      const bw = Math.max(1, el.clientWidth - 24);
      const bh = Math.max(1, el.clientHeight - 24);
      const k = Math.min(bw / out.w, bh / out.h);
      setStageSize({ w: Math.max(1, Math.floor(out.w * k)), h: Math.max(1, Math.floor(out.h * k)) });
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
    const loaded = await Promise.allSettled(Array.from(files).filter(f => f.type.startsWith("image/")).map(loadPhoto));
    setImages(prev => [...prev, ...loaded.flatMap(result => result.status === "fulfilled" ? [result.value] : [])]);
  };
  const removePhoto = (index: number) => setImages(prev => prev.filter((_, i) => i !== index));

  // ── Выгрузка ──
  const exportSize = custom ? { w: even(long), h: even(long / (out.w / out.h)) } : sizeOf(aspect, long);
  const exportFollow: Frame["follow"] = pinned ? follow : null;
  const exportFollowAt = recorded ? (t: number) => (ago: number) => sampleAt(recorded, t - ago) : undefined;
  const exportStill = (w: number, h: number, type: "image/png" | "image/jpeg") => {
    const t = stillTime(tpl, dur, timeRef.current);
    return renderImage(scene, tpl, images, w, h, t, dur, type, exportFollowAt ? exportFollowAt(t) : exportFollow);
  };
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
        const blob = await exportStill(w, h, type);
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

  const search = query.trim().toLocaleLowerCase("ru");
  const shown = TEMPLATES.filter(t => (group === "all" || t.group === group)
    && `${t.name} ${t.about}`.toLocaleLowerCase("ru").includes(search));
  const featured = shown.filter(t => featuredIds.has(t.id));
  const library = shown.filter(t => !featuredIds.has(t.id));
  const transparent = !tpl.ownBackground && scene.background.kind === "transparent";
  const stageBackdrop = backdrop ?? autoBackdrop(scene);
  const previewDark = transparent ? stageBackdrop === "dark" : isDark(baseColor(scene, tpl) ?? "#ffffff");
  const fmtLabel = FORMATS.find((x) => x[0] === format)![1];

  const renderCard = (t: Template) => (
    <button key={t.id} id={`sg-card-${t.id}`} className="sg-card ds-card" onClick={() => open(t.id)} onMouseEnter={() => setHovered(t.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(t.id)} onBlur={() => setHovered(null)}>
      <div className="sg-card__pic" aria-hidden="true">
        <Thumb tpl={t} scene={scenes[t.id]} duration={durs[t.id]} images={images} {...sizeOf(aspect, 720)} hover={hovered === t.id} />
        <div className="sg-card__tags">
          {t.loop && <span>Петля</span>}
          {t.interactive && <span>За курсором</span>}
        </div>
      </div>
      <div className="sg-card__body">
        <strong>{t.name}</strong>
        <span>{t.about}</span>
      </div>
    </button>
  );

  return (
    <PageShell title="Графика для слайдов" width={1440} onShowInstructions={() => setShowHelp(true)}>
      {deck && <PresentationEditor key={session} deck={deck} initialObject={project?.initialObject} active={view === "presentation"} onBack={() => setView("catalog")} onDirty={setDeckDirty} />}
      {view === "presentation" ? null : view === "catalog" ? (
        <div className="sg-studio sg-catalog">
          <PresentationStart previous={deck} dirty={deckDirty}
            onResume={() => setView("presentation")}
            onOpen={(file, initialObject) => { catalogCard.current = null; setProject({ deck: file, initialObject }); setDeckDirty(false); setSession(n => n + 1); setView("presentation"); }} />
          <section className="sg-library-tools">
            <h2 className="ds-section-title sg-section-head">Создать отдельную графику</h2>
            <section className="ds-panel sg-filters" aria-label="Поиск и фильтры">
              <div className="sg-search-row">
                <input className="ds-input sg-search" type="search" aria-label="Поиск инструментов" placeholder="Найти инструмент" value={query} onChange={e => setQuery(e.target.value)} />
                <label className="sg-category-picker">
                  <span id="sg-category-label">Категория</span>
                  <select className="ds-select" aria-labelledby="sg-category-label" value={group} onChange={e => setGroup(e.target.value as Group | "all")}>
                    {GROUPS.map(([g, name]) => <option key={g} value={g}>{name}</option>)}
                  </select>
                </label>
                <label className="sg-aspect">
                  <span id="sg-aspect-label">Формат кадра</span>
                  <select className="ds-select" aria-labelledby="sg-aspect-label" value={aspect} onChange={e => setAspect(e.target.value)}>
                    {ASPECTS.map(([a]) => <option key={a}>{a}</option>)}
                  </select>
                </label>
              </div>
              <div className="sg-categories ds-tabs" role="group" aria-label="Категории шаблонов">
                {GROUPS.map(([g, l]) => (
                  <button key={g} aria-pressed={group === g} className={`ds-tab${group === g ? " ds-tab--active" : ""}`} onClick={() => setGroup(g)}>
                    {l}
                  </button>
                ))}
              </div>
            </section>
          </section>
          {featured.length > 0 && (
            <section aria-labelledby="sg-new-title">
              <h2 className="ds-section-title sg-section-head" id="sg-new-title">Новые инструменты</h2>
              <div className="sg-grid sg-grid--new">{featured.map(renderCard)}</div>
            </section>
          )}
          {library.length > 0 && (
            <section aria-labelledby="sg-library-title">
              <h2 className="ds-section-title sg-section-head" id="sg-library-title">Библиотека шаблонов</h2>
              <div className="sg-grid">{library.map(renderCard)}</div>
            </section>
          )}
          {shown.length === 0 && (
            <div className="ds-panel sg-empty">
              <p role="status">Инструменты по вашему запросу не найдены.</p>
              <button className="btn-secondary" onClick={() => { setQuery(""); setGroup("all"); }}>Сбросить фильтры</button>
            </div>
          )}
        </div>
      ) : (
        <div className="sg-studio sg-editor">
          <div className="sg-editor-heading">
            <button className="ds-nav-btn" onClick={() => setView("catalog")}>← Каталог</button>
            <div>
              <h2 tabIndex={-1} ref={editorTitle}>{tpl.name}</h2>
              <p>{tpl.about}</p>
            </div>
          </div>
          <aside className="sg-panel ds-panel" aria-label="Настройки шаблона">
            <TemplateSettings {...{ tpl, scene, images, previewDark, update, addPhotos, removePhoto }} />
          </aside>

          <section className={`sg-stage ${previewDark ? "is-dark" : ""}`} aria-label="Холст и экспорт">
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
                  <button className="btn-primary" onClick={() => setShowExport((v) => !v)} aria-expanded={showExport}>
                    Экспорт · {fmtLabel} <span aria-hidden="true">▾</span>
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
                        <button className="btn-primary" disabled={busy !== null} onClick={() => save(false)}>
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

            <div className="sg-canvas-wrap" ref={stageRef}>
              <canvas
                aria-label={`Предпросмотр: ${tpl.name}`}
                ref={canvasRef}
                style={{ width: stageSize.w, height: stageSize.h, background: transparent ? BACKDROP[stageBackdrop] : undefined, cursor: tpl.interactive ? (pinned ? "pointer" : "crosshair") : undefined }}
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
              <AnimationTimeline playing={playing} time={time} duration={dur} onRestart={restart}
                onPlay={() => playing ? setPlaying(false) : time >= dur && !tpl.loop ? restart() : setPlaying(true)}
                onSeek={t => { setPlaying(false); timeRef.current = t; setTime(t); draw(t); }}
                clip={{ duration: dur, onChange: next => {
                  timeRef.current = Math.min(timeRef.current, next);
                  setTime(timeRef.current);
                  setDurs(d => ({ ...d, [tplId]: next }));
                } }} />
            </div>
          </section>
        </div>
      )}
      <InstructionsModalShell isOpen={showHelp} onClose={() => setShowHelp(false)} title="Графика для слайдов" footerLabel="Понятно!" maxWidth={720}>
        {view !== "editor" && <div className="instructions-section">
          <h3>Работа со своей презентацией</h3>
          <ol>
            {view === "catalog" && <li>Нажмите «Открыть PPTX» или «Попробовать на примере».</li>}
            <li>Выберите миниатюру и нажмите на объект прямо на слайде. Его также можно выбрать в списке элементов.</li>
            <li>Для текста доступны правка надписи, кегль и цвет. Для диаграммы можно сменить палитру с сохранением исходных рядов или выбрать графический шаблон.</li>
            <li>Кнопка «Добавить графику» вставляет новый объект. Его можно перетащить и изменить размер за угловой маркер.</li>
            <li>«Сравнить с оригиналом» показывает исходный вид. «Скачать PPTX» сохраняет копию со всеми правками.</li>
          </ol>
          <p>Анимация шаблона запускается прямо на слайде. Под ним можно поставить её на паузу или повторить. В скачанной презентации откройте режим показа в настольном PowerPoint. Для сохранения одного кадра выключите «Анимация в PPTX».</p>
        </div>}
        {view !== "presentation" && <>
          <div className="instructions-section">
            <h3>Создание отдельной графики</h3>
            <ol>
              <li>Выберите шаблон в каталоге — при наведении он показывает анимацию.</li>
              <li>В панели настроек впишите свои числа или вставьте диапазон из Excel, добавьте фразы или фото.</li>
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
        </>}
        <div className="instructions-section">
          <h3>Конфиденциальность</h3>
          <p>Всё рисуется в браузере, данные и фото никуда не отправляются. Ограничений на число картинок и видео нет.</p>
        </div>
      </InstructionsModalShell>
    </PageShell>
  );
};

export default SlideGraphics;
