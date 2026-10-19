// Русские шашки: правила и поиск хода.
//
// Доска 8×8, клетка = ряд * 8 + вертикаль, a1 = 0 (тёмная), белые внизу и
// ходят первыми. Фигуры: 1 — белая простая, 2 — белая дамка, 3 — чёрная
// простая, 4 — чёрная дамка.
//
// Правила: бить обязательно (назад тоже), выбор между вариантами взятия
// свободный, взятие продолжается до конца, сбитые шашки снимаются после хода
// и через них нельзя прыгать второй раз (турецкий удар). Дамка ходит и бьёт
// на любое расстояние; если после взятия она может бить дальше — обязана
// встать на такое поле. Простая, дошедшая до последнего ряда во время
// взятия, становится дамкой и продолжает бить уже как дамка.

export const WHITE = 0;
export const BLACK = 1;
export const W_MAN = 1;
export const W_KING = 2;
export const B_MAN = 3;
export const B_KING = 4;

export const colorOf = (p: number) => (p <= 2 ? WHITE : BLACK);
export const isKing = (p: number) => p === W_KING || p === B_KING;

export interface Move {
  /** Путь фигуры: старт, (промежуточные поля), финиш. */
  path: number[];
  /** Сбитые шашки. */
  captured: number[];
  /** Простая стала дамкой. */
  promotes: boolean;
}

export const sqName = (sq: number) => "abcdefgh"[sq & 7] + ((sq >> 3) + 1);
export const moveText = (m: Move) => m.path.map(sqName).join(m.captured.length ? ":" : "-");

// Лучи по диагоналям для каждой клетки: [вверх-вправо, вверх-влево, вниз-вправо, вниз-влево]
const RAYS: number[][][] = [];
for (let sq = 0; sq < 64; sq++) {
  const r = sq >> 3;
  const c = sq & 7;
  RAYS.push(
    [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([dr, dc]) => {
      const ray: number[] = [];
      for (let k = 1; ; k++) {
        const rr = r + dr * k;
        const cc = c + dc * k;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) break;
        ray.push(rr * 8 + cc);
      }
      return ray;
    }),
  );
}

// Zobrist
let seed = 0x2545f491;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
};
const Z = new Int32Array(5 * 64).map(rnd);
const Z_SIDE = rnd();

export class Board {
  sq = new Int8Array(64);
  side = WHITE;
  hash = 0;
  /** Сколько полуходов подряд делались только дамками без взятий (правило 15 ходов). */
  kingQuiet = 0;
  private hist: number[] = [];
  private undo: { m: Move; piece: number; capturedPieces: number[]; kingQuiet: number }[] = [];

  static initial(): Board {
    const b = new Board();
    for (let sq = 0; sq < 64; sq++) {
      const r = sq >> 3;
      if (((sq >> 3) + (sq & 7)) % 2 !== 0) continue; // светлые поля
      if (r <= 2) b.sq[sq] = W_MAN;
      else if (r >= 5) b.sq[sq] = B_MAN;
    }
    b.rehash();
    return b;
  }

  clone(): Board {
    const b = new Board();
    b.sq.set(this.sq);
    b.side = this.side;
    b.hash = this.hash;
    b.kingQuiet = this.kingQuiet;
    b.hist = [...this.hist];
    return b;
  }

  rehash() {
    let h = 0;
    for (let i = 0; i < 64; i++) if (this.sq[i]) h ^= Z[this.sq[i] * 64 + i];
    if (this.side) h ^= Z_SIDE;
    this.hash = h;
  }

  /** Все легальные ходы стороны, которая ходит. */
  moves(): Move[] {
    const caps: Move[] = [];
    const us = this.side;
    for (let s = 0; s < 64; s++) {
      const p = this.sq[s];
      if (!p || colorOf(p) !== us) continue;
      this.sq[s] = 0; // фигура «в полёте» не мешает сама себе
      if (isKing(p)) this.kingCaptures(s, s, p, [s], [], caps);
      else this.manCaptures(s, s, p, [s], [], caps);
      this.sq[s] = p;
    }
    if (caps.length) return caps;

    const quiet: Move[] = [];
    for (let s = 0; s < 64; s++) {
      const p = this.sq[s];
      if (!p || colorOf(p) !== us) continue;
      if (isKing(p)) {
        for (const ray of RAYS[s]) {
          for (const t of ray) {
            if (this.sq[t]) break;
            quiet.push({ path: [s, t], captured: [], promotes: false });
          }
        }
      } else {
        const fwd = us === WHITE ? [0, 1] : [2, 3];
        for (const d of fwd) {
          const t = RAYS[s][d][0];
          if (t !== undefined && !this.sq[t]) {
            const lastRow = us === WHITE ? 7 : 0;
            quiet.push({ path: [s, t], captured: [], promotes: t >> 3 === lastRow });
          }
        }
      }
    }
    return quiet;
  }

