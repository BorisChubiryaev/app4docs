import React, { useEffect } from "react";
import "./InstructionsModal.css";

interface InstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footerLabel?: string;
  /** Максимальная ширина окна, по умолчанию 720px */
  maxWidth?: number | string;
}

/**
 * Единый каркас для модальных окон-инструкций.
 * Содержит оверлей, шапку с заголовком и крестиком, тело со скроллом,
 * футер с кнопкой, а также закрытие по Escape и блокировку прокрутки фона.
 * Контент секций страницы передают как children — разметка не меняется.
 */
const InstructionsModal: React.FC<InstructionsModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footerLabel = "Понятно, спасибо!",
  maxWidth = 720,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="im-overlay" onClick={onClose}>
      <div
        className="im-modal"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="im-header">
          <h2 className="im-title">{title}</h2>
          <button className="im-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="im-body">{children}</div>

        <div className="im-footer">
          <button className="im-btn" onClick={onClose}>
            {footerLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstructionsModal;
