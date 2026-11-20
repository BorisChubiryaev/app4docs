import { useEffect, useRef, useState } from "react";
import { Icon } from "../../ChartCraft/components/icons";
import { effects, objectLabel, type Animation as ObjectEffect, type Effect, type Presentation, type Slide } from "../core/presentation";
import SlideCanvas from "./SlideCanvas";

const options = Object.keys(effects) as Effect[];
const durations = [0.5, 1, 1.5, 2, 3];
const seconds = (value: number) => value.toLocaleString("ru") + " с";
const symbols: Record<Effect, string> = { fade: "◐", wipe: "→", rise: "↑" };
const frames: Record<Effect, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  wipe: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }],
  rise: [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0)" }],
};

interface Props {
  deck: Presentation;
  slide: Slide;
  index: number;
  selection: Record<string, ObjectEffect>;
  selected?: string;
  select: (id: string) => void;
  change: (id: string, animation?: ObjectEffect) => void;
}

export default function SlideAnimationEditor({ deck, slide, index, selection, selected, select, change }: Props) {
  const targets = useRef(new Map<string, HTMLDivElement>());
  const running = useRef<Animation[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ id: string; step: number; total: number; effect: Effect; sequence: boolean } | null>(null);
  const object = slide.objects.find(o => o.id === selected) ?? slide.objects[0];
  const choice = object && selection[object.id];
  const ordered = slide.objects.filter(o => selection[o.id]);

  useEffect(() => {
    const active = running.current;
    return () => { active.forEach(a => { a.onfinish = null; a.cancel(); }); };
  }, []);
  function stop() {
    running.current.splice(0).forEach(a => { a.onfinish = null; a.cancel(); });
    setPreview(null);
  }
  function pick(id: string) {
    stop();
    select(id);
  }
  function play(steps: { id: string; animation: ObjectEffect }[], sequence = false) {
    stop();
    let delay = 0;
    for (const [i, { id, animation }] of steps.entries()) {
      const target = targets.current.get(id);
      if (!target) continue;
      const duration = animation.duration * 1000;
      const showStep = () => setPreview({ id, step: i + 1, total: steps.length, effect: animation.effect, sequence });
      const previous = running.current.at(-1);
      if (previous) previous.onfinish = showStep;
      else showStep();
      running.current.push(target.animate(frames[animation.effect], { duration, delay, fill: "backwards" }));
      delay += duration;
    }
    const last = running.current.at(-1);
    if (last) {
      last.onfinish = () => { if (running.current.at(-1) === last) stop(); };
    }
  }
  function assign(next?: ObjectEffect) {
    if (!object) return;
    change(object.id, next);
    if (next && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) play([{ id: object.id, animation: next }]);
    else stop();
  }

  return <>
    <section className="sg-pptx-work" aria-label="Эскиз и объекты слайда">
      <div className="sg-pptx-preview ds-panel" ref={canvas}>
        <div className="sg-pptx-preview-head">
          <div><div className="sg-pptx-kicker">Эскиз слайда</div><h2>Слайд {index + 1}</h2></div>
          <button className="btn-secondary sg-pptx-compact" disabled={!ordered.length} onClick={() => {
            if (preview?.sequence) stop();
            else play(ordered.map(o => ({ id: o.id, animation: selection[o.id] })), true);
          }}><span aria-hidden="true">{preview?.sequence ? "■" : "▷"}</span>{preview?.sequence ? "Остановить" : "Просмотреть слайд"}</button>
        </div>
        <SlideCanvas deck={deck} slide={slide} selected={object?.id} select={pick} targets={targets} order={ordered.map(o => o.id)} />
        <div className="sg-pptx-caption" aria-live="polite">
          {preview ? <>
            <strong>{preview.sequence ? "Шаг " + preview.step + " из " + preview.total : "Предпросмотр эффекта"}</strong>
            {" · " + effects[preview.effect].label + " · " + objectLabel(slide.objects.find(o => o.id === preview.id)!)}
          </> : object ? <>
            <strong>{object.kind + " · " + objectLabel(object)}</strong>
            {choice ? " — " + effects[choice.effect].label + ", " + seconds(choice.duration) : " — выберите эффект появления"}
          </> : "На слайде нет отдельных текстовых блоков или диаграмм PowerPoint."}
        </div>
      </div>
      {object && <section className="sg-pptx-objects ds-panel" aria-label="Объекты слайда">
        <div className="sg-pptx-section-head"><h3>Объекты слайда</h3><span>{slide.objects.length}</span></div>
        {slide.objects.map(o => {
          const animation = selection[o.id];
          const status = animation ? effects[animation.effect].label + " · " + seconds(animation.duration) :
            o.existing ? "Есть исходная анимация" : "Без эффекта";
          return <button key={o.id} className="sg-pptx-object" aria-pressed={o.id === object.id} onClick={() => pick(o.id)}>
            <span className="sg-pptx-object-icon"><Icon name={o.kind === "Текст" ? "text" : "chart"} /></span>
            <span className="sg-pptx-object-name"><strong>{objectLabel(o)}</strong><small>{o.kind}</small></span>
            <span className="sg-pptx-object-state">{animation && <b aria-label={"Шаг " + (ordered.indexOf(o) + 1)}>{ordered.indexOf(o) + 1}</b>}{status}</span>
          </button>;
        })}
      </section>}
    </section>
    <aside className="ds-panel sg-pptx-inspector" aria-label="Настройка выбранного объекта">
      <div className="sg-pptx-kicker">Выбранный объект</div>
      {object ? <>
        <div className="sg-pptx-selected-object"><span className="sg-pptx-object-icon"><Icon name={object.kind === "Текст" ? "text" : "chart"} /></span>
          <div><small>{object.kind}</small><h3 title={object.name}>{objectLabel(object)}</h3></div></div>
        <div className="sg-pptx-rule" />
        <h3>Эффект появления</h3>
        <div className="sg-pptx-effects" role="group" aria-label="Эффект появления">
          <button className="sg-pptx-effect" aria-pressed={!choice} onClick={() => assign()}>
            <span aria-hidden="true" className="sg-pptx-effect-glyph">∅</span>Без нового эффекта<span className="sg-pptx-radio" aria-hidden="true" />
          </button>
          {options.map(key => <button key={key} className="sg-pptx-effect" aria-pressed={choice?.effect === key}
            onClick={() => assign({ effect: key, duration: choice?.duration ?? 1 })}>
            <span aria-hidden="true" className="sg-pptx-effect-glyph">{symbols[key]}</span>{effects[key].label}<span className="sg-pptx-radio" aria-hidden="true" />
          </button>)}
        </div>
        {choice && <div className="sg-pptx-timing">
          <h3>Длительность</h3>
          <div className="sg-pptx-durations" role="group" aria-label="Длительность эффекта">
            {durations.map(n => <button key={n} aria-pressed={n === choice.duration} onClick={() => assign({ ...choice, duration: n })}>{seconds(n)}</button>)}
          </div>
          <button className="btn-secondary sg-pptx-replay" onClick={() => {
            if (window.matchMedia("(max-width: 720px)").matches) canvas.current?.scrollIntoView({ block: "start" });
            play([{ id: object.id, animation: choice }]);
          }}>▷ Повторить эффект</button>
        </div>}
        <p className="sg-pptx-footnote">{object.existing ? "У объекта уже есть анимация в файле. Новый эффект будет добавлен после исходных." : "В PowerPoint каждый добавленный эффект запускается по щелчку."}</p>
      </> : <p className="sg-pptx-footnote">Выберите слайд с текстом или диаграммой.</p>}
    </aside>
  </>;
}