  private enemy(sq: number) {
    const p = this.sq[sq];
    return p !== 0 && colorOf(p) !== this.side;
  }

  private manCaptures(start: number, s: number, p: number, path: number[], taken: number[], out: Move[]) {
    let found = false;
    const lastRow = this.side === WHITE ? 7 : 0;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[s][d];
      if (ray.length < 2) continue;
      const mid = ray[0];
      const land = ray[1];
      if (!this.enemy(mid) || taken.includes(mid) || this.sq[land]) continue;
      found = true;
      const nTaken = [...taken, mid];
      const nPath = [...path, land];
      if (land >> 3 === lastRow) {
        // Стала дамкой — дальше бьёт по правилам дамки
        const king = this.side === WHITE ? W_KING : B_KING;
        const before = out.length;
        this.kingCaptures(start, land, king, nPath, nTaken, out);
        for (let i = before; i < out.length; i++) out[i].promotes = true;
      } else this.manCaptures(start, land, p, nPath, nTaken, out);
    }
    if (!found && taken.length) out.push({ path, captured: taken, promotes: false });
  }

  /** Может ли дамка с клетки s бить дальше (с учётом уже сбитых). */
  private kingCanCapture(s: number, taken: number[]) {
    for (const ray of RAYS[s]) {
      for (let i = 0; i < ray.length; i++) {
        const t = ray[i];
        if (!this.sq[t]) continue;
        if (this.enemy(t) && !taken.includes(t) && i + 1 < ray.length && !this.sq[ray[i + 1]]) return true;
        break;
      }
    }
    return false;
  }

  private kingCaptures(start: number, s: number, p: number, path: number[], taken: number[], out: Move[]) {
    let found = false;
    for (const ray of RAYS[s]) {
      let i = 0;
      while (i < ray.length && !this.sq[ray[i]]) i++;
      if (i >= ray.length) continue;
      const victim = ray[i];
      // Своя шашка или уже сбитая — дальше по лучу нельзя
      if (!this.enemy(victim) || taken.includes(victim)) continue;
      const lands: number[] = [];
      for (let j = i + 1; j < ray.length && !this.sq[ray[j]]; j++) lands.push(ray[j]);
      if (!lands.length) continue;
      found = true;
      const nTaken = [...taken, victim];
      // Если с какого-то поля можно бить дальше — встаём только туда
      const cont = lands.filter((l) => this.kingCanCapture(l, nTaken));
      if (cont.length) for (const l of cont) this.kingCaptures(start, l, p, [...path, l], nTaken, out);
      else for (const l of lands) out.push({ path: [...path, l], captured: nTaken, promotes: false });
    }
    if (!found && taken.length) out.push({ path, captured: taken, promotes: false });
  }

  make(m: Move) {
    const from = m.path[0];
    const to = m.path[m.path.length - 1];
    const piece = this.sq[from];
    const capturedPieces = m.captured.map((c) => this.sq[c]);
    this.undo.push({ m, piece, capturedPieces, kingQuiet: this.kingQuiet });
    this.hist.push(this.hash);

    this.hash ^= Z[piece * 64 + from];
    this.sq[from] = 0;
    for (const c of m.captured) {
      this.hash ^= Z[this.sq[c] * 64 + c];
      this.sq[c] = 0;
    }
    const np = m.promotes ? (colorOf(piece) === WHITE ? W_KING : B_KING) : piece;
    this.sq[to] = np;
    this.hash ^= Z[np * 64 + to];
    this.kingQuiet = isKing(piece) && !m.captured.length ? this.kingQuiet + 1 : 0;
    this.side ^= 1;
    this.hash ^= Z_SIDE;
  }

  unmake() {
    const u = this.undo.pop()!;
    const from = u.m.path[0];
    const to = u.m.path[u.m.path.length - 1];
    this.sq[to] = 0;
    this.sq[from] = u.piece;
    u.m.captured.forEach((c, i) => (this.sq[c] = u.capturedPieces[i]));
    this.kingQuiet = u.kingQuiet;
    this.side ^= 1;
    this.hash = this.hist.pop()!;
  }

  repetitions(): number {
    let n = 1;
    for (let i = this.hist.length - 2; i >= 0; i -= 2) if (this.hist[i] === this.hash) n++;
    return n;
  }

  count() {
    const c = [0, 0, 0, 0, 0];
    for (let i = 0; i < 64; i++) c[this.sq[i]]++;
    return c;
  }
}

