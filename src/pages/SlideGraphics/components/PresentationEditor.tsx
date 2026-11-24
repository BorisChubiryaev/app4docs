import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Icon } from "../../ChartCraft/components/icons";
import { download } from "../core/export";
import { isDark } from "../core/draw";
import { baseColor, stillTime } from "../core/render";
import { loadPhoto, objectNames, type GraphicEdit, type NativeStyle, type Presentation, type Rect, type SlideEdit, type SlideObject } from "../core/presentation";
import type { Scene, Template } from "../core/types";
import { byId } from "../templates";
import TemplateSettings from "./TemplateSettings";
import NativeSettings from "../presentation/NativeSettings";
import TemplatePicker from "../presentation/TemplatePicker";
import SlideBoard, { type Layer } from "../presentation/SlideBoard";
import SlideSurface from "../presentation/SlideSurface";
import { chartPalettes } from "../presentation/chartStyle";
import { exportPresentation } from "../presentation/slideEdits";

type History = { past: SlideEdit[][]; now: SlideEdit[]; future: SlideEdit[][]; batch?: string };
type Action = { type: "put"; edit: SlideEdit; batch?: string } | { type: "remove"; id: string; part: string }
  | { type: "undo" | "redo" | "end" };

function history(state: History, action: Action): History {
  if (action.type === "end") return state.batch ? { ...state, batch: undefined } : state;
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), now: previous, future: [state.now, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const [next, ...rest] = state.future;
    return next ? { past: [...state.past, state.now], now: next, future: rest } : state;
  }
  if (action.type === "remove") {
    return { past: [...state.past.slice(-39), state.now], now: state.now.filter(e => e.id !== action.id || e.slidePart !== action.part), future: [] };
  }
  if (action.type !== "put") return state;
  const existing = state.now.find(e => e.slidePart === action.edit.slidePart && e.id === action.edit.id);
  return {
    past: action.batch && action.batch === state.batch ? state.past : [...state.past.slice(-39), state.now],
    now: existing ? state.now.map(e => e === existing ? action.edit : e) : [...state.now, action.edit],
    future: [], batch: action.batch,
  };
}

const icons = { text: "text", chart: "chart", photo: "image", video: "image", table: "table", shape: "rect", graphic: "sliders" };
const empty: SlideEdit[] = [];
const emptyPhotos: HTMLImageElement[] = [];
const countForm = (n: number, a: string, b: string, c: string) =>
  n % 100 >= 11 && n % 100 <= 14 ? c : n % 10 === 1 ? a : n % 10 >= 2 && n % 10 <= 4 ? b : c;
type Props = { deck: Presentation; initialObject?: string; active: boolean; onBack: () => void; onDirty: (dirty: boolean) => void };

