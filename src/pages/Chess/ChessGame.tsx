import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import {
  Position,
  gameResult,
  moveFromUci,
  moveToUci,
  mFrom,
  mTo,
  mPromo,
  toSan,
  sqName,
  KING,
  type GameResult,
} from "../../games/chess/engine";
import { CHESS_LEVELS } from "../../games/chess/levels";
import { PieceSvg } from "../../games/chess/pieces";
import type {
  ChessRequest,
  ChessResponse,
} from "../../games/chess/chessWorker";
import {
  useLocalState,
  EMPTY_SCORE,
  type Score,
} from "../BoardGames/useLocalState";
import "../BoardGames/BoardGames.css";

interface Saved {
  moves: string[];
  player: 0 | 1;
  level: number;
  resigned: boolean;
}
const NEW_GAME: Saved = { moves: [], player: 0, level: 3, resigned: false };
const isSaved = (v: unknown) =>
  !!v &&
  Array.isArray((v as Saved).moves) &&
  ((v as Saved).player === 0 || (v as Saved).player === 1);

const PROMO_TYPES = [5, 4, 3, 2]; // ферзь, ладья, слон, конь
const START_COUNT = [0, 8, 2, 2, 2, 1, 0];
const PIECE_VALUE = [0, 1, 3, 3, 5, 9, 0];

/** Минимальная «пауза на раздумье», чтобы ответ не появлялся мгновенно. */
const MIN_THINK_MS = 450;

function replay(moves: string[]) {
  const pos = new Position();
  const sans: string[] = [];
  for (const u of moves) {
    const m = moveFromUci(pos, u);
    if (m === null) break;
    sans.push(toSan(pos, m));
    pos.make(m);
  }
  return { pos, sans };
}

function resultText(r: GameResult, player: number, resigned: boolean) {
  if (resigned)
    return {
      title: "Вы сдались",
      sub: "Победа за компьютером",
      outcome: "loss" as const,
    };
  if (!r.over) return null;
  switch (r.reason) {
    case "checkmate":
      return r.winner === player
        ? {
            title: "Мат! Вы победили 🎉",
            sub: "Отличная партия",
            outcome: "win" as const,
          }
        : { title: "Мат", sub: "Победил компьютер", outcome: "loss" as const };
    case "stalemate":
      return {
        title: "Пат — ничья",
        sub: "У стороны, чей ход, нет ходов, но и шаха нет",
        outcome: "draw" as const,
      };
    case "fifty":
      return {
        title: "Ничья",
        sub: "50 ходов без взятий и ходов пешками",
        outcome: "draw" as const,
      };
    case "repetition":
      return {
        title: "Ничья",
        sub: "Позиция повторилась три раза",
        outcome: "draw" as const,
      };
    case "material":
      return {
        title: "Ничья",
        sub: "Ни у кого не хватает фигур, чтобы поставить мат",
        outcome: "draw" as const,
      };
  }
}

