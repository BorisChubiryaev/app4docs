import React from "react";
import "../Svg2Png.css";

// Компонент инструкции
export const SvgInstructionsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Инструкция по использованию SVG конвертера</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="instructions-section">
            <h3>🎯 Назначение инструмента</h3>
            <p>
              Конвертер позволяет преобразовывать SVG (Scalable Vector Graphics)
              изображения в растровые форматы PNG и JPEG с настройкой параметров
              экспорта.
            </p>
          </div>

          <div className="instructions-section">
            <h3>📝 Способы загрузки SVG</h3>
            <p>
              <strong>Два способа ввода данных:</strong>
            </p>
            <ul>
              <li>
                <strong>📁 Загрузка файла:</strong> Выберите SVG файл с вашего
                устройства
              </li>
              <li>
                <strong>📝 Вставка кода:</strong> Вставьте SVG код напрямую в
                текстовое поле
              </li>
            </ul>

            <p>
              <strong>Пример SVG кода:</strong>
            </p>
            <pre>{`<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="80" fill="#4f46e5" />
  <text x="100" y="110" text-anchor="middle" fill="white">SVG</text>
</svg>`}</pre>
          </div>

          <div className="instructions-section">
            <h3>⚙️ Настройки экспорта</h3>

            <p>
              <strong>Форматы вывода:</strong>
            </p>
            <ul>
              <li>
                <strong>PNG</strong> - формат с поддержкой прозрачности, идеален
                для логотипов и графики
              </li>
              <li>
                <strong>JPEG</strong> - формат с настраиваемым качеством,
                подходит для фотографий
              </li>
            </ul>

            <p>
              <strong>Основные параметры:</strong>
            </p>
            <ul>
              <li>
                <strong>Размер изображения:</strong> Ширина и высота в пикселях
              </li>
              <li>
                <strong>Фон:</strong> Цвет фона или прозрачность
              </li>
              <li>
                <strong>Качество JPEG:</strong> От 10% до 100%
              </li>
              <li>
                <strong>Сохранять пропорции:</strong> Автоматическое
                масштабирование без искажений
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>🔄 Процесс конвертации</h3>
            <ol>
              <li>Выберите способ загрузки (файл или код)</li>
              <li>Настройте параметры экспорта</li>
              <li>Нажмите "Конвертировать"</li>
              <li>Просмотрите результат в превью</li>
              <li>Скачайте готовое изображение</li>
            </ol>
          </div>

          <div className="instructions-section">
            <h3>🎨 Особенности форматов</h3>

            <p>
              <strong>PNG (Portable Network Graphics):</strong>
            </p>
            <ul>
              <li>Поддержка прозрачности (альфа-канал)</li>
              <li>Без потерь качества</li>
              <li>Идеален для логотипов, иконок, графики</li>
              <li>Больший размер файла по сравнению с JPEG</li>
            </ul>

            <p>
              <strong>JPEG (Joint Photographic Experts Group):</strong>
            </p>
            <ul>
              <li>Настраиваемое качество сжатия</li>
              <li>Меньший размер файла</li>
              <li>Идеален для фотографий и сложных изображений</li>
              <li>Нет поддержки прозрачности</li>
              <li>Потери качества при высоком сжатии</li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>💡 Рекомендации по настройкам</h3>

            <p>
              <strong>Размеры изображения:</strong>
            </p>
            <ul>
              <li>
                <strong>Для веба:</strong> 800×600px - 1920×1080px
              </li>
              <li>
                <strong>Для печати:</strong> 300 DPI (умножьте нужный размер в
                дюймах на 300)
              </li>
              <li>
                <strong>Для иконок:</strong> 16×16px - 512×512px
              </li>
            </ul>

            <p>
              <strong>Качество JPEG:</strong>
            </p>
            <ul>
              <li>
                <strong>Высокое (80-100%):</strong> Для важных изображений,
                минимальные потери
              </li>
              <li>
                <strong>Среднее (60-80%):</strong> Баланс качества и размера
              </li>
              <li>
                <strong>Низкое (30-60%):</strong> Для превью или веб-страниц
              </li>
            </ul>

            <p>
              <strong>Фон:</strong>
            </p>
            <ul>
              <li>
                <strong>Прозрачный:</strong> Для наложения на другие изображения
              </li>
              <li>
                <strong>Белый:</strong> Стандартный для документов и веба
              </li>
              <li>
                <strong>Черный:</strong> Для темных тем оформления
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>📊 История конвертаций</h3>
            <p>
              Инструмент сохраняет последние 5 конвертаций, позволяя быстро
              скачать ранее преобразованные изображения без повторной
              конвертации.
            </p>
          </div>

          <div className="instructions-section">
            <h3>⚠️ Частые проблемы и решения</h3>
            <ul>
              <li>
                <strong>SVG не загружается:</strong>
                Убедитесь, что файл имеет расширение .svg и содержит валидный
                SVG код
              </li>
              <li>
                <strong>Прозрачность не работает в JPEG:</strong>
                JPEG не поддерживает прозрачность - используйте PNG формат
              </li>
              <li>
                <strong>Изображение искажено:</strong>
                Включите опцию "Сохранять пропорции"
              </li>
              <li>
                <strong>Большой размер файла:</strong>
                Для PNG - уменьшите размер изображения, для JPEG - снизьте
                качество
              </li>
              <li>
                <strong>Неверные цвета:</strong>
                Проверьте цветовую схему SVG (RGB/HEX)
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>🎯 Примеры использования</h3>

            <p>
              <strong>Логотипы и брендинг:</strong>
            </p>
            <ul>
              <li>Формат: PNG</li>
              <li>Фон: Прозрачный</li>
              <li>Качество: Максимальное</li>
              <li>Размер: От 32×32px до 512×512px</li>
            </ul>

            <p>
              <strong>Фотографии и иллюстрации:</strong>
            </p>
            <ul>
              <li>Формат: JPEG</li>
              <li>Качество: 80-90%</li>
              <li>Размер: Соответствует целевому использованию</li>
            </ul>

            <p>
              <strong>Иконки для приложений:</strong>
            </p>
            <ul>
              <li>Формат: PNG</li>
              <li>Размеры: 16×16, 32×32, 64×64, 128×128px</li>
              <li>Фон: Прозрачный</li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>🔧 Технические ограничения</h3>
            <ul>
              <li>Максимальный размер: 5000×5000 пикселей</li>
              <li>Поддерживаются только валидные SVG файлы</li>
              <li>Автоматическое определение размеров из SVG атрибутов</li>
              <li>Поддержка основных SVG элементов и стилей</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Понятно! Начать работу!
          </button>
        </div>
      </div>
    </div>
  );
};
