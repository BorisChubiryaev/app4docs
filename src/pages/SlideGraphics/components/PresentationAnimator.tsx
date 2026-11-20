import { useRef, useState } from "react";
import { plural } from "../../../utils/plural";
import { Icon } from "../../ChartCraft/components/icons";
import { download } from "../core/export";
import { exportPresentation, openPresentation, type Animation, type Choices, type Presentation } from "../core/presentation";
import SlideAnimationEditor from "./SlideAnimationEditor";
import "./PresentationAnimator.css";

const effectForms: [string, string, string] = ["эффект", "эффекта", "эффектов"];

export default function PresentationAnimator({ onBack }: { onBack: () => void }) {
  const [opened, setOpened] = useState<{ deck: Presentation; revision: number } | null>(null);
  const deck = opened?.deck;
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Choices>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const slide = deck?.slides[index];
  const changed = Object.values(choices).filter(objects => Object.keys(objects).length);
  const count = changed.reduce((sum, objects) => sum + Object.keys(objects).length, 0);

  const result = count
    ? count + " " + plural(count, effectForms) + " на " + changed.length + " " + plural(changed.length, ["слайде", "слайдах", "слайдах"])
    : "Выберите эффект для скачивания";

  async function load(file?: File) {
    if (!file || busy) return;
    setBusy("Открываем презентацию…");
    setError("");
    try {
      if (!/\.pptx$/i.test(file.name)) throw new Error("Выберите файл в формате PPTX.");
      const next = await openPresentation(file);
      setOpened(previous => ({ deck: next, revision: (previous?.revision ?? 0) + 1 }));
      setIndex(0);
      setActive({});
      setChoices({});
      setSaved(false);
    } catch {
      setError("Не удалось открыть файл. Выберите презентацию PowerPoint в формате .pptx без пароля.");
    } finally { setBusy(""); }
  }

  function change(id: string, animation?: Animation) {
    if (!slide) return;
    setSaved(false);
    setChoices(previous => {
      const objects = { ...previous[slide.part] };
      if (animation) objects[id] = animation;
      else delete objects[id];
      return { ...previous, [slide.part]: objects };
    });
  }

  async function save() {
    if (!deck || busy || !count) return;
    setBusy("Готовим PPTX…");
    setError("");
    try {
      download(await exportPresentation(deck, choices), deck.file.name.replace(/\.pptx$/i, "") + " — анимация.pptx");
      setSaved(true);
    } catch { setError("Не удалось скачать презентацию. Попробуйте ещё раз."); }
    finally { setBusy(""); }
  }

  return <section className="sg-studio sg-pptx-editor">
    <input ref={input} hidden type="file" accept=".pptx" aria-label="Открыть презентацию PowerPoint" disabled={!!busy}
      onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="sg-pptx-bar">
      <button className="ds-nav-btn" disabled={!!busy} onClick={onBack}>← Каталог</button>
      {deck && <>
        <div className="sg-pptx-file"><Icon name="file" /><div><strong title={deck.file.name}>{deck.file.name}</strong>
          <small role="status">{busy || (saved ? "PPTX отправлен на скачивание · " + result : result)}</small>
        </div></div>
        <div className="sg-pptx-actions">
          <button className="btn-secondary sg-pptx-compact" disabled={!!busy} onClick={() => input.current?.click()}><Icon name="folder" />Сменить файл</button>
          <button className="btn-primary" disabled={!!busy || !count} onClick={save}><Icon name="download" />Скачать PPTX</button>
        </div>
      </>}
    </div>
    {error && <div className="sg-pptx-error" role="alert">{error}</div>}
    {!deck && <div className="ds-panel sg-pptx-upload" data-dragging={dragging}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); void load(e.dataTransfer.files[0]); }}>
      <div className="sg-pptx-upload-icon"><Icon name="folder" size={38} /></div>
      <h2>Откройте свою презентацию</h2>
      <p>Перетащите сюда файл PowerPoint, чтобы добавить анимацию к тексту и диаграммам на слайдах.</p>
      <button className="btn-primary" disabled={!!busy} onClick={() => input.current?.click()}><Icon name="folder" />Выбрать файл PPTX</button>
      <small role="status">{busy || "Файл обрабатывается в браузере"}</small>
    </div>}
    {deck && slide && <fieldset className="sg-pptx-layout" disabled={!!busy} aria-label="Редактор анимации">
      <nav className="ds-panel sg-pptx-slides" aria-label="Слайды презентации">
        <div className="sg-pptx-section-head"><h3>Слайды</h3><span>{deck.slides.length}</span></div>
        <div className="sg-pptx-slide-list">
          {deck.slides.map((s, i) => {
            const n = Object.keys(choices[s.part] ?? {}).length;
            const title = s.objects.find(o => o.kind === "Текст")?.content.split("\n")[0] || "Слайд " + (i + 1);
            return <button key={s.part} className="sg-pptx-slide" aria-current={i === index ? "page" : undefined}
              aria-label={"Слайд " + (i + 1) + " · " + title} onClick={() => setIndex(i)}>
              <span className="sg-pptx-number">{i + 1}</span>
              <span><strong>{title}</strong><small>{n ? n + " " + plural(n, effectForms) : "Без изменений"}</small></span>
            </button>;
          })}
        </div>
      </nav>
      <SlideAnimationEditor key={slide.part + "/" + opened.revision} deck={deck} slide={slide} index={index}
        selection={choices[slide.part] ?? {}} selected={active[slide.part]}
        select={id => setActive(previous => ({ ...previous, [slide.part]: id }))} change={change} />
    </fieldset>}
  </section>;
}
