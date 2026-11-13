// Главная Convertix: найти инструмент по задаче или по файлу.
// Поиск и «перетащите файл» сразу сужают каталог; без них — разделы
// по типу работы и недавние инструменты этого браузера.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  handleUrlExcelDownload,
  hasUrlDownloadData,
} from "../utils/urlExcelDownloader";
import DownloadSuccessModal from "../components/DownloadSuccessModal";
import ThemeToggle from "../components/ThemeToggle";
import { BrandMark } from "../components/PageShell";
import { isMac } from "../utils/palette";
import {
  CATEGORIES,
  GAMES,
  ICONS,
  TOOLS,
  extOf,
  rankTools,
  readRecent,
  type Tool,
} from "../tools";
import { warmUpEngine } from "./PdfToPptx/engineAssets";
import "./HomePage.css";

// Ссылка на опрос CSI — и в блоке поддержки, и в разовом окне с просьбой
const SURVEY_URL = "https://public.oprosso.sber.ru/p/jgwgns80";
const SBERCHAT_URL =
  "https://sberchat.sberbank.ru/join-circle/0abb2491520a72356261de83e7ba96bbace14faae1248dedd3125ed476f5295b";
const DOCS_URL =
  "https://confluence.sberbank.ru/pages/viewpage.action?pageId=23788264929";
const MAIL_TO = "LGBotsoeva@sberbank.ru,BSChubiryaev@sberbank.ru";

const writeToUs = (subject: string, intro: string) => {
  const body = encodeURIComponent(
    `Здравствуйте!\n\n${intro}\n\n[Опишите здесь]\n\n--\nОтправлено из Convertix`,
  );
  window.open(
    `mailto:${MAIL_TO}?subject=${encodeURIComponent(subject)}&body=${body}`,
  );
};

