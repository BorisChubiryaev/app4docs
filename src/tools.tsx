// Каталог инструментов Convertix: один источник для главной страницы,
// быстрого поиска (Ctrl+K) и истории недавних. Добавляете инструмент —
// добавьте его сюда, и он появится везде.

import type { ReactNode } from "react";

export type CategoryId = "docs" | "slides" | "data" | "images";

export interface Category {
  id: CategoryId;
  title: string;
  /** Короткое пояснение под заголовком раздела */
  hint: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "docs",
    title: "Документы и PDF",
    hint: "Word, PDF, сравнение и правки",
  },
  {
    id: "slides",
    title: "Презентации",
    hint: "PowerPoint, шаблоны и графика для слайдов",
  },
  { id: "images", title: "Изображения", hint: "Форматы, фон, сборка в PDF" },
  {
    id: "data",
    title: "Таблицы и данные",
    hint: "Excel, HTML и JSON, графики",
  },
];

export interface Tool {
  id: string;
  title: string;
  path: string;
  category: CategoryId;
  /** Одна строка: что делает инструмент */
  description: string;
  /** Что на входе и что на выходе — показывается как формат «PDF → PPTX» */
  formats: string;
  features: string[];
  /** Расширения файлов, с которыми работает (для «перетащите файл») */
  accepts: string[];
  /** Слова для поиска: как люди называют задачу */
  keywords: string;
  icon: ReactNode;
  isTest?: boolean;
}

// ── Иконки: линейные, 24×24, цвет берут из currentColor ──
const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ICONS = {
  slides: icon(
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M7 13.5l3-3.5 2.5 2.5L17 8" />
      <path d="M12 17v3M8.5 20h7" />
    </>,
  ),
  pdfToPptx: icon(
    <>
      <path d="M6 3h6l4 4v5" />
      <path d="M12 3v4h4" />
      <path d="M6 3v13" />
      <rect x="10" y="13" width="11" height="8" rx="1.5" />
      <path d="M13 17h5" />
    </>,
  ),
  compare: icon(
    <>
      <rect x="3" y="4" width="8" height="16" rx="1.5" />
      <rect x="13" y="4" width="8" height="16" rx="1.5" />
      <path d="M5.5 8h3M5.5 11h3M15.5 8h3M15.5 11h3" />
      <path d="M5.5 14.5h3M15.5 14.5h3" strokeWidth="3" strokeOpacity="0.35" />
    </>,
  ),
  htmlToExcel: icon(
    <>
      <path d="M6.5 5L3 8.5 6.5 12M10.5 5L14 8.5 10.5 12" />
      <rect x="10" y="12" width="11" height="9" rx="1.5" />
      <path d="M10 15.5h11M14 12v9" />
    </>,
  ),
  image: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-8 9" />
    </>,
  ),
  pdfStudio: icon(
    <>
      <path d="M8 7V4.5A1.5 1.5 0 019.5 3H19a1.5 1.5 0 011.5 1.5V16A1.5 1.5 0 0119 17.5h-2.5" />
      <rect x="3.5" y="7" width="13" height="14" rx="1.5" />
      <path d="M7 12h6M7 15.5h4" />
    </>,
  ),
  grouper: icon(
    <>
      <rect x="3" y="3" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <path d="M10 5.5h2.5a2 2 0 012 2V10M10 18.5h2.5a2 2 0 002-2V14" />
      <rect x="14.5" y="9.5" width="6.5" height="5" rx="1" />
    </>,
  ),
  chart: icon(
    <>
      <path d="M4 20V4M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.6" />
      <rect x="12" y="8" width="3" height="9" rx="0.6" />
      <rect x="17" y="5" width="3" height="12" rx="0.6" />
    </>,
  ),
  docConvert: icon(
    <>
      <rect x="3" y="3" width="9" height="12" rx="1.5" />
      <rect x="12" y="9" width="9" height="12" rx="1.5" />
      <path d="M15 4.5h2.5A1.5 1.5 0 0119 6v1.5M17.5 9L19 7.5 20.5 9" />
      <path d="M9 19.5H6.5A1.5 1.5 0 015 18v-1.5M6.5 15L5 16.5 3.5 15" />
    </>,
  ),
  offer: icon(
    <>
      <path d="M14 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h5M8.5 16.5h3" />
      <path d="M15 14.5l1.2 1.2 2.3-2.4" />
    </>,
  ),
  htmlEditor: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <path d="M9 12l-2 2 2 2M15 12l2 2-2 2M12.8 11.5l-1.6 5" />
    </>,
  ),
  restyle: icon(
    <>
      <rect x="3" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 9h14" />
      <path d="M20.5 9.5l-5.8 5.8-1.9.6.6-1.9 5.8-5.8a.9.9 0 011.3 1.3z" />
      <path d="M8 19h5" />
    </>,
  ),
  workplace: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
      <circle cx="15" cy="13.5" r="1.6" />
      <path d="M12.5 18c.5-1.3 1.4-2 2.5-2s2 .7 2.5 2" />
    </>,
  ),
  search: icon(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>,
  ),
  upload: icon(
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 14v4.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V14" />
    </>,
  ),
  home: icon(
    <>
      <path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z" />
    </>,
  ),
  book: icon(
    <>
      <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z" />
    </>,
  ),
  mail: icon(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </>,
  ),
  chat: icon(
    <>
      <path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4A8 8 0 1120 12z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </>,
  ),
  star: icon(
    <>
      <path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />
    </>,
  ),
  arrow: icon(
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>,
  ),
  gamepad: icon(
    <>
      <path d="M7 8h10a4 4 0 014 4.2l-.3 3.6a2.4 2.4 0 01-4.3 1.2L15 15H9l-1.4 2a2.4 2.4 0 01-4.3-1.2L3 12.2A4 4 0 017 8z" />
      <path d="M8 11v3M6.5 12.5h3" />
      <circle cx="16" cy="11.5" r="0.6" fill="currentColor" />
      <circle cx="17.5" cy="13.5" r="0.6" fill="currentColor" />
    </>,
  ),
};

