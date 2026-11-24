import { useRef, useState } from "react";
import { Icon } from "../../ChartCraft/components/icons";
import { openPresentation, PresentationError, type Presentation } from "../core/presentation";
import cover from "../assets/product-review.png?inline";

type Props = { previous: Presentation | null; dirty: boolean; onOpen: (deck: Presentation, initialObject?: string) => void; onResume: () => void };

export default function PresentationStart({ previous, dirty, onOpen, onResume }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  async function open(file?: File) {
    if (busy) return;
    const isExample = !file;
    setBusy(true);
    setError("");
    try {
      if (!file) {
        const { default: exampleUrl } = await import("../assets/product-review.pptx?url&inline");
        const response = await fetch(exampleUrl);
        if (!response.ok) throw new Error();
        file = new File([await response.blob()], "Обзор продукта.pptx");
      }
      const next = await openPresentation(file);
      if (dirty && !window.confirm("Открыть другой файл? Правки в текущей презентации ещё не скачаны.")) return;
      onOpen(next, isExample ? next.slides[0].objects.find(o => o.kind === "chart")?.id : undefined);
    } catch (e) {
      setError(e instanceof PresentationError ? e.message : "Не удалось открыть презентацию. Проверьте, что файл открывается в PowerPoint.");
    } finally { setBusy(false); }
  }
  return (
    <section className={`pw-start${dragging ? " is-over" : ""}`} aria-labelledby="pw-start-title"
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) void open(file); }}>
      <div className="pw-start-copy">
        <h2 id="pw-start-title">Оформить свою презентацию</h2>
        <p>Выберите объект прямо на слайде PowerPoint. Измените текст, оформите диаграмму или добавьте графику из библиотеки.</p>
        <div className="pw-start-actions">
          {previous && <button className="pw-primary" onClick={onResume}>Продолжить работу</button>}
          <button className={previous ? "pw-quiet" : "pw-primary"} disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="folder" />{busy ? "Открываем…" : previous ? "Другой файл" : "Открыть PPTX"}
          </button>
          {!previous && <button className="pw-quiet" disabled={busy} onClick={() => void open()}>Попробовать на примере <span aria-hidden="true">→</span></button>}
        </div>
        <input ref={input} type="file" hidden accept=".pptx" aria-label="Файл PowerPoint" onChange={e => {
          const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void open(file);
        }} />
        <small>{previous ? previous.file.name : "Можно перетащить .pptx сюда. Файл обрабатывается в браузере."}</small>
        {error && <p className="pw-error" role="alert">{error}</p>}
      </div>
      <div className="pw-start-art" aria-hidden="true"><div className="pw-start-sheet"><img src={cover} alt="" /><i /></div></div>
    </section>
  );
}
