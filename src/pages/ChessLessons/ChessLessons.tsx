import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import PageShell from "../../components/PageShell";
import {
  Position,
  Searcher,
  toSan,
  moveToUci,
  mFlags,
  mFrom,
  mTo,
  sqName,
  sqFromName,
  gameResult,
  F_CASTLE,
  F_EP,
} from "../../games/chess/engine";
import { LESSONS, type LessonStep, type MoveCheck } from "../../games/chess/lessons";
import { useLocalState } from "../BoardGames/useLocalState";
import LessonBoard from "./LessonBoard";
import { plural } from "../../utils/plural";
import "../BoardGames/BoardGames.css";
import "./ChessLessons.css";

/** В заданиях «звёзды» и «съешь всё» ходят только белые. */
const forceWhite = (fen: string) => {
  const f = fen.split(" ");
  f[1] = "w";
  f[3] = "-";
  return f.join(" ");
};

const blackPieces = (pos: Position) => {
  let n = 0;
  for (let sq = 0; sq < 128; sq++) if (!(sq & 0x88) && pos.board[sq] && pos.board[sq] >> 3 === 1) n++;
  return n;
};

function describe(pos: Position, m: number): MoveCheck {
  const fl = mFlags(m);
  const piece = pos.board[mFrom(m)] & 7;
  const captured = fl & F_EP ? 1 : pos.board[mTo(m)] & 7;
  const san = toSan(pos, m);
  pos.make(m);
  const check = pos.inCheck();
  const replies = pos.legalMoves().length;
  pos.unmake();
  return {
    san,
    uci: moveToUci(m),
    check,
    mate: check && replies === 0,
    stalemate: !check && replies === 0 && pos.kings[1] >= 0,
    piece,
    captured,
    castle: !!(fl & F_CASTLE),
    enPassant: !!(fl & F_EP),
  };
}

let searcher: Searcher | null = null;
const engine = () => (searcher ??= new Searcher());

type Msg = { kind: "ok" | "err" | "info"; text: string } | null;

