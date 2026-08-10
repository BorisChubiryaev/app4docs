// src/components/ThemeToggle.tsx
// Понятный переключатель темы: сегментированная «пилюля» с двумя вариантами
// (светлая/тёмная), активный подсвечен. Работает на всех страницах.
import { memo } from "react";
import { useTheme } from "../hooks/useTheme";

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
    <g
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </g>
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2z"
      fill="currentColor"
    />
  </svg>
);

const ThemeToggle = memo(() => {
  const [theme, setTheme] = useTheme();
  return (
    <div className="ds-theme" role="group" aria-label="Тема оформления">
      <button
        type="button"
        className={`ds-theme__opt ${theme === "light" ? "is-active" : ""}`}
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
        aria-label="Светлая тема"
        title="Светлая тема"
      >
        <SunIcon />
      </button>
      <button
        type="button"
        className={`ds-theme__opt ${theme === "dark" ? "is-active" : ""}`}
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
        aria-label="Тёмная тема"
        title="Тёмная тема"
      >
        <MoonIcon />
      </button>
    </div>
  );
});

export default ThemeToggle;
