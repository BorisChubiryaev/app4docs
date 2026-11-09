// Шаблон графики для слайда: что он показывает, какие у него настройки и как
// он рисует кадр в момент времени t. Кадр — функция от t, поэтому один и тот
// же код рисует превью, картинку любого размера и видео покадрово.

export type Val = string | number | boolean;
export type Params = Record<string, Val>;

export interface Row {
  label: string;
  value: number;
  /** Второе значение (план/факт, прошлый/этот год) */
  value2?: number;
  /** Подпись под именем (должность) */
  note?: string;
}

export type Group = "charts" | "text" | "backgrounds" | "cards";

/** Какие данные вводит пользователь */
export type Input = "rows" | "pairs" | "single" | "phrases" | "photos" | "people" | "none";

export type Control =
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "range"; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; type: "select"; options: [string, string][] }
  | { key: string; label: string; type: "toggle" }
  | { key: string; label: string; type: "color" };

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Время кадра, с */
  t: number;
  /** Длительность ролика, с (для зацикленных шаблонов — период) */
  dur: number;
  /** Масштаб: 1 для кадра 1920×1080 (по меньшей стороне 1080) */
  s: number;
  p: Params;
  rows: Row[];
  phrases: string[];
  images: (HTMLImageElement | ImageBitmap)[];
  pal: string[];
  /** Основной и приглушённый цвет текста под фон */
  ink: string;
  muted: string;
  /** Фон тёмный (для выбора контрастных деталей) */
  dark: boolean;
  /** Цвет подложки под шаблоном или null, если фон прозрачный */
  base: string | null;
  /**
   * Точка, за которой следует интерактивный шаблон, в долях кадра:
   * follow(0) — сейчас, follow(0.5) — полсекунды назад. null — курсора нет,
   * шаблон движется по своей траектории (так же пишется видео).
   */
  follow: ((ago: number) => [number, number]) | null;
}

export interface Template {
  id: string;
  name: string;
  group: Group;
  about: string;
  input: Input;
  /** Длительность по умолчанию, с */
  duration: number;
  /** Зацикленная анимация: кадр при t и при t + dur одинаков */
  loop: boolean;
  /** Шаблон сам рисует фон на весь кадр */
  ownBackground?: boolean;
  controls: Control[];
  defaults: {
    params: Params;
    rows?: Row[];
    phrases?: string[];
    palette?: string[];
    background?: Background;
  };
  /** Кнопка «Перемешать» меняет параметр seed */
  shuffle?: boolean;
  /** Шаблон следует за курсором в превью; подсказка для пользователя */
  interactive?: string;
  draw(f: Frame): void;
}

export type BackgroundKind = "transparent" | "white" | "light" | "dark" | "custom";
export interface Background {
  kind: BackgroundKind;
  color: string;
}

export interface Scene {
  templateId: string;
  params: Params;
  rows: Row[];
  phrases: string[];
  palette: string[];
  background: Background;
  /** Цвет текста: авто по фону или принудительно */
  ink: "auto" | "dark" | "light";
  /** Проверенная палитра, подобранная под светлый или тёмный фон */
  paletteAuto: boolean;
}