export type CheckersResult =
  | { over: false }
  | { over: true; winner: number | null; reason: "nomoves" | "nopieces" | "kings15" | "repetition" };

/** Ничья: 15 ходов (30 полуходов) только дамками без взятий или троекратное повторение. */
export function checkersResult(b: Board, legal = b.moves()): CheckersResult {
  if (!legal.length) {
    const c = b.count();
    const mine = b.side === WHITE ? c[W_MAN] + c[W_KING] : c[B_MAN] + c[B_KING];
    return { over: true, winner: b.side ^ 1, reason: mine ? "nomoves" : "nopieces" };
  }
  if (b.kingQuiet >= 30) return { over: true, winner: null, reason: "kings15" };
  if (b.repetitions() >= 3) return { over: true, winner: null, reason: "repetition" };
  return { over: false };
}

// ── Оценка ──

const ADV = [0, 3, 6, 10, 15, 22, 30, 0];
/** Главная дорога (a1–h8) и двойники — сильные диагонали для дамки. */
const MAIN_DIAG = new Set([0, 9, 18, 27, 36, 45, 54, 63]);

export function evaluate(b: Board): number {
  let score = 0;
  const c = b.count();
  const total = c[1] + c[2] + c[3] + c[4];
  for (let s = 0; s < 64; s++) {
    const p = b.sq[s];
    if (!p) continue;
    const r = s >> 3;
    const f = s & 7;
    const center = f >= 2 && f <= 5 && r >= 2 && r <= 5 ? 6 : 0;
    switch (p) {
      case W_MAN:
        score += 100 + ADV[r] + center + (r === 0 && total > 14 && (f === 2 || f === 4) ? 8 : 0) - (f === 0 || f === 7 ? 4 : 0);
        break;
      case B_MAN:
        score -= 100 + ADV[7 - r] + center + (r === 7 && total > 14 && (f === 3 || f === 5) ? 8 : 0) - (f === 0 || f === 7 ? 4 : 0);
        break;
      case W_KING:
        score += 320 + (MAIN_DIAG.has(s) ? 20 : 0);
        break;
      case B_KING:
        score -= 320 + (MAIN_DIAG.has(s) ? 20 : 0);
        break;
    }
  }
  // Перевес ценнее, когда шашек мало — стимул меняться, если впереди
  const material = c[1] + 3 * c[2] - c[3] - 3 * c[4];
  score += Math.round((material * 60) / (total + 6));
  return b.side === WHITE ? score : -score;
}

// ── Поиск ──

export const WIN = 100000;
const INF = 1e9;

export interface CheckersSearchOptions {
  depth: number;
  timeMs: number;
  noise?: number;
  blunder?: number;
}

class TimeUp extends Error {}

const TT_SIZE = 1 << 18;

export class CheckersSearcher {
  private ttKey = new Int32Array(TT_SIZE);
  private ttMoveKey = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttScore = new Float64Array(TT_SIZE);
  private ttFlag = new Int8Array(TT_SIZE);
  private deadline = 0;
  private nodes = 0;
  private b!: Board;