const UdtLogo = memo(() => (
  <svg
    height="30"
    role="img"
    aria-label="Unit Data Team"
    viewBox="0 0 579.913 117"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <radialGradient
        gradientTransform="translate(111.286 0.822067) rotate(0) scale(170.688 170.824)"
        cx="0"
        cy="0"
        r="1"
        id="udt-g1"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#0087CD" />
        <stop offset="0.22" stopColor="#515DAD" />
        <stop offset="0.64" stopColor="#8253AA" />
        <stop offset="1" stopColor="#FF1C77" />
      </radialGradient>
      <radialGradient
        gradientTransform="translate(111.285 0.822327) rotate(0) scale(170.688 170.824)"
        cx="0"
        cy="0"
        r="1"
        id="udt-g2"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#0087CD" />
        <stop offset="0.22" stopColor="#515DAD" />
        <stop offset="0.64" stopColor="#8253AA" />
        <stop offset="1" stopColor="#FF1C77" />
      </radialGradient>
      <radialGradient
        gradientTransform="translate(111.284 0.822006) rotate(0) scale(170.688 170.823)"
        cx="0"
        cy="0"
        r="1"
        id="udt-g3"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#0087CD" />
        <stop offset="0.22" stopColor="#515DAD" />
        <stop offset="0.64" stopColor="#8253AA" />
        <stop offset="1" stopColor="#FF1C77" />
      </radialGradient>
      <radialGradient
        gradientTransform="translate(111.285 0.822693) rotate(0) scale(170.688 170.824)"
        cx="0"
        cy="0"
        r="1"
        id="udt-g4"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#0087CD" />
        <stop offset="0.22" stopColor="#515DAD" />
        <stop offset="0.64" stopColor="#8253AA" />
        <stop offset="1" stopColor="#FF1C77" />
      </radialGradient>
    </defs>
    <path
      d="M220.46 31.82C217.85 31.82 216.22 30.26 216.22 27.87C216.22 25.55 217.85 24 220.46 24C222.95 24 224.59 25.55 224.59 27.87C224.59 30.26 222.95 31.82 220.46 31.82ZM134.39 27.52L141.98 27.52L141.98 52.22C141.98 59.86 146.65 63.13 152.9 63.13C159.27 63.13 162.96 60.15 162.96 52.94L162.96 27.52L170.54 27.52L170.54 52.16C170.54 64.45 163.7 70 152.59 70C140.22 70 134.39 63.25 134.39 52.63L134.39 27.52ZM277.05 69.29L277.05 27.52L291.67 27.52C307.38 27.52 315.02 34.73 315.02 47.56C315.02 62.84 305.31 69.29 291.49 69.29L277.05 69.29ZM427.28 27.52L463.25 27.52L463.25 34.38L448.94 34.38L448.94 69.29L441.36 69.29L441.36 34.38L427.28 34.38L427.28 27.52ZM235.51 39.46L235.51 34.32L242.6 29.31L242.6 39.46L253.45 39.46L253.45 45.6L242.6 45.6L242.6 58.55C242.6 62.54 243.76 63.73 247.15 63.73C249.69 63.73 252.24 62.9 254.01 61.83L254.01 67.85C252.67 68.92 248.97 69.88 245.93 69.88C239.14 69.88 235.51 67.32 235.51 60.58L235.51 45.6L229.99 45.6L229.99 39.46L235.51 39.46ZM357.23 39.46L357.23 34.32L364.33 29.31L364.33 39.46L375.18 39.46L375.18 45.6L364.33 45.6L364.33 58.55C364.33 62.54 365.48 63.73 368.87 63.73C371.42 63.73 373.97 62.9 375.73 61.83L375.73 67.85C374.4 68.92 370.7 69.88 367.66 69.88C360.87 69.88 357.23 67.32 357.23 60.58L357.23 45.6L351.72 45.6L351.72 39.46L357.23 39.46ZM284.64 34.38L284.64 62.43L291.49 62.43C301.97 62.43 307.07 57.35 307.07 48.28C307.07 38.97 302.29 34.38 291.55 34.38L284.64 34.38ZM489.02 59.14L489.02 66.3C487.57 67.97 483.39 69.94 477.87 69.88C467.86 69.94 461.92 64.51 461.92 54.25C461.92 44.35 468.23 38.8 477.38 38.8C486.18 38.85 491.45 44.17 491.45 53.54L491.45 56.39L468.95 56.39C469.5 61.34 472.59 63.85 478.1 63.85C483.69 63.85 487.39 61.77 489.02 59.14ZM208.21 69.29L201.11 69.29L201.11 51.21C201.11 46.97 199.35 45.06 195.18 45L194.99 45C189.72 45 187.22 47.51 187.22 52.69L187.22 69.29L180.13 69.29L180.13 39.4L186.8 39.4L186.8 45.48C188.07 41.84 192.02 38.85 197.78 38.85C204.33 38.91 208.21 42.38 208.21 49.36L208.21 69.29ZM333.39 44.94C327.81 44.94 324.6 47.08 322.54 50.25L322.54 41.54C324.54 40.05 328.18 38.85 333.39 38.85C342.25 38.85 346.61 41.84 346.61 49.59L346.61 69.29L339.95 69.29L339.95 63.91C338.49 67.38 334.79 69.76 329.94 69.76C323.82 69.76 320.17 66.36 320.17 60.52C320.17 53.71 325.2 51.81 332.67 51.81L339.52 51.81L339.52 50.49C339.52 46.26 337.46 44.94 333.39 44.94ZM393.56 44.94C387.98 44.94 384.76 47.08 382.71 50.25L382.71 41.54C384.7 40.05 388.35 38.85 393.56 38.85C402.41 38.85 406.78 41.84 406.78 49.59L406.78 69.29L400.12 69.29L400.12 63.91C398.65 67.38 394.95 69.76 390.11 69.76C383.98 69.76 380.34 66.36 380.34 60.52C380.34 53.71 385.37 51.81 392.84 51.81L399.69 51.81L399.69 50.49C399.69 46.26 397.63 44.94 393.56 44.94ZM509.4 44.94C503.82 44.94 500.61 47.08 498.55 50.25L498.55 41.54C500.55 40.05 504.19 38.85 509.4 38.85C518.26 38.85 522.62 41.84 522.62 49.59L522.62 69.29L515.96 69.29L515.96 63.91C514.5 67.38 510.8 69.76 505.95 69.76C499.83 69.76 496.18 66.36 496.18 60.52C496.18 53.71 501.21 51.81 508.68 51.81L515.53 51.81L515.53 50.49C515.53 46.26 513.47 44.94 509.4 44.94ZM556.95 69.29L549.86 69.29L549.86 51.26C549.86 46.91 548.35 45 544.46 45C539.97 45.06 537.85 47.62 537.91 52.69L537.91 69.29L530.82 69.29L530.82 39.46L537.48 39.46L537.48 45.54C538.52 41.9 541.85 38.91 546.76 38.91C551.98 38.91 555.38 41.13 556.53 45.54C557.62 41.84 560.96 38.91 565.87 38.91C572.42 38.91 576 42.38 576 49.36L576 69.29L568.9 69.29L568.9 51.26C568.9 46.91 567.45 45 563.51 45C559.26 45 557.07 47.45 556.95 51.98L556.95 69.29ZM223.98 69.29L216.89 69.29L216.89 39.46L223.98 39.46L223.98 69.29ZM484.35 51.44C484.18 47.39 481.51 44.88 477.2 44.88C472.65 44.88 469.8 47.14 469.08 51.44L484.35 51.44ZM327.33 59.8C327.33 62.06 329.02 63.5 332.18 63.5C336.98 63.5 339.21 60.81 339.52 58.78L339.52 56.33L333.51 56.33C329.34 56.33 327.33 57.11 327.33 59.8ZM387.5 59.8C387.5 62.06 389.19 63.5 392.34 63.5C397.14 63.5 399.38 60.81 399.69 58.78L399.69 56.33L393.68 56.33C389.5 56.33 387.5 57.11 387.5 59.8ZM503.34 59.8C503.34 62.06 505.03 63.5 508.19 63.5C512.99 63.5 515.22 60.81 515.53 58.78L515.53 56.33L509.52 56.33C505.34 56.33 503.34 57.11 503.34 59.8Z"
      fill="currentColor"
    />
    <path
      d="M113.74 70.97C112.8 70.23 111.5 70.23 108.71 70.23L89.35 70.23C87.86 70.23 87.11 70.23 86.55 70.41C86.18 70.6 85.99 70.6 85.62 70.97C85.07 71.34 84.69 72.09 83.76 73.77C80.41 79.36 75.01 83.83 68.68 86.07C65.33 82.71 63.65 81.04 62.16 81.04C61.42 81.04 60.49 81.41 59.93 81.97C58.81 83.09 58.81 85.51 58.81 90.54L58.81 107.12C58.81 111.03 58.81 112.9 59.75 114.2C60.31 114.94 60.86 115.69 61.61 116.06C63.1 117 64.96 117 68.68 117L85.25 117C90.28 117 92.7 117 93.81 115.88C94.37 115.32 94.75 114.39 94.75 113.64C94.75 112.15 93.26 110.66 90.46 107.68C101.44 100.59 110.01 89.79 114.29 77.12C115.04 74.7 115.41 73.58 115.04 72.46C114.67 72.09 114.11 71.34 113.74 70.97Z"
      fill="url(#udt-g1)"
    />
    <path
      d="M45.97 85.51C45.6 84.95 44.85 84.58 43.18 83.65C37.59 80.29 33.13 74.89 30.89 68.55C34.24 65.2 35.92 63.52 35.92 62.03C35.92 61.29 35.55 60.36 34.99 59.8C33.87 58.68 31.45 58.68 26.43 58.68L9.86 58.68C5.95 58.68 4.09 58.68 2.79 59.61C2.04 60.17 1.3 60.73 0.93 61.47C0 62.96 0 64.82 0 68.55L0 85.14C0 90.16 0 92.58 1.11 93.7C1.67 94.26 2.6 94.63 3.34 94.63C4.83 94.63 6.32 93.14 9.3 90.35C16.37 101.34 27.17 109.91 39.83 114.2C42.25 114.95 43.36 115.32 44.48 114.95C45.04 114.76 45.78 114.2 46.16 113.83C46.9 112.9 46.9 111.59 46.9 108.8L46.9 89.42C46.9 87.93 46.9 87.19 46.72 86.63C46.34 86.07 46.34 85.88 45.97 85.51Z"
      fill="url(#udt-g2)"
    />
    <path
      d="M58.44 9.86C58.44 5.95 58.44 4.09 57.51 2.79C56.95 2.04 56.39 1.3 55.65 0.93C54.16 0 52.3 0 48.58 0L32.01 0C26.98 0 24.57 0 23.45 1.11C22.89 1.67 22.52 2.6 22.52 3.35C22.52 4.83 24.01 6.32 26.8 9.3C15.82 16.39 7.25 27.19 2.97 39.86C2.23 42.28 1.85 43.4 2.23 44.52C2.41 45.08 2.97 45.82 3.34 46.2C4.28 46.94 5.58 46.94 8.37 46.94L27.73 46.94C29.22 46.94 29.96 46.94 30.52 46.75C30.89 46.57 31.08 46.57 31.45 46.2C32.01 45.82 32.38 45.08 33.31 43.4C36.66 37.81 42.06 33.34 48.39 31.11C51.74 34.46 53.42 36.13 54.91 36.13C55.65 36.13 56.58 35.76 57.14 35.2C58.26 34.08 58.26 31.66 58.26 26.64L58.26 9.86L58.44 9.86Z"
      fill="url(#udt-g3)"
    />
    <path
      d="M115.97 23.47C115.41 22.91 114.48 22.54 113.73 22.54C112.24 22.54 110.75 24.03 107.78 26.82C100.7 15.83 89.9 7.26 77.24 2.97C74.82 2.23 73.71 1.86 72.59 2.23C72.03 2.41 71.29 2.97 70.91 3.35C70.17 4.28 70.17 5.58 70.17 8.37L70.17 27.76C70.17 29.25 70.17 29.99 70.36 30.55C70.54 30.92 70.54 31.11 70.91 31.48C71.29 32.04 72.03 32.41 73.71 33.34C79.29 36.69 83.76 42.1 85.99 48.43C82.64 51.79 80.97 53.46 80.97 54.95C80.97 55.7 81.34 56.63 81.9 57.19C83.02 58.31 85.43 58.31 90.46 58.31L107.03 58.31C110.94 58.31 112.8 58.31 114.11 57.38C114.85 56.82 115.59 56.26 115.97 55.51C116.9 54.02 116.9 52.16 116.9 48.43L116.9 31.85C117.08 27.01 117.08 24.4 115.97 23.47Z"
      fill="url(#udt-g4)"
    />
  </svg>
));

