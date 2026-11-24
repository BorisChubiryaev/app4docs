import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Icon } from "../../ChartCraft/components/icons";
import type { GraphicEdit, Presentation, Rect, Slide, SlideEdit, SlideObject } from "../core/presentation";
import SlideSurface from "./SlideSurface";
import SlidePlayback from "./SlidePlayback";
import type { SlideClock } from "./slideEdits";
import { byId } from "../templates";

export type Layer = { id: string; label: string; kind: SlideObject["kind"] | "graphic"; box: Rect; rotation: number; graphic?: GraphicEdit };
type Drag = { id: string; from: Rect; next: Rect; sx: number; sy: number; resize: boolean };
const original: SlideEdit[] = [];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type Props = {
  deck: Presentation; index: number; slide: Slide; edits: SlideEdit[]; layers: Layer[]; selected: string | null; before: boolean;
  onSelect: (id: string | null) => void; onMove: (id: string, box: Rect) => void; onCompare: () => void; onAdd: () => void;
  onDuration: (graphic: GraphicEdit, seconds: number) => void;
};

export default function SlideBoard({ deck, index, slide, edits, layers, selected, before, onSelect, onMove, onDuration, onCompare, onAdd }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const animated = before ? [] : edits.filter((edit): edit is GraphicEdit => edit.kind === "graphic" && edit.animated);
  const originals = slide.objects.filter(o => before || !edits.some(edit => edit.kind === "graphic" && edit.targetId === o.id));
  const media = originals.flatMap(o => o.movie ?? o.gif ?? []);
  const animationKey = [...animated.map(e => e.id + ":" + e.scene.templateId), ...media.map(m => m.part)].join("|");
  const clock = useMemo<SlideClock | undefined>(() => {
    if (!animationKey) return undefined;
    const play = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return { time: play ? 0 : null, playing: play };
  }, [animationKey]);
  const clips = [...animated.map(edit => ({ duration: edit.duration, loop: byId(edit.scene.templateId).loop })), ...media];
  const editable = animated.find(edit => edit.id === selected) ?? (!selected && animated.length === 1 ? animated[0] : undefined);
  const { width, height } = deck.model;
  const position = (box: Rect, rot: number): CSSProperties => ({
    left: `${100 * box.x / width}%`, top: `${100 * box.y / height}%`, width: `${100 * box.w / width}%`,
    height: `${100 * box.h / height}%`, transform: `rotate(${rot}deg)`,
  });
  function start(event: PointerEvent<HTMLElement>, layer: Layer, resize: boolean) {
    if (event.button !== 0 || !layer.graphic) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: layer.id, sx: event.clientX, sy: event.clientY, from: layer.box, next: layer.box, resize });
  }
  function move(event: PointerEvent) {
    if (!drag || !frame.current) return;
    const scale = frame.current.getBoundingClientRect().width / width;
    const dx = (event.clientX - drag.sx) / scale, dy = (event.clientY - drag.sy) / scale;
    const b = drag.from;
    const ratio = clamp(1 + (dx * b.w + dy * b.h) / (b.w ** 2 + b.h ** 2), Math.min(1, 24 / Math.max(b.w, b.h)), Math.min((width - b.x) / b.w, (height - b.y) / b.h));
    const next = drag.resize ? { ...b, w: b.w * ratio, h: b.h * ratio }
      : { ...b, x: clamp(b.x + dx, 0, width - b.w), y: clamp(b.y + dy, 0, height - b.h) };
    setDrag({ ...drag, next });
  }
  function end() {
    if (!drag) return;
    if (Object.keys(drag.next).some(k => Math.abs(drag.next[k as keyof Rect] - drag.from[k as keyof Rect]) > .1)) {
      onMove(drag.id, drag.next);
    }
    setDrag(null);
  }
  const current = layers.find(l => l.id === selected);
  return <section className="pw-board" aria-label="Редактирование слайда">
    <header className="pw-board-bar">
      <b>Слайд {index + 1} <span>/ {deck.slides.length}</span></b>
      <div>
        {edits.length > 0 && <button className="pw-link" aria-pressed={before} onClick={onCompare}>{before ? "Показать изменения" : "Сравнить с оригиналом"}</button>}
        <button className="pw-add" onClick={onAdd}><Icon name="plus" size={16} />Добавить графику</button>
      </div>
    </header>
    <div className="pw-mat" onClick={e => { if (e.target === e.currentTarget) onSelect(null); }}>
      <div className="pw-paper" ref={frame} style={{ "--ratio": width / height, aspectRatio: `${width}/${height}` } as CSSProperties}
        onClick={e => { if (e.target === e.currentTarget) onSelect(null); }}>
        <SlideSurface deck={deck} slide={slide} edits={before ? original : edits} clock={clock} motion={drag ? { id: drag.id, box: drag.next } : undefined} />
        {!before && layers.map(layer => <button type="button" className={`pw-hit${layer.graphic ? " pw-movable" : ""}`}
          key={layer.id} style={position(drag?.id === layer.id ? drag.next : layer.box, layer.rotation)}
          title={layer.label} aria-label={`Выбрать: ${layer.label}`} aria-pressed={selected === layer.id}
          onClick={() => onSelect(layer.id)}
          onPointerDown={e => { if (layer.id === selected) start(e, layer, false); }}
          onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}
          onKeyDown={e => {
            if (!layer.graphic || !e.key.startsWith("Arrow")) return;
            e.preventDefault();
            const b = layer.box, d = e.shiftKey ? 10 : 1;
            onMove(layer.id, { ...b, x: clamp(b.x + (e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0), 0, width - b.w),
              y: clamp(b.y + (e.key === "ArrowDown" ? d : e.key === "ArrowUp" ? -d : 0), 0, height - b.h) });
          }} />)}
        {!before && current && <div className="pw-outline" style={position(drag?.id === current.id ? drag.next : current.box, current.rotation)}>
          <i /><i /><i /><i />
          {current.graphic && <button className="pw-resize" type="button" title="Потяните, чтобы изменить размер" aria-label="Изменить размер графики"
            onPointerDown={e => start(e, current, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}
            onKeyDown={e => {
              if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const b = current.box, ratio = clamp(e.key === "ArrowUp" ? 1.05 : .95, 8 / b.w, Math.min((width - b.x) / b.w, (height - b.y) / b.h));
              onMove(current.id, { ...b, w: b.w * ratio, h: b.h * ratio });
            }} />}
        </div>}
      </div>
    </div>
    {clock ? <SlidePlayback key={animationKey} clock={clock} duration={Math.max(...clips.map(t => t.duration))} loop={clips.some(t => t.loop)}
      poster={editable?.time} clip={editable ? { duration: editable.duration, name: byId(editable.scene.templateId).name,
        onChange: n => onDuration(editable, n) } : undefined} />
    : <footer className="pw-board-note"><Icon name={current?.graphic ? "grip" : "select"} size={15} />
      {before ? "Исходный слайд" : current?.graphic ? "Перетащите графику или потяните за угловой маркер." : current?.kind === "chart" ? "Выберите палитру или шаблон для этой диаграммы." : current?.kind === "text" ? "Измените текст и оформление в панели параметров." : "Нажмите на объект слайда, чтобы изменить его."}
    </footer>}
  </section>;
}
