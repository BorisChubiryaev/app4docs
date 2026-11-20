import { useEffect, useRef, useState } from "react";
import type { Background } from "../core/types";

export default function BackgroundPhoto({ background, onChange, fallback }: {
  background: Background; onChange: (value: Background) => void; fallback: Background;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, [background]);
  async function select(file?: File, asLayer = false) {
    if (!file) return;
    setLoading(true);
    const current = ++request.current;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (current !== request.current) return;
      if (asLayer) {
        const layer = { image, name: file.name, x: 50, y: 50, size: 30 };
        onChange({ ...background, layers: [...(background.layers ?? []), layer] });
        setError("");
        return;
      }
      const sample = document.createElement("canvas");
      sample.width = sample.height = 1;
      const ctx = sample.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.drawImage(image, 0, 0, 1, 1);
      const tone = "#" + Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3), n => n.toString(16).padStart(2, "0")).join("");
      onChange({ ...background, kind: "image", image, imageName: file.name, imageTone: tone });
      setError("");
    } catch {
      if (current === request.current) setError("Не удалось прочитать изображение. Выберите PNG, JPEG или WebP.");
    } finally {
      setLoading(false);
      URL.revokeObjectURL(url);
    }
  }
  return <>
    <label className="sg-field">Фоновое изображение
      <input type="file" disabled={loading} accept="image/png,image/jpeg,image/webp" onChange={e => {
        void select(e.target.files?.[0]);
        e.target.value = "";
      }} />
    </label>
    {background.kind === "image" && <div className="sg-photo-choice"><span>{background.imageName}</span>
      <button className="btn-secondary" onClick={() => onChange({ ...fallback, layers: background.layers })}>Убрать изображение</button></div>}
    <label className="sg-field">Добавить картинку поверх фона
      <input type="file" disabled={loading} accept="image/png,image/jpeg,image/webp" onChange={e => {
        void select(e.target.files?.[0], true);
        e.target.value = "";
      }} />
    </label>
    {background.layers?.map((layer, i, layers) => <fieldset key={i} className="sg-layer">
      <legend>{layer.name}</legend>
      {([["x", "По горизонтали"], ["y", "По вертикали"], ["size", "Размер"]] as const).map(([key, name]) => (
        <label className="sg-field" key={key}>{name} · {layer[key]}%
          <input type="range" min={key === "size" ? 5 : 0} max={100} value={layer[key]} onChange={e =>
            onChange({ ...background, layers: layers.map((l, j) => j === i ? { ...l, [key]: Number(e.target.value) } : l) })} />
        </label>
      ))}
      <button className="btn-secondary" onClick={() => onChange({ ...background, layers: layers.filter((_, j) => j !== i) })}>Удалить картинку</button>
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
  </>;
}
