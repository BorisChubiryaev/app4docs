import React from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import { isMac, openPalette } from "../utils/palette";
import { ICONS } from "../tools";
import "./PageShell.css";

interface PageShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Показать кнопку «Инструкция» (передайте обработчик открытия) */
  onShowInstructions?: () => void;
  /** Показать ссылку на главную (по умолчанию да) */
  showHome?: boolean;
  /** Доп. действия в правой части шапки (перед кнопкой инструкции) */
  actions?: React.ReactNode;
  /** Максимальная ширина контента, px или строка. По умолчанию 1440 */
  width?: number | string;
  /** Занять весь экран без прокрутки страницы (контент сам управляет высотой) */
  fill?: boolean;
  children: React.ReactNode;
}

/** Знак Convertix: четыре «стрелки преобразования» в фирменном градиенте */
export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden="true"
    className="cvx-mark"
  >
    <defs>
      <linearGradient
        id="cvx-mark-g"
        x1="0"
        y1="0"
        x2="32"
        y2="32"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#0087cd" />
        <stop offset="0.35" stopColor="#515dad" />
        <stop offset="0.68" stopColor="#8253aa" />
        <stop offset="1" stopColor="#ff1c77" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#cvx-mark-g)" />
    <path
      d="M10 12.5h9.5l-3-3M22 19.5h-9.5l3 3"
      fill="none"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type HeaderProps = Pick<
  PageShellProps,
  | "title"
  | "subtitle"
  | "icon"
  | "onShowInstructions"
  | "showHome"
  | "actions"
  | "width"
>;

/** Шапка инструмента: логотип → главная · название · поиск · тема · инструкция */
export const ShellHeader: React.FC<HeaderProps> = ({
  title,
  subtitle,
  icon,
  onShowInstructions,
  showHome = true,
  actions,
  width = 1440,
}) => (
  <header className="ds-page__header">
    <div className="ds-page__header-inner" style={{ maxWidth: width }}>
      <div className="ds-page__lead">
        {showHome && (
          <Link to="/" className="ds-page__home" title="Все инструменты">
            <BrandMark />
            <span className="ds-page__brand">Convertix</span>
          </Link>
        )}
        {showHome && <span className="ds-page__sep" aria-hidden="true" />}
        <div className="ds-page__titles">
          <h1 className="ds-page__title">
            {icon && <span className="ds-page__icon">{icon}</span>}
            {title}
          </h1>
          {subtitle && <p className="ds-page__subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="ds-page__nav">
        {actions}
        <button
          type="button"
          className="ds-nav-btn ds-nav-btn--search"
          onClick={openPalette}
          title="Найти другой инструмент"
        >
          {ICONS.search}
          <span>Найти</span>
          <kbd className="kbd">{isMac() ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <ThemeToggle />
        {onShowInstructions && (
          <button
            className="ds-nav-btn"
            onClick={onShowInstructions}
            aria-label="Показать инструкцию"
          >
            {ICONS.book}
            <span>Инструкция</span>
          </button>
        )}
      </div>
    </div>
  </header>
);

/** Единая оболочка страницы инструмента: шапка и контейнер контента. */
const PageShell: React.FC<PageShellProps> = ({
  width = 1440,
  fill = false,
  children,
  ...header
}) => (
  <div className={`ds-page${fill ? " ds-page--fill" : ""}`}>
    <ShellHeader width={width} {...header} />
    <main
      className={`ds-page__body${fill ? " ds-page__body--fill" : ""}`}
      style={{ maxWidth: width }}
    >
      {children}
    </main>
  </div>
);

export default PageShell;
