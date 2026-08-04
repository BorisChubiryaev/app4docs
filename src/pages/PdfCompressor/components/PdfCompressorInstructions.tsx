import React from "react";
import InstructionsModal from "../../../components/InstructionsModal";

interface PdfCompressorInstructionsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PdfCompressorInstructions: React.FC<
  PdfCompressorInstructionsProps
> = ({ isOpen, onClose }) => (
  <InstructionsModal
    isOpen={isOpen}
    onClose={onClose}
    title="📦 Инструкция по работе с PDF Компрессором"
  >
    <section className="instruction-section">
      <h3>📁 1. Загрузка PDF</h3>
      <ul>
        <li>Нажмите на область загрузки или перетащите PDF файл мышкой</li>
        <li>Поддерживаются файлы любого размера</li>
        <li>После загрузки вы увидите информацию о файле</li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>⚙️ 2. Сжатие</h3>
      <ul>
        <li>Нажмите кнопку "Уменьшить размер PDF"</li>
        <li>Процесс сжатия занимает от нескольких секунд до минут</li>
        <li>Вы можете отменить сжатие в любой момент</li>
        <li>Прогресс отображается в реальном времени</li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>📊 3. Результаты</h3>
      <ul>
        <li>После сжатия вы увидите сравнение размеров файлов</li>
        <li>Будет показан процент экономии места</li>
        <li>Вы можете скачать сжатый файл или начать заново</li>
      </ul>
    </section>

    <section className="instruction-section">
      <h3>⚠️ 4. Важное ограничение</h3>
      <ul>
        <li>
          <strong>
            Эффективно работает только с PDF, содержащими изображения
          </strong>{" "}
          (сканы, фото, картинки)
        </li>
        <li>
          <strong>Не рекомендуется для текстовых PDF</strong> - размер файла
          может увеличиться
        </li>
        <li>Текстовые PDF лучше сжимать другими инструментами</li>
      </ul>
    </section>

    <div className="instruction-tip">
      <span className="tip-icon">💡</span>
      <span>
        Совет: Для лучшего результата используйте исходные файлы с высоким
        качеством изображений
      </span>
    </div>
  </InstructionsModal>
);
