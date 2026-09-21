// Мост между страницей и воркером орфографии.
// Воркер создаётся лениво — только когда проверка орфографии включена,
// чтобы страница открывалась мгновенно, а словарь (~3,5 МБ) грузился
// в фоне и не мешал правилам пунктуации работать сразу.

import { useCallback, useEffect, useRef, useState } from "react";
import type { UnknownWord } from "../../workers/spellWorker";

export type SpellStatus = "off" | "loading" | "ready" | "error";

const STORAGE_KEY = "textChecker.personalDictionary";

function loadPersonal(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function savePersonal(words: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch {
    // Приватный режим браузера — словарь просто не сохранится.
  }
}

export function useSpellChecker(enabled: boolean) {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const checkWaiters = useRef(new Map<number, (words: UnknownWord[]) => void>());
  const suggestWaiters = useRef(new Map<number, (list: string[]) => void>());

  const [status, setStatus] = useState<SpellStatus>("off");
  const [personal, setPersonal] = useState<string[]>(loadPersonal);
  const personalRef = useRef(personal);
  personalRef.current = personal;

  useEffect(() => {
    if (!enabled) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setStatus("off");
      return;
    }

    const worker = new Worker(new URL("../../workers/spellWorker.ts", import.meta.url), {
      type: "module",
    });
    const checks = checkWaiters.current;
    const suggests = suggestWaiters.current;
    workerRef.current = worker;
    setStatus("loading");

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === "ready") {
        setStatus("ready");
        return;
      }
      if (data.type === "error") {
        setStatus("error");
        // Не оставляем повисшие обещания.
        checkWaiters.current.forEach((resolve) => resolve([]));
        checkWaiters.current.clear();
        suggestWaiters.current.forEach((resolve) => resolve([]));
        suggestWaiters.current.clear();
        return;
      }
      if (data.type === "result") {
        checkWaiters.current.get(data.id)?.(data.unknown);
        checkWaiters.current.delete(data.id);
        return;
      }
      if (data.type === "suggestions") {
        suggestWaiters.current.get(data.id)?.(data.list);
        suggestWaiters.current.delete(data.id);
      }
    };

    worker.postMessage({ type: "init", personal: personalRef.current });

    return () => {
      worker.terminate();
      workerRef.current = null;
      checks.clear();
      suggests.clear();
    };
  }, [enabled]);

  const check = useCallback((text: string): Promise<UnknownWord[]> => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve([]);
    const id = (requestId.current += 1);
    return new Promise((resolve) => {
      checkWaiters.current.set(id, resolve);
      worker.postMessage({ type: "check", id, text });
    });
  }, []);

  const suggest = useCallback((word: string): Promise<string[]> => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve([]);
    const id = (requestId.current += 1);
    return new Promise((resolve) => {
      suggestWaiters.current.set(id, resolve);
      worker.postMessage({ type: "suggest", id, word });
    });
  }, []);

  const addWord = useCallback((word: string) => {
    const next = Array.from(new Set([...personalRef.current, word]));
    setPersonal(next);
    savePersonal(next);
    workerRef.current?.postMessage({ type: "add", word });
  }, []);

  const removeWord = useCallback((word: string) => {
    const next = personalRef.current.filter((w) => w !== word);
    setPersonal(next);
    savePersonal(next);
    workerRef.current?.postMessage({ type: "remove", word });
  }, []);

  return { status, check, suggest, addWord, removeWord, personal };
}
