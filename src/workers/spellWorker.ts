// Веб-воркер проверки орфографии.
// Словарь Hunspell (ru_RU, ~3,5 МБ) лежит в репозитории — src/assets/dictionary-ru,
// см. README рядом с ним. Грузится один раз и живёт в воркере, чтобы разбор
// словаря и поиск подсказок не блокировали интерфейс.
// Ничего не отправляется наружу: словарь — статический файл сборки.

import nspell from "nspell";
import affUrl from "../assets/dictionary-ru/ru.aff?url";
import dicUrl from "../assets/dictionary-ru/ru.dic?url";
import { tokenize } from "../pages/TextChecker/engine/tokenize";

type Spell = ReturnType<typeof nspell>;

export interface UnknownWord {
  word: string;
  start: number;
  end: number;
}

type Incoming =
  | { type: "init"; personal?: string[] }
  | { type: "check"; id: number; text: string }
  | { type: "suggest"; id: number; word: string }
  | { type: "add"; word: string }
  | { type: "remove"; word: string };

type Outgoing =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "result"; id: number; unknown: UnknownWord[] }
  | { type: "suggestions"; id: number; word: string; list: string[] };

let speller: Spell | null = null;
let loading: Promise<void> | null = null;
const verdictCache = new Map<string, boolean>();
const personalWords = new Set<string>();

const post = (message: Outgoing) => self.postMessage(message);

async function load(): Promise<void> {
  if (speller) return;
  if (!loading) {
    loading = (async () => {
      // nspell принимает строку или Buffer. В браузере Buffer нет, а
      // Uint8Array он молча превратит в «208,159,…», поэтому декодируем
      // сами: в index.aff объявлена кодировка UTF-8.
      const decoder = new TextDecoder("utf-8");
      const [aff, dic] = await Promise.all([
        fetch(affUrl).then((r) => r.arrayBuffer()),
        fetch(dicUrl).then((r) => r.arrayBuffer()),
      ]);
      speller = nspell(decoder.decode(aff), decoder.decode(dic));
      for (const word of personalWords) speller.add(word);
    })();
  }
  await loading;
}

/** Слово не проверяем: аббревиатуры, латиница, цифры, короткие служебные. */
function skipWord(word: string): boolean {
  if (word.length < 2) return true;
  if (/\d/.test(word)) return true;
  if (!/^[А-Яа-яЁё][А-Яа-яЁё'’-]*$/.test(word)) return true;
  // Аббревиатуры (ИНН, ЕГРЮЛ) словарём не покрываются.
  if (word === word.toUpperCase() && word.length <= 6) return true;
  return false;
}

function isKnown(word: string): boolean {
  if (!speller) return true;
  const cached = verdictCache.get(word);
  if (cached !== undefined) return cached;

  let known = speller.correct(word);

  if (!known) {
    const lower = word.toLowerCase();
    // Слово с заглавной буквы в начале предложения — проверяем как строчное.
    if (lower !== word && speller.correct(lower)) known = true;
  }

  if (!known && word.includes("-")) {
    // Сложные слова («интернет-магазин»): достаточно, чтобы части были верны.
    const parts = word.split("-").filter(Boolean);
    known =
      parts.length > 1 &&
      parts.every((part) => speller!.correct(part) || speller!.correct(part.toLowerCase()));
  }

  verdictCache.set(word, known);
  return known;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const data = event.data;

  try {
    if (data.type === "init") {
      for (const word of data.personal ?? []) personalWords.add(word);
      await load();
      post({ type: "ready" });
      return;
    }

    if (data.type === "add") {
      personalWords.add(data.word);
      verdictCache.delete(data.word);
      speller?.add(data.word);
      return;
    }

    if (data.type === "remove") {
      personalWords.delete(data.word);
      verdictCache.delete(data.word);
      speller?.remove(data.word);
      return;
    }

    await load();

    if (data.type === "check") {
      const unknown: UnknownWord[] = [];
      for (const token of tokenize(data.text)) {
        if (token.kind !== "word") continue;
        if (skipWord(token.text)) continue;
        if (personalWords.has(token.text) || personalWords.has(token.lower)) continue;
        if (isKnown(token.text)) continue;
        unknown.push({ word: token.text, start: token.start, end: token.end });
      }
      post({ type: "result", id: data.id, unknown });
      return;
    }

    if (data.type === "suggest") {
      const list = speller ? speller.suggest(data.word).slice(0, 6) : [];
      post({ type: "suggestions", id: data.id, word: data.word, list });
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Не удалось загрузить словарь",
    });
  }
};
