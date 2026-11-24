import { useId, type CSSProperties, type FC, type ReactNode } from "react";
import type { Control, Row, Scene, Template, Val } from "../core/types";
import { SAFE_DARK, SAFE_LIGHT } from "../core/render";
import { newScene, PALETTES } from "../templates";
import { BG_PRESETS } from "../templates/scenes";
import RowsEditor from "./RowsEditor";
import NumberInput from "./NumberInput";

/** Поля, которые относятся к содержанию, — в разделе «Данные» */
const DATA_KEYS = new Set(["title", "subtitle", "value", "caption", "delta", "center", "s1", "s2", "prefix", "unit", "decimals", "text"]);
const isDataControl = (c: Control) => c.data || DATA_KEYS.has(c.key);
const Field: FC<{ c: Control; value: Val | undefined; onChange: (v: Val) => void }> = ({ c, value, onChange }) => {
  const id = useId();
  switch (c.type) {
    case "textarea":
      return (
        <label className="sg-field">
          <span className="sg-field__label">{c.label}</span>
          <textarea aria-label={c.label} rows={3} value={String(value ?? "")} onChange={e => onChange(e.target.value)} />
        </label>
      );
    case "time":
    case "text":
      return (
        <label className="sg-field">
          <span className="sg-field__label">{c.label}</span>
          <input type={c.type} value={String(value ?? "")} placeholder={c.placeholder} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
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
    case "fontSize": {
      const n = Number(value ?? c.min);
      const sliderValue = Math.max(c.min, Math.min(c.max, n));
      return (
        <div className="sg-field">
          <div className="sg-field__label">
            <label htmlFor={id}>{c.label}</label>
            {c.type === "fontSize"
              ? <NumberInput aria-label={c.label} min={1} value={n} onValue={onChange} />
              : <b>{`${n}${c.unit ?? ""}`}</b>}
          </div>
          <input
            id={id} type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={sliderValue}
            style={{ "--k": `${(sliderValue - c.min) / (c.max - c.min || 1) * 100}%` } as CSSProperties}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );
    }
    case "select":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
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
        <label className="sg-switch">
          <span className="sg-field__label">{c.label}</span>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <i aria-hidden="true" />
        </label>
      );
    case "color":
      return (
        <label className="sg-field sg-field--row">
          <span className="sg-field__label">{c.label}</span>
          <span className="sg-colorpick">
            <input type="color" value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />
            <code>{String(value ?? "")}</code>
          </span>
        </label>
      );
  }
};

const Section: FC<{ title: string; children: ReactNode; open?: boolean }> = ({ title, children, open = true }) => (
  <details className="sg-sec" open={open}>
    <summary>{title}</summary>
    <div className="sg-sec__body">{children}</div>
  </details>
);

type Props = {
  tpl: Template;
  scene: Scene;
  images: HTMLImageElement[];
  previewDark: boolean;
  preserveData?: boolean;
  update: (patch: Partial<Scene>) => void;
  addPhotos: (files: FileList | null) => void;
  removePhoto: (index: number) => void;
};

