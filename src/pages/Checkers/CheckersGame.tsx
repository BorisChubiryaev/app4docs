import { useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import {
  Board,
  checkersResult,
  moveText,
  sqName,
  colorOf,
  isKing,
  W_MAN,
  W_KING,
  B_MAN,
  B_KING,
  type CheckersResult,
  type Move,
} from "../../games/checkers/engine";
import { CHECKERS_LEVELS } from "../../games/checkers/levels";
import { CheckersSearcher } from "../../games/checkers/engine";
import { runCheckersRequest, type CheckersRequest, type CheckersResponse } from "../../games/checkers/search";
import { EngineRunner } from "../../games/engineRunner";
import { useLocalState, EMPTY_SCORE, type Score } from "../BoardGames/useLocalState";
import "../BoardGames/BoardGames.css";

interface Saved {
  moves: string[];
  player: 0 | 1;
  level: number;
  resigned: boolean;
}
const NEW_GAME: Saved = { moves: [], player: 0, level: 3, resigned: false };
const isSaved = (v: unknown) =>
  !!v && Array.isArray((v as Saved).moves) && ((v as Saved).player === 0 || (v as Saved).player === 1);

const MIN_THINK_MS = 450;

function replay(moves: string[]) {
  const b = Board.initial();
  const done: string[] = [];
  for (const t of moves) {
    const m = b.moves().find((x) => moveText(x) === t);
    if (!m) break;
    b.make(m);
    done.push(t);
  }
  return { board: b, done };
}

/** Шашка (SVG): дамка — с короной. */
function CheckerPiece({ piece }: { piece: number }) {
  const white = colorOf(piece) === 0;
  const fill = white ? "#f6efe1" : "#2b2b31";
  const edge = white ? "#b9a888" : "#0e0e12";
  const ring = white ? "#d8c9aa" : "#4a4a53";
  return (
    <svg viewBox="0 0 100 100" className="bg-piece" aria-hidden="true">
      <circle cx="50" cy="54" r="40" fill={edge} />
      <circle cx="50" cy="48" r="40" fill={fill} stroke={edge} strokeWidth="3" />
      <circle cx="50" cy="48" r="28" fill="none" stroke={ring} strokeWidth="4" />
      <circle cx="50" cy="48" r="16" fill="none" stroke={ring} strokeWidth="3" />
      {isKing(piece) && (
        <path
          d="M30 58 L26 36 L39 46 L50 30 L61 46 L74 36 L70 58 Z"
          fill="#e8b21f"
          stroke={white ? "#8a6508" : "#f5d36a"}
          strokeWidth="3"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function resultText(r: CheckersResult, player: number, resigned: boolean) {
  if (resigned) return { title: "Вы сдались", sub: "Победа за компьютером", outcome: "loss" as const };
  if (!r.over) return null;
  if (r.winner === null)
    return r.reason === "kings15"
      ? { title: "Ничья", sub: "15 ходов только дамками без взятий", outcome: "draw" as const }
      : { title: "Ничья", sub: "Позиция повторилась три раза", outcome: "draw" as const };
  const sub = r.reason === "nopieces" ? "Все шашки соперника сбиты" : "У соперника не осталось ходов";
  return r.winner === player
    ? { title: "Вы победили! 🎉", sub, outcome: "win" as const }
    : { title: "Победил компьютер", sub: r.reason === "nopieces" ? "Все ваши шашки сбиты" : "У вас не осталось ходов", outcome: "loss" as const };
}

const CheckersGame = () => {
  const [game, setGame] = useLocalState<Saved>("convertix.checkers.v1", NEW_GAME, isSaved);
  const [scores, setScores] = useLocalState<Record<number, Score>>("convertix.checkers.scores", {});
  const [nextColor, setNextColor] = useState<0 | 1 | "random">(game.player);
  const [flipped, setFlipped] = useState(game.player === 1);
  /** Выбранный путь: шашка и уже пройденные поля многоходового взятия. */
  const [partial, setPartial] = useState<number[]>([]);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintPending, setHintPending] = useState(false);
  const [showOver, setShowOver] = useState(true);

  const workerRef = useRef<EngineRunner<CheckersRequest, CheckersResponse> | null>(null);
  const reqId = useRef(0);
  const hintId = useRef(-1);
  const hintSeq = useRef(1_000_000);
  const startedAt = useRef(0);

  const { moves, player, level, resigned } = game;
  const { board } = useMemo(() => replay(moves), [moves]);
  const legal = useMemo(() => board.moves(), [board]);
  const result = useMemo(() => checkersResult(board, legal), [board, legal]);
  const over = result.over || resigned;
  const myTurn = !over && board.side === player;
  const outcome = resultText(result, player, resigned);
  const levelInfo = CHECKERS_LEVELS.find((l) => l.id === level) ?? CHECKERS_LEVELS[2];
  const mustCapture = legal.length > 0 && legal[0].captured.length > 0;

  useEffect(() => {
    let local: CheckersSearcher | null = null;
    const w = new EngineRunner<CheckersRequest, CheckersResponse>(
      () => new Worker(new URL("../../games/checkers/checkersWorker.ts", import.meta.url), { type: "module" }),
      (req) => runCheckersRequest((local ??= new CheckersSearcher()), req),
    );
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    w.onmessage = (r) => {
      if (r.id >= 1_000_000) {
        if (r.id === hintId.current) {
          hintId.current = -1;
          setHintPending(false);
          setHint(r.move);
        }
        return;
      }
      if (r.id !== reqId.current) return;
      if (!r.move) return setThinking(false);
      const wait = Math.max(0, MIN_THINK_MS - (performance.now() - startedAt.current));
      setTimeout(() => {
        if (r.id !== reqId.current) return;
        setThinking(false);
        setGame((g) => ({ ...g, moves: [...g.moves, r.move!] }));
      }, wait);
    };
  }, [setGame]);

  useEffect(() => {
    if (over || board.side === player || !workerRef.current) return;
    const id = ++reqId.current;
    startedAt.current = performance.now();
    setThinking(true);
    workerRef.current.post({ id, moves, opts: levelInfo.opts } satisfies CheckersRequest);
  }, [moves, player, over, board, levelInfo]);

  const recorded = useRef(`${game.moves.join(" ")}|${game.resigned}`);
  useEffect(() => {
    if (!outcome) return;
    const key = `${moves.join(" ")}|${resigned}`;
    if (recorded.current === key) return;
    recorded.current = key;
    setShowOver(true);
    setScores((s) => {
      const cur = s[level] ?? EMPTY_SCORE;
      return { ...s, [level]: { ...cur, [outcome.outcome]: cur[outcome.outcome] + 1 } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome?.outcome, moves, resigned]);

  // ── Ходы игрока ──
  const candidates: Move[] = partial.length
    ? legal.filter((m) => partial.every((sq, i) => m.path[i] === sq))
    : [];
  const nextSquares = new Set(
    candidates.filter((m) => m.path.length > partial.length).map((m) => m.path[partial.length]),
  );
  const movablePieces = new Set(myTurn ? legal.map((m) => m.path[0]) : []);
  const pendingCaptured = new Set<number>();
  // Шашки, которые уже «сбиты» выбранным отрезком пути (показываем полупрозрачными)
  if (partial.length > 1 && candidates.length) {
    const m = candidates[0];
    m.captured.slice(0, partial.length - 1).forEach((c) => pendingCaptured.add(c));
  }

  const commit = (m: Move) => {
    setGame((g) => ({ ...g, moves: [...g.moves, moveText(m)] }));
    setPartial([]);
    setHint(null);
    hintId.current = -1;
    setHintPending(false);
  };

  const onSquare = (sq: number) => {
    if (!myTurn) return;
    if (partial.length && nextSquares.has(sq)) {
      const np = [...partial, sq];
      const rest = legal.filter((m) => np.every((s, i) => m.path[i] === s));
      const finished = rest.find((m) => m.path.length === np.length);
      // Ход закончен, если дальше идти некуда (или все варианты заканчиваются здесь)
      if (finished && rest.every((m) => m.path.length === np.length)) commit(finished);
      else setPartial(np);
      return;
    }
    if (movablePieces.has(sq) && partial.length <= 1) {
      setPartial(partial[0] === sq ? [] : [sq]);
      return;
    }
    if (partial.length <= 1) setPartial([]);
  };

  // ── Кнопки ──
  const newGame = () => {
    const color = nextColor === "random" ? (Math.random() < 0.5 ? 0 : 1) : nextColor;
    reqId.current++;
    hintId.current = -1;
    setHintPending(false);
    setThinking(false);
    setPartial([]);
    setHint(null);
    setFlipped(color === 1);
    setGame({ moves: [], player: color, level, resigned: false });
  };

  const undo = () => {
    reqId.current++;
    hintId.current = -1;
    setHintPending(false);
    setThinking(false);
    setHint(null);
    setPartial([]);
    setGame((g) => {
      let k = g.moves.length;
      if (k && (k - 1) % 2 !== g.player) k--;
      if (k && (k - 1) % 2 === g.player) k--;
      return { ...g, moves: g.moves.slice(0, k), resigned: false };
    });
  };

  const askHint = () => {
    if (!myTurn || !workerRef.current) return;
    const id = ++hintSeq.current;
    hintId.current = id;
    setHintPending(true);
    workerRef.current.post({ id, moves, opts: { depth: 64, timeMs: 900 } } satisfies CheckersRequest);
  };

  const canUndo = moves.some((_, i) => i % 2 === player);

  // ── Отрисовка ──
  const last = moves.length ? moves[moves.length - 1] : null;
  const lastSquares = new Set(last ? last.split(/[-:]/) : []);
  const hintSquares = new Set(hint ? hint.split(/[-:]/) : []);

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flipped ? row : 7 - row;
      const f = flipped ? 7 - col : col;
      const sq = r * 8 + f;
      const name = sqName(sq);
      const dark = (r + f) % 2 === 0;
      const p = board.sq[sq];
      const cls = [
        "bg-sq",
        dark ? "dark" : "light",
        lastSquares.has(name) ? "last" : "",
        partial.includes(sq) ? "selected" : "",
        hintSquares.has(name) ? "hint" : "",
        myTurn && mustCapture && !partial.length && movablePieces.has(sq) ? "must" : "",
        myTurn && movablePieces.has(sq) ? "movable" : "",
      ].join(" ");
      const showPiece = p !== 0 && !(partial.length > 1 && sq === partial[0]);
      squares.push(
        <div key={sq} className={cls} onClick={() => onSquare(sq)} role="gridcell" aria-label={name} data-sq={sq}>
          {col === 0 && <span className="bg-coord bg-coord-rank">{r + 1}</span>}
          {row === 7 && <span className="bg-coord bg-coord-file">{"abcdefgh"[f]}</span>}
          {showPiece && (
            <span className={`bg-piece-wrap ${pendingCaptured.has(sq) ? "is-taken" : ""}`}>
              <CheckerPiece piece={p} />
            </span>
          )}
          {partial.length > 1 && sq === partial[partial.length - 1] && (
            <span className="bg-piece-wrap is-ghost">
              <CheckerPiece piece={board.sq[partial[0]]} />
            </span>
          )}
          {nextSquares.has(sq) && <span className="bg-target-dot" />}
        </div>,
      );
    }
  }

  const c = board.count();
  const mine = player === 0 ? [c[W_MAN], c[W_KING]] : [c[B_MAN], c[B_KING]];
  const theirs = player === 0 ? [c[B_MAN], c[B_KING]] : [c[W_MAN], c[W_KING]];

  const status = over
    ? outcome?.title
    : thinking
      ? "Компьютер думает…"
      : myTurn
        ? mustCapture
          ? "Ваш ход — бить обязательно"
          : "Ваш ход"
        : "Ход компьютера";

  const score = scores[level] ?? EMPTY_SCORE;
  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]]);

  return (
    <PageShell title="Шашки ⛀" subtitle="Русские шашки против компьютера — шесть уровней сложности" fill width="100%">
      <div className="bg-layout">
        <div className="bg-board-col">
          <div className="bg-board-area">
            <div className={`bg-board checkers ${myTurn ? "my-turn" : ""}`} role="grid" aria-label="Шашечная доска">
              {squares}
              {over && showOver && outcome && (
                <div className="bg-over">
                  <div className="bg-over-card">
                    <div className="bg-over-icon">{outcome.outcome === "win" ? "🏆" : outcome.outcome === "draw" ? "🤝" : "⛂"}</div>
                    <h2>{outcome.title}</h2>
                    <p>{outcome.sub}</p>
                    <div className="bg-over-actions">
                      <button className="bg-btn bg-btn--primary" onClick={newGame}>
                        Новая партия
                      </button>
                      <button className="bg-btn" onClick={() => setShowOver(false)}>
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
          <div className={`glass-card bg-card bg-status ${over ? "is-over" : thinking ? "is-thinking" : ""}`}>
            <span className={`bg-turn-dot ${board.side === 0 ? "white" : "black"}`} aria-hidden="true" />
            <b>{status}</b>
            {thinking && <span className="bg-spinner" aria-hidden="true" />}
          </div>

          <div className="bg-actions">
            <button className="bg-btn" onClick={undo} disabled={!canUndo} title="Вернуть свой последний ход">
              ↶ Отменить
            </button>
            <button className="bg-btn" onClick={askHint} disabled={!myTurn || hintPending} title="Компьютер подсветит хороший ход">
              💡 Подсказка
            </button>
            <button className="bg-btn" onClick={() => setFlipped((f) => !f)} title="Перевернуть доску">
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
            <div className="bg-material bg-count">
              <span>
                Ваши: <b>{mine[0]}</b> {mine[1] > 0 && <>+ <b>{mine[1]}</b> 👑</>}
              </span>
              <span>
                Компьютер: <b>{theirs[0]}</b> {theirs[1] > 0 && <>+ <b>{theirs[1]}</b> 👑</>}
              </span>
            </div>
            <h3>Ходы</h3>
            {pairs.length ? (
              <ol className="bg-moves">
                {pairs.map(([w, b], i) => (
                  <li key={i}>
                    <span className="bg-move-n">{i + 1}.</span>
                    <span className={i * 2 === moves.length - 1 ? "is-last" : ""}>{w}</span>
                    <span className={i * 2 + 1 === moves.length - 1 ? "is-last" : ""}>{b ?? ""}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="bg-muted">
                {player === 0 ? "Вы играете белыми — ваш ход." : "Вы играете чёрными — первым ходит компьютер."} Нажмите на
                шашку, затем на поле. При взятии нескольких шашек отмечайте поля по очереди.
              </p>
            )}
          </div>

          <div className="glass-card bg-card">
            <h3>Сложность</h3>
            <div className="bg-levels" role="radiogroup" aria-label="Уровень">
              {CHECKERS_LEVELS.map((l) => (
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
              {levelInfo.hint}. Счёт: <b>{score.win}</b> побед · <b>{score.draw}</b> ничьих · <b>{score.loss}</b> поражений
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
                <button key={String(v)} role="radio" aria-checked={nextColor === v} className={nextColor === v ? "is-active" : ""} onClick={() => setNextColor(v)}>
                  {v !== "random" && <span className={`bg-turn-dot ${v === 0 ? "white" : "black"}`} aria-hidden="true" />}
                  {l}
                </button>
              ))}
            </div>
            <button className="bg-btn bg-btn--primary bg-btn--wide" onClick={newGame}>
              Начать заново
            </button>
          </div>

          <div className="glass-card bg-card">
            <h3>Правила</h3>
            <p className="bg-muted bg-rules">
              Простые шашки ходят вперёд, а бьют и вперёд, и назад. Бить обязательно, взятие продолжается до конца.
              Дошедшая до последнего ряда шашка становится дамкой — она ходит и бьёт на любое расстояние. Ничья — 15
              ходов только дамками без взятий или троекратное повторение.
            </p>
          </div>
        </aside>
      </div>
    </PageShell>
  );
};

export default CheckersGame;
