import React from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import "./PageShell.css";

interface PageShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Показать кнопку «Инструкция» (передайте обработчик открытия) */
  onShowInstructions?: () => void;
  /** Показать кнопку «На главную» (по умолчанию да) */
  showHome?: boolean;
  /** Доп. действия в правой части шапки (перед кнопкой инструкции) */
  actions?: React.ReactNode;
  /** Максимальная ширина контента, px или строка. По умолчанию 1440 */
  width?: number | string;
  /** Занять весь экран без прокрутки страницы (контент сам управляет высотой) */
  fill?: boolean;
  children: React.ReactNode;
}

/**
 * Единая оболочка страницы: светлый фон, шапка (на главную · заголовок ·
 * инструкция) и контейнер контента. Заменяет постраничные самодельные
 * шапки/фоны, чтобы все инструменты выглядели как один продукт.
 */
const PageShell: React.FC<PageShellProps> = ({
  title,
  subtitle,
  icon,
  onShowInstructions,
  showHome = true,
  actions,
  width = 1440,
  fill = false,
  children,
}) => (
  <div className={`ds-page${fill ? " ds-page--fill" : ""}`}>
    <header className="ds-page__header">
      <div className="ds-page__header-inner" style={{ maxWidth: width }}>
        <div className="ds-page__nav ds-page__nav--left">
          {showHome && (
            <Link to="/" className="ds-nav-btn">
              🏠 <span>На главную</span>
            </Link>
          )}
        </div>

        <div className="ds-page__titles">
          <h1 className="ds-page__title">
            {icon && <span className="ds-page__icon">{icon}</span>}
            {title}
          </h1>
          {subtitle && <p className="ds-page__subtitle">{subtitle}</p>}
        </div>

        <div className="ds-page__nav ds-page__nav--right">
          {actions}
          <ThemeToggle />
          {onShowInstructions && (
            <button
              className="ds-nav-btn"
              onClick={onShowInstructions}
              aria-label="Показать инструкцию"
            >
              📚 <span>Инструкция</span>
            </button>
          )}
        </div>
      </div>
    </header>

    <main
      className={`ds-page__body${fill ? " ds-page__body--fill" : ""}`}
      style={{ maxWidth: width }}
    >
      {children}
    </main>
  </div>
);

export default PageShell;