  search(b: Board, opts: CheckersSearchOptions): { move: Move | null; score: number; depth: number } {
    this.b = b;
    this.nodes = 0;
    const legal = b.moves();
    if (!legal.length) return { move: null, score: -WIN, depth: 0 };
    if (legal.length === 1) return { move: legal[0], score: 0, depth: 0 };

    if (opts.noise || opts.blunder) {
      this.deadline = Infinity;
      const scored = legal.map((m) => {
        b.make(m);
        const s = -this.negamax(opts.depth - 1, -INF, INF, 1);
        b.unmake();
        return { m, s };
      });
      const best = Math.max(...scored.map((x) => x.s));
      if (best > WIN - 100) return { move: scored.find((x) => x.s === best)!.m, score: best, depth: opts.depth };
      if (opts.blunder && Math.random() < opts.blunder) {
        const pool = scored.filter((x) => x.s > -WIN + 100);
        const pick = (pool.length ? pool : scored)[Math.floor(Math.random() * (pool.length || scored.length))];
        return { move: pick.m, score: pick.s, depth: opts.depth };
      }
      const noisy = scored.map((x) => ({ ...x, n: x.s + (Math.random() * 2 - 1) * (opts.noise ?? 0) }));
      noisy.sort((a, c) => c.n - a.n);
      return { move: noisy[0].m, score: noisy[0].s, depth: opts.depth };
    }

    this.deadline = performance.now() + opts.timeMs;
    let best = { move: legal[0], score: 0, depth: 0 };
    for (let depth = 1; depth <= opts.depth; depth++) {
      try {
        let alpha = -INF;
        let bestMove = legal[0];
        const ordered = this.order(legal, this.ttBestKey());
        for (const m of ordered) {
          b.make(m);
          let s: number;
          try {
            s = -this.negamax(depth - 1, -INF, -alpha, 1);
          } finally {
            b.unmake();
          }
          if (s > alpha) {
            alpha = s;
            bestMove = m;
          }
        }
        this.store(depth, alpha, 1, bestMove);
        best = { move: bestMove, score: alpha, depth };
        if (Math.abs(alpha) > WIN - 1000) break;
        if (performance.now() > this.deadline - opts.timeMs * 0.5) break;
      } catch (e) {
        if (!(e instanceof TimeUp)) throw e;
        break;
      }
    }
    return best;
  }

  private moveKey(m: Move) {
    return m.path[0] * 64 + m.path[m.path.length - 1] + m.captured.length * 4096;
  }

  private ttBestKey() {
    const i = (this.b.hash >>> 0) & (TT_SIZE - 1);
    return this.ttKey[i] === this.b.hash ? this.ttMoveKey[i] : -1;
  }

  private store(depth: number, score: number, flag: number, m: Move | null) {
    const i = (this.b.hash >>> 0) & (TT_SIZE - 1);
    this.ttKey[i] = this.b.hash;
    this.ttDepth[i] = depth;
    this.ttScore[i] = score;
    this.ttFlag[i] = flag;
    this.ttMoveKey[i] = m ? this.moveKey(m) : -1;
  }

  private order(moves: Move[], ttKey: number) {
    return moves
      .map((m) => ({
        m,
        k: (this.moveKey(m) === ttKey ? 1e6 : 0) + m.captured.length * 1000 + (m.promotes ? 500 : 0),
      }))
      .sort((a, c) => c.k - a.k)
      .map((x) => x.m);
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    const b = this.b;
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new TimeUp();
    if (b.repetitions() >= 2 || b.kingQuiet >= 30) return 0;

    const moves = b.moves();
    if (!moves.length) return -WIN + ply;
    const forced = moves[0].captured.length > 0;
    // Пока есть обязательные взятия, позиция не «спокойная» — считаем дальше
    if (depth <= 0 && (!forced || ply > 60)) return evaluate(b);

    const i = (b.hash >>> 0) & (TT_SIZE - 1);
    let ttKey = -1;
    if (this.ttKey[i] === b.hash) {
      ttKey = this.ttMoveKey[i];
      if (this.ttDepth[i] >= depth) {
        const s = this.ttScore[i];
        const f = this.ttFlag[i];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }

    const alpha0 = alpha;
    let bestScore = -INF;
    let bestMove: Move | null = null;
    const nextDepth = forced && moves.length === 1 ? depth : depth - 1; // единственный ход не тратит глубину
    for (const m of this.order(moves, ttKey)) {
      b.make(m);
      let s: number;
      try {
        s = -this.negamax(nextDepth, -beta, -alpha, ply + 1);
      } finally {
        b.unmake();
      }
      if (s > bestScore) {
        bestScore = s;
        bestMove = m;
      }
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    this.store(Math.max(depth, 0), bestScore, bestScore >= beta ? 2 : bestScore > alpha0 ? 1 : 3, bestMove);
    return bestScore;
  }
}
