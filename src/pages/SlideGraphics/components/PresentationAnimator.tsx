import { useState } from "react";
import ChartPreview from "./ChartPreview";
import { download } from "../core/export";
import { effects, exportPresentation, openPresentation } from "../core/presentation";
import type { Animation, Choices, Effect, Presentation } from "../core/presentation";

export default function PresentationAnimator({ onBack }: { onBack: () => void }) {
  const [deck, setDeck] = useState<Presentation | null>(null);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Choices>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const slide = deck?.slides[index];
  const count = Object.values(choices).reduce((sum, objects) => sum + Object.keys(objects).length, 0);

  async function load(file?: File) {
    if (!file) return;
    setBusy("Читаем слайды…");
    setError("");
    try {
      if (!/\.pptx$/i.test(file.name)) throw new Error("Выберите презентацию в формате .pptx");
      const next = await openPresentation(file);
      setDeck(next);
      setIndex(0);
      setChoices({});
    } catch (e) {
      setError("Не удалось открыть презентацию. " + (e instanceof Error ? e.message : ""));
    } finally { setBusy(""); }
  }
  function choose(id: string, animation?: Animation) {
    if (!slide) return;
    setChoices(previous => {
      const objects = { ...previous[slide.part] };
      if (animation) objects[id] = animation;
      else delete objects[id];
      return { ...previous, [slide.part]: objects };
    });
  }
  async function save() {
    if (!deck) return;
    setBusy("Готовим PPTX…");
    setError("");
    try {
      download(await exportPresentation(deck, choices), deck.file.name.replace(/\.pptx$/i, "") + " — анимация.pptx");
    } catch { setError("Не удалось сохранить презентацию. Попробуйте ещё раз."); }
    finally { setBusy(""); }
  }
  return <section className="sg-studio sg-deck">
    <div className="sg-editor-heading">
      <button className="ds-nav-btn" disabled={!!busy} onClick={onBack}>← Каталог</button>
      <div><h2>Анимация презентации</h2><p>Выберите слайд и эффекты для его объектов. В PowerPoint каждый новый эффект запускается по щелчку после имеющихся эффектов.</p></div>
    </div>
    <div className="ds-panel sg-deck-file">
      <label className="sg-field">{deck ? "Открыть другую презентацию" : "Загрузить презентацию PowerPoint"}
        <input type="file" accept=".pptx" disabled={!!busy} onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {deck && <button className="btn-primary" onClick={save} disabled={!!busy || !count}>Скачать PPTX · {count}</button>}
    </div>
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert">{error}</p>}
    {deck && slide && <fieldset className="ds-panel sg-deck-edit" disabled={!!busy}>
      <legend>{deck.file.name}</legend>
      <label className="sg-field">Слайд
        <select className="ds-select" aria-label="Слайд" value={index} onChange={e => setIndex(Number(e.target.value))}>
          {deck.slides.map((s, i) => <option key={s.part} value={i}>{i + 1} из {deck.slides.length} · {s.objects.find(o => o.kind === "Текст")?.content.slice(0, 55) || "Слайд " + (i + 1)}</option>)}
        </select>
      </label>
      {!slide.objects.length && <p>На этом слайде нет отдельных текстовых блоков или диаграмм PowerPoint.</p>}
      {slide.objects.map(o => {
        const selected = choices[slide.part]?.[o.id];
        const sampleId = "sg-object-" + o.id;
        return <div className="sg-deck-object" key={slide.part + "/" + o.id}>
          <div><small>{o.kind} · {o.name}</small><div id={sampleId}><p>{o.content || o.name}</p>{o.sketch && <ChartPreview chart={o.sketch} />}</div></div>
          <label className="sg-field">Эффект
            <select className="ds-select" aria-label={"Эффект · " + o.name} value={selected?.effect ?? ""} onChange={e => choose(o.id, e.target.value ? { effect: e.target.value as Effect, duration: selected?.duration ?? 1 } : undefined)}>
              <option value="">Без нового эффекта</option>
              {Object.entries(effects).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          {selected && <>
            <label className="sg-field">Длительность
              <select className="ds-select" aria-label={"Длительность · " + o.name} value={selected.duration} onChange={e => choose(o.id, { ...selected, duration: Number(e.target.value) })}>
                {[.5, 1, 1.5, 2, 3].map(n => <option key={n} value={n}>{n.toLocaleString("ru")} с</option>)}
              </select>
            </label>
            <button className="btn-secondary" onClick={() => {
              const sample = document.getElementById(sampleId);
              sample?.getAnimations().forEach(a => a.cancel());
              const frames = selected.effect === "fade" ? [{ opacity: 0 }, { opacity: 1 }]
                : [{ clipPath: selected.effect === "rise" ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }];
              sample?.animate(frames, { duration: selected.duration * 1000 });
            }}>Проверить эффект</button>
          </>}
        </div>;
      })}
    </fieldset>}
  </section>;
}
