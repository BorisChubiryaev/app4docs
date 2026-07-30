import React from "react";
import "../WorkplaceCompare.css";

// Компонент инструкции
export const WorkplaceInstructionsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-workplace" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Инструкция по сравнению рабочих мест</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="instructions-section">
            <h3>🎯 Назначение инструмента</h3>
            <p>
              Инструмент предназначен для сравнения двух версий файлов с данными
              о рабочих местах и выявления изменений между ними. Особое внимание
              уделяется изменениям в поле "Признак".
            </p>
          </div>

          <div className="instructions-section">
            <h3>📝 Подготовка данных</h3>
            <p>
              <strong>Требования к файлам:</strong>
            </p>
            <ul>
              <li>
                Формат файлов: <code>.xlsx</code> или <code>.xls</code>
              </li>
              <li>
                Данные должны находиться на <strong>третьем листе</strong>{" "}
                (Sheet3)
              </li>
              <li>Структура файлов должна быть идентичной</li>
              <li>
                Обязательные колонки: Адрес, Этаж, РМ, Тип РМ, Признак, Таб. №,
                ФИО и другие
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>🔄 Пошаговая инструкция</h3>
            <ol>
              <li>
                <strong>Загрузка файлов:</strong>
                Выберите исходную и обновленную версии файла
              </li>
              <li>
                <strong>Запуск сравнения:</strong>
                Нажмите кнопку "Сравнить файлы" для анализа изменений
              </li>
              <li>
                <strong>Анализ результатов:</strong>
                Просмотрите выявленные изменения в таблице:
                <ul>
                  <li>
                    <span className="workplace-status-badge old">БЫЛО</span> -
                    предыдущее значение
                  </li>
                  <li>
                    <span className="workplace-status-badge new">СТАЛО</span> -
                    новое значение
                  </li>
                  <li>
                    <span className="workplace-status-badge added">НОВАЯ</span>{" "}
                    - новая запись
                  </li>
                  <li>
                    <span className="workplace-status-badge deleted">
                      УДАЛЕНА
                    </span>{" "}
                    - удаленная запись
                  </li>
                </ul>
              </li>
              <li>
                <strong>Фильтрация данных:</strong>
                Используйте панель фильтров для поиска нужных изменений
              </li>
              <li>
                <strong>Экспорт результатов:</strong>
                Сохраните отфильтрованные данные в Excel для дальнейшей работы
              </li>
            </ol>
          </div>

          <div className="instructions-section">
            <h3>🔍 Типы выявляемых изменений</h3>
            <ul>
              <li>
                <strong>Новые рабочие места</strong> - записи, которых не было в
                исходном файле
              </li>
              <li>
                <strong>Удаленные рабочие места</strong> - записи, удаленные из
                файла
              </li>
              <li>
                <strong>Измененные данные</strong> - записи с измененными полями
              </li>
              <li>
                <strong>Изменения в поле "Признак"</strong> - особо выделяются в
                интерфейсе
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>🎨 Особенности интерфейса</h3>
            <p>
              <strong>Цветовая кодировка строк:</strong>
            </p>
            <ul>
              <li>
                <span className="color-dot old-dot"></span>{" "}
                <strong>БЫЛО:</strong> Светло-серый фон - предыдущие значения
              </li>
              <li>
                <span className="color-dot new-dot"></span>{" "}
                <strong>СТАЛО:</strong> Светло-зеленый фон - новые значения
              </li>
              <li>
                <span className="color-dot added-dot"></span>{" "}
                <strong>НОВАЯ:</strong> Светло-синий фон - новые записи
              </li>
              <li>
                <span className="color-dot deleted-dot"></span>{" "}
                <strong>УДАЛЕНА:</strong> Светло-оранжевый фон, зачеркивание -
                удаленные записи
              </li>
            </ul>

            <p>
              <strong>Подсветка изменений:</strong>
            </p>
            <ul>
              <li>Измененные ячейки выделяются цветом</li>
              <li>
                При фильтрации по изменениям важные поля выделяются жирным
                шрифтом
              </li>
              <li>Поле "Признак" всегда отображается с историей изменений</li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>⚙️ Фильтры и поиск</h3>
            <p>
              <strong>Доступные фильтры:</strong>
            </p>
            <ul>
              <li>
                <strong>Статус записи</strong> - БЫЛО/СТАЛО/НОВАЯ/УДАЛЕНА
              </li>
              <li>
                <strong>Измененные поля</strong> - фильтрация по конкретным
                измененным колонкам
              </li>
              <li>
                <strong>Локация</strong> - фильтр по адресу, городу, этажу
              </li>
              <li>
                <strong>Занятость РМ</strong> - фильтр по количеству рабочих
                мест
              </li>
              <li>
                <strong>Специальные фильтры</strong> - изменения признака на
                "Резерв" или "Партнер"
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>💡 Советы по использованию</h3>
            <ul>
              <li>
                Используйте фильтр "Измененные поля" для быстрого поиска
                изменений в конкретных атрибутах
              </li>
              <li>
                Фильтр "→ Резерв" помогает найти рабочие места, переведенные в
                резерв
              </li>
              <li>
                Фильтр "→ Партнер" выделяет рабочие места, переданные партнерам
              </li>
              <li>
                Отмечайте важные строки чекбоксами для последующего экспорта
              </li>
              <li>
                Используйте полноэкранный режим для работы с большими объемами
                данных
              </li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>📊 Экспорт результатов</h3>
            <p>
              Функция экспорта сохраняет все отфильтрованные данные в Excel-файл
              с сохранением цветового кодирования и форматирования. В
              экспортированном файле:
            </p>
            <ul>
              <li>Сохранены все видимые колонки</li>
              <li>Применена цветовая подсветка по статусам</li>
              <li>Добавлена информация о типах изменений</li>
              <li>Автоматически настроена ширина колонок</li>
            </ul>
          </div>

          <div className="instructions-section">
            <h3>⚠️ Частые проблемы</h3>
            <ul>
              <li>
                <strong>Файлы не загружаются:</strong>
                Убедитесь, что файлы имеют правильный формат и данные находятся
                на третьем листе
              </li>
              <li>
                <strong>Не отображаются изменения:</strong>
                Проверьте, что структура файлов идентична и используются
                правильные колонки
              </li>
              <li>
                <strong>Ошибки при сравнении:</strong>
                Убедитесь, что в файлах есть данные и они не повреждены
              </li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="workplace-btn workplace-btn-primary"
            onClick={onClose}
          >
            Понятно! Начать работу!
          </button>
        </div>
      </div>
    </div>
  );
};
