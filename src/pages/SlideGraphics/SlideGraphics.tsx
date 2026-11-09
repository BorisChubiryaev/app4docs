import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import RowsEditor from "./components/RowsEditor";
import { FONT } from "./core/draw";
import { copyImage, download, even, renderImage, renderVideo } from "./core/export";
import { baseColor, renderFrame, stillTime } from "./core/render";
import type { Control, Group, Row, Scene, Template, Val } from "./core/types";
import { BG_PRESETS } from "./templates/scenes";
import { GROUPS, PALETTES, TEMPLATES, byId, newScene } from "./templates";
import "./SlideGraphics.css";

// Графика для слайдов: анимированные графики, фразы, фоны и карточки.
// Всё рисуется на canvas в браузере; картинка — любого размера с прозрачным
// фоном, видео — MP4 (H.264), которое вставляется в PowerPoint и Keynote.

type Images = HTMLImageElement[];

const ASPECTS: [string, number, number][] = [
  ["16:9", 16, 9],
  ["4:3", 4, 3],
  ["1:1", 1, 1],
  ["4:5", 4, 5],
  ["9:16", 9, 16],
  ["21:9", 21, 9],
];
const SIZES: [string, number][] = [
  ["Full HD — 1920", 1920],
  ["2K — 2560", 2560],
  ["4K — 3840", 3840],
];
/** Поля, которые относятся к содержанию, — во вкладке «Данные» */
const DATA_KEYS = new Set(["title", "subtitle", "value", "caption", "delta", "center", "s1", "s2", "prefix", "unit", "decimals"]);

const sizeOf = (aspect: string, long: number) => {
  const [, a, b] = ASPECTS.find((x) => x[0] === aspect) ?? ASPECTS[0];
  return a >= b ? { w: even(long), h: even((long * b) / a) } : { w: even((long * a) / b), h: even(long) };
};
const fileName = (tpl: Template, w: number, h: number, ext: string) => `${tpl.name.replace(/[\\/:*?"<>|]+/g, "_")}-${w}x${h}.${ext}`;

// ── Превью в каталоге: стоп-кадр, при наведении — анимация ──