/** Один шаг урока: своё состояние доски, сбрасывается при переходе. */
function StepRunner({
  step,
  onDone,
  footer,
}: {
  step: LessonStep;
  onDone: () => void;
  footer: (state: { done: boolean; reset: () => void; hint: (() => void) | null }) => ReactNode;
}) {
  const [fen, setFen] = useState(step.fen);
  const [moves, setMoves] = useState(0);
  const [stars, setStars] = useState(() => new Set(step.kind === "stars" ? step.stars.map(sqFromName) : []));
  const [found, setFound] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(step.kind === "info");
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [last, setLast] = useState<[number, number] | null>(null);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [thinking, setThinking] = useState(false);
  const pos = useMemo(() => new Position(fen), [fen]);

  const legal = useMemo(() => {
    if (done || failed || thinking || step.kind === "info" || step.kind === "squares") return [];
    return pos.side === 0 ? pos.legalMoves() : [];
  }, [pos, done, failed, thinking, step.kind]);

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (done) doneRef.current();
  }, [done]);

  const reset = () => {
    setFen(step.fen);
    setMoves(0);
    setStars(new Set(step.kind === "stars" ? step.stars.map(sqFromName) : []));
    setFound(new Set());
    setDone(step.kind === "info");
    setFailed(false);
    setMsg(null);
    setLast(null);
    setHint(null);
    setThinking(false);
  };

  const hods = (n: number) => `${n} ${plural(n, ["ход", "хода", "ходов"])}`;
  const finishCount = (n: number, par?: number) =>
    par && n > par
      ? `Готово за ${hods(n)}. Можно и за ${par} — попробуйте ещё раз, если хотите.`
      : `Отлично! Готово за ${hods(n)} — это лучший результат.`;

  const onMove = (m: number) => {
    setHint(null);
    const from = mFrom(m);
    const to = mTo(m);
    if (step.kind === "move") {
      const c = describe(pos, m);
      if (step.accept(c)) {
        pos.make(m);
        setFen(pos.fen());
        setLast([from, to]);
        setDone(true);
        setMsg({ kind: "ok", text: step.success ?? `Верно! ${c.san}` });
      } else {
        setMsg({ kind: "err", text: step.why?.(c) ?? `${c.san} — не то. Попробуйте другой ход.` });
      }
      return;
    }
    if (step.kind === "stars" || step.kind === "capture") {
      pos.make(m);
      const next = forceWhite(pos.fen());
      const n = moves + 1;
      setMoves(n);
      setLast([from, to]);
      setFen(next);
      if (step.kind === "stars") {
        const left = new Set(stars);
        left.delete(to);
        setStars(left);
        if (!left.size) {
          setDone(true);
          setMsg({ kind: "ok", text: finishCount(n, step.par) });
        } else setMsg(null);
      } else if (!blackPieces(new Position(next))) {
        setDone(true);
        setMsg({ kind: "ok", text: finishCount(n, step.par) });
      } else setMsg(null);
      return;
    }
    if (step.kind === "play") {
      pos.make(m);
      const after = pos.fen();
      const n = moves + 1;
      setMoves(n);
      setLast([from, to]);
      setFen(after);
      const r = gameResult(new Position(after));
      if (r.over) {
        if (r.reason === "checkmate") {
          setDone(true);
          setMsg({ kind: "ok", text: `Мат за ${hods(n)}! Вы освоили этот приём.` });
        } else {
          setFailed(true);
          setMsg({
            kind: "err",
            text: r.reason === "stalemate" ? "Пат — ничья! У чёрного короля не осталось ходов без шаха. Нажмите «Заново»." : "Ничья. Нажмите «Заново».",
          });
        }
        return;
      }
      if (n >= step.maxMoves) {
        setFailed(true);
        setMsg({ kind: "err", text: `Ходы закончились (${step.maxMoves}). Нажмите «Заново» и попробуйте быстрее прижать короля к краю.` });
        return;
      }
      // Ответ компьютера — после короткой паузы, чтобы ход было видно
      setThinking(true);
      setTimeout(() => {
        const p = new Position(after);
        const res = engine().search(p, { depth: 64, timeMs: 250 });
        if (res.move) {
          p.make(res.move);
          setLast([mFrom(res.move), mTo(res.move)]);
          setFen(p.fen());
          const rr = gameResult(p);
          if (rr.over) {
            setFailed(true);
            setMsg({
              kind: "err",
              text:
                rr.reason === "material"
                  ? "Компьютер забрал вашу фигуру — матовать больше нечем, ничья. Не ставьте фигуру рядом с чужим королём без защиты. Нажмите «Заново»."
                  : "Ничья. Нажмите «Заново».",
            });
          }
        }
        setThinking(false);
      }, 350);
    }
  };

  const onSquare = (sq: number) => {
    if (step.kind !== "squares" || done) return;
    const want = step.squares[found.size];
    if (sqName(sq) === want) {
      const f = new Set(found);
      f.add(sq);
      setFound(f);
      if (f.size === step.squares.length) {
        setDone(true);
        setMsg({ kind: "ok", text: "Все поля найдены!" });
      } else setMsg({ kind: "ok", text: `Верно, это ${want}.` });
    } else setMsg({ kind: "err", text: `Это поле ${sqName(sq)}, а нужно ${want}.` });
  };

  const hintFn =
    step.kind === "move"
      ? () => {
          const f = sqFromName(step.solution.slice(0, 2));
          const t = sqFromName(step.solution.slice(2, 4));
          setHint([f, t]);
          setMsg({ kind: "info", text: "Подсказка: подсвечены поле, откуда ходить, и куда." });
        }
      : step.kind === "squares"
        ? () => {
            const s = sqFromName(step.squares[found.size]);
            setHint([s, s]);
          }
        : step.kind === "play"
          ? () => {
              const res = engine().search(new Position(fen), { depth: 64, timeMs: 400 });
              if (res.move) setHint([mFrom(res.move), mTo(res.move)]);
            }
          : null;

  // Счётчик под заданием
  let progress: string | null = null;
  if (step.kind === "stars") progress = `Звёзд осталось: ${stars.size} · ходов: ${moves}${step.par ? ` (можно за ${step.par})` : ""}`;
  if (step.kind === "capture") progress = `Чёрных фигур осталось: ${blackPieces(pos)} · ходов: ${moves}`;
  if (step.kind === "squares") progress = `Найдено ${found.size} из ${step.squares.length}${!done ? ` · ищем ${step.squares[found.size]}` : ""}`;
  if (step.kind === "play") progress = thinking ? "Компьютер думает…" : `Ходов: ${moves} из ${step.maxMoves}`;

  return (
    <div className="bg-layout">
      <div className="bg-board-col">
        <div className="bg-board-area">
          <LessonBoard
            pos={pos}
            legal={legal}
            onMove={onMove}
            onSquare={step.kind === "squares" ? onSquare : undefined}
            stars={stars}
            marks={new Set((step.marks ?? []).map(sqFromName))}
            found={found}
            last={last}
            hint={hint}
          />
        </div>
      </div>
      <aside className="bg-side cl-side">
        <div className="glass-card bg-card cl-text">
          {step.text.map((t, i) => (t ? <p key={i}>{t}</p> : <div key={i} className="cl-gap" />))}
          {progress && <p className="cl-progress">{progress}</p>}
          {msg && <div className={`cl-msg cl-msg--${msg.kind}`}>{msg.text}</div>}
        </div>
        {footer({ done, reset, hint: done ? null : hintFn })}
      </aside>
    </div>
  );
}

