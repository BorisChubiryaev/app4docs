# excel-dashboard

Навык для кодинг-агента (GigaCode Desktop, Claude Code и совместимых): собирает
интерактивный HTML-дашборд по Excel/CSV файлу — KPI, графики, фильтры,
кросс-фильтрация, таблица деталей. Результат — **один самодостаточный файл**,
который открывается с диска без интернета и без сервера.

## Установка

Скопировать папку `excel-dashboard` в каталог навыков агента, например:

```
~/.gigacode/skills/excel-dashboard/
```

Зависимостей нет: нужен только Python 3.9+ из стандартной поставки.

## Проверка

```bash
python3 scripts/test_dashboard.py    # 34 теста: чтение файлов, валидация, сборка
```

Быстрый прогон «руками» на приложенных данных:

```bash
cd skills/excel-dashboard
python3 scripts/tabledata.py profile evals/fixtures/sales_2025.xlsx --out /tmp/sales.json
python3 scripts/build_dashboard.py build evals/example-config.json \
  --data /tmp/sales.json --out /tmp/Дашборд.html
```

## Состав

| Файл | Назначение |
|---|---|
| `SKILL.md` | Инструкция агенту: порядок работы и типичные ошибки |
| `references/config-schema.md` | Полная схема `config.json` |
| `references/chart-choice.md` | Какой график к каким данным и как компоновать |
| `scripts/tabledata.py` | Чтение xlsx/csv, профиль колонок, вычисляемые колонки |
| `scripts/build_dashboard.py` | Проверка конфига и сборка HTML |
| `assets/dashboard.js` | Рантайм: агрегация, фильтры, SVG-графики |
| `assets/dashboard.css` | Оформление, светлая и тёмная темы |
| `evals/fixtures/` | Демоданные: xlsx с датами и csv в cp1251 |

## Границы

- Читаются `.xlsx`, `.xlsm`, `.csv`, `.tsv`. Форматы `.xls` (старый бинарный) и
  `.ods` не поддерживаются — их нужно пересохранить.
- Данные целиком попадают внутрь HTML: ориентир — до ~100 тыс. строк.
- Внешний вид меняется только через `assets/`, состав дашборда — только через
  `config.json`. Готовый HTML править бессмысленно: пересборка его затрёт.
