// Доменная модель genOferta.
//
// Инструкции из документов «Изменения» разбираются (ИИ или оффлайн-парсером)
// в СТРУКТУРНЫЕ операции. Юридический текст Оферты меняет только
// детерминированный движок — модель лишь указывает координаты правки.

/** Куда направлена правка внутри Оферты. */
export type OpTarget =
  /** Сноска № N (нумерация — по порядку ссылок в тексте). */
  | { kind: "footnote"; number: number; label?: string }
  /** Термин из раздела «Термины» (напр. п. 2.44 «Устройство»). */
  | { kind: "term"; section?: string; point?: string; term: string }
  /** Обычный пункт основного текста (напр. п. 7.6). */
  | { kind: "point"; section?: string; point: string; heading?: string }
  /** Пункт внутри Приложения (напр. Приложение №2 п. 1.2). */
  | { kind: "appendix_point"; appendix: string; point: string }
  /** Таблица внутри Приложения (напр. таблица п. 3 Приложения №2, либо вся таблица Приложения №1). */
  | { kind: "appendix_table"; appendix: string; point?: string };

/** Тип операции над Офертой. */
export type OpType =
  | "insert_after"
  | "replace"
  | "replace_footnote"
  | "append_table_rows"
  | "replace_table_rows"
  | "delete"
  | "manual"; // распознано, но требует ручной обработки (напр. перенумерация)

/** Одна распознанная правка. */
export interface Operation {
  /** Стабильный идентификатор в рамках сессии. */
  id: string;
  /** Из какого документа «Изменения» пришла правка (имя файла). */
  sourceDoc: string;
  /** Тип операции. */
  type: OpType;
  /** Цель правки в Оферте. */
  target: OpTarget;
  /** Якорная фраза «после слов …» (для insert_after). */
  anchor?: string;
  /** Вставляемый / заменяющий текст (уже без внешних кавычек-ёлочек). */
  payload?: string;
  /** Строки таблицы (для append/replace_table_rows): массив строк, каждая — массив ячеек. */
  rows?: string[][];
  /** Диапазон номеров добавляемых строк, если указан в инструкции. */
  rowRange?: { from: number; to: number };
  /** Номера заменяемых строк таблицы (для replace_table_rows). */
  rowNumbers?: number[];
  /** Пояснение для операций типа manual / неуверенного распознавания. */
  note?: string;
  /** Нужна ли последующая перенумерация сносок. */
  renumberFootnotes?: boolean;
  /** Исходный текст инструкции — показывается оператору и попадает в объединённый файл. */
  rawText: string;
  /** Уверенность парсера 0..1 (для сортировки внимания оператора). */
  confidence: number;
  /** Предупреждения парсера (напр. «якорь не найден дословно»). */
  warnings?: string[];
}

/** Результат применения одной операции. */
export interface ApplyResult {
  operationId: string;
  ok: boolean;
  message: string;
  /** Позиция цели в теле Оферты — ключ сортировки «по порядку следования пунктов». */
  orderKey: number;
}

/** Итог полной сборки. */
export interface BuildResult {
  /** docx актуального текста Оферты с выделенными изменениями. */
  offerDocx: Uint8Array;
  /** docx объединённого файла с описанием изменений (в порядке Оферты). */
  combinedDocx: Uint8Array;
  /** Пооперационный отчёт. */
  results: ApplyResult[];
  /** Порядок операций после сортировки. */
  orderedOperationIds: string[];
}

/** Режим выделения изменений в итоговой Оферте. */
export type HighlightMode = "color" | "tracked" | "both";

export interface BuildOptions {
  /** Как показывать изменения. По умолчанию — цветом (как в образце). */
  highlightMode?: HighlightMode;
  /** Цвет шрифта для выделения (hex без #). По умолчанию — как в образце. */
  highlightColor?: string;
  /** Автор правок для режима рецензирования. */
  author?: string;
}
