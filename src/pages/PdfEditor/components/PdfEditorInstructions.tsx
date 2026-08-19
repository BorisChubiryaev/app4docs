import React from "react";
import InstructionsModal from "../../../components/InstructionsModal";

interface PdfEditorInstructionsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PdfEditorInstructions: React.FC<PdfEditorInstructionsProps> = ({
  isOpen,
  onClose,
}) => (
  <InstructionsModal
    isOpen={isOpen}
    onClose={onClose}
    title="📄 Инструкция по работе с PDF Studio"
  >
    <section className="instruction-section">
      <h3>✏️ Редактор страницы</h3>
      <ul>
        <li>
          Наведите на страницу и нажмите <strong>✏️</strong> — откроется
          редактор поверх страницы.
        </li>
        <li>
          Инструменты: текст, рисование, линия, стрелка, прямоугольник,
          выделение, вставка картинки. Объекты можно двигать и масштабировать.
        </li>
        <li>
          «Готово» сохраняет разметку; она «запекается» в PDF при скачивании.
          Кириллица поддерживается.
        </li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>🔁 Поворот и 🗜️ сжатие</h3>
      <ul>
        <li>
          <strong>Поворот:</strong> наведите на страницу и нажмите ↻ (или
          выделите несколько и «↻ Повернуть») — поворот на 90°. Учитывается при
          скачивании.
        </li>
        <li>
          <strong>Сжатие:</strong> кнопка «🗜️ Сжать» — страницы перерисовываются
          в изображения, что уменьшает вес PDF (эффективно для сканов и
          картинок). Можно сжать все или только выделенные.
        </li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>📁 1. Загрузка PDF файлов</h3>
      <ul>
        <li>
          Нажмите на область "Перетащите PDF файлы сюда" или на кнопку "Выбрать
          файлы"
        </li>
        <li>Можно выбрать несколько PDF файлов одновременно</li>
        <li>Также можно перетащить файлы мышкой в область загрузки</li>
        <li>Поддерживаются файлы в формате PDF любого размера</li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>📑 2. Управление страницами</h3>
      <ul>
        <li>
          <strong>Просмотр страниц:</strong> Все страницы из загруженных PDF
          отображаются в виде миниатюр
        </li>
        <li>
          <strong>Перетаскивание:</strong> Для изменения порядка страниц просто
          перетащите их мышкой
        </li>
        <li>
          <strong>Удаление страниц:</strong> Нажмите на крестик ✕ в правом
          верхнем углу миниатюры, чтобы удалить страницу
        </li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>🔗 3. Объединение PDF</h3>
      <ul>
        <li>
          После того как вы расположили страницы в нужном порядке, нажмите кнопку
          "💾 Скачать PDF"
        </li>
        <li>Все страницы будут объединены в один PDF файл в выбранном порядке</li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>🗑️ 4. Очистка</h3>
      <ul>
        <li>Кнопка "🗑️ Очистить все" удаляет все загруженные страницы</li>
        <li>
          Вы также можете удалить отдельные страницы с помощью крестика на
          миниатюре
        </li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>💡 5. Советы</h3>
      <ul>
        <li>
          Порядок страниц можно менять перетаскиванием - просто схватите
          миниатюру и переместите
        </li>
        <li>При перетаскивании будет подсвечиваться место вставки</li>
        <li>
          Все операции выполняются локально в вашем браузере - файлы не
          отправляются на сервер
        </li>
        <li>
          Можно комбинировать страницы из разных PDF файлов в любом порядке
        </li>
      </ul>
    </section>
  </InstructionsModal>
);
