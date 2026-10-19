import type { CheckersSearchOptions } from "./engine";

export interface CheckersLevel {
  id: number;
  name: string;
  hint: string;
  opts: CheckersSearchOptions;
}

export const CHECKERS_LEVELS: CheckersLevel[] = [
  { id: 1, name: "Новичок", hint: "Смотрит на ход вперёд и часто ошибается", opts: { depth: 2, timeMs: 1000, noise: 160, blunder: 0.3 } },
  { id: 2, name: "Любитель", hint: "Не отдаёт шашки даром, но играет неточно", opts: { depth: 3, timeMs: 1000, noise: 60, blunder: 0.08 } },
  { id: 3, name: "Клубный", hint: "Считает на 5 полуходов", opts: { depth: 5, timeMs: 2000, noise: 20 } },
  { id: 4, name: "Опытный", hint: "Полный поиск, ~0,5 с на ход", opts: { depth: 64, timeMs: 500 } },
  { id: 5, name: "Сильный", hint: "Полный поиск, ~1,5 с на ход", opts: { depth: 64, timeMs: 1500 } },
  { id: 6, name: "Мастер", hint: "Полный поиск, до 4 с на ход", opts: { depth: 64, timeMs: 4000 } },
];