const Thumb: React.FC<{ tpl: Template; scene: Scene; images: Images; aspect: string }> = ({ tpl, scene, images, aspect }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const { w, h } = sizeOf(aspect, 640);
  const drawAt = useCallback(
    (t: number) => {
      const c = ref.current;
      if (!c) return;
      renderFrame(c.getContext("2d")!, w, h, t, scene, tpl, images, tpl.duration, tpl.ownBackground ? undefined : baseColor(scene, tpl) ?? undefined);
    },
    [w, h, scene, tpl, images],
  );
  useEffect(() => {
    drawAt(stillTime(tpl, tpl.duration, tpl.duration * 0.3));
  }, [drawAt, tpl]);
  const play = () => {
    const start = performance.now();
    const tick = () => {
      drawAt((performance.now() - start) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(raf.current);
    drawAt(stillTime(tpl, tpl.duration, tpl.duration * 0.3));
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return <canvas ref={ref} width={w} height={h} className="sg-thumb" onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} />;
};

// ── Поле настройки ──

const Field: React.FC<{ c: Control; value: Val | undefined; onChange: (v: Val) => void }> = ({ c, value, onChange }) => {
  switch (c.type) {
    case "text":
      return (
        <label className="sg-field">
          <span>{c.label}</span>
          <input value={String(value ?? "")} placeholder={c.placeholder} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="sg-field">
          <span>{c.label}</span>
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
          <span>
            {c.label} <b>{`${value}${c.unit ?? ""}`}</b>
          </span>
          <input type="range" min={c.min} max={c.max} step={c.step} value={Number(value ?? c.min)} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    case "select":
      return (
        <label className="sg-field">
          <span>{c.label}</span>
          <select className="ds-select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
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
        <label className="sg-check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {c.label}
        </label>
      );
    case "color":
      return (
        <label className="sg-field sg-field--row">
          <span>{c.label}</span>
          <input type="color" value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
};

// ── Страница ──

const SlideGraphics: React.FC = () => {
  const [view, setView] = useState<"catalog" | "editor">("catalog");
  const [group, setGroup] = useState<Group | "all">("all");
  const [scenes, setScenes] = useState<Record<string, Scene>>(() => Object.fromEntries(TEMPLATES.map((t) => [t.id, newScene(t)])));
  const [tplId, setTplId] = useState(TEMPLATES[0].id);
  const [images, setImages] = useState<Images>([]);
  const [aspect, setAspect] = useState("16:9");
  const [tab, setTab] = useState<"data" | "look" | "save">("data");
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [durs, setDurs] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<"png" | "jpeg" | "mp4">("png");
  const [long, setLong] = useState(1920);
  const [custom, setCustom] = useState(false);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [fontsReady, setFontsReady] = useState(0);

  const tpl = byId(tplId);
  const scene = scenes[tplId];
  const dur = durs[tplId] ?? tpl.duration;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [stageSize, setStageSize] = useState({ w: 960, h: 540 });

  // Шрифт Inter должен загрузиться до первой отрисовки, иначе canvas возьмёт запасной
  useEffect(() => {
    Promise.all([400, 500, 600, 700, 800].map((wgt) => document.fonts.load(`${wgt} 40px ${FONT}`)))
      .catch(() => undefined)
      .then(() => setFontsReady((n) => n + 1));
  }, []);

  // Освобождаем загруженные фото
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.src)), [images]);

  const update = (patch: Partial<Scene>) => setScenes((all) => ({ ...all, [tplId]: { ...all[tplId], ...patch } }));
  const setParam = (k: string, v: Val) => update({ params: { ...scene.params, [k]: v } });

  const open = (id: string) => {
    setTplId(id);
    setView("editor");
    setTab("data");
    timeRef.current = 0;
    setTime(0);
    setPlaying(true);
    setMsg("");
  };

  // ── Размер сцены под область просмотра ──
  const out = sizeOf(aspect, 1920);
  useEffect(() => {
    if (view !== "editor") return;
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const bw = el.clientWidth - 32;
      const bh = el.clientHeight - 32;
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
      renderFrame(c.getContext("2d")!, w, h, t, scene, tpl, images, dur);
    },
    [stageSize, scene, tpl, images, dur],
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
      timeRef.current += (now - last) / 1000;
      last = now;
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
        const { blob, ext } = await renderVideo(scene, tpl, images, { w, h, fps, dur, fallbackBase: fallback, onProgress: setBusy, signal: ac.signal });
        download(blob, fileName(tpl, even(w), even(h), ext));
        setMsg(ext === "mp4" ? "Видео сохранено — его можно вставить в PowerPoint и Keynote." : "Браузер записал WebM — для PowerPoint лучше открыть в Chrome или Edge последней версии.");
      } else {
        const type = format === "jpeg" && !copy ? "image/jpeg" : "image/png";
        const blob = await renderImage(scene, tpl, images, w, h, stillTime(tpl, dur, timeRef.current), dur, type);
        if (copy) {
          await copyImage(blob);
          setMsg("Картинка скопирована — вставьте её в слайд (Ctrl+V).");
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
  const lookControls = tpl.controls.filter((c) => !DATA_KEYS.has(c.key));
  const transparent = !tpl.ownBackground && scene.background.kind === "transparent";
  const usesPhrases = tpl.input === "phrases" || ((tpl.id === "carousel" || tpl.id === "deck") && !images.length);
  const usesRows = tpl.input === "rows" || tpl.input === "pairs" || tpl.input === "people";
  const usesPhotos = tpl.input === "photos" || tpl.input === "people";

  return (
    <PageShell
      title="Графика для слайдов"
      subtitle="Анимированные графики, фразы, фоны и карточки — картинкой с прозрачным фоном в 4K или видео MP4 для PowerPoint"
      onShowInstructions={() => setShowHelp(true)}
      width={1480}
      fill={view === "editor"}
    >
      {view === "catalog" ? (
        <div className="sg-catalog">
          <div className="sg-groups" role="tablist">
            {GROUPS.map(([g, l]) => (
              <button key={g} role="tab" aria-selected={group === g} className={`sg-chip ${group === g ? "is-on" : ""}`} onClick={() => setGroup(g)}>
                {l}
              </button>
            ))}
            <span className="sg-sep" />
            <label className="sg-inline">
              Формат кадра
              <select className="ds-select" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {ASPECTS.map(([a]) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="sg-grid">
            {shown.map((t) => (
              <button key={t.id} className="sg-card" onClick={() => open(t.id)}>
                <div className={`sg-card__pic ${!t.ownBackground && scenes[t.id].background.kind === "transparent" ? "is-checker" : ""}`}>
                  <Thumb tpl={t} scene={scenes[t.id]} images={images} aspect={aspect} />
                  {t.loop && <span className="sg-card__tag">петля</span>}
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
          <div className="sg-bar">
            <button className="sg-btn" onClick={() => setView("catalog")}>
              ← Каталог
            </button>
            <strong className="sg-bar__name">{tpl.name}</strong>
            <label className="sg-inline">
              Кадр
              <select className="ds-select" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {ASPECTS.map(([a]) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {tpl.shuffle && (
              <button className="sg-btn" onClick={() => setParam("seed", Math.floor(Math.random() * 1e6))}>
                🎲 Перемешать
              </button>
            )}
            <button className="sg-btn" onClick={() => update(newScene(tpl))} title="Вернуть пример и настройки шаблона">
              Сбросить
            </button>
          </div>

          <div className="sg-main">
            <div className="sg-stage-col">
              <div className="sg-stage" ref={stageRef}>
                <canvas ref={canvasRef} className={transparent ? "is-checker" : ""} style={{ width: stageSize.w, height: stageSize.h }} />
              </div>
              <div className="sg-timeline">
                <button className="sg-icon" onClick={() => (playing ? setPlaying(false) : time >= dur && !tpl.loop ? restart() : setPlaying(true))} aria-label={playing ? "Пауза" : "Воспроизвести"}>
                  {playing ? "⏸" : "▶"}
                </button>
                <button className="sg-icon" onClick={restart} aria-label="С начала" title="С начала">
                  ↺
                </button>
                <input
                  type="range"
                  min={0}
                  max={dur}
                  step={0.01}
                  value={time}
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
                <label className="sg-inline">
                  Длительность
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={0.5}
                    value={dur}
                    onChange={(e) => setDurs((d) => ({ ...d, [tplId]: Math.min(60, Math.max(1, Number(e.target.value) || tpl.duration)) }))}
                  />
                  с
                </label>
              </div>
            </div>

            <aside className="sg-side">
              <div className="sg-tabs" role="tablist">
                {(
                  [
                    ["data", "Данные"],
                    ["look", "Вид"],
                    ["save", "Сохранить"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={`sg-tab ${tab === k ? "is-on" : ""}`} onClick={() => setTab(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="sg-side__body">
                {tab === "data" && (
                  <>
                    {dataControls.map((c) => (
                      <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
                    ))}
                    {usesRows && (
                      <RowsEditor
                        input={tpl.input}
                        rows={scene.rows}
                        names={[String(scene.params.s1 ?? ""), String(scene.params.s2 ?? "")]}
                        onChange={(rows: Row[]) => update({ rows })}
                      />
                    )}
                    {usesPhotos && (
                      <div className="sg-photos">
                        <div className="sg-photos__head">
                          <strong>{tpl.input === "people" ? "Фото людей (по порядку строк)" : "Фото"}</strong>
                          <label className="sg-btn">
                            ＋ Добавить
                            <input type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
                          </label>
                        </div>
                        {images.length ? (
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
                        ) : (
                          <p className="sg-hint">{tpl.id === "glass" ? "Без фото под стеклом — цветные пятна." : "Без фото будут цветные карточки."} Фото остаются только в вашем браузере.</p>
                        )}
                      </div>
                    )}
                    {usesPhrases && (
                      <label className="sg-field">
                        <span>Фразы — по одной в строке. Вторая часть после «|» выделяется</span>
                        <textarea rows={7} value={scene.phrases.join("\n")} onChange={(e) => update({ phrases: e.target.value.split("\n") })} />
                      </label>
                    )}
                    {!dataControls.length && !usesRows && !usesPhotos && !usesPhrases && <p className="sg-hint">У этого шаблона нет данных — всё настраивается во вкладке «Вид».</p>}
                  </>
                )}

                {tab === "look" && (
                  <>
                    {tpl.ownBackground && tpl.id !== "cover" && tpl.id !== "spiral" && (
                      <div className="sg-group">
                        <div className="sg-group__title">Готовые наборы</div>
                        <div className="sg-presets">
                          {BG_PRESETS.map(([name, base, pal]) => (
                            <button
                              key={name}
                              className="sg-preset"
                              style={{ background: `radial-gradient(circle at 30% 30%, ${pal[0]}, transparent 60%), radial-gradient(circle at 75% 70%, ${pal[1]}, transparent 60%), ${base}` }}
                              onClick={() => update({ palette: [...pal], params: { ...scene.params, base } })}
                              title={name}
                            >
                              <span>{name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {lookControls.map((c) => (
                      <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
                    ))}
                    <div className="sg-group">
                      <div className="sg-group__title">Цвета</div>
                      <div className="sg-palettes">
                        {PALETTES.map(([name, pal]) => (
                          <button key={name} className="sg-pal" onClick={() => update({ palette: [...pal] })} title={name}>
                            {pal.map((c) => (
                              <i key={c} style={{ background: c }} />
                            ))}
                          </button>
                        ))}
                      </div>
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
                          <button className="sg-btn" onClick={() => update({ palette: [...scene.palette, scene.palette[scene.palette.length - 1] ?? "#4f6ef7"] })}>
                            ＋
                          </button>
                        )}
                      </div>
                    </div>
                    {!tpl.ownBackground && (
                      <div className="sg-group">
                        <div className="sg-group__title">Фон</div>
                        <div className="sg-seg">
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
                              {l}
                            </button>
                          ))}
                        </div>
                        {scene.background.kind === "custom" && (
                          <input type="color" value={scene.background.color} onChange={(e) => update({ background: { kind: "custom", color: e.target.value } })} aria-label="Цвет фона" />
                        )}
                        <label className="sg-field">
                          <span>Цвет текста</span>
                          <select className="ds-select" value={scene.ink} onChange={(e) => update({ ink: e.target.value as Scene["ink"] })}>
                            <option value="auto">По фону</option>
                            <option value="dark">Тёмный — для светлых слайдов</option>
                            <option value="light">Светлый — для тёмных слайдов</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </>
                )}

                {tab === "save" && (
                  <>
                    <div className="sg-seg sg-seg--big">
                      {(
                        [
                          ["png", "PNG", "прозрачный фон"],
                          ["jpeg", "JPEG", "с фоном"],
                          ["mp4", "Видео MP4", "для PowerPoint"],
                        ] as const
                      ).map(([k, l, d]) => (
                        <button key={k} className={format === k ? "is-on" : ""} onClick={() => setFormat(k)}>
                          <b>{l}</b>
                          <small>{d}</small>
                        </button>
                      ))}
                    </div>
                    <label className="sg-field">
                      <span>Размер</span>
                      <select
                        className="ds-select"
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
                      <label className="sg-field">
                        <span>Ширина, px</span>
                        <input type="number" min={200} max={7680} value={long} onChange={(e) => setLong(Math.min(7680, Math.max(200, Number(e.target.value) || 1920)))} />
                      </label>
                    )}
                    <p className="sg-hint">
                      Итог: {exportSize.w} × {exportSize.h} px
                      {format === "mp4" ? ` · ${dur} с · ${fps} кадров/с` : tpl.loop ? " · текущий кадр" : " · финальный кадр"}
                    </p>
                    {format === "mp4" && (
                      <>
                        <label className="sg-field">
                          <span>Кадров в секунду</span>
                          <select className="ds-select" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                            <option value={25}>25</option>
                            <option value={30}>30</option>
                            <option value={60}>60 — плавнее, файл больше</option>
                          </select>
                        </label>
                        {transparent && <p className="sg-note">В видео нет прозрачности — фон будет белым. Выберите фон под цвет слайда во вкладке «Вид».</p>}
                        {tpl.loop && <p className="sg-hint">Ролик зациклен: в PowerPoint включите «Повторять до остановки» — шва не будет.</p>}
                      </>
                    )}
                    {format === "png" && !transparent && !tpl.ownBackground && <p className="sg-hint">Чтобы фон был прозрачным, выберите «Прозрачный» во вкладке «Вид».</p>}
                    <div className="sg-actions">
                      <button className="btn-primary" disabled={busy !== null} onClick={() => save(false)}>
                        {format === "mp4" ? "Записать видео" : "Скачать"}
                      </button>
                      {format !== "mp4" && (
                        <button className="btn-secondary" disabled={busy !== null} onClick={() => save(true)}>
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
                        <button className="sg-btn" onClick={() => abortRef.current?.abort()}>
                          Остановить
                        </button>
                      </div>
                    )}
                  </>
                )}
                {msg && <p className="sg-msg">{msg}</p>}
              </div>
            </aside>
          </div>
        </div>
      )}

      <InstructionsModalShell isOpen={showHelp} onClose={() => setShowHelp(false)} title="🎬 Графика для слайдов" footerLabel="Понятно!" maxWidth={720}>
        <div className="instructions-section">
          <h3>Как пользоваться</h3>
          <ol>
            <li>Выберите шаблон в каталоге — при наведении он показывает анимацию.</li>
            <li>Во вкладке «Данные» впишите свои числа или вставьте диапазон из Excel, добавьте фразы или фото.</li>
            <li>Во вкладке «Вид» настройте цвета, фон и детали.</li>
            <li>Во вкладке «Сохранить» скачайте картинку или видео нужного размера.</li>
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
          <h3>Конфиденциальность</h3>
          <p>Всё рисуется в браузере, данные и фото никуда не отправляются. Ограничений на число картинок и видео нет.</p>
        </div>
      </InstructionsModalShell>
    </PageShell>
  );
};

export default SlideGraphics;