export const TOOLS: Tool[] = [
  {
    id: "slides",
    title: "Графика для слайдов",
    path: "/SlideGraphics",
    category: "slides",
    description: "Анимированные графики, фоны и карточки для презентаций",
    formats: "PNG, 4K, MP4",
    features: [
      "30 шаблонов, раздел в стиле СБ",
      "PNG без фона, 4K и видео MP4",
      "Данные — вставкой из Excel",
    ],
    accepts: ["xlsx", "xls", "csv", "png", "jpg", "jpeg", "webp"],
    keywords:
      "график диаграмма анимация видео mp4 слайд фон карусель сбер инфографика",
    icon: ICONS.slides,
    isTest: true,
  },
  {
    id: "pdf2pptx",
    title: "PDF → PowerPoint",
    path: "/PdfToPptx",
    category: "slides",
    description: "Редактируемая презентация из PDF: текст, картинки и фигуры",
    formats: "PDF → PPTX",
    features: [
      "Слайд на каждую страницу",
      "Текст и фигуры редактируются",
      "Режим «точная копия»",
    ],
    accepts: ["pdf"],
    keywords: "презентация повер поинт pptx слайды пдф",
    icon: ICONS.pdfToPptx,
  },
  {
    id: "restyle",
    title: "Перенос в шаблон",
    path: "/PptxRestyle",
    category: "slides",
    description:
      "Презентации в новом корпоративном шаблоне — фон, шрифты, цвета",
    formats: "PPTX → PPTX",
    features: [
      "Несколько файлов → одна презентация",
      "Таблицы и диаграммы перекрашены",
      "Текст читается на новом фоне",
    ],
    accepts: ["pptx"],
    keywords: "шаблон ребрендинг фирменный стиль презентация оформление",
    icon: ICONS.restyle,
  },
  {
    id: "pdfstudio",
    title: "PDF Studio",
    path: "/PdfEditor",
    category: "docs",
    description:
      "Объединение, порядок страниц, подпись, распознавание и сжатие PDF",
    formats: "PDF, сканы → PDF",
    features: [
      "Объединение и разделение",
      "Подпись, печать, вымарывание",
      "Сканы с поиском по тексту",
    ],
    accepts: ["pdf", "png", "jpg", "jpeg", "tif", "tiff"],
    keywords:
      "пдф объединить разделить подпись печать сжать распознать скан ocr страницы водяной знак",
    icon: ICONS.pdfStudio,
  },
  {
    id: "docconvert",
    title: "Конвертер документов",
    path: "/PdfToWord",
    category: "docs",
    description:
      "PDF в Word и обратно — с таблицами, колонками и колонтитулами",
    formats: "PDF ⇄ DOCX",
    features: [
      "Таблицы и колонки сохраняются",
      "Распознавание сканов",
      "Несколько файлов сразу",
    ],
    accepts: ["pdf", "docx", "doc"],
    keywords: "ворд word docx пдф конвертировать перевести",
    icon: ICONS.docConvert,
  },
  {
    id: "compare",
    title: "Сравнение файлов",
    path: "/compare",
    category: "docs",
    description:
      "Что изменилось между версиями: Excel по ячейкам, Word и PDF по абзацам",
    formats: "XLSX, DOCX, PDF",
    features: [
      "Word и PDF в любом сочетании",
      "Подсветка правок",
      "Номера страниц PDF",
    ],
    accepts: ["xlsx", "xls", "docx", "pdf"],
    keywords: "сравнить различия версии изменения дифф эксель ворд",
    icon: ICONS.compare,
  },
  {
    id: "offer",
    title: "Изменения в оферту",
    path: "/OfferMerge",
    category: "docs",
    description:
      "Собирает правки из нескольких документов и обновляет текст оферты",
    formats: "DOCX → DOCX",
    features: [
      "Сноски, пункты, строки таблиц",
      "Правки цветом или исправлениями Word",
      "Без ИИ — по правилам",
    ],
    accepts: ["docx"],
    keywords: "оферта правки редакция договор объединить изменения",
    icon: ICONS.offer,
  },
  {
    id: "htmlstudio",
    title: "HTML-редактор",
    path: "/HtmlStudio",
    category: "docs",
    description: "Правка страниц и отчётов от ИИ без знания HTML",
    formats: "HTML",
    features: [
      "Текст и блоки прямо на странице",
      "Таблицы и данные графиков",
      "Цвета и шрифты одним кликом",
    ],
    accepts: ["html", "htm"],
    keywords: "html веб страница отчёт редактировать ии код",
    icon: ICONS.htmlEditor,
  },
  {
    id: "htmlToExcel",
    title: "Таблицы HTML/JSON в Excel",
    path: "/htmlToExcel",
    category: "data",
    description: "HTML- и JSON-таблицы в файл Excel с сохранением оформления",
    formats: "HTML, JSON → XLSX",
    features: [
      "Предпросмотр перед выгрузкой",
      "Стили сохраняются",
      "Одним кликом",
    ],
    accepts: ["html", "htm", "json"],
    keywords: "эксель xlsx json html таблица выгрузить",
    icon: ICONS.htmlToExcel,
  },
  {
    id: "grouper",
    title: "Excel группиратор",
    path: "/ExcelTableBuilder",
    category: "data",
    description: "Сводит данные из нескольких Excel-файлов по вашим правилам",
    formats: "XLSX → XLSX",
    features: [
      "Конструктор правил",
      "Сопоставление строк",
      "Проверка структуры",
    ],
    accepts: ["xlsx", "xls", "csv"],
    keywords: "эксель группировка свести объединить таблицы",
    icon: ICONS.grouper,
  },
  {
    id: "workplace",
    title: "Сравнение по рабочим местам",
    path: "/WorkplaceCompare",
    category: "data",
    description: "Сравнение файлов рабочих мест с фильтрами и выгрузкой",
    formats: "XLSX",
    features: [
      "Фильтры по рабочим местам",
      "Подсветка изменений",
      "Экспорт в Excel",
    ],
    accepts: ["xlsx", "xls"],
    keywords: "рабочие места сотрудники штат сравнить эксель",
    icon: ICONS.workplace,
  },
  {
    id: "chartcraft",
    title: "Генератор графиков",
    path: "/ChartCraft",
    category: "data",
    description: "Таблица превращается в аккуратный график за пару кликов",
    formats: "XLSX → PNG, SVG",
    features: ["Конструктор графиков", "Рисование поверх", "Экспорт картинкой"],
    accepts: ["xlsx", "xls", "csv"],
    keywords: "график диаграмма chart визуализация",
    icon: ICONS.chart,
  },
  {
    id: "images",
    title: "Конвертер изображений",
    path: "/ImageConverter",
    category: "images",
    description:
      "SVG, PSD, PDF и фото в PNG, JPEG, WebP, ICO или PDF, удаление фона",
    formats: "SVG, PSD, JPG → PNG, PDF",
    features: [
      "Удаление фона нейросетью",
      "Сборка фото в PDF",
      "Полностью офлайн",
    ],
    accepts: [
      "svg",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "bmp",
      "psd",
      "pdf",
      "tif",
      "tiff",
    ],
    keywords: "картинка фото png jpg svg ico фон удалить конвертировать",
    icon: ICONS.image,
  },
];

