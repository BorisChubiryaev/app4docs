import type { SearchOptions } from "./engine";

export interface ChessLevel {
  id: number;
  name: string;
  hint: string;
  opts: SearchOptions;
}

/** Уровни: слабые — мелкий поиск со случайностью, сильные — по времени. */
export const CHESS_LEVELS: ChessLevel[] = [
  { id: 1, name: "Новичок", hint: "Видит на ход вперёд и часто ошибается", opts: { depth: 1, timeMs: 1000, noise: 220, blunder: 0.3 } },
  { id: 2, name: "Любитель", hint: "Не зевает фигуры, но играет неточно", opts: { depth: 2, timeMs: 1000, noise: 90, blunder: 0.08 } },
  { id: 3, name: "Клубный", hint: "Считает на 3 полухода", opts: { depth: 3, timeMs: 2000, noise: 30 } },
  { id: 4, name: "Опытный", hint: "Полный поиск, ~0,5 с на ход", opts: { depth: 64, timeMs: 500 } },
  { id: 5, name: "Сильный", hint: "Полный поиск, ~1,5 с на ход", opts: { depth: 64, timeMs: 1500 } },
  { id: 6, name: "Мастер", hint: "Полный поиск, до 4 с на ход", opts: { depth: 64, timeMs: 4000 } },
];
