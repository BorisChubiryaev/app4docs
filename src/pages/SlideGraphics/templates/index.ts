import type { Group, Scene, Template } from "../core/types";
import { CONVERTIX } from "../core/render";
import { CHARTS } from "./charts";
import { MOTION } from "./motion";
import { SBER, SBER_GREENS, SBER_TEMPLATES } from "./sber";
import { SCENES } from "./scenes";
import { MODULES } from "./modules";

export const TEMPLATES: Template[] = [...MODULES, ...CHARTS, ...SBER_TEMPLATES, ...MOTION, ...SCENES];

export const GROUPS: [Group | "all", string][] = [
  ["all", "Все"],
  ["modules", "Модули для презентаций"],
  ["charts", "Графики"],
  ["sber", "Стиль СБ"],
  ["text", "Текст"],
  ["backgrounds", "Фоны"],
  ["cards", "Карточки и фото"],
];

// Свои наборы. Для графиков с несколькими категориями лучше «Проверенная»:
// в «Фирменной» фиолетовый и индиго почти не различаются — она для одного
// ряда и градиентов.
export const PALETTES: [string, string[]][] = [
  ["Фирменная", CONVERTIX],
  ["Неон", ["#5b5bf7", "#ff4fa3", "#2bd9a6", "#ffb547"]],
  // Стиль СБ: для нескольких категорий (проверена на светлом и тёмном фоне)
  // и зелёные — для одного ряда и градиентов
  ["Сбер", SBER],
  ["Сбер — зелёные", SBER_GREENS],
  ["Зелёная", ["#21a038", "#0ea5a4", "#a3e635", "#14532d"]],
  ["Океан", ["#0077b6", "#00b4d8", "#90e0ef", "#023e8a"]],
  ["Тёплая", ["#ff6b35", "#ff2e63", "#ffd166", "#8338ec"]],
  ["Пастель", ["#7c9cff", "#ff9ecd", "#7ee0b5", "#ffd47a"]],
  ["Графит", ["#2b2f3a", "#6b7280", "#a3a8b5", "#4f6ef7"]],
];

export const byId = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export function newScene(tpl: Template): Scene {
  return {
    templateId: tpl.id,
    params: { ...tpl.defaults.params },
    rows: (tpl.defaults.rows ?? []).map((r) => ({ ...r })),
    phrases: [...(tpl.defaults.phrases ?? [])],
    palette: [...(tpl.defaults.palette ?? PALETTES[0][1])],
    background: tpl.defaults.background ?? { kind: "transparent", color: "#ffffff" },
    ink: "auto",
    // Свои цвета у шаблона — значит, они часть его вида; иначе проверенная палитра
    paletteAuto: !tpl.defaults.palette,
  };
}
