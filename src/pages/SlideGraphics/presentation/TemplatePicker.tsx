import { useMemo, useState } from "react";
import type { Scene, Template } from "../core/types";
import type { SlideObject } from "../core/presentation";
import { GROUPS, TEMPLATES, byId, newScene } from "../templates";
import Thumb from "../components/TemplateThumb";

const noImages: HTMLImageElement[] = [];
function suggestions(obj?: SlideObject) {
  if (obj?.series.length) return [...(obj.series.length > 1 ? ["pairs"] : []), "bars", "hbars", "line", "donut", "treemap"];
  if (obj?.kind === "photo" || obj?.kind === "video") return ["glass", "deck", "carousel", "flow"];
  if (obj?.text) return ["phrases", "bento", "cover", "levels-pyramid"];
  return ["bars", "line", "donut", "bento", "phrases", "gradient"];
}

function sceneFor(tpl: Template, obj: SlideObject | undefined, sourceText: string, seriesIndex: number, saved?: Scene): Scene {
  const scene = newScene(tpl);
  const p = scene.params;
  const series = obj?.series[seriesIndex];
  if (obj && series && (tpl.input === "rows" || tpl.input === "pairs")) {
    const second = obj.series.length > 1 ? obj.series[(seriesIndex + 1) % obj.series.length] : undefined;
    const other = new Map(second?.points.map(point => [point.index, point.value]));
    scene.rows = series.points.map(point => ({ label: point.label, value: point.value, value2: other.get(point.index) }));
    for (const key of ["subtitle", "unit", "prefix", "center", "delta"]) if (key in p) p[key] = "";
    if ("title" in p) p.title = obj.chartTitle || series.name;
    if ("s1" in p) p.s1 = series.name;
    if ("s2" in p) p.s2 = second?.name ?? "Ряд 2";
    if ("value" in p) p.value = series.points.at(-1)?.value ?? 0;
    if ("decimals" in p) p.decimals = Math.min(6, series.points.reduce((max, pt) => Math.max(max, String(pt.value).split(".")[1]?.length ?? 0), 0));
    if (!tpl.ownBackground) scene.background = { kind: "transparent", color: "#ffffff" };
  }
  if (sourceText) {
    if (tpl.input === "phrases") scene.phrases = tpl.id === "phrases" ? [sourceText.replace(/\n/g, " ")] : sourceText.split("\n").filter(Boolean);
    if ("title" in p) p.title = sourceText.split("\n")[0];
    if ("subtitle" in p) p.subtitle = sourceText.split("\n").slice(1).join(" ");
    if ("text" in p) p.text = sourceText;
  }
  if ((obj?.kind === "photo" || obj?.kind === "video") && tpl.input === "photos") { scene.phrases = []; p.captions = false; }
  if (saved) {
    if (saved.templateId === tpl.id) return saved;
    const from = byId(saved.templateId).input;
    if (["rows", "pairs"].includes(from) && ["rows", "pairs"].includes(tpl.input)) {
      scene.rows = saved.rows.map(row => ({ ...row }));
      for (const key of ["title", "subtitle", "unit", "decimals", "s1", "s2"]) {
        if (key in p && key in saved.params) p[key] = saved.params[key];
      }
    }
    if (from === "phrases" && tpl.input === "phrases") scene.phrases = [...saved.phrases];
  }
  return scene;
}

type Props = {
  object?: SlideObject; sourceText: string; previous?: Scene; images?: HTMLImageElement[]; loading?: boolean;
  onChoose: (tpl: Template, scene: Scene) => void;
};

export default function TemplatePicker({ object, sourceText, previous, images = noImages, loading, onChoose }: Props) {
  const [category, setCategory] = useState("suggested");
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [series, setSeries] = useState(0);
  const [useEditedData, setUseEditedData] = useState(!!previous);
  const query = search.trim().toLocaleLowerCase("ru");
  const choices = useMemo(() => {
    const library = category === "suggested" && !query ? suggestions(object).map(byId) : TEMPLATES;
    return library.filter(t => (category === "suggested" || category === "all" || t.group === category)
      && !(object?.series.length === 1 && t.input === "pairs")
      && t.name.toLocaleLowerCase("ru").includes(query)).map(tpl => ({ tpl, scene: sceneFor(tpl, object, sourceText, series, useEditedData ? previous : undefined) }));
  }, [object, sourceText, previous, useEditedData, series, category, query]);
  return <div className="pw-picker">
    {object && <div className="pw-picker-heading"><h4>Анимированные шаблоны</h4><p className="pw-hint">Выберите шаблон, чтобы увидеть анимацию на слайде. В копии PPTX он заменит исходный объект.</p></div>}
    {object?.series.length ? <div className="pw-source">
      {object.series.length > 1 ? <label>Данные из презентации
        <select aria-label="Ряд данных" value={series} onChange={e => { setSeries(+e.target.value); setUseEditedData(false); }}>
          {object.series.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
        </select>
      </label> : <><small>Данные из презентации</small><strong>{object.series[0].name}</strong></>}
      <span>{object.series[series].points.map(p => p.value.toLocaleString("ru-RU")).join(" · ")}</span>
    </div> : null}
    <input type="search" className="ds-input" aria-label="Найти оформление" placeholder="Найти шаблон" value={search} onChange={e => setSearch(e.target.value)} />
    <select className="ds-select" aria-label="Раздел библиотеки" value={category} onChange={e => setCategory(e.target.value)}>
      <option value="suggested">{object ? "Для этого объекта" : "Популярные шаблоны"}</option>
      {GROUPS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
    <div className="pw-template-grid">
      {choices.map(({ tpl, scene }) => <button key={tpl.id} className="pw-template" disabled={loading} onClick={() => onChoose(tpl, scene)}
        onPointerEnter={e => { if (e.pointerType === "mouse") setHovered(tpl.id); }} onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered(tpl.id)} onBlur={() => setHovered(null)}>
        <span className="pw-template-pic"><Thumb tpl={tpl} scene={scene} images={images} hover={hovered === tpl.id} /></span><strong>{tpl.name}</strong>
      </button>)}
    </div>
    {!choices.length && <p className="pw-hint">По этому запросу нет шаблонов.</p>}
  </div>;
}