export default function PresentationEditor({ deck, initialObject, active, onBack, onDirty }: Props) {
  const [state, dispatch] = useReducer(history, { past: [], now: empty, future: [] });
  const [saved, setSaved] = useState<SlideEdit[]>(empty);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialObject ?? null);
  const [picker, setPicker] = useState(false);
  const [before, setBefore] = useState(false);
  const [saveProgress, setSaveProgress] = useState<number | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<{ source: NonNullable<SlideObject["image"]>; images: HTMLImageElement[] } | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const sequence = useRef(0);
  const name = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const slide = deck.slides[index];
  const local = useMemo(() => state.now.filter(e => e.slidePart === slide.part), [state.now, slide]);
  const edit = local.find(e => e.id === selected);
  const object = slide.objects.find(o => o.id === selected);
  const graphic = edit?.kind === "graphic" ? edit : undefined;
  const style = edit?.kind === "native" ? edit.style : {};
  const tpl = graphic ? byId(graphic.scene.templateId) : undefined;
  const { width, height } = deck.model;
  const sourceImages = object?.image && photo?.source === object.image ? photo.images : emptyPhotos;
  const isPicker = picker || Boolean(object && !graphic && !["shape", "text"].includes(object.kind));
  const showObjects = !isPicker && !object && !graphic;
  const changesCount = state.now.length;

  useEffect(() => { onDirty(changesCount > 0 && state.now !== saved); }, [changesCount, state.now, saved, onDirty]);
  useEffect(() => () => exportController.current?.abort(), [active]);
  useEffect(() => {
    if (active) { window.scrollTo(0, 0); name.current?.focus({ preventScroll: true }); }
  }, [active]);
  useEffect(() => {
    let stale = false;
    const source = object?.image;
    setPhotoError(false);
    if (source) source().then(img => { if (!stale) setPhoto({ source, images: [img] }); })
      .catch(() => { if (!stale) setPhotoError(true); });
    return () => { stale = true; };
  }, [object?.image]);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [index, selected, isPicker]);

  const select = (id: string | null) => { setSelected(id); setBefore(false); setPicker(false); setError(""); dispatch({ type: "end" }); };
  function openSlide(i: number) { setIndex(i); select(null); }
  function add() { select(null); setPicker(true); }
  const travel = useCallback((direction: "undo" | "redo") => {
    const next = direction === "undo" ? state.past.at(-1) : state.future[0];
    if (!next) return;
    const changed = next.find(e => !state.now.includes(e)) ?? state.now.find(e => !next.includes(e));
    if (changed) {
      setIndex(deck.slides.findIndex(s => s.part === changed.slidePart));
      setSelected(next.includes(changed) || changed.targetId ? changed.id : null);
    }
    setBefore(false); setPicker(false); dispatch({ type: direction });
  }, [deck, state]);
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]")) return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); travel(e.shiftKey ? "redo" : "undo"); }
      if (e.key === "Escape") { setSelected(null); setPicker(false); setBefore(false); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, travel]);

  const layers: Layer[] = [];
  const asLayer = (g: GraphicEdit): Layer => ({ id: g.id, label: byId(g.scene.templateId).name, kind: "graphic", box: g.box, rotation: g.rotation, graphic: g });
  for (const o of slide.objects) {
    const e = local.find(item => item.targetId === o.id);
    if (e?.kind === "graphic") layers.push(asLayer(e));
    else layers.push({ ...o, label: e?.kind === "native" ? e.style.text?.trim() || o.label : o.label });
  }
  for (const e of local) {
    if (e.kind !== "graphic" || e.targetId !== null) continue;
    if (e.behind) layers.unshift(asLayer(e)); else layers.push(asLayer(e));
  }

  function put(next: SlideEdit, batch?: string) {
    setBefore(false); setError("");
    dispatch({ type: "put", edit: next, batch: batch && `${next.slidePart}/${next.id}/${batch}` });
  }
  function native(patch: NativeStyle) {
    if (object) put({ kind: "native", id: object.id, targetId: object.id, slidePart: slide.part, style: { ...style, ...patch } }, Object.keys(patch)[0]);
  }
  function choose(template: Template, scene: Scene) {
    const behind = !object && template.group === "backgrounds";
    let box = graphic?.box ?? object?.box;
    if (!box) {
      const w = Math.min(width * .58, height * .75 * 16 / 9), h = w * 9 / 16;
      box = behind ? { x: 0, y: 0, w: width, h: height } : { x: (width - w) / 2, y: (height - h) / 2, w, h };
    }
    const id = graphic?.id ?? object?.id ?? `new-${++sequence.current}`;
    const customDuration = graphic && graphic.duration !== byId(graphic.scene.templateId).duration;
    const duration = customDuration ? graphic.duration : template.duration;
    put({ kind: "graphic", id, targetId: object?.id ?? null, slidePart: slide.part, scene,
      images: graphic?.images.length ? graphic.images : sourceImages, rotation: graphic?.rotation ?? object?.rotation ?? 0,
      animated: graphic?.animated ?? true, duration, time: stillTime(template, duration, duration * .3), box, behind });
    setSelected(id); setPicker(false);
  }
  function changeDuration(g: GraphicEdit, duration: number) {
    if (duration !== g.duration) put({ ...g, duration, time: g.time / g.duration * duration }, "duration");
  }
  function reposition(id: string, box: Rect) {
    const g = local.find(e => e.id === id);
    if (g?.kind === "graphic") put({ ...g, box });
  }
  async function save() {
    if (exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    setSaveProgress(0); setError("");
    try {
      const output = await exportPresentation(deck, state.now, controller.signal, setSaveProgress);
      controller.signal.throwIfAborted();
      download(output, deck.file.name.replace(/(?: — с правками)?\.pptx$/i, " — с правками.pptx"));
      setSaved(state.now);
    } catch {
      if (!controller.signal.aborted) setError("Не удалось сохранить презентацию. Попробуйте скачать её ещё раз.");
    } finally { exportController.current = null; setSaveProgress(null); }
  }
  const latest = useRef(state.now);
  latest.current = state.now;
  async function addPhotos(files: FileList | null) {
    if (!files?.length || !graphic) return;
    try {
      const imgs = await Promise.all(Array.from(files).filter(f => f.type.startsWith("image/")).map(loadPhoto));
      const g = latest.current.find(e => e.id === graphic.id && e.slidePart === graphic.slidePart);
      if (g?.kind === "graphic" && imgs.length) put({ ...g, images: [...g.images, ...imgs] });
    } catch { setError("Не удалось прочитать изображение."); }
  }

  if (!active) return null;
  const backInInspector = <button className="pw-link pw-inspector-back" onClick={() => select(null)}>← Элементы слайда</button>;
  const nativeChart = object?.kind === "chart" && !!object.chartPath && deck.files.charts.has(object.chartPath) && !graphic;
  const heading = nativeChart ? "Диаграмма" : isPicker ? (object || graphic ? "Заменить оформление" : "Добавить графику")
    : graphic ? tpl!.name : object ? objectNames[object.kind] : "Элементы слайда";
  return <div className="sg-studio pw-workspace" onBlurCapture={() => dispatch({ type: "end" })}>
    <header className="pw-filebar">
      <div className="pw-filename"><div className="pw-file-icon"><Icon name="file" size={21} /></div>
        <div><button className="pw-link" onClick={onBack}>← К каталогу</button><h2 ref={name} tabIndex={-1} title={deck.file.name}>{deck.file.name}</h2></div>
      </div>
      <div className="pw-file-actions">
        <small role="status">{changesCount ? (saved === state.now ? "Копия скачана" : `${changesCount} ${countForm(changesCount, "правка", "правки", "правок")}`) : "Без правок"}</small>
        <div className="pw-history">
          <button aria-label="Отменить правку" title="Отменить (Ctrl/⌘ Z)" disabled={!state.past.length} onClick={() => travel("undo")}><Icon name="undo" size={17} /></button>
          <button aria-label="Повторить правку" title="Повторить (Ctrl/⌘ Shift Z)" disabled={!state.future.length} onClick={() => travel("redo")}><Icon name="redo" size={17} /></button>
        </div>
        {saveProgress !== null && <button className="pw-cancel-export" title="Отменить скачивание" aria-label="Отменить скачивание"
          onClick={() => exportController.current?.abort()}><Icon name="close" size={16} /></button>}
        <button className="pw-primary" disabled={saveProgress !== null} onClick={save}><Icon name="download" size={17} />
          {saveProgress === null ? "Скачать PPTX" : saveProgress ? `Сохраняем · ${saveProgress}%` : "Сохраняем…"}
        </button>
      </div>
    </header>
    {error && <p className="pw-error" role="alert">{error}</p>}
    <div className="pw-layout">
      <nav className="pw-film" aria-label="Слайды презентации">
        <h3>Слайды <span>{deck.slides.length}</span></h3>
        <div className="pw-film-list">{deck.slides.map((s, i) => <button key={s.part}
          className="pw-thumb" aria-current={i === index ? "page" : undefined}
          aria-label={`Слайд ${i + 1}. ${s.title}`} onClick={() => openSlide(i)}>
          <span className="pw-thumb-art" style={{ aspectRatio: `${width}/${height}` }}>
            <SlideSurface deck={deck} slide={s} edits={state.now.filter(e => e.slidePart === s.part)} thumbnail />
          </span><span className="pw-thumb-caption"><b>{i + 1}</b><span>{s.title || "Без заголовка"}</span></span>
        </button>)}</div>
      </nav>
      <SlideBoard key={slide.part} deck={deck} index={index} slide={slide} edits={local} layers={layers} selected={selected}
        before={before && !!local.length} onSelect={select} onMove={reposition} onDuration={changeDuration} onCompare={() => setBefore(v => !v)} onAdd={add} />
      <aside className="pw-inspector" aria-label="Параметры слайда">
        <header>{!showObjects && backInInspector}<h3>{heading}</h3>
          {showObjects && <p>Выберите объект на слайде или в списке.</p>}
          {isPicker && object && !nativeChart && <p title={object.label}>{object.label}</p>}
        </header>
        <div className="pw-inspector-body" ref={body}>
          {showObjects && <>{layers.length ? <div className="pw-layers">{layers.map(l => <button key={l.id} onClick={() => select(l.id)}>
            <i><Icon name={icons[l.kind]} size={17} /></i><span><small>{l.kind === "graphic" ? "Графика" : objectNames[l.kind]}</small><strong>{l.label}</strong></span><em aria-hidden="true">›</em>
          </button>)}</div> : <div className="pw-empty"><Icon name="rect" size={24} /><p>На этом слайде можно разместить новую графику.</p><button className="pw-secondary" onClick={add}>Выбрать шаблон</button></div>}</>}
          {isPicker && <>
            {object?.kind === "photo" && (!object.image || photoError) && <p className="pw-hint">Для этого формата потребуется выбрать фото в настройках шаблона.</p>}
            {object?.kind === "chart" && !object.series.length && <p className="pw-hint">Данные этой диаграммы можно ввести в шаблон вручную.</p>}
            {nativeChart && <section className="pw-chart-style">
              <h4>Палитра диаграммы</h4>
              <div>{chartPalettes.map(p => <button key={p.name} title={p.name} aria-label={`Палитра ${p.name}`}
                aria-pressed={edit?.kind === "chart" && edit.palette === p.colors}
                onClick={() => put({ kind: "chart", id: object.id, targetId: object.id, slidePart: slide.part, palette: p.colors })}>
                {p.colors.map(color => <i key={color} style={{ background: color }} />)}
              </button>)}</div>
              <p className="pw-hint">Данные и ряды останутся редактируемыми в PowerPoint.</p>
            </section>}
            <TemplatePicker key={selected ?? "insert"} object={object} previous={graphic?.scene} sourceText={style.text ?? object?.text ?? ""}
              images={graphic?.images.length ? graphic.images : sourceImages}
              loading={!!object?.image && !sourceImages.length && !photoError} onChoose={choose} /></>}
          {!isPicker && !graphic && object && <NativeSettings object={object} style={style} update={native} onTemplates={() => setPicker(true)} />}
          {!isPicker && graphic && tpl && <div className="pw-graphic-settings">
            <button className="pw-secondary" onClick={() => setPicker(true)}><Icon name="sliders" size={16} />Сменить шаблон</button>
            <label className="pw-animation-setting"><span><strong>Анимация в PPTX</strong>
              <small>{graphic.animated ? "Воспроизводится при показе слайдов" : "Сохранится один кадр"}</small></span>
              <input type="checkbox" role="switch" aria-label="Анимация в PPTX" checked={graphic.animated}
                onChange={e => put({ ...graphic, animated: e.target.checked })} />
            </label>
            {!graphic.animated && tpl.loop && <label className="sg-field"><span>Кадр для сохранения</span><input type="range" min={0} max={graphic.duration} step={.05}
              value={graphic.time} onChange={e => put({ ...graphic, time: +e.target.value }, "time")} /></label>}
            <TemplateSettings preserveData tpl={tpl} scene={graphic.scene} images={graphic.images} previewDark={graphic.scene.ink === "light" || isDark(baseColor(graphic.scene, tpl) ?? "#fff")}
              update={patch => put({ ...graphic, scene: { ...graphic.scene, ...patch } }, "settings")}
              addPhotos={addPhotos} removePhoto={i => put({ ...graphic, images: graphic.images.filter((_, n) => n !== i) })} />
            <button className="pw-link" onClick={() => reposition(graphic.id, { ...graphic.box, x: (width - graphic.box.w) / 2, y: (height - graphic.box.h) / 2 })}>Поместить в центр</button>
          </div>}
          {edit && (!isPicker || edit.kind === "chart") && <button className="pw-restore" onClick={() => { dispatch({ type: "remove", id: edit.id, part: slide.part }); select(edit.targetId); }}>
            <Icon name={edit.targetId ? "undo" : "trash"} size={15} />{edit.targetId ? "Вернуть исходный объект" : "Удалить графику"}</button>}
        </div>
      </aside>
    </div>
  </div>;
}
