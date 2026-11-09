import type { Group, Scene, Template } from "../core/types";
import { CHARTS } from "./charts";
import { MOTION } from "./motion";
import { SCENES } from "./scenes";

export const TEMPLATES: Template[] = [...CHARTS, ...MOTION, ...SCENES];

export const GROUPS: [Group | "all", string][] = [
  ["all", "Все"],
  ["charts", "Графики"],
  ["text", "Текст"],
  ["backgrounds", "Фоны"],
  ["cards", "Карточки и фото"],
];

// Свои наборы. Для графиков с несколькими категориями лучше «Проверенная»:
// в «Фирменной» фиолетовый и индиго почти не различаются — она для одного
// ряда и градиентов.
export const PALETTES: [string, string[]][] = [
  ["Фирменная", ["#0087cd", "#8253aa", "#ff1c77", "#515dad"]],
  ["Неон", ["#5b5bf7", "#ff4fa3", "#2bd9a6", "#ffb547"]],
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