export default function TemplateSettings({ tpl, scene, images, previewDark, preserveData = false, update, addPhotos, removePhoto }: Props) {
  const setParam = (key: string, value: Val) => update({ params: { ...scene.params, [key]: value } });
  const autoPal = previewDark ? SAFE_DARK : SAFE_LIGHT;
  const dataControls = tpl.controls.filter(isDataControl);
  const lookControls = tpl.controls.filter((c) => !isDataControl(c) && (!c.when || c.when(scene.params)));
  // Выбор палитры: шаблон может переключить свои цвета на неё
  const pickPalette = (pal: string[], auto: boolean) =>
    update({ palette: [...pal], paletteAuto: auto, params: { ...scene.params, ...(tpl.onPalette?.(scene.params, pal) ?? {}) } });
  const cardTpl = ["carousel", "deck", "flow"].includes(tpl.id);
  const usesPhrases = tpl.input === "phrases" || cardTpl;
  const usesRows = tpl.input === "flows" || tpl.input === "rows" || tpl.input === "pairs" || tpl.input === "people";
  const usesPhotos = tpl.input === "photos" || tpl.input === "people";
  function reset() {
    const next = newScene(tpl);
    if (preserveData) {
      next.rows = scene.rows;
      next.phrases = scene.phrases;
      for (const control of dataControls) next.params[control.key] = scene.params[control.key];
    }
    update(next);
  }
  return (
    <>
      {(dataControls.length > 0 || usesRows || usesPhotos || usesPhrases) && (
        <Section title="Данные">
          {dataControls.map((c) => (
            <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
          ))}
          {usesRows && <RowsEditor input={tpl.input} rows={scene.rows} names={[String(scene.params.s1 ?? ""), String(scene.params.s2 ?? "")]} onChange={(rows: Row[]) => update({ rows })} />}
          {usesPhotos && (
            <div className="sg-photos">
              <div className="sg-photos__head">
                <span className="sg-field__label">{tpl.input === "people" ? "Фото — по порядку строк" : "Фото"}</span>
                <label className="sg-btn sg-btn--sm">
                  ＋ Добавить
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
                </label>
              </div>
              {images.length ? (
                <>
                {cardTpl && <p className="sg-hint">Подписи ниже ложатся на фото по порядку. Если подписей больше, чем фото, — остальные карточки будут цветными.</p>}
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
                </>
              ) : (
                <p className="sg-hint">{tpl.id === "glass" ? "Без фото под стеклом — цветные пятна." : "Без фото — цветные карточки с подписями."} Фото остаются только в вашем браузере.</p>
              )}
            </div>
          )}
          {usesPhrases && (
            <label className="sg-field">
              <span className="sg-field__label">{tpl.phrasesLabel ?? (cardTpl ? "Подписи карточек — по одной в строке, вторая часть после «|»" : "Фразы — по одной в строке, вторая часть после «|»")}</span>
              <textarea rows={6} value={scene.phrases.join("\n")} onChange={(e) => update({ phrases: e.target.value.split("\n") })} />
            </label>
          )}
        </Section>
      )}

      {lookControls.length > 0 && (
        <Section title="Вид">
          {tpl.ownBackground && !["cover", "spiral", "magnet"].includes(tpl.id) && (
            <div className="sg-presets">
              {BG_PRESETS.map(([name, base, pal]) => (
                <button
                  key={name}
                  className="sg-preset"
                  style={{ background: `radial-gradient(circle at 28% 30%, ${pal[0]}, transparent 62%), radial-gradient(circle at 76% 72%, ${pal[1]}, transparent 60%), ${base}` }}
                  onClick={() => update({ palette: [...pal], paletteAuto: false, params: { ...scene.params, base } })}
                >
                  <span>{name}</span>
                </button>
              ))}
            </div>
          )}
          {lookControls.map((c) => (
            <Field key={c.key} c={c} value={scene.params[c.key]} onChange={(v) => setParam(c.key, v)} />
          ))}
        </Section>
      )}

      <Section title="Цвета" open={false}>
        <div className="sg-pals">
          <button className={`sg-pal ${scene.paletteAuto ? "is-on" : ""}`} onClick={() => pickPalette(autoPal, true)} title="Проверенная палитра: цвета различимы, в том числе при нарушениях цветовосприятия">
            <span className="sg-pal__dots">
              {autoPal.slice(0, 5).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            Проверенная
          </button>
          {PALETTES.map(([name, pal]) => (
            <button key={name} className={`sg-pal ${!scene.paletteAuto && scene.palette.join() === pal.join() ? "is-on" : ""}`} onClick={() => pickPalette(pal, false)}>
              <span className="sg-pal__dots">
                {pal.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {name}
            </button>
          ))}
        </div>
        {!scene.paletteAuto && (
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
              <button className="sg-btn sg-btn--sm" onClick={() => update({ palette: [...scene.palette, scene.palette[scene.palette.length - 1] ?? "#4f6ef7"] })}>
                ＋
              </button>
            )}
          </div>
        )}
      </Section>

      {!tpl.ownBackground && (
        <Section title="Фон" open={false}>
          <div className="sg-chips">
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
                {k !== "transparent" && <i style={{ background: k === "custom" ? scene.background.color : k === "white" ? "#fff" : k === "light" ? "#f4f5f8" : "#0e1016" }} />}
                {l}
              </button>
            ))}
          </div>
          {scene.background.kind === "custom" && (
            <label className="sg-field sg-field--row">
              <span className="sg-field__label">Цвет фона</span>
              <span className="sg-colorpick">
                <input type="color" value={scene.background.color} onChange={(e) => update({ background: { kind: "custom", color: e.target.value } })} />
                <code>{scene.background.color}</code>
              </span>
            </label>
          )}
          <label className="sg-field sg-field--row">
            <span className="sg-field__label">Цвет текста</span>
            <select value={scene.ink} onChange={(e) => update({ ink: e.target.value as Scene["ink"] })}>
              <option value="auto">По фону</option>
              <option value="dark">Тёмный — для светлых слайдов</option>
              <option value="light">Светлый — для тёмных слайдов</option>
            </select>
          </label>
        </Section>
      )}
      <button className="sg-reset" onClick={reset}>
        {preserveData ? "Сбросить оформление" : "Вернуть настройки шаблона"}
      </button>
    </>
  );
}
