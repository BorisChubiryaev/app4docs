import React, { useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import type { BuildOptions, PlanItem, SourceSlide } from "./engine/build";
import type { Role, TemplateProfile } from "./engine/template";
import "./PptxRestyle.css";

// Перенос презентаций в новый шаблон: фон, шрифты, цвета и место заголовков
// берутся из шаблона, содержимое слайдов — из исходных файлов. Несколько
// исходников собираются в одну презентацию (разделы — по файлам).

const engine = () => import("./engine/build");

const ROLE_LABEL: Record<Role, string> = {
  title: "Титульный",
  section: "Раздел",
  content: "Обычный",
  end: "Финальный",
};

const isPptx = (f: File) => /\.(pptx|potx)$/i.test(f.name);
const baseName = (n: string) => n.replace(/\.(pptx|potx)$/i, "");
const fmtMb = (n: number) => `${(n / 1048576).toFixed(1)} МБ`;

interface TemplateState {
  file: File;
  data: ArrayBuffer;
  profile: TemplateProfile;
  previews: Record<string, string>;
}

interface SourceState {
  id: number;
  file: File;
  data: ArrayBuffer;
  slides: (SourceSlide & { include: boolean; bg: string | null })[];
  ratio: number;
}

type FlagKey = Exclude<keyof BuildOptions, "textColors">;

const TEXT_COLOR_MODES: { id: BuildOptions["textColors"]; title: string; hint: string }[] = [
  {
    id: "template",
    title: "Цвета шаблона",
    hint: "Заголовки — цветом заголовков шаблона, весь текст — цветом текста шаблона (зелёные заголовки старого оформления станут как в шаблоне)",
  },
  {
    id: "palette",
    title: "Фирменные акценты",
    hint: "Заголовки — как в шаблоне, выделенные цветом слова — в ближайший цвет палитры шаблона",
  },
  {
    id: "keep",
    title: "Как в исходнике",
    hint: "Цветной текст и заголовки сохраняют свои цвета (с поправкой, чтобы читались на новом фоне)",
  },
];

const OPTION_TEXT: { key: FlagKey; title: string; hint: string }[] = [
  { key: "fonts", title: "Шрифты шаблона", hint: "Весь текст — шрифтами шаблона (заголовки — шрифтом заголовков)" },
  { key: "colors", title: "Цвета шаблона", hint: "Текст читается на новом фоне, заливки и линии — в фирменной палитре, таблицы и диаграммы перекрашены" },
  { key: "titles", title: "Заголовки на место шаблона", hint: "Заголовок слайда переносится туда, где он стоит в шаблоне, с его размером; длинный уменьшается, чтобы не наехать на содержимое" },
  { key: "dropBackgroundPictures", title: "Убрать фоновые картинки", hint: "Картинки во весь слайд из старого оформления удаляются" },
  { key: "notes", title: "Заметки докладчика", hint: "Переносятся вместе со слайдами" },
  { key: "sections", title: "Разделы по файлам", hint: "Если файлов несколько, каждый становится разделом в PowerPoint" },
];

const PptxRestyle: React.FC = () => {
  const [template, setTemplate] = useState<TemplateState | null>(null);
  const [sources, setSources] = useState<SourceState[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; size: number; slides: number } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [options, setOptions] = useState<BuildOptions>({
    fonts: true,
    colors: true,
    textColors: "template",
    titles: true,
    dropBackgroundPictures: true,
    sections: true,
    notes: true,
  });
  const nextId = useRef(1);
  const tplInput = useRef<HTMLInputElement>(null);
  const srcInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<"tpl" | "src" | null>(null);

  useEffect(
    () => () => {
      if (template) Object.values(template.previews).forEach(URL.revokeObjectURL);
    },
    [template],
  );
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const clearResult = () => setResult(null);

  const bgFor = (role: Role, profile: TemplateProfile) => profile.roles[role] ?? profile.roles.content ?? profile.backgrounds[0]?.id ?? null;

  const loadTemplate = async (file: File) => {
    if (!isPptx(file)) return setError("Шаблон — файл PowerPoint (.pptx или .potx)");
    setError("");
    clearResult();
    setBusy("Изучаем шаблон…");
    try {
      const data = await file.arrayBuffer();
      const { inspectTemplate } = await engine();
      const { profile, images } = await inspectTemplate(data, file.name);
      if (!profile.backgrounds.length) throw new Error("В шаблоне нет ни одного слайда-примера");
      const previews: Record<string, string> = {};
      for (const [id, img] of Object.entries(images)) previews[id] = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.type }));
      setTemplate({ file, data, profile, previews });
      // Фоны слайдов уже загруженных материалов — по ролям нового шаблона
      setSources((prev) => prev.map((s) => ({ ...s, slides: s.slides.map((sl) => ({ ...sl, bg: bgFor(sl.role, profile) })) })));
    } catch (e) {
      setError(`Не удалось прочитать шаблон: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const addSources = async (files: File[]) => {
    const ok = files.filter(isPptx);
    if (!ok.length) return setError("Материалы — файлы PowerPoint (.pptx)");
    setError("");
    clearResult();
    const { describeSource } = await engine();
    for (const file of ok) {
      setBusy(`Читаем «${file.name}»…`);
      try {
        const data = await file.arrayBuffer();
        const id = nextId.current++;
        const d = await describeSource(data, file.name, id);
        const slides = d.slides.map((s) => ({ ...s, include: true, bg: template ? bgFor(s.role, template.profile) : null }));
        setSources((prev) => [...prev, { id, file, data, slides, ratio: d.cx / d.cy }]);
      } catch (e) {
        setError(`Не удалось прочитать «${file.name}»: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy("");
  };

  const updateSlide = (srcId: number, index: number, patch: Partial<SourceState["slides"][number]>) => {
    clearResult();
    setSources((prev) =>
      prev.map((s) => (s.id !== srcId ? s : { ...s, slides: s.slides.map((sl) => (sl.index === index ? { ...sl, ...patch } : sl)) })),
    );
  };

  const moveSource = (id: number, dir: -1 | 1) => {
    clearResult();
    setSources((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const totalSlides = useMemo(() => sources.reduce((n, s) => n + s.slides.filter((x) => x.include).length, 0), [sources]);

  const build = async () => {
    if (!template || !totalSlides) return;
    setError("");
    clearResult();
    setBusy("Собираем презентацию…");
    setProgress(0);
    try {
      const { buildPresentation } = await engine();
      const plan: PlanItem[] = [];
      sources.forEach((s, di) => s.slides.forEach((sl) => sl.include && plan.push({ deck: di, index: sl.index, role: sl.role, bg: sl.bg })));
      const bytes = await buildPresentation(
        { name: template.file.name, data: template.data },
        sources.map((s) => ({ name: s.file.name, data: s.data })),
        plan,
        options,
        (done, total) => setProgress(total ? done / total : 0),
      );
      const name = `${baseName(sources[0].file.name)}${sources.length > 1 ? "_объединённая" : ""}_в_шаблоне.pptx`;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
      setResult({ url, name, size: bytes.byteLength, slides: plan.length });
    } catch (e) {
      console.error(e);
      setError(`Не удалось собрать презентацию: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };

  const drop = (kind: "tpl" | "src") => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const files = Array.from(e.dataTransfer.files);
    if (kind === "tpl") files[0] && loadTemplate(files[0]);
    else addSources(files);
  };
  const dragProps = (kind: "tpl" | "src") => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(kind);
    },
    onDragLeave: () => setDragOver(null),
    onDrop: drop(kind),
  });

  const p = template?.profile;
  const bgOptions = p?.backgrounds ?? [];

  return (
    <PageShell
      title="Перенос в шаблон"
      subtitle="Переложите презентации в новый корпоративный шаблон: фон, шрифты, цвета и заголовки — автоматически, содержимое — как было"
      onShowInstructions={() => setShowInstructions(true)}
      width={1320}
    >
      <div className="rs">
        {error && (
          <div className="rs-error" role="alert">
            ⚠️ {error}
            <button onClick={() => setError("")} aria-label="Закрыть">
              ✕
            </button>
          </div>
        )}

        {/* ── 1. Шаблон ── */}
        <section className="rs-step">
          <h2 className="rs-step__title">
            <span className="rs-num">1</span> Новый шаблон
          </h2>
          {!template ? (
            <div
              className={`rs-drop ${dragOver === "tpl" ? "is-over" : ""}`}
              onClick={() => tplInput.current?.click()}
              {...dragProps("tpl")}
            >
              <div className="rs-drop__icon">🎨</div>
              <p>
                <strong>Перетащите файл шаблона</strong> или нажмите, чтобы выбрать
              </p>
              <small>
                .pptx или .potx — шаблон или любая презентация в нужном оформлении (например, фирменный шаблон
                департамента или конференции)
              </small>
            </div>
          ) : (
            <div className="rs-tpl">
              <div className="rs-tpl__head">
                <div>
                  <strong>{template.file.name}</strong>
                  <span className="rs-muted"> · {fmtMb(template.file.size)}</span>
                </div>
                <button className="rs-link" onClick={() => tplInput.current?.click()}>
                  Заменить шаблон
                </button>
              </div>
              <div className="rs-style">
                <div className="rs-style__item">
                  <span className="rs-muted">Заголовок</span>
                  <span
                    className="rs-sample"
                    style={{ color: `#${p!.title.color}`, background: p!.dark ? "#14161f" : "#fff", fontFamily: `"${p!.title.font}", sans-serif` }}
                  >
                    {p!.title.font}, {Math.round(p!.title.sz / 100)} pt
                  </span>
                </div>
                <div className="rs-style__item">
                  <span className="rs-muted">Текст</span>
                  <span
                    className="rs-sample"
                    style={{ color: `#${p!.body.color}`, background: p!.dark ? "#14161f" : "#fff", fontFamily: `"${p!.body.font}", sans-serif` }}
                  >
                    {p!.body.font}
                  </span>
                </div>
                <div className="rs-style__item">
                  <span className="rs-muted">Палитра</span>
                  <span className="rs-swatches">
                    {p!.palette.map((c) => (
                      <span key={c} className="rs-swatch" style={{ background: `#${c}` }} title={`#${c}`} />
                    ))}
                    {p!.card && <span className="rs-swatch rs-swatch--card" style={{ background: `#${p!.card}` }} title={`Карточки #${p!.card}`} />}
                  </span>
                </div>
                <div className="rs-style__item">
                  <span className="rs-muted">Оформление</span>
                  <span>{p!.dark ? "тёмное" : "светлое"}</span>
                </div>
              </div>
              <div className="rs-bgs">
                {bgOptions.map((b) => (
                  <figure key={b.id} className="rs-bg">
                    {template.previews[b.id] ? (
                      <img src={template.previews[b.id]} alt={b.label} />
                    ) : (
                      <div className="rs-bg__none">фон макета «{b.label}»</div>
                    )}
                    <figcaption>{b.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
          <input
            ref={tplInput}
            type="file"
            accept=".pptx,.potx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) loadTemplate(f);
            }}
          />
        </section>

        {/* ── 2. Материалы ── */}
        <section className="rs-step">
          <h2 className="rs-step__title">
            <span className="rs-num">2</span> Презентации, которые переносим
          </h2>
          <div
            className={`rs-drop rs-drop--small ${dragOver === "src" ? "is-over" : ""}`}
            onClick={() => srcInput.current?.click()}
            {...dragProps("src")}
          >
            <span className="rs-drop__icon">📥</span>
            <span>
              <strong>Перетащите один или несколько .pptx</strong> — например, материалы разных руководителей: они
              соберутся в одну презентацию в едином стиле
            </span>
          </div>
          <input
            ref={srcInput}
            type="file"
            accept=".pptx"
            multiple
            hidden
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              e.target.value = "";
              addSources(fs);
            }}
          />

          {sources.map((s, si) => (
            <div key={s.id} className="rs-src">
              <div className="rs-src__head">
                <strong title={s.file.name}>{s.file.name}</strong>
                <span className="rs-muted">
                  {s.slides.length} слайд(ов){Math.abs(s.ratio - 16 / 9) > 0.05 ? ` · формат ${s.ratio < 1.5 ? "4:3" : "другой"} — будет вписан` : ""}
                </span>
                <span className="rs-src__actions">
                  <button className="rs-icon" onClick={() => moveSource(s.id, -1)} disabled={si === 0} title="Выше">
                    ↑
                  </button>
                  <button className="rs-icon" onClick={() => moveSource(s.id, 1)} disabled={si === sources.length - 1} title="Ниже">
                    ↓
                  </button>
                  <button
                    className="rs-icon"
                    onClick={() => {
                      clearResult();
                      setSources((prev) => prev.filter((x) => x.id !== s.id));
                    }}
                    title="Убрать файл"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <table className="rs-slides">
                <thead>
                  <tr>
                    <th aria-label="Переносить" />
                    <th>№</th>
                    <th>Заголовок слайда</th>
                    <th>Тип</th>
                    <th>Фон из шаблона</th>
                  </tr>
                </thead>
                <tbody>
                  {s.slides.map((sl) => (
                    <tr key={sl.index} className={sl.include ? "" : "is-off"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={sl.include}
                          onChange={(e) => updateSlide(s.id, sl.index, { include: e.target.checked })}
                          aria-label={`Переносить слайд ${sl.index + 1}`}
                        />
                      </td>
                      <td className="rs-muted">{sl.index + 1}</td>
                      <td className="rs-slides__title">{sl.title || <span className="rs-muted">без заголовка</span>}</td>
                      <td>
                        <select
                          className="ds-select rs-select"
                          value={sl.role}
                          onChange={(e) => {
                            const role = e.target.value as Role;
                            updateSlide(s.id, sl.index, { role, bg: p ? bgFor(role, p) : sl.bg });
                          }}
                        >
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="rs-bgpick">
                          {sl.bg && template?.previews[sl.bg] && <img src={template.previews[sl.bg]} alt="" />}
                          <select
                            className="ds-select rs-select"
                            value={sl.bg ?? ""}
                            disabled={!template}
                            onChange={(e) => updateSlide(s.id, sl.index, { bg: e.target.value || null })}
                          >
                            {!template && <option value="">сначала выберите шаблон</option>}
                            {bgOptions.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.label}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {/* ── 3. Настройки и сборка ── */}
        <section className="rs-step">
          <h2 className="rs-step__title">
            <span className="rs-num">3</span> Что менять
          </h2>
          <div className="rs-options">
            {OPTION_TEXT.map((o) => (
              <label key={o.key} className="rs-option" title={o.hint}>
                <input
                  type="checkbox"
                  checked={options[o.key]}
                  onChange={(e) => {
                    clearResult();
                    setOptions({ ...options, [o.key]: e.target.checked });
                  }}
                />
                <span>
                  <strong>{o.title}</strong>
                  <small>{o.hint}</small>
                </span>
              </label>
            ))}
          </div>

          <div className={`rs-textmode ${options.colors ? "" : "is-off"}`} role="radiogroup" aria-label="Цветной текст">
            <span className="rs-textmode__label">Цветной текст и заголовки</span>
            {TEXT_COLOR_MODES.map((m) => (
              <label key={m.id} className={`rs-chip ${options.textColors === m.id ? "is-active" : ""}`} title={m.hint}>
                <input
                  type="radio"
                  name="textColors"
                  checked={options.textColors === m.id}
                  disabled={!options.colors}
                  onChange={() => {
                    clearResult();
                    setOptions({ ...options, textColors: m.id });
                  }}
                />
                {m.title}
              </label>
            ))}
            <small className="rs-muted">{TEXT_COLOR_MODES.find((m) => m.id === options.textColors)?.hint}</small>
          </div>

          <div className="rs-actions">
            <button className="btn-primary rs-build" disabled={!template || !totalSlides || !!busy} onClick={build}>
              {busy && progress !== null ? `⏳ ${Math.round(progress * 100)}%` : `🪄 Собрать презентацию${totalSlides ? ` (${totalSlides} слайд.)` : ""}`}
            </button>
            {!template && <span className="rs-muted">Загрузите шаблон</span>}
            {template && !sources.length && <span className="rs-muted">Добавьте презентации</span>}
            {busy && <span className="rs-muted">{busy}</span>}
          </div>
          {result && (
            <div className="rs-result">
              <span>
                ✅ Готово: {result.slides} слайд(ов), {fmtMb(result.size)}
              </span>
              <a className="btn-primary" href={result.url} download={result.name}>
                💾 Скачать «{result.name}»
              </a>
            </div>
          )}
          <p className="rs-muted rs-note">
            Всё выполняется в браузере — файлы никуда не отправляются. Откройте результат в PowerPoint и просмотрите
            слайды: сложные схемы иногда требуют ручной доводки (например, если новый шрифт шире старого).
          </p>
        </section>
      </div>

      <InstructionsModalShell
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        title="🪄 Перенос в шаблон"
        footerLabel="Понятно!"
        maxWidth={760}
      >
        <div className="instructions-section">
          <h3>Для чего</h3>
          <ul>
            <li>Обновился фирменный шаблон — переложить старые презентации в новый</li>
            <li>Готовили слайды к конференции, а потом прислали централизованный шаблон</li>
            <li>
              Каждый руководитель подготовил свою часть в своём оформлении — собрать всё в одну презентацию в едином
              стиле
            </li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>Как пользоваться</h3>
          <ol>
            <li>
              Загрузите <strong>шаблон</strong>: .potx или любую презентацию в нужном оформлении. Инструмент сам найдёт
              в нём фоны (титульный, основной, раздел, финальный), шрифты и цвет заголовков и текста, фирменную палитру.
            </li>
            <li>
              Добавьте <strong>презентации</strong> — одну или несколько. Для каждого слайда видно, каким он будет:
              титульный, раздел или обычный, и какой фон шаблона получит. Это можно поменять, а лишние слайды —
              выключить.
            </li>
            <li>
              Нажмите <strong>«Собрать презентацию»</strong> и скачайте результат.
            </li>
          </ol>
        </div>
        <div className="instructions-section">
          <h3>Что происходит со слайдами</h3>
          <ul>
            <li>Фон — из шаблона; старые фоны и элементы старого оформления убираются</li>
            <li>Текст — шрифтами шаблона; цвет подбирается так, чтобы читался на новом фоне</li>
            <li>
              Цветной текст — на выбор: цветами шаблона (по умолчанию: заголовки и подзаголовки — цветом заголовков
              шаблона, остальное — цветом текста), фирменными акцентами палитры или как в исходнике
            </li>
            <li>Заголовки встают на место и в размер, как в шаблоне; длинные — уменьшаются</li>
            <li>Цветные фигуры — в фирменную палитру, светлые плашки на тёмном шаблоне — в «карточки» шаблона</li>
            <li>Таблицы и диаграммы перекрашиваются; картинки, схемы и всё содержимое остаются как были</li>
            <li>Слайды 4:3 вписываются в 16:9 без искажений; заметки докладчика сохраняются</li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>Ограничения</h3>
          <ul>
            <li>
              Фирменные шрифты должны быть установлены на компьютере, где открывается презентация (у сотрудников они
              обычно есть)
            </li>
            <li>Расположение блоков на слайде не меняется — инструмент меняет оформление, а не вёрстку</li>
            <li>Схемы SmartArt и картинки с «зашитыми» цветами остаются как были</li>
          </ul>
        </div>
      </InstructionsModalShell>
    </PageShell>
  );
};

export default PptxRestyle;
