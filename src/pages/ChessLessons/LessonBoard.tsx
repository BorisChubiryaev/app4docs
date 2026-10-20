import { useEffect, useRef, useState } from "react";
import { Position, mFrom, mTo, mPromo, sqName, QUEEN } from "../../games/chess/engine";
import { PieceSvg } from "../../games/chess/pieces";

interface Props {
  pos: Position;
  /** Разрешённые ходы; пусто — фигуры не двигаются. */
  legal: number[];
  onMove?: (m: number) => void;
  /** Режим «найди поле»: клик по любому полю. */
  onSquare?: (sq: number) => void;
  stars?: Set<number>;
  marks?: Set<number>;
  found?: Set<number>;
  last?: [number, number] | null;
  hint?: [number, number] | null;
}

const Star = () => (
  <svg viewBox="0 0 24 24" className="cl-star" aria-hidden="true">
    <path
      d="M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z"
      fill="#f5b301"
      stroke="#9a6a00"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

/** Учебная доска: клик или перетаскивание, превращение — сразу в ферзя. */
export default function LessonBoard({ pos, legal, onMove, onSquare, stars, marks, found, last, hint }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; size: number; was: boolean } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const movable = new Set(legal.map(mFrom));
  const targets = new Set(selected !== null ? legal.filter((m) => mFrom(m) === selected).map(mTo) : []);

  const play = (from: number, to: number) => {
    const options = legal.filter((m) => mFrom(m) === from && mTo(m) === to);
    if (!options.length) return false;
    const m = options.find((x) => !mPromo(x) || mPromo(x) === QUEEN) ?? options[0];
    setSelected(null);
    onMove?.(m);
    return true;
  };

  const click = (sq: number) => {
    if (onSquare) return onSquare(sq);
    if (movable.has(sq)) return;
    if (selected !== null && play(selected, sq)) return;
    setSelected(null);
  };

  const down = (e: React.PointerEvent, sq: number) => {
    if (onSquare || !movable.has(sq) || e.button !== 0) return;
    const size = boardRef.current ? boardRef.current.clientWidth / 8 : 60;
    setDrag({ from: sq, x: e.clientX, y: e.clientY, size, was: selected === sq });
    setSelected(sq);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-sq]") as HTMLElement | null;
      const to = el ? Number(el.dataset.sq) : -1;
      if (to >= 0 && to !== drag.from) play(drag.from, to);
      else if (to === drag.from && drag.was) setSelected(null);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.from]);

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = 7 - row;
      const sq = rank * 16 + col;
      const p = pos.board[sq];
      const cls = [
        "bg-sq",
        (rank + col) % 2 === 0 ? "dark" : "light",
        last && (last[0] === sq || last[1] === sq) ? "last" : "",
        selected === sq ? "selected" : "",
        hint && (hint[0] === sq || hint[1] === sq) ? "hint" : "",
        marks?.has(sq) ? "mark" : "",
        found?.has(sq) ? "found" : "",
        movable.has(sq) ? "movable" : "",
        onSquare ? "pickable" : "",
      ].join(" ");
      squares.push(
        <div key={sq} data-sq={sq} className={cls} onClick={() => click(sq)} onPointerDown={(e) => down(e, sq)} aria-label={sqName(sq)} role="gridcell">
          {col === 0 && <span className="bg-coord bg-coord-rank">{rank + 1}</span>}
          {row === 7 && <span className="bg-coord bg-coord-file">{"abcdefgh"[col]}</span>}
          {stars?.has(sq) && <Star />}
          {p !== 0 && !(drag && drag.from === sq) && <PieceSvg type={p & 7} color={p >> 3} />}
          {targets.has(sq) && <span className={p ? "bg-target-ring" : "bg-target-dot"} />}
        </div>,
      );
    }
  }

  return (
    <>
      <div className="bg-board chess" ref={boardRef} role="grid" aria-label="Учебная доска">
        {squares}
      </div>
      {drag && (
        <div className="bg-drag-piece" style={{ left: drag.x - drag.size / 2, top: drag.y - drag.size / 2, width: drag.size, height: drag.size }}>
          <PieceSvg type={pos.board[drag.from] & 7} color={pos.board[drag.from] >> 3} />
        </div>
      )}
    </>
  );
}