const ChessGame = () => {
  const [game, setGame] = useLocalState<Saved>(
    "convertix.chess.v1",
    NEW_GAME,
    isSaved,
  );
  const [scores, setScores] = useLocalState<Record<number, Score>>(
    "convertix.chess.scores",
    {},
  );
  const [nextColor, setNextColor] = useState<0 | 1 | "random">(game.player);
  const [flipped, setFlipped] = useState(game.player === 1);
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [evalScore, setEvalScore] = useState<number | null>(null);
  const [showOver, setShowOver] = useState(true);
  const [drag, setDrag] = useState<{
    from: number;
    x: number;
    y: number;
    size: number;
    wasSelected: boolean;
  } | null>(null);
  const [hintPending, setHintPending] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const hintId = useRef(-1);
  const hintSeq = useRef(1_000_000);
  const boardRef = useRef<HTMLDivElement>(null);

  const { moves, player, level, resigned } = game;
  const { pos, sans } = useMemo(() => replay(moves), [moves]);
  const legal = useMemo(() => pos.legalMoves(), [pos]);
  const result = useMemo(() => gameResult(pos), [pos]);
  const over = result.over || resigned;
  const myTurn = !over && pos.side === player;
  const outcome = resultText(result, player, resigned);
  const levelInfo = CHESS_LEVELS.find((l) => l.id === level) ?? CHESS_LEVELS[2];

  // ── Компьютер ──
  useEffect(() => {
    const w = new Worker(
      new URL("../../games/chess/chessWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const startedAt = useRef(0);
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    w.onmessage = (e: MessageEvent<ChessResponse>) => {
      const r = e.data;
      if (r.id >= 1_000_000) {
        if (r.id === hintId.current) {
          hintId.current = -1;
          setHintPending(false);
          setHint(r.move);
        }
        return;
      }
      if (r.id !== reqId.current || !r.move) return;
      const wait = Math.max(
        0,
        MIN_THINK_MS - (performance.now() - startedAt.current),
      );
      setTimeout(() => {
        if (r.id !== reqId.current) return;
        setThinking(false);
        if (levelInfo.id >= 4) setEvalScore(r.score);
        setGame((g) => ({ ...g, moves: [...g.moves, r.move!] }));
      }, wait);
    };
  }, [setGame, levelInfo.id]);

  useEffect(() => {
    if (over || pos.side === player || !workerRef.current) return;
    const id = ++reqId.current;
    startedAt.current = performance.now();
    setThinking(true);
    const req: ChessRequest = { id, moves, opts: levelInfo.opts };
    workerRef.current.postMessage(req);
  }, [moves, player, over, pos, levelInfo]);

  // Запоминаем итог партии один раз
  const recorded = useRef<string>(`${game.moves.join(" ")}|${game.resigned}`);
  useEffect(() => {
    if (!outcome) return;
    const key = `${moves.join(" ")}|${resigned}`;
    if (recorded.current === key) return;
    recorded.current = key;
    setShowOver(true);
    setScores((s) => {
      const cur = s[level] ?? EMPTY_SCORE;
      return {
        ...s,
        [level]: { ...cur, [outcome.outcome]: cur[outcome.outcome] + 1 },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome?.outcome, moves, resigned]);

  // ── Ходы игрока ──
  const playMove = useCallback(
    (from: number, to: number, promoType = 0) => {
      const m = legal.find(
        (x) => mFrom(x) === from && mTo(x) === to && mPromo(x) === promoType,
      );
      if (m === undefined) return false;
      setGame((g) => ({ ...g, moves: [...g.moves, moveToUci(m)] }));
      setSelected(null);
      setHint(null);
      hintId.current = -1;
      setHintPending(false);
      return true;
    },
    [legal, setGame],
  );

  const tryMove = (from: number, to: number) => {
    const options = legal.filter((x) => mFrom(x) === from && mTo(x) === to);
    if (!options.length) return false;
    if (options.some((x) => mPromo(x))) {
      setPromo({ from, to });
      setSelected(null);
      return true;
    }
    return playMove(from, to);
  };

  const ownPiece = (sq: number) => {
    const p = pos.board[sq];
    return !!p && p >> 3 === player;
  };

  // Свои фигуры выбираются через pointer-события (там же перетаскивание),
  // клик обрабатывает только ход на клетку-цель или сброс выбора.
  const onSquareClick = (sq: number) => {
    if (!myTurn || promo || ownPiece(sq)) return;
    if (selected !== null && tryMove(selected, sq)) return;
    setSelected(null);
  };

  // Перетаскивание фигуры
  const onPointerDown = (e: React.PointerEvent, sq: number) => {
    if (!myTurn || promo || !ownPiece(sq) || e.button !== 0) return;
    const size = boardRef.current ? boardRef.current.clientWidth / 8 : 60;
    setDrag({
      from: sq,
      x: e.clientX,
      y: e.clientY,
      size,
      wasSelected: selected === sq,
    });
    setSelected(sq);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-sq]") as HTMLElement | null;
      const to = el ? Number(el.dataset.sq) : -1;
      if (to >= 0 && to !== drag.from) tryMove(drag.from, to);
      else if (to === drag.from && drag.wasSelected) setSelected(null);
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

  // ── Кнопки ──
  const newGame = () => {
    const color =
      nextColor === "random" ? (Math.random() < 0.5 ? 0 : 1) : nextColor;
    reqId.current++;
    hintId.current = -1;
    setHintPending(false);
    setThinking(false);
    setSelected(null);
    setPromo(null);
    setHint(null);
    setEvalScore(null);
    setFlipped(color === 1);
    setGame({ moves: [], player: color, level, resigned: false });
  };

  const undo = () => {
    reqId.current++;
    hintId.current = -1;
    setHintPending(false);
    setThinking(false);
    setHint(null);
    setSelected(null);
    setPromo(null);
    setGame((g) => {
      let k = g.moves.length;
      if (k && (k - 1) % 2 !== g.player) k--; // ответ компьютера
      if (k && (k - 1) % 2 === g.player) k--; // свой ход
      return { ...g, moves: g.moves.slice(0, k), resigned: false };
    });
  };

  const askHint = () => {
    if (!myTurn || !workerRef.current) return;
    const id = ++hintSeq.current;
    hintId.current = id;
    setHintPending(true);
    workerRef.current.postMessage({
      id,
      moves,
      opts: { depth: 64, timeMs: 900 },
    } satisfies ChessRequest);
  };

  const canUndo = moves.some((_, i) => i % 2 === player);

  // ── Отрисовка ──
  const lastFrom = moves.length ? moves[moves.length - 1].slice(0, 2) : null;
  const lastTo = moves.length ? moves[moves.length - 1].slice(2, 4) : null;
  const targets = new Set(
    selected !== null
      ? legal.filter((m) => mFrom(m) === selected).map(mTo)
      : [],
  );
  const checkSq = result.check ? pos.kings[pos.side] : -1;
  const hintFrom = hint?.slice(0, 2);
  const hintTo = hint?.slice(2, 4);

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      const sq = rank * 16 + file;
      const name = sqName(sq);
      const p = pos.board[sq];
      const dark = (rank + file) % 2 === 0;
      const cls = [
        "bg-sq",
        dark ? "dark" : "light",
        name === lastFrom || name === lastTo ? "last" : "",
        selected === sq ? "selected" : "",
        sq === checkSq ? "check" : "",
        name === hintFrom || name === hintTo ? "hint" : "",
        myTurn && ownPiece(sq) ? "movable" : "",
      ].join(" ");
      squares.push(
        <div
          key={sq}
          data-sq={sq}
          className={cls}
          onClick={() => onSquareClick(sq)}
          onPointerDown={(e) => onPointerDown(e, sq)}
          role="gridcell"
          aria-label={name}
        >
          {col === 0 && (
            <span className="bg-coord bg-coord-rank">{rank + 1}</span>
          )}
          {row === 7 && (
            <span className="bg-coord bg-coord-file">{"abcdefgh"[file]}</span>
          )}
          {p !== 0 && !(drag && drag.from === sq) && (
            <PieceSvg type={p & 7} color={p >> 3} />
          )}
          {targets.has(sq) && (
            <span className={p ? "bg-target-ring" : "bg-target-dot"} />
          )}
        </div>,
      );
    }
  }

  // Взятые фигуры и перевес
  const counts = [new Array(7).fill(0), new Array(7).fill(0)];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (p && (p & 7) !== KING) counts[p >> 3][p & 7]++;
  }
  const material = (c: number) =>
    counts[c].reduce((s, n, t) => s + n * PIECE_VALUE[t], 0);
  const lost = (c: number) => {
    const out: number[] = [];
    for (let t = 5; t >= 1; t--) {
      // превращённые пешки дают «лишние» фигуры — не уходим в минус
      const n = Math.max(0, START_COUNT[t] - counts[c][t]);
      for (let i = 0; i < n; i++) out.push(t);
    }
    return out;
  };
  const diff = material(player) - material(player ^ 1);

  const status = over
    ? outcome?.title
    : thinking
      ? "Компьютер думает…"
      : myTurn
        ? result.check
          ? "Вам шах! Ваш ход"
          : "Ваш ход"
        : "Ход компьютера";

  const score = scores[level] ?? EMPTY_SCORE;
  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < sans.length; i += 2) pairs.push([sans[i], sans[i + 1]]);

  const capturedRow = (color: number, label: string, adv: number) =>
    !lost(color).length ? null : (
      <div className="bg-captured" aria-label={label} title={label}>
        {lost(color).map((t, i) => (
          <span key={i} className="bg-captured-piece">
            <PieceSvg type={t} color={color} />
          </span>
        ))}
        {adv > 0 && <span className="bg-adv">+{adv}</span>}
      </div>
    );

  return (
    <PageShell
      title="Шахматы ♟"
      subtitle="Партия с компьютером — шесть уровней сложности"
      fill
      width="100%"
    >
      <div className="bg-layout">
        <div className="bg-board-col">
          <div className="bg-board-area">
            <div
              className={`bg-board chess ${myTurn ? "my-turn" : ""}`}
              ref={boardRef}
              role="grid"
              aria-label="Шахматная доска"
            >
              {squares}
              {promo && (
                <div
                  className="bg-promo"
                  role="dialog"
                  aria-label="Превращение пешки"
                >
                  <div className="bg-promo-card">
                    <p>Во что превратить пешку?</p>
                    <div className="bg-promo-row">
                      {PROMO_TYPES.map((t) => (
                        <button
                          key={t}
                          className="bg-promo-btn"
                          onClick={() => {
                            playMove(promo.from, promo.to, t);
                            setPromo(null);
                          }}
                          aria-label={
                            ["", "", "Конь", "Слон", "Ладья", "Ферзь"][t]
                          }
                        >
                          <PieceSvg type={t} color={player} />
                        </button>
                      ))}
                    </div>
                    <button className="bg-link" onClick={() => setPromo(null)}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {over && showOver && outcome && (
                <div className="bg-over">
                  <div className="bg-over-card">
                    <div className="bg-over-icon">
                      {outcome.outcome === "win"
                        ? "🏆"
                        : outcome.outcome === "draw"
                          ? "🤝"
                          : "♚"}
                    </div>
                    <h2>{outcome.title}</h2>
                    <p>{outcome.sub}</p>
                    <div className="bg-over-actions">
                      <button
                        className="bg-btn bg-btn--primary"
                        onClick={newGame}
                      >
                        Новая партия
                      </button>
                      <button
                        className="bg-btn"
                        onClick={() => setShowOver(false)}
                      >
                        Посмотреть доску
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="bg-side">
          <div
            className={`glass-card bg-card bg-status ${over ? "is-over" : thinking ? "is-thinking" : ""}`}
          >
            <span
              className={`bg-turn-dot ${pos.side === 0 ? "white" : "black"}`}
              aria-hidden="true"
            />
            <b>{status}</b>
            {thinking && <span className="bg-spinner" aria-hidden="true" />}
            {evalScore !== null && !over && (
              <span
                className="bg-eval"
                title="Оценка позиции компьютером (в пешках, + — перевес белых)"
              >
                {evalScore > 0 ? "+" : ""}
                {Math.abs(evalScore) > 20000
                  ? "мат"
                  : (evalScore / 100).toFixed(1)}
              </span>
            )}
          </div>

          <div className="bg-actions">
            <button
              className="bg-btn"
              onClick={undo}
              disabled={!canUndo || !moves.length}
              title="Вернуть свой последний ход"
            >
              ↶ Отменить
            </button>
            <button
              className="bg-btn"
              onClick={askHint}
              disabled={!myTurn || hintPending}
              title="Компьютер подсветит хороший ход"
            >
              💡 Подсказка
            </button>
            <button
              className="bg-btn"
              onClick={() => setFlipped((f) => !f)}
              title="Перевернуть доску"
            >
              ⇅ Доска
            </button>
            <button
              className="bg-btn"
              onClick={() => setGame((g) => ({ ...g, resigned: true }))}
              disabled={over || moves.length < 2}
              title="Признать поражение"
            >
              🏳 Сдаться
            </button>
          </div>

          <div className="glass-card bg-card bg-moves-card">
            <div className="bg-material">
              {capturedRow(player ^ 1, "Взято у компьютера", diff)}
              {capturedRow(player, "Взято у вас", -diff)}
            </div>
            <h3>Ходы</h3>
            {pairs.length ? (
              <ol className="bg-moves">
                {pairs.map(([w, b], i) => (
                  <li key={i}>
                    <span className="bg-move-n">{i + 1}.</span>
                    <span
                      className={i * 2 === sans.length - 1 ? "is-last" : ""}
                    >
                      {w}
                    </span>
                    <span
                      className={i * 2 + 1 === sans.length - 1 ? "is-last" : ""}
                    >
                      {b ?? ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="bg-muted">
                {player === 0
                  ? "Вы играете белыми — ваш ход."
                  : "Вы играете чёрными — первым ходит компьютер."}{" "}
                Фигуры можно перетаскивать или ходить кликами.
              </p>
            )}
          </div>
          <div className="glass-card bg-card">
            <h3>Сложность</h3>
            <div className="bg-levels" role="radiogroup" aria-label="Уровень">
              {CHESS_LEVELS.map((l) => (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={level === l.id}
                  className={level === l.id ? "is-active" : ""}
                  onClick={() => setGame((g) => ({ ...g, level: l.id }))}
                  title={l.hint}
                >
                  <span className="bg-level-n">{l.id}</span>
                  {l.name}
                </button>
              ))}
            </div>
            <p className="bg-muted">
              {levelInfo.hint}. Счёт: <b>{score.win}</b> побед ·{" "}
              <b>{score.draw}</b> ничьих · <b>{score.loss}</b> поражений
            </p>
            <h3 className="bg-card-sub">Новая партия</h3>
            <div className="bg-seg" role="radiogroup" aria-label="Цвет">
              {(
                [
                  [0, "Белыми"],
                  [1, "Чёрными"],
                  ["random", "Случайно"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={String(v)}
                  role="radio"
                  aria-checked={nextColor === v}
                  className={nextColor === v ? "is-active" : ""}
                  onClick={() => setNextColor(v)}
                >
                  {v !== "random" && (
                    <span
                      className={`bg-turn-dot ${v === 0 ? "white" : "black"}`}
                      aria-hidden="true"
                    />
                  )}
                  {l}
                </button>
              ))}
            </div>
            <button
              className="bg-btn bg-btn--primary bg-btn--wide"
              onClick={newGame}
            >
              Начать заново
            </button>
          </div>
        </aside>
      </div>

      {drag && (
        <div
          className="bg-drag-piece"
          style={{
            left: drag.x - drag.size / 2,
            top: drag.y - drag.size / 2,
            width: drag.size,
            height: drag.size,
          }}
        >
          <PieceSvg
            type={pos.board[drag.from] & 7}
            color={pos.board[drag.from] >> 3}
          />
        </div>
      )}
    </PageShell>
  );
};

export default ChessGame;
