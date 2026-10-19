import { useEffect, useState } from "react";

/** useState, который переживает перезагрузку страницы (localStorage; без него — просто state). */
export function useLocalState<T>(key: string, initial: T, valid: (v: unknown) => boolean = () => true) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (valid(parsed)) return parsed as T;
      }
    } catch {
      /* приватный режим или битые данные — начинаем с нуля */
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* хранилище недоступно — игра просто не запомнится */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export interface Score {
  win: number;
  loss: number;
  draw: number;
}
export const EMPTY_SCORE: Score = { win: 0, loss: 0, draw: 0 };
