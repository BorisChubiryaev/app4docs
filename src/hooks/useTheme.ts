// src/hooks/useTheme.ts
// Единый источник правды для темы оформления (светлая/тёмная).
// Значение хранится в localStorage и применяется на <html> через data-theme.
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "hp-theme";

/** Прочитать сохранённую тему; при отсутствии — из системной настройки. */
export function getInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Применить тему к документу и сохранить в localStorage. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

/** Считать текущую тему с документа (её ставит applyTheme на старте). */
function readCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" || attr === "light" ? attr : getInitialTheme();
}

/**
 * Хук темы. Возвращает текущую тему и функцию установки.
 * Синхронизируется между несколькими экземплярами (разные страницы/шапки)
 * через событие storage и кастомное событие "themechange".
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readCurrentTheme);

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
    setThemeState(t);
    window.dispatchEvent(new CustomEvent("themechange", { detail: t }));
  }, []);

  useEffect(() => {
    const sync = () => setThemeState(readCurrentTheme());
    window.addEventListener("themechange", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("themechange", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [theme, setTheme];
}