const ChessLessons = () => {
  const [progress, setProgress] = useLocalState<Record<string, boolean>>("convertix.chess.lessons", {});
  const [open, setOpen] = useState<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [stepDone, setStepDone] = useState<Record<string, boolean>>({});

  const doneCount = LESSONS.filter((l) => progress[l.id]).length;

  if (open === null) {
    return (
      <PageShell title="Уроки шахмат 🎓" subtitle="С нуля до первой партии — объяснения и задания на доске">
        <div className="cl-list-head">
          <div className="cl-progress-bar" aria-label={`Пройдено ${doneCount} из ${LESSONS.length}`}>
            <div style={{ width: `${(doneCount / LESSONS.length) * 100}%` }} />
          </div>
          <span>
            Пройдено <b>{doneCount}</b> из {LESSONS.length}
          </span>
          <Link to="/Chess" className="bg-btn bg-btn--primary">
            ♟ Сыграть партию
          </Link>
        </div>
        <div className="cl-grid">
          {LESSONS.map((l, i) => (
            <button
              key={l.id}
              className={`cl-card ${progress[l.id] ? "is-done" : ""}`}
              onClick={() => {
                setOpen(i);
                setStepIdx(0);
              }}
            >
              <span className="cl-card-icon" aria-hidden="true">
                {l.icon}
              </span>
              <span className="cl-card-body">
                <span className="cl-card-n">Урок {i + 1}</span>
                <b>{l.title}</b>
                <small>{l.desc}</small>
              </span>
              {progress[l.id] && <span className="cl-check" title="Пройден">✓</span>}
            </button>
          ))}
        </div>
        <p className="cl-footnote">
          Прогресс сохраняется в браузере. После уроков начните с уровня «Новичок» — компьютер там часто ошибается, и
          можно потренироваться.
        </p>
      </PageShell>
    );
  }

  const lesson = LESSONS[open];
  const step = lesson.steps[stepIdx];
  const key = `${lesson.id}-${stepIdx}`;
  const last = stepIdx === lesson.steps.length - 1;

  const goNext = () => {
    if (!last) {
      setStepIdx(stepIdx + 1);
      return;
    }
    setProgress((p) => ({ ...p, [lesson.id]: true }));
    if (open < LESSONS.length - 1) {
      setOpen(open + 1);
      setStepIdx(0);
    } else setOpen(null);
  };

  return (
    <PageShell title={`${lesson.icon} ${lesson.title}`} subtitle={`Урок ${open + 1} из ${LESSONS.length} · ${lesson.desc}`} fill width="100%">
      <StepRunner
        key={key}
        step={step}
        onDone={() => setStepDone((d) => ({ ...d, [key]: true }))}
        footer={({ done, reset, hint }) => (
          <>
            <div className="glass-card bg-card">
              <div className="cl-steps" aria-label={`Шаг ${stepIdx + 1} из ${lesson.steps.length}`}>
                {lesson.steps.map((_, i) => (
                  <button
                    key={i}
                    className={`cl-dot ${i === stepIdx ? "is-current" : ""} ${stepDone[`${lesson.id}-${i}`] ? "is-done" : ""}`}
                    onClick={() => setStepIdx(i)}
                    aria-label={`Шаг ${i + 1}`}
                  />
                ))}
                <span className="cl-steps-text">
                  Шаг {stepIdx + 1} из {lesson.steps.length}
                </span>
              </div>
              <div className="bg-actions cl-actions">
                <button className="bg-btn" onClick={() => (stepIdx ? setStepIdx(stepIdx - 1) : setOpen(null))}>
                  ← Назад
                </button>
                <button className="bg-btn bg-btn--primary" onClick={goNext} disabled={!done}>
                  {last ? (open < LESSONS.length - 1 ? "Следующий урок →" : "Завершить ✓") : "Далее →"}
                </button>
                {step.kind !== "info" && (
                  <button className="bg-btn" onClick={reset}>
                    ↺ Заново
                  </button>
                )}
                {hint && (
                  <button className="bg-btn" onClick={hint}>
                    💡 Подсказка
                  </button>
                )}
              </div>
              {!done && step.kind !== "info" && (
                <button className="bg-link cl-skip" onClick={goNext}>
                  Пропустить задание
                </button>
              )}
            </div>
            <button className="bg-link cl-back" onClick={() => setOpen(null)}>
              ☰ Все уроки
            </button>
          </>
        )}
      />
    </PageShell>
  );
};

export default ChessLessons;