const fmtSize = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} КБ`
    : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;

// ─── Карточка инструмента ───
const ToolCard = memo(({ tool }: { tool: Tool }) => (
  <Link to={tool.path} className="hm-card">
    <span className={`hm-card__icon tone-${tool.category}`}>{tool.icon}</span>
    <span className="hm-card__body">
      <span className="hm-card__title">
        {tool.title}
        {tool.isTest && (
          <span
            className="cvx-test-badge"
            title="Инструмент в тестовом режиме — результат стоит проверить"
          >
            Тест
          </span>
        )}
      </span>
      <span className="hm-card__desc">{tool.description}</span>
    </span>
    <span className="hm-card__foot">
      <span className="hm-card__formats">{tool.formats}</span>
      <span className="hm-card__go" aria-hidden="true">
        {ICONS.arrow}
      </span>
    </span>
  </Link>
));

// ─── Разовые окна: опрос и обратная связь ───
const Notice = ({
  icon,
  title,
  children,
  actions,
  onClose,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) => (
  <div className="hm-modal-overlay" onMouseDown={onClose}>
    <div
      className="hm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hm-modal-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="hm-modal__close"
        onClick={onClose}
        aria-label="Закрыть"
      >
        ×
      </button>
      <span className="hm-modal__icon">{icon}</span>
      <h2 id="hm-modal-title">{title}</h2>
      <p>{children}</p>
      <div className="hm-modal__actions">{actions}</div>
    </div>
  </div>
);

const HomePage = () => {
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recent] = useState(readRecent);
  const [notice, setNotice] = useState<"csi" | "feedback" | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadedFilename, setDownloadedFilename] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Тихо подкачиваем движок PDF → PowerPoint (~33 МБ) в кэш браузера, пока
  // страница простаивает: к открытию инструмента он уже на месте.
  useEffect(() => {
    const start = () => void warmUpEngine();
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    const timer = window.setTimeout(() => {
      if (w.requestIdleCallback)
        w.requestIdleCallback(start, { timeout: 10000 });
      else start();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  // Выгрузка Excel по ссылке (данные в адресе страницы)
  useEffect(() => {
    if (!hasUrlDownloadData()) return;
    void handleUrlExcelDownload({
      onSuccess: (filename) => {
        setDownloadedFilename(filename);
        setShowDownloadModal(true);
      },
      onError: (error) => console.error("URL download error:", error),
    });
  }, []);

  // Опрос, затем благодарность — по одному разу
  useEffect(() => {
    const key = !localStorage.getItem("csiSurveyShown")
      ? "csi"
      : !localStorage.getItem("feedbackModalShown")
        ? "feedback"
        : null;
    if (!key) return;
    const timer = setTimeout(() => {
      setNotice(key);
      localStorage.setItem(
        key === "csi" ? "csiSurveyShown" : "feedbackModalShown",
        "true",
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // «/» — к поиску, как на привычных сайтах
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !/INPUT|TEXTAREA|SELECT/.test(t.tagName) &&
        !t.isContentEditable
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickFile = useCallback((f?: File | null) => {
    if (!f) return;
    setFile({ name: f.name, size: f.size });
    setQuery("");
  }, []);

  // Файл можно бросить в любое место страницы
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      pickFile(e.dataTransfer.files?.[0]);
    },
  };

  const ext = file ? extOf(file.name) : "";
  const fileMatches = useMemo(
    () => (file ? TOOLS.filter((t) => t.accepts.includes(ext)) : []),
    [file, ext],
  );
  const found = useMemo(() => rankTools(query), [query]);
  const recentTools = recent
    .map((p) => TOOLS.find((t) => t.path === p))
    .filter(Boolean) as Tool[];
  const filtering = !!query.trim() || !!file;

  return (
    <div className={`hm ${dragging ? "is-dragging" : ""}`} {...dropHandlers}>
      {notice === "csi" && (
        <Notice
          icon={ICONS.star}
          title="Оцените Convertix"
          onClose={() => setNotice(null)}
          actions={
            <>
              <a
                className="btn-primary"
                href={SURVEY_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setNotice(null)}
              >
                Пройти опрос
              </a>
              <button className="btn-secondary" onClick={() => setNotice(null)}>
                Позже
              </button>
            </>
          }
        >
          Короткий опрос о том, насколько вам удобно работать с инструментами.
          Займёт пару минут и поможет команде решить, что улучшать дальше.
        </Notice>
      )}
      {notice === "feedback" && (
        <Notice
          icon={ICONS.chat}
          title="Спасибо, что пользуетесь Convertix"
          onClose={() => setNotice(null)}
          actions={
            <>
              <button
                className="btn-primary"
                onClick={() => {
                  writeToUs(
                    "Обратная связь по Convertix",
                    "Хочу поделиться впечатлениями о работе приложения:",
                  );
                  setNotice(null);
                }}
              >
                Написать нам
              </button>
              <button className="btn-secondary" onClick={() => setNotice(null)}>
                Закрыть
              </button>
            </>
          }
        >
          Команда Unit Data Team будет рада обратной связи: что получилось
          удобно, чего не хватает, где инструмент ошибся.
        </Notice>
      )}

      {/* ─── Шапка ─── */}
      <header className="hm-top">
        <div className="hm-wrap hm-top__inner">
          <Link to="/" className="hm-brand" aria-label="Convertix — главная">
            <BrandMark size={34} />
            <span className="hm-brand__name">Convertix</span>
          </Link>
          <div className="hm-top__right">
            <ThemeToggle />
            <span className="hm-udt">
              <UdtLogo />
            </span>
          </div>
        </div>
      </header>

      <main className="hm-wrap hm-main">
        {/* ─── Вступление: поиск и файл ─── */}
        <section className="hm-hero" aria-labelledby="hm-title">
          <div className="hm-hero__text">
            <p className="hm-eyebrow">
              {TOOLS.length} инструментов · работают в браузере
            </p>
            <h1 id="hm-title">
              Документы, таблицы и&nbsp;слайды без лишних программ
            </h1>
            <p className="hm-lead">
              Сравнить версии, перевести PDF в Word или PowerPoint, свести
              Excel, подготовить графику для презентации. Файлы не покидают ваш
              компьютер.
            </p>
          </div>

          <div className="hm-intake">
            <label className="hm-search" htmlFor="hm-search">
              {ICONS.search}
              <input
                ref={searchRef}
                id="hm-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFile(null);
                }}
                placeholder="Что сделать? Например, сжать PDF"
                autoComplete="off"
              />
              <kbd className="kbd">/</kbd>
            </label>
            <button
              type="button"
              className={`hm-drop ${dragging ? "is-over" : ""}`}
              onClick={() => fileRef.current?.click()}
            >
              <span className="hm-drop__icon">{ICONS.upload}</span>
              <span className="hm-drop__text">
                <b>Перетащите файл</b> или выберите его — покажем, что с ним
                можно сделать
              </span>
              <span className="hm-drop__formats" aria-hidden="true">
                {["PDF", "DOCX", "XLSX", "PPTX", "HTML", "PNG"].map((f) => (
                  <i key={f}>{f}</i>
                ))}
              </span>
            </button>
            <input
              ref={fileRef}
              id="hm-file"
              type="file"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <p className="hm-intake__note">
              Файл здесь только для подсказки: он не загружается. Ко всем
              инструментам —{" "}
              <kbd className="kbd">{isMac() ? "⌘K" : "Ctrl K"}</kbd> на любой
              странице.
            </p>
          </div>
        </section>

        {/* ─── Результат поиска или подбор по файлу ─── */}
        {filtering && (
          <section className="hm-section" aria-live="polite">
            <div className="hm-result">
              {file ? (
                <p>
                  <b>{file.name}</b>{" "}
                  <span className="hm-muted">· {fmtSize(file.size)}</span> —{" "}
                  {fileMatches.length
                    ? `подходят ${fileMatches.length} ${fileMatches.length === 1 ? "инструмент" : fileMatches.length < 5 ? "инструмента" : "инструментов"}. Откройте нужный и добавьте файл ещё раз.`
                    : "такой формат пока не поддерживается."}
                </p>
              ) : (
                <p>
                  {found.length
                    ? `Найдено: ${found.length}`
                    : `По запросу «${query.trim()}» ничего нет. Попробуйте «excel», «презентация» или «сравнить».`}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setFile(null);
                  setQuery("");
                }}
              >
                Показать все
              </button>
            </div>
            <div className="hm-grid">
              {(file ? fileMatches : found).map((t) => (
                <ToolCard key={t.path} tool={t} />
              ))}
            </div>
          </section>
        )}

        {/* ─── Каталог по разделам ─── */}
        {!filtering && (
          <>
            {recentTools.length > 0 && (
              <section className="hm-recent" aria-label="Недавние">
                <span className="hm-recent__label">Недавние</span>
                {recentTools.map((t) => (
                  <Link key={t.path} to={t.path} className="hm-chip">
                    <span className={`hm-chip__icon tone-${t.category}`}>
                      {t.icon}
                    </span>
                    {t.title}
                  </Link>
                ))}
              </section>
            )}
            <div className="hm-cats">
              {CATEGORIES.map((c) => {
                const list = TOOLS.filter((t) => t.category === c.id);
                return (
                  <section
                    key={c.id}
                    className={`hm-section ${list.length >= 4 ? "is-row" : ""} ${list.length <= 2 ? "is-narrow" : ""}`}
                    style={{ "--n": list.length } as CSSProperties}
                    aria-labelledby={`hm-cat-${c.id}`}
                  >
                    <div className="hm-section__head">
                      <span
                        className={`hm-dot tone-${c.id}`}
                        aria-hidden="true"
                      />
                      <h2 id={`hm-cat-${c.id}`}>{c.title}</h2>
                      <span className="hm-muted">{c.hint}</span>
                    </div>
                    <div className="hm-grid">
                      {list.map((t) => (
                        <ToolCard key={t.path} tool={t} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {/* ─── Поддержка и перерыв ─── */}
        <section className="hm-bottom">
          <div className="hm-help">
            <h2>Нужна помощь?</h2>
            <p className="hm-muted">
              Отвечаем в группе и по почте. В документации — инструкции к
              каждому инструменту.
            </p>
            <div className="hm-help__links">
              <button
                type="button"
                className="hm-link"
                onClick={() =>
                  writeToUs(
                    "Вопрос по Convertix",
                    "У меня вопрос по работе инструмента:",
                  )
                }
              >
                {ICONS.mail}
                Написать нам
                <small>ответим на почту</small>
              </button>
              <a
                className="hm-link"
                href={SBERCHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ICONS.chat}
                Группа в СберЧате
                <small>вопросы и новости</small>
              </a>
              <a
                className="hm-link"
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ICONS.book}
                Документация
                <small>инструкции в Confluence</small>
              </a>
              <a
                className="hm-link"
                href={SURVEY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ICONS.star}
                Оценить проект
                <small>опрос на 2 минуты</small>
              </a>
            </div>
          </div>
          <div className="hm-break">
            <h2>
              <span className="tone-games hm-break__icon">{ICONS.gamepad}</span>
              Перерыв
            </h2>
            <ul>
              {GAMES.map((g) => (
                <li key={g.path}>
                  <Link to={g.path}>
                    <span className="hm-break__glyph" aria-hidden="true">
                      {g.glyph}
                    </span>
                    <b>{g.title}</b>
                    <span className="hm-muted">{g.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="hm-wrap hm-foot">
        <span>Convertix · Unit Data Team</span>
        <span className="hm-muted">
          Все инструменты работают в браузере: файлы не отправляются на сервер.
        </span>
      </footer>

      {dragging && (
        <div className="hm-dropveil" aria-hidden="true">
          <div>
            {ICONS.upload}
            <b>Отпустите файл</b>
            <span>Подберём подходящие инструменты</span>
          </div>
        </div>
      )}

      <DownloadSuccessModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        filename={downloadedFilename}
      />
    </div>
  );
};

export default HomePage;