export interface Game {
  title: string;
  path: string;
  description: string;
  glyph: string;
}

export const GAMES: Game[] = [
  {
    title: "Шахматы",
    path: "/Chess",
    description: "С компьютером, 6 уровней",
    glyph: "♞",
  },
  {
    title: "Уроки шахмат",
    path: "/ChessLessons",
    description: "С нуля до первой партии",
    glyph: "♙",
  },
  {
    title: "Шашки",
    path: "/Checkers",
    description: "Русские шашки, 6 уровней",
    glyph: "⛀",
  },
  {
    title: "Змейка",
    path: "/SnakeGame",
    description: "Собирай файлы, проходи уровни",
    glyph: "∿",
  },
  {
    title: "Три в ряд",
    path: "/DocMatchGame",
    description: "Документный перерыв",
    glyph: "◆",
  },
];

/** Расширение файла в нижнем регистре */
export const extOf = (name: string) =>
  (name.split(".").pop() ?? "").toLowerCase();

/** Простой поиск: все слова запроса встречаются в названии, описании или ключевых словах */
export function matchTool(t: Tool, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay =
    `${t.title} ${t.description} ${t.formats} ${t.keywords} ${t.features.join(" ")}`
      .toLowerCase()
      .replace(/ё/g, "е");
  return q
    .replace(/ё/g, "е")
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/** Найденные инструменты по убыванию точности: совпадение в названии важнее описания */
export function rankTools(query: string) {
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, "е");
  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  const score = (t: Tool) =>
    words.reduce(
      (n, w) =>
        n +
        (norm(t.title).includes(w) ? 4 : 0) +
        (norm(t.formats).includes(w) ? 3 : 0) +
        (norm(t.keywords).includes(w) ? 2 : 0) +
        (norm(t.description).includes(w) ? 1 : 0),
      0,
    );
  return TOOLS.filter((t) => matchTool(t, query))
    .map((t, i) => [t, score(t), i] as const)
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .map(([t]) => t);
}

