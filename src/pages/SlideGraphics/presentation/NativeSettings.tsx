import { Icon } from "../../ChartCraft/components/icons";
import type { NativeStyle, SlideObject } from "../core/presentation";
import NumberInput from "../components/NumberInput";

const colors = [
  ["Графит", "#282535"], ["Фиолетовый", "#684bc1"], ["Синий", "#2267aa"],
  ["Зелёный", "#16745f"], ["Коралловый", "#bd5146"], ["Белый", "#ffffff"],
];
function ColorField({ label, value, change }: { label: string; value?: string; change: (color: string) => void }) {
  return <div className="pw-color-field" role="group" aria-label={label}><span>{label}</span>
    <div>{colors.map(([name, hex]) => <button key={hex} aria-label={`${label} — ${name}`} aria-pressed={value?.toLowerCase() === hex}
      title={name} style={{ backgroundColor: hex }} onClick={() => change(hex)} />)}
      <label title="Выбрать другой цвет"><Icon name="plus" size={14} /><input type="color" value={value ?? "#282535"} aria-label={`${label} — свой цвет`} onChange={e => change(e.target.value)} /></label>
    </div>
  </div>;
}
type Props = { object: SlideObject; style: NativeStyle; update: (style: NativeStyle) => void; onTemplates: () => void };

export default function NativeSettings({ object, style, update, onTemplates }: Props) {
  return <div className="pw-native">
    {object.kind === "text" && <>
      <label className="sg-field"><span className="sg-field__label">Текст на слайде</span>
        <textarea rows={3} value={style.text ?? object.text} onChange={e => update({ text: e.target.value })} /></label>
      <label className="sg-field sg-field--row"><span className="sg-field__label">Кегль, пт</span>
        <NumberInput min={1} max={4000} placeholder="Из макета" title="От 1 до 4000 пт" value={style.fontSize ?? object.fontSize}
          onValue={size => update({ fontSize: Math.round(size * 100) / 100 })} /></label>
      <ColorField label="Цвет текста" value={style.ink ?? object.ink} change={ink => update({ ink })} />
    </>}
    <ColorField label="Заливка фигуры" value={style.fill ?? object.fill} change={fill => update({ fill })} />
    <button className="pw-secondary" onClick={onTemplates}><Icon name="sliders" size={16} />Заменить шаблоном</button>
  </div>;
}
