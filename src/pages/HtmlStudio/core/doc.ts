// Документ в редакторе: фрейм без выполнения скриптов (sandbox без
// allow-scripts) — страница видна и редактируется, но её код не работает,
// поэтому даже чужой файл открывать безопасно. Служебные пометки редактора
// (выделение, наведение, режим правки) при сохранении убираются.

export const EDITOR_STYLE_ID = "he-editor-style";

const EDITOR_CSS = `
[data-he-hover]:not([data-he-sel]) { outline: 2px dashed rgba(79, 110, 247, 0.85) !important; outline-offset: 1px !important; cursor: pointer !important; }
/* Контейнеры, которые заполняют скрипты (в визуальном режиме скрипты не выполняются) */
canvas, div[id]:empty, svg:empty { min-height: 48px; background: repeating-linear-gradient(45deg, rgba(79, 110, 247, 0.06) 0 8px, transparent 8px 16px) !important; }
/* Выделение должно читаться на любом фоне: розовая рамка, белый ободок и
   розовое свечение снаружи. Заливку не делаем — на цветном фоне она похожа
   на обычное выделение текста браузером */
[data-he-sel] { outline: 3px solid #ff1c77 !important; outline-offset: 4px !important; box-shadow: 0 0 0 4px #fff, 0 0 0 10px rgba(255, 28, 119, 0.3) !important; }
[data-he-edit] { outline: 2px solid #ff1c77 !important; outline-offset: 2px !important; cursor: text !important; background-image: linear-gradient(rgba(255, 28, 119, 0.05), rgba(255, 28, 119, 0.05)) !important; }
[data-he-flash] { animation: he-flash 1.2s ease !important; }
@keyframes he-flash { 0%, 50% { box-shadow: 0 0 0 4px rgba(255, 28, 119, 0.55); } 100% { box-shadow: none; } }
`;

/** Подготовить документ фрейма к редактированию. */
export function setupEditorDoc(doc: Document) {
  if (!doc.getElementById(EDITOR_STYLE_ID)) {
    const st = doc.createElement("style");
    st.id = EDITOR_STYLE_ID;
    st.setAttribute("data-he", "");
    st.textContent = EDITOR_CSS;
    (doc.head ?? doc.documentElement).appendChild(st);
  }
}

const HE_ATTRS = ["data-he-sel", "data-he-hover", "data-he-edit", "data-he-flash"];

/** HTML документа без служебного оформления редактора. */
export function serializeDoc(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll("[data-he]").forEach((e) => e.remove());
  for (const a of HE_ATTRS) root.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a));
  // Режим правки текста включал редактор — не сам документ
  root.querySelectorAll("[data-he-ce]").forEach((e) => {
    e.removeAttribute("contenteditable");
    e.removeAttribute("data-he-ce");
    e.removeAttribute("spellcheck");
  });
  const dt = doc.doctype;
  const doctype = dt
    ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>\n`
    : "";
  return doctype + root.outerHTML;
}

/** Нормализовать входной HTML (фрагмент из чата → полноценная страница). */
export function normalizeHtml(src: string): string {
  const t = src.replace(/^\uFEFF/, "");
  if (/<html[\s>]/i.test(t) || /<!doctype/i.test(t)) return t;
  return `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Документ</title>\n</head>\n<body>\n${t}\n</body>\n</html>`;
}

/** Путь к элементу для «хлебных крошек»: body › div.card › h2 */
export function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = Array.from(el.classList)
    .filter((c) => !c.startsWith("he-"))
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${cls}`;
}

export const TAG_NAMES: Record<string, string> = {
  h1: "Заголовок 1",
  h2: "Заголовок 2",
  h3: "Заголовок 3",
  h4: "Заголовок 4",
  p: "Абзац",
  span: "Фрагмент текста",
  a: "Ссылка",
  img: "Картинка",
  button: "Кнопка",
  ul: "Список",
  ol: "Нумерованный список",
  li: "Пункт списка",
  table: "Таблица",
  tr: "Строка таблицы",
  td: "Ячейка",
  th: "Ячейка заголовка",
  div: "Блок",
  section: "Раздел",
  header: "Шапка",
  footer: "Подвал",
  nav: "Меню",
  main: "Основная часть",
  article: "Статья",
  aside: "Боковая колонка",
  svg: "Векторная графика",
  canvas: "Холст (рисует скрипт)",
  strong: "Жирный текст",
  em: "Курсив",
  b: "Жирный текст",
  i: "Курсив",
  hr: "Разделитель",
  blockquote: "Цитата",
  figure: "Иллюстрация",
  figcaption: "Подпись",
  label: "Подпись поля",
  input: "Поле ввода",
};

/** Можно ли править текст элемента прямо на странице. */
export const isTextual = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  if (["img", "svg", "canvas", "video", "iframe", "input", "select", "textarea", "hr", "br", "table", "tr", "tbody", "thead", "ul", "ol", "html", "body"].includes(tag)) return false;
  return (el.textContent ?? "").trim().length > 0 || ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "span", "a", "button", "div", "label"].includes(tag);
};

/** Шаблоны вставляемых блоков. */
export const INSERTS: { id: string; label: string; html: string }[] = [
  { id: "h2", label: "Заголовок", html: "<h2>Новый заголовок</h2>" },
  { id: "p", label: "Абзац", html: "<p>Новый абзац текста.</p>" },
  { id: "ul", label: "Список", html: "<ul><li>Первый пункт</li><li>Второй пункт</li></ul>" },
  { id: "img", label: "Картинка", html: '<img src="" alt="Картинка" style="max-width:100%">' },
  { id: "a", label: "Ссылка-кнопка", html: '<a href="#" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#4f6ef7;color:#fff;text-decoration:none">Кнопка</a>' },
  { id: "hr", label: "Разделитель", html: "<hr>" },
  {
    id: "table",
    label: "Таблица 3×3",
    html: '<table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ccc;padding:6px">Столбец 1</th><th style="border:1px solid #ccc;padding:6px">Столбец 2</th><th style="border:1px solid #ccc;padding:6px">Столбец 3</th></tr></thead><tbody><tr><td style="border:1px solid #ccc;padding:6px">—</td><td style="border:1px solid #ccc;padding:6px">—</td><td style="border:1px solid #ccc;padding:6px">—</td></tr><tr><td style="border:1px solid #ccc;padding:6px">—</td><td style="border:1px solid #ccc;padding:6px">—</td><td style="border:1px solid #ccc;padding:6px">—</td></tr></tbody></table>',
  },
  { id: "note", label: "Плашка-заметка", html: '<div style="padding:12px 16px;border-radius:10px;background:#fff7e6;border:1px solid #f5c26b">Важная заметка</div>' },
];
