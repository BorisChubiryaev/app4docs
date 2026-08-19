// src/components/DownloadSuccessModal.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./DownloadSuccessModal.css";

interface DownloadSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  filename?: string;
}

// Данные об инструментах для рекламного блока
const toolsPromo = [
  {
    icon: "📊",
    title: "Сравнение Excel по рабочим местам",
    desc: "Сравнение «как было — как стало» из АС «Друг»",
    path: "/WorkplaceCompare",
  },
  {
    icon: "🔄",
    title: "Сравнение Excel/Word",
    desc: "Анализ различий с удобной визуализацией",
    path: "/compare",
  },
  {
    icon: "📄",
    title: "Конвертер HTML → Excel",
    desc: "Распознавание таблиц, выбор строк и колонок",
    path: "/htmlToExcel",
  },
  {
    icon: "🎨",
    title: "SVG → PNG/JPEG",
    desc: "Настройка фона, размера и пропорций",
    path: "/Svg2Png",
  },
  {
    icon: "📄",
    title: "PDF Studio",
    desc: "Порядок, повороты, объединение, разделение и сжатие",
    path: "/PdfEditor",
  },
  {
    icon: "📎",
    title: "Excel Группиратор",
    desc: "Сборка данных из разных файлов в один",
    path: "/ExcelTableBuilder",
  },
  {
    icon: "📈",
    title: "Генератор графиков",
    desc: "Настройка осей, типов, стилей и экспорт",
    path: "/ChartCraft",
  },
];

const DownloadSuccessModal: React.FC<DownloadSuccessModalProps> = ({
  isOpen,
  onClose,
  filename,
}) => {
  const [showArrow, setShowArrow] = useState(true);
  const [showPromo, setShowPromo] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowArrow(true);

      // Показываем рекламный блок с небольшой задержкой
      const promoTimer = setTimeout(() => {
        setShowPromo(true);
      }, 600);

      const arrowTimer = setTimeout(() => {
        setShowArrow(false);
      }, 5000);

      return () => {
        clearTimeout(promoTimer);
        clearTimeout(arrowTimer);
      };
    } else {
      setShowPromo(false);
    }
  }, [isOpen]);

  const handleOpenSberChat = () => {
    window.open(
      "https://sberchat.sberbank.ru/join-circle/0abb2491520a72356261de83e7ba96bbace14faae1248dedd3125ed476f5295b",
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleClose = () => {
    setShowArrow(false);
    setShowPromo(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Индикатор загрузки — стрелка */}
      {showArrow && (
        <div className="download-indicator">
          <div className="download-indicator__arrow">
            <svg width="36" height="36" viewBox="0 0 40 40" fill="none">
              <path
                d="M28 12L14 26M28 12H18M28 12V22"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="download-indicator__text">Файл загружен</div>
          <div className="download-indicator__pulse" />
        </div>
      )}

      {/* Модальное окно */}
      <div className="ds-modal-overlay" onClick={handleClose}>
        <div
          className={`ds-modal ds-modal--wide ${showPromo ? "ds-modal--expanded" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ds-modal__content">
            <button className="ds-modal__close" onClick={handleClose}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {/* Шапка */}
            <div className="ds-modal__success-icon">
              <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" fill="#34C759" opacity="0.12" />
                <path
                  d="M24 32l6 6 10-10"
                  stroke="#34C759"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 className="ds-modal__title">Таблица успешно скачана! 🎉</h2>

            {filename && <p className="ds-modal__filename">📄 {filename}</p>}

            <p className="ds-modal__text">
              Благодарим за использование{" "}
              <span className="lg-gradient-text">EX-EL</span>!
            </p>

            {/* Рекламный блок */}
            <div className={`ds-promo ${showPromo ? "ds-promo--visible" : ""}`}>
              <div className="ds-promo__header">
                <span className="ds-promo__rocket">🚀</span>
                <div>
                  <h3 className="ds-promo__title">
                    EX-EL — ваш помощник в работе с документами
                  </h3>
                  <p className="ds-promo__subtitle">
                    Устали от рутины с Excel, PDF и таблицами? Попробуйте другие
                    инструменты:
                  </p>
                </div>
              </div>

              <div className="ds-promo__grid">
                {toolsPromo.map((tool, index) => (
                  <Link
                    key={tool.path}
                    to={tool.path}
                    className="ds-promo__card"
                    style={{ animationDelay: `${0.3 + index * 0.05}s` }}
                    onClick={handleClose}
                  >
                    <span className="ds-promo__card-icon">{tool.icon}</span>
                    <div className="ds-promo__card-info">
                      <span className="ds-promo__card-title">{tool.title}</span>
                      <span className="ds-promo__card-desc">{tool.desc}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* CTA секция */}
            <div className="ds-modal__cta">
              <p className="ds-modal__cta-text">
                💬 Есть вопросы или идеи? Присоединяйтесь к нашему чату в Сбере!
              </p>
              <button
                className="lg-btn lg-btn--sberchat ds-modal__btn"
                onClick={handleOpenSberChat}
              >
                <img
                  src="./sberchatLogo.png"
                  alt="СберЧат"
                  className="lg-btn__icon-img"
                />
                Присоединиться к каналу
              </button>
            </div>

            <button
              className="lg-btn lg-btn--ghost ds-modal__close-btn"
              onClick={handleClose}
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DownloadSuccessModal;
