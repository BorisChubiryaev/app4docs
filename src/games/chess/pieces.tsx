// Шахматные фигуры (собственный рисунок, SVG 45×45). Цвет задаётся
// заливкой/обводкой, детали — контрастной линией.

import type { ReactNode } from "react";

const BASE = <rect x="10.5" y="35" width="24" height="4.2" rx="1.6" />;

const SHAPES: Record<number, (detail: string) => ReactNode> = {
  // пешка
  1: () => (
    <>
      <rect x="12" y="35" width="21" height="4.2" rx="1.6" />
      <path d="M15.5 35C15.5 29.5 18.5 26.5 20.3 24.6h4.4c1.8 1.9 4.8 4.9 4.8 10.4Z" />
      <rect x="17.3" y="21.6" width="10.4" height="3.2" rx="1.6" />
      <circle cx="22.5" cy="15.8" r="5.6" />
    </>
  ),
  // конь
  2: (d) => (
    <>
      {BASE}
      <path d="M14 35c0-4 1.2-6.6 3-8.8 2.2-2.6 4.6-4.4 5-7.2-1 .9-2.6 1.5-4.1 1.2l-2.3 2.1c-.8.8-1.9 1.2-3 .9l-1.6-.5c-1.6-.6-2-2.6-1-4.1l4.6-7.1c1-1.9 2.6-3.4 4.6-3.9l2-2.6 1.1 3c3.6 1.4 6.2 5 7.7 9.6 1.9 5.4 2.6 11.4 2.6 17.4Z" />
      <path d="M24.5 11.5c3.4 3 5.4 8.2 5.8 15" fill="none" stroke={d} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="17.6" cy="14.6" r="1.2" fill={d} stroke="none" />
    </>
  ),
  // слон
  3: (d) => (
    <>
      {BASE}
      <path d="M15 35c.5-4 3-5.6 4-7.2h7c1 1.6 3.5 3.2 4 7.2Z" />
      <rect x="17" y="25.4" width="11" height="2.8" rx="1.4" />
      <path d="M22.5 8.2c-5.6 4.5-7.2 9.6-5.1 13.6 1 2.2 2.6 3.6 2.6 3.6h5s1.6-1.4 2.6-3.6c2.1-4 .5-9.1-5.1-13.6Z" />
      <circle cx="22.5" cy="6.4" r="2.1" />
      <path d="M25 13.2l-4.2 5.6" fill="none" stroke={d} strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // ладья
  4: (d) => (
    <>
      {BASE}
      <rect x="13" y="31" width="19" height="4" rx="1" />
      <path d="M15.2 31l1-13.8h12.6l1 13.8Z" />
      <path d="M13 17.4V10.2h4v3h3.5v-3h4v3H28v-3h4v7.2Z" />
      <path d="M16.3 17.4h12.4M15.6 27h13.8" fill="none" stroke={d} strokeWidth="1.1" />
    </>
  ),
  // ферзь
  5: (d) => (
    <>
      {BASE}
      <path d="M13 35l-2.4-19.4 5.6 9.4.7-12.6 3.7 11.6 1.9-13 1.9 13 3.7-11.6.7 12.6 5.6-9.4L32 35Z" />
      <circle cx="10.5" cy="14" r="2" />
      <circle cx="16.8" cy="11" r="2" />
      <circle cx="22.5" cy="9.4" r="2" />
      <circle cx="28.2" cy="11" r="2" />
      <circle cx="34.5" cy="14" r="2" />
      <path d="M13.2 30.5h18.6" fill="none" stroke={d} strokeWidth="1.1" />
    </>
  ),
  // король
  6: (d) => (
    <>
      {BASE}
      <path d="M12.6 35c-1.6-8-3.6-13 0-15.5 3.5-2.5 7.5 0 9.9 3.5 2.4-3.5 6.4-6 9.9-3.5 3.6 2.5 1.6 7.5 0 15.5Z" />
      <path d="M22.5 23c-1.6-2.8-2.4-5 0-7.6 2.4 2.6 1.6 4.8 0 7.6Z" />
      <path d="M21.4 15.5V6h2.2v9.5ZM19 10.9V8.7h7v2.2Z" />
      <path d="M13.3 30.5h18.4" fill="none" stroke={d} strokeWidth="1.1" />
    </>
  ),
};

/** Фигура: type 1..6 (пешка…король), color 0 — белые, 1 — чёрные. */
export function PieceSvg({ type, color }: { type: number; color: number }) {
  const white = color === 0;
  const fill = white ? "#fbfbf8" : "#2e2f36";
  const stroke = white ? "#26262b" : "#0d0d10";
  const detail = white ? "#26262b" : "#d9d9de";
  return (
    <svg viewBox="0 0 45 45" className="bg-piece" aria-hidden="true">
      <g fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round">
        {SHAPES[type](detail)}
      </g>
    </svg>
  );
}
