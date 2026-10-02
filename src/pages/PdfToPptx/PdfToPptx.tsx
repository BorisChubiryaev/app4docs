import React, { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import PageShell from "../../components/PageShell";
import InstructionsModalShell from "../../components/InstructionsModal";
import type {
  ConvertMode,
  WorkerRequest,
  WorkerResponse,
} from "./pdf2pptx.types";
import { plural } from "../../utils/plural";
import "./PdfToPptx.css";

type EngineState =
  | { status: "loading"; text: string; step: number; steps: number }
  | { status: "ready"; ms: number; runtimeSize: string; engineCommit: string }
  | { status: "error"; message: string; details?: string };

type JobStatus = "queued" | "converting" | "done" | "error";

interface Job {
  id: number;
  file: File;
  mode: ConvertMode;
  status: JobStatus;
  done: number;
  total: number;
  startedAt?: number;
  ms?: number;
  url?: string;
  blob?: Blob;
  error?: string;
  details?: string;
}

const MODES: { id: ConvertMode; title: string; text: string }[] = [
  {
    id: "editable",
    title: "Редактируемая",
    text: "Текст — текстовыми блоками, картинки — картинками, графика — фигурами PowerPoint. Всё, что нельзя повторить точно, вставляется картинкой.",
  },
  {
    id: "exact",
    title: "Точная копия",
    text: "Слайд = изображение страницы + редактируемый текст поверх. Быстрее и всегда 1:1, но фигуры и картинки не редактируются.",
  },
];

const fmtBytes = (n: number) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(0)} КБ`
    : `${(n / 1024 / 1024).toFixed(1)} МБ`;
const fmtSec = (ms: number) =>
  ms < 60000
    ? `${Math.max(1, Math.round(ms / 1000))} с`
    : `${Math.floor(ms / 60000)} мин ${Math.round((ms % 60000) / 1000)} с`;
const pptxName = (file: File) => file.name.replace(/\.pdf$/i, "") + ".pptx";

const isPdf = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

const PdfToPptx: React.FC = () => {
  const [engine, setEngine] = useState<EngineState>({
    status: "loading",
    text: "Готовим движок…",
    step: 0,
    steps: 1,
  });
  const [mode, setMode] = useState<ConvertMode>("editable");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [skipped, setSkipped] = useState<string[]>([]);
  // Подсказку про первую загрузку показываем, только если подготовка затянулась.
  const [slowStart, setSlowStart] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchJob = (id: number, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  // ── Фоновый поток: создаём при открытии страницы и сразу грузим движок ──
  const startWorker = useCallback(() => {
    const worker = new Worker(
      new URL("./pdf2pptx.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === "stage") {
        setEngine({ status: "loading", text: m.text, step: m.step, steps: m.steps });
      } else if (m.type === "ready") {
        setEngine({
          status: "ready",
          ms: m.ms,
          runtimeSize: m.runtimeSize,
          engineCommit: m.engineCommit,
        });
      } else if (m.type === "progress") {
        patchJob(m.id, { done: m.done, total: m.total });
      } else if (m.type === "done") {
        const blob = new Blob([m.pptx], {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
        patchJob(m.id, {
          status: "done",
          ms: m.ms,
          blob,
          url: URL.createObjectURL(blob),
        });
      } else if (m.type === "error") {
        if (m.fatal || m.id === undefined) {
          setEngine({ status: "error", message: m.message, details: m.details });
        } else {
          patchJob(m.id, { status: "error", error: m.message, details: m.details });
        }
      }
    };
    worker.onerror = (e) => {
      setEngine({
        status: "error",
        message: "Не удалось запустить движок конвертации.",
        details: e.message,
      });
    };
    // Файлы движка лежат рядом с index.html: public/pdf2pptx/.
    const base = new URL("pdf2pptx/", document.baseURI).href;
    worker.postMessage({ type: "init", base } satisfies WorkerRequest);
    workerRef.current = worker;
  }, []);

  useEffect(() => {
    startWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [startWorker]);

  // Освобождаем ссылки на готовые файлы при уходе со страницы.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(
    () => () => jobsRef.current.forEach((j) => j.url && URL.revokeObjectURL(j.url)),
    [],
  );

  // ── Очередь: по одному файлу за раз ──
  useEffect(() => {
    if (engine.status !== "ready") return;
    if (jobs.some((j) => j.status === "converting")) return;
    const next = jobs.find((j) => j.status === "queued");
    if (!next || !workerRef.current) return;

    patchJob(next.id, { status: "converting", startedAt: Date.now(), done: 0 });
    const worker = workerRef.current;
    next.file.arrayBuffer().then((pdf) => {
      worker.postMessage(
        { type: "convert", id: next.id, pdf, mode: next.mode } satisfies WorkerRequest,
        [pdf],
      );
    });
  }, [engine.status, jobs]);

  useEffect(() => {
    if (engine.status !== "loading") {
      setSlowStart(false);
      return;
    }
    const t = setTimeout(() => setSlowStart(true), 4000);
    return () => clearTimeout(t);
  }, [engine.status]);

  // Тикающий таймер для «прошло N с».
  const converting = jobs.some((j) => j.status === "converting");
  useEffect(() => {
    if (!converting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [converting]);

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list);
    const pdfs = files.filter(isPdf);
    setSkipped(files.filter((f) => !isPdf(f)).map((f) => f.name));
    if (pdfs.length === 0) return;
    setJobs((prev) => [
      ...prev,
      ...pdfs.map((file) => ({
        id: nextId.current++,
        file,
        mode,
        status: "queued" as const,
        done: 0,
        total: 0,
      })),
    ]);
  };

  const removeJob = (id: number) =>
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.url) URL.revokeObjectURL(job.url);
      return prev.filter((j) => j.id !== id);
    });

  const retryJob = (id: number) =>
    patchJob(id, { status: "queued", error: undefined, details: undefined, done: 0 });

  // Отмена: Python нельзя прервать посреди вычислений, поэтому
  // перезапускаем поток (движок поднимется заново из кэша браузера).
  const cancelCurrent = () => {
    workerRef.current?.terminate();
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "converting"
          ? { ...j, status: "error", error: "Конвертация отменена." }
          : j,
      ),
    );
    setEngine({ status: "loading", text: "Перезапускаем движок…", step: 0, steps: 1 });
    startWorker();
  };

  const restartEngine = () => {
    workerRef.current?.terminate();
    setEngine({ status: "loading", text: "Готовим движок…", step: 0, steps: 1 });
    startWorker();
  };

  const clearAll = () => {
    if (converting) cancelCurrent();
    jobs.forEach((j) => j.url && URL.revokeObjectURL(j.url));
    setJobs([]);
    setSkipped([]);
  };

  const finished = jobs.filter((j) => j.status === "done");

  const downloadAll = async () => {
    const zip = new JSZip();
    const used = new Set<string>();
    for (const j of finished) {
      let name = pptxName(j.file);
      for (let k = 2; used.has(name); k++) {
        name = pptxName(j.file).replace(/\.pptx$/, ` (${k}).pptx`);
      }
      used.add(name);
      zip.file(name, j.blob!);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presentations.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <PageShell
      title="PDF → PowerPoint"
      subtitle="Редактируемая презентация из PDF — прямо в браузере, файлы никуда не отправляются"
      onShowInstructions={() => setShowHelp(true)}
      width={960}
    >
      {/* ── Состояние движка: тонкая строка, пока он готовится; после — скрыта ── */}
      {engine.status === "loading" && (
        <div className="p2p-engine" role="status">
          <div className="p2p-engine__row">
            <span className="p2p-spinner" aria-hidden="true" />
            <span>{engine.text}</span>
          </div>
          <div className="p2p-bar">
            <div
              className="p2p-bar__fill"
              style={{ width: `${(engine.step / Math.max(1, engine.steps)) * 100}%` }}
            />
          </div>
          {slowStart && (
            <p className="p2p-muted">
              Первый запуск на этом компьютере: движок (~33 МБ) копируется с
              сервера приложения в браузер, дальше запуск быстрее. Файлы можно
              добавлять уже сейчас.
            </p>
          )}
        </div>
      )}
      {engine.status === "error" && (
        <div className="p2p-engine p2p-engine--error" role="alert">
          <div className="p2p-engine__row">
            <span aria-hidden="true">⚠️</span>
            <strong>{engine.message}</strong>
            <button className="btn-secondary p2p-small" onClick={restartEngine}>
              Повторить
            </button>
          </div>
          {engine.details && <pre className="p2p-details">{engine.details}</pre>}
        </div>
      )}

      {/* ── Режим ── */}
      <div className="p2p-modes" role="radiogroup" aria-label="Режим конвертации">
        {MODES.map((m) => (
          <label
            key={m.id}
            className={`p2p-mode ${mode === m.id ? "is-active" : ""}`}
          >
            <input
              type="radio"
              name="p2p-mode"
              checked={mode === m.id}
              onChange={() => setMode(m.id)}
            />
            <span>
              <strong>{m.title}</strong>
              <small>{m.text}</small>
            </span>
          </label>
        ))}
      </div>

      {/* ── Загрузка ── */}
      <div
        className={`ds-dropzone p2p-drop ${dragOver ? "ds-dropzone--over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="p2p-drop__icon" aria-hidden="true">
          📄 → 📊
        </div>
        <strong>Перетащите PDF сюда или нажмите, чтобы выбрать</strong>
        <span className="p2p-muted">
          Можно несколько файлов — они сконвертируются по очереди.
          Режим применяется к добавленным после выбора.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {skipped.length > 0 && (
        <p className="p2p-warn">
          Пропущены (не PDF): {skipped.join(", ")}
        </p>
      )}

      {/* ── Очередь и результаты ── */}
      {jobs.length > 0 && (
        <div className="p2p-jobs">
          <div className="p2p-jobs__head">
            <h3 className="ds-section-title">Файлы</h3>
            <div className="p2p-jobs__actions">
              {finished.length > 1 && (
                <button className="btn-primary p2p-small" onClick={downloadAll}>
                  Скачать все ({finished.length}) · ZIP
                </button>
              )}
              <button className="btn-secondary p2p-small" onClick={clearAll}>
                Очистить
              </button>
            </div>
          </div>

          {jobs.map((j) => {
            const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
            return (
              <div key={j.id} className={`p2p-job p2p-job--${j.status}`}>
                <div className="p2p-job__main">
                  <div className="p2p-job__name" title={j.file.name}>
                    {j.file.name}
                  </div>
                  <div className="p2p-job__meta">
                    {fmtBytes(j.file.size)} ·{" "}
                    {MODES.find((m) => m.id === j.mode)?.title}
                    {j.status === "queued" &&
                      (engine.status === "ready"
                        ? " · в очереди"
                        : " · ждёт запуска движка")}
                    {j.status === "converting" &&
                      ` · ${j.total ? `страница ${j.done} из ${j.total}` : "читаем PDF…"} · ${fmtSec(now - (j.startedAt ?? now))}`}
                    {j.status === "done" &&
                      ` → ${fmtBytes(j.blob!.size)} · ${j.total} ${plural(j.total, ["слайд", "слайда", "слайдов"])} за ${fmtSec(j.ms!)}`}
                  </div>
                  {j.status === "converting" && (
                    <div className="p2p-bar">
                      <div
                        className="p2p-bar__fill"
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  )}
                  {j.status === "error" && (
                    <div className="p2p-job__error">
                      {j.error}
                      {j.details && <pre className="p2p-details">{j.details}</pre>}
                    </div>
                  )}
                </div>
                <div className="p2p-job__actions">
                  {j.status === "done" && (
                    <a className="btn-primary p2p-small" href={j.url} download={pptxName(j.file)}>
                      Скачать .pptx
                    </a>
                  )}
                  {j.status === "converting" && (
                    <button className="btn-secondary p2p-small" onClick={cancelCurrent}>
                      Отменить
                    </button>
                  )}
                  {j.status === "error" && (
                    <button className="btn-secondary p2p-small" onClick={() => retryJob(j.id)}>
                      Повторить
                    </button>
                  )}
                  {j.status !== "converting" && (
                    <button
                      className="p2p-remove"
                      onClick={() => removeJob(j.id)}
                      aria-label={`Убрать ${j.file.name}`}
                      title="Убрать из списка"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InstructionsModalShell
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        title="📊 PDF → PowerPoint"
      >
        <div className="instructions-section">
          <h3>Как это работает</h3>
          <p>
            Каждая страница PDF становится слайдом того же размера: текст —
            текстовыми блоками со шрифтами и отступами, картинки — картинками,
            линии и фигуры — фигурами PowerPoint. Конвертация идёт прямо в
            браузере: файлы не загружаются на сервер.
          </p>
        </div>
        <div className="instructions-section">
          <h3>Режимы</h3>
          <ul>
            <li>
              <strong>Редактируемая</strong> — максимум редактируемых
              объектов. Движок сам сверяет результат с оригиналом и всё, что
              не удалось воспроизвести точно (тени, сложные градиенты, маски),
              вставляет прозрачной картинкой ровно этого фрагмента.
            </li>
            <li>
              <strong>Точная копия</strong> — фон слайда картинкой, текст
              поверх остаётся редактируемым. Быстрее и всегда выглядит 1:1.
            </li>
          </ul>
        </div>
        <div className="instructions-section">
          <h3>Скорость</h3>
          <ul>
            <li>
              Интернет не нужен: движок (~33 МБ) входит в приложение и один
              раз копируется в браузер — обычно в фоне, пока открыта главная.
            </li>
            <li>
              Текстовая страница — около полсекунды, сложный слайд с
              графикой — несколько секунд.
            </li>
            <li>Защищённые паролем PDF нужно сначала разблокировать.</li>
          </ul>
        </div>
      </InstructionsModalShell>
    </PageShell>
  );
};

export default PdfToPptx;
