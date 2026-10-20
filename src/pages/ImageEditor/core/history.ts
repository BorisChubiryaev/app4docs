// История отмены: список прошлых состояний документа.
// Состояния разделяют неизменённые canvas, поэтому память тратится только
// на действительно изменённые слои. Старые шаги отбрасываются, когда
// суммарный объём уникальных canvas превышает бюджет.

import type { DocState } from "./types";

export interface HistoryEntry {
  label: string;
  state: DocState;
}

export interface History {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
}

const MAX_STEPS = 60;
/** ~700 МБ пикселей на всю историю — дальше браузер начинает задыхаться. */
const BUDGET_BYTES = 700 * 1024 * 1024;

function canvasesOf(s: DocState, into: Set<HTMLCanvasElement>) {
  for (const l of s.layers) {
    into.add(l.canvas);
    if (l.mask) into.add(l.mask);
  }
  if (s.selection) into.add(s.selection);
}

function bytesOf(entries: HistoryEntry[]): number {
  const set = new Set<HTMLCanvasElement>();
  for (const e of entries) canvasesOf(e.state, set);
  let total = 0;
  for (const c of set) total += c.width * c.height * 4;
  return total;
}

export function initHistory(state: DocState, label = "Открытие"): History {
  return { past: [], present: { label, state }, future: [] };
}

export function push(h: History, state: DocState, label: string): History {
  const past = [...h.past, h.present];
  while (past.length > MAX_STEPS) past.shift();
  // Бюджет памяти: выкидываем самые старые шаги
  while (past.length > 1 && bytesOf([...past, { label, state }]) > BUDGET_BYTES) past.shift();
  return { past, present: { label, state }, future: [] };
}

/** Заменить текущее состояние без новой записи (например, выбор активного слоя). */
export function replace(h: History, state: DocState): History {
  return { ...h, present: { ...h.present, state } };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  const past = [...h.past];
  const prev = past.pop()!;
  return { past, present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}

/** Перейти к шагу истории по индексу (0 — самый старый). */
export function jump(h: History, index: number): History {
  const all = [...h.past, h.present, ...h.future];
  if (index < 0 || index >= all.length) return h;
  return { past: all.slice(0, index), present: all[index], future: all.slice(index + 1) };
}
