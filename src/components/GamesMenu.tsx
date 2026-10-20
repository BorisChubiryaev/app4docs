import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./GamesMenu.css";

const GAMES = [
  { to: "/Chess", icon: "♟️", title: "Шахматы", desc: "Партия с компьютером, 6 уровней" },
  { to: "/ChessLessons", icon: "🎓", title: "Уроки шахмат", desc: "С нуля до первой партии" },
  { to: "/Checkers", icon: "⛀", title: "Шашки", desc: "Русские шашки, 6 уровней" },
  { to: "/SnakeGame", icon: "🐍", title: "Змейка", desc: "Собирай файлы, проходи уровни" },
  { to: "/DocMatchGame", icon: "🧩", title: "Три в ряд", desc: "Документный перерыв для ума" },
];

/** Одна кнопка «Игры» в подвале главной: по нажатию — список игр. */
const GamesMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="games-menu" ref={ref}>
      <button
        type="button"
        className="lg-btn lg-btn--game"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Игры — перерыв для ума"
      >
        <span className="lg-btn__game-icon">🎮</span>
        Игры
      </button>
      {open && (
        <div className="games-menu__panel" role="menu">
          <div className="games-menu__title">Перерыв для ума</div>
          {GAMES.map((g) => (
            <Link key={g.to} to={g.to} className="games-menu__item" role="menuitem" onClick={() => setOpen(false)}>
              <span className="games-menu__icon" aria-hidden="true">
                {g.icon}
              </span>
              <span>
                <b>{g.title}</b>
                <small>{g.desc}</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default GamesMenu;
