# Русский словарь Hunspell (вендоринг)

Файлы `ru.aff` и `ru.dic` — русский словарь Hunspell (ru_RU), который
использует корректор текста (`src/pages/TextChecker`). Проверка орфографии
читает их через `?url`-импорт в веб-воркере `src/workers/spellWorker.ts`.

## Почему файлы лежат в репозитории, а не ставятся из npm

Пакет `dictionary-ru` недоступен в корпоративном реестре npm, поэтому словарь
хранится прямо в проекте. Дополнительный плюс: сборка не зависит от внешнего
реестра, а Vite сам кладёт словарь в `dist/assets` с хешем в имени.

## Происхождение и лицензия

- Источник: пакет [`dictionary-ru`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/ru)
  версии 3.0.0 (файлы `index.aff` и `index.dic` без изменений).
- Первоисточник: словарь ru_RU проекта LibreOffice, Alexander I. Lebedev.
- Лицензия: BSD-3-Clause, полный текст — в файле `LICENSE` рядом.
  Она разрешает распространение файлов при сохранении текста лицензии.

## Как обновить словарь

На машине с доступом к npm:

```bash
npm pack dictionary-ru@3            # скачает архив пакета
tar -xzf dictionary-ru-3.*.tgz
cp package/index.aff src/assets/dictionary-ru/ru.aff
cp package/index.dic src/assets/dictionary-ru/ru.dic
cp package/license   src/assets/dictionary-ru/LICENSE
```

Формат файлов — обычный Hunspell, поэтому подойдёт и словарь из LibreOffice
(`ru_RU.aff` / `ru_RU.dic`), если понадобится другая редакция.