// ── Недавние инструменты: хранятся только в этом браузере ──
const RECENT_KEY = "cvx-recent";

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberTool(path: string) {
  if (!TOOLS.some((t) => t.path === path)) return;
  try {
    const list = [path, ...readRecent().filter((p) => p !== path)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно — просто не запоминаем */
  }
}

// ── Фраза на главной: «У меня есть [формат], нужно [действие]» ──
// Каждое действие ведёт ровно в один инструмент.

export interface Source {
  id: string;
  /** Как формат звучит в фразе «У меня есть …» */
  label: string;
  /** Расширения файлов, по которым он узнаётся при перетаскивании */
  exts: string[];
}

export const SOURCES: Source[] = [
  { id: "pdf", label: "PDF", exts: ["pdf"] },
  { id: "word", label: "документ Word", exts: ["docx", "doc"] },
  { id: "excel", label: "таблица Excel", exts: ["xlsx", "xls", "xlsm", "csv"] },
  { id: "pptx", label: "презентация", exts: ["pptx", "potx"] },
  { id: "html", label: "HTML или JSON", exts: ["html", "htm", "json"] },
  { id: "image", label: "картинка", exts: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "psd", "tif", "tiff"] },
];

export interface Intent {
  source: string;
  /** Продолжение фразы «…, нужно …» */
  verb: string;
  tool: string;
}

export const INTENTS: Intent[] = [
  { source: "pdf", verb: "сделать из него презентацию", tool: "pdf2pptx" },
  { source: "pdf", verb: "перевести в Word", tool: "docconvert" },
  { source: "pdf", verb: "объединить, подписать или сжать", tool: "pdfstudio" },
  { source: "pdf", verb: "сравнить с другой версией", tool: "compare" },
  { source: "pdf", verb: "сохранить страницы картинками", tool: "images" },
  { source: "word", verb: "сделать из него PDF", tool: "docconvert" },
  { source: "word", verb: "сравнить две версии", tool: "compare" },
  { source: "word", verb: "собрать правки в оферту", tool: "offer" },
  { source: "excel", verb: "сравнить две версии", tool: "compare" },
  { source: "excel", verb: "сравнить по рабочим местам", tool: "workplace" },
  { source: "excel", verb: "свести несколько файлов в один", tool: "grouper" },
  { source: "excel", verb: "построить график", tool: "chartcraft" },
  { source: "excel", verb: "оживить график для слайда", tool: "slides" },
  { source: "pptx", verb: "перенести в новый шаблон", tool: "restyle" },
  { source: "html", verb: "выгрузить таблицу в Excel", tool: "htmlToExcel" },
  { source: "html", verb: "поправить текст и оформление", tool: "htmlstudio" },
  { source: "image", verb: "сменить формат или убрать фон", tool: "images" },
  { source: "image", verb: "собрать сканы в один PDF", tool: "pdfstudio" },
  { source: "image", verb: "сделать карусель для слайда", tool: "slides" },
];

/** Какой формат из фразы соответствует файлу */
export const sourceOfFile = (name: string) => SOURCES.find((s) => s.exts.includes(extOf(name)));
