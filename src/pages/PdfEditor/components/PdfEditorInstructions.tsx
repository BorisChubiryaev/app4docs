// src/components/PdfEditorInstructions.tsx
import React from "react";
import "./PdfEditorInstructions.css";

interface PdfEditorInstructionsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PdfEditorInstructions: React.FC<PdfEditorInstructionsProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="instructions-overlay" onClick={onClose}>
      <div className="instructions-modal" onClick={(e) => e.stopPropagation()}>
        <div className="instructions-header">
          <h2>📄 Инструкция по работе с PDF Редактором</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="instructions-content">
          <section className="instruction-section">
            <h3>📁 1. Загрузка PDF файлов</h3>
            <ul>
              <li>Нажмите на область "Перетащите PDF файлы сюда" или на кнопку "Выбрать файлы"</li>
              <li>Можно выбрать несколько PDF файлов одновременно</li>
              <li>Также можно перетащить файлы мышкой в область загрузки</li>
              <li>Поддерживаются файлы в формате PDF любого размера</li>
            </ul>
          </section>

          <section className="instruction-section">
            <h3>📑 2. Управление страницами</h3>
            <ul>
              <li>
                <strong>Просмотр страниц:</strong> Все страницы из загруженных PDF отображаются в виде миниатюр
              </li>
              <li>
                <strong>Перетаскивание:</strong> Для изменения порядка страниц просто перетащите их мышкой
              </li>
              <li>
                <strong>Удаление страниц:</strong> Нажмите на крестик ✕ в правом верхнем углу миниатюры, чтобы удалить страницу
              </li>
            </ul>
          </section>

          <section className="instruction-section">
            <h3>🔗 3. Объединение PDF</h3>
            <ul>
              <li>После того как вы расположили страницы в нужном порядке, нажмите кнопку "💾 Скачать PDF"</li>
              <li>Все страницы будут объединены в один PDF файл в выбранном порядке</li>
              {/* <li>Файл сохранится с именем "merged-document-{timestamp}.pdf"</li> */}
            </ul>
          </section>

          <section className="instruction-section">
            <h3>🗑️ 4. Очистка</h3>
            <ul>
              <li>Кнопка "🗑️ Очистить все" удаляет все загруженные страницы</li>
              <li>Вы также можете удалить отдельные страницы с помощью крестика на миниатюре</li>
            </ul>
          </section>

          <section className="instruction-section">
            <h3>💡 5. Советы</h3>
            <ul>
              <li>Порядок страниц можно менять перетаскиванием - просто схватите миниатюру и переместите</li>
              <li>При перетаскивании будет подсвечиваться место вставки</li>
              <li>Все операции выполняются локально в вашем браузере - файлы не отправляются на сервер</li>
              <li>Можно комбинировать страницы из разных PDF файлов в любом порядке</li>
            </ul>
          </section>

        </div>

        <div className="instructions-footer">
          <button className="primary-button" onClick={onClose}>
            Понятно, спасибо!
          </button>
        </div>
      </div>
    </div>
  );
};
