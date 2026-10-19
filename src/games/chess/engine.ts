// Шахматный движок без зависимостей: правила + поиск хода.
//
// Доска 0x88 (128 клеток, «лишние» отсекаются проверкой sq & 0x88),
// клетка = ряд * 16 + вертикаль, a1 = 0, h8 = 0x77.
// Фигура = тип | (цвет << 3): белые 1..6, чёрные 9..14.
// Ход упакован в число: from | to << 7 | promo << 14 | flags << 17.
//
// Генератор ходов проверен perft-тестами (scripts/chessPerft — числа из
// Chess Programming Wiki), поиск — альфа-бета с итеративным углублением,
// таблицей перестановок, нулевым ходом, LMR и форсированным поиском взятий.

export const WHITE = 0;
export const BLACK = 1;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const F_CAP = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;
export const F_PROMO = 16;

const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
const K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
const B_OFF = [15, 17, -15, -17];
const R_OFF = [1, -1, 16, -16];

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const encodeMove = (from: number, to: number, promo = 0, flags = 0) =>
  from | (to << 7) | (promo << 14) | (flags << 17);
export const mFrom = (m: number) => m & 127;
export const mTo = (m: number) => (m >> 7) & 127;
export const mPromo = (m: number) => (m >> 14) & 7;
export const mFlags = (m: number) => m >> 17;

export const sqName = (sq: number) => "abcdefgh"[sq & 7] + ((sq >> 4) + 1);
export const sqFromName = (s: string) => (s.charCodeAt(1) - 49) * 16 + (s.charCodeAt(0) - 97);

// ── Zobrist-ключи (детерминированный генератор — одинаковые в UI и воркере) ──
let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
};
const Z_PIECE_LO = new Int32Array(16 * 128).map(rnd);
const Z_PIECE_HI = new Int32Array(16 * 128).map(rnd);
const Z_CASTLE_LO = new Int32Array(16).map(rnd);
const Z_CASTLE_HI = new Int32Array(16).map(rnd);
const Z_EP_LO = new Int32Array(8).map(rnd);
const Z_EP_HI = new Int32Array(8).map(rnd);
const Z_SIDE_LO = rnd();
const Z_SIDE_HI = rnd();

/** Какие права на рокировку остаются, если с клетки ушла/на неё пришла фигура. */
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[0x70] = 15 & ~CASTLE_BQ;
CASTLE_MASK[0x77] = 15 & ~CASTLE_BK;
CASTLE_MASK[0x74] = 15 & ~(CASTLE_BK | CASTLE_BQ);

const MAX_PLY = 1024;

export class Position {
  board = new Int8Array(128);
  side = WHITE;
  castle = 0;
  ep = -1;
  half = 0;
  full = 1;
  kings = [4, 0x74];
  hashLo = 0;
  hashHi = 0;
  /** Сколько ходов сделано (глубина стека отмены). */
  ply = 0;

  // Стек отмены
  private uMove = new Int32Array(MAX_PLY);
  private uCapt = new Int8Array(MAX_PLY);
  private uCastle = new Int8Array(MAX_PLY);
  private uEp = new Int16Array(MAX_PLY);
  private uHalf = new Int16Array(MAX_PLY);
  /** Ключи позиций по ходу партии — для троекратного повторения. */
  histLo = new Int32Array(MAX_PLY + 1);
  histHi = new Int32Array(MAX_PLY + 1);

  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen: string) {
    const [placement, side, castle, ep, half, full] = fen.trim().split(/\s+/);
    this.board.fill(0);
    let r = 7;
    let f = 0;
    for (const ch of placement) {
      if (ch === "/") {
        r--;
        f = 0;
      } else if (ch >= "1" && ch <= "8") f += Number(ch);
      else {
        const t = "pnbrqk".indexOf(ch.toLowerCase()) + 1;
        if (!t) throw new Error("Неверная позиция (FEN)");
        const color = ch === ch.toLowerCase() ? BLACK : WHITE;
        const sq = r * 16 + f;
        this.board[sq] = t | (color << 3);
        if (t === KING) this.kings[color] = sq;
        f++;
      }
    }
    this.side = side === "b" ? BLACK : WHITE;
    this.castle =
      (castle?.includes("K") ? CASTLE_WK : 0) |
      (castle?.includes("Q") ? CASTLE_WQ : 0) |
      (castle?.includes("k") ? CASTLE_BK : 0) |
      (castle?.includes("q") ? CASTLE_BQ : 0);
    this.ep = ep && ep !== "-" ? sqFromName(ep) : -1;
    this.half = Number(half) || 0;
    this.full = Number(full) || 1;
    this.ply = 0;
    this.computeHash();
    this.histLo[0] = this.hashLo;
    this.histHi[0] = this.hashHi;
  }

  fen(): string {
    let s = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) s += empty;
        empty = 0;
        const ch = " pnbrqk"[p & 7];
        s += p >> 3 ? ch : ch.toUpperCase();
      }
      if (empty) s += empty;
      if (r) s += "/";
    }
    const c =
      (this.castle & CASTLE_WK ? "K" : "") +
      (this.castle & CASTLE_WQ ? "Q" : "") +
      (this.castle & CASTLE_BK ? "k" : "") +
      (this.castle & CASTLE_BQ ? "q" : "");
    return `${s} ${this.side ? "b" : "w"} ${c || "-"} ${this.ep >= 0 ? sqName(this.ep) : "-"} ${this.half} ${this.full}`;
  }

  private computeHash() {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = this.board[sq];
      if (p) {
        lo ^= Z_PIECE_LO[p * 128 + sq];
        hi ^= Z_PIECE_HI[p * 128 + sq];
      }
    }
    lo ^= Z_CASTLE_LO[this.castle];
    hi ^= Z_CASTLE_HI[this.castle];
    if (this.ep >= 0) {
      lo ^= Z_EP_LO[this.ep & 7];
      hi ^= Z_EP_HI[this.ep & 7];
    }
    if (this.side) {
      lo ^= Z_SIDE_LO;
      hi ^= Z_SIDE_HI;
    }
    this.hashLo = lo;
    this.hashHi = hi;
  }

  /** Бьёт ли сторона `by` клетку `sq`. */
  attacked(sq: number, by: number): boolean {
    const b = this.board;
    // пешки
    if (by === WHITE) {
      if (!((sq - 15) & 0x88) && b[sq - 15] === PAWN) return true;
      if (!((sq - 17) & 0x88) && b[sq - 17] === PAWN) return true;
    } else {
      if (!((sq + 15) & 0x88) && b[sq + 15] === (PAWN | 8)) return true;
      if (!((sq + 17) & 0x88) && b[sq + 17] === (PAWN | 8)) return true;
    }
    const c = by << 3;
    for (let i = 0; i < 8; i++) {
      const t = sq + N_OFF[i];
      if (!(t & 0x88) && b[t] === (KNIGHT | c)) return true;
    }
    for (let i = 0; i < 8; i++) {
      const t = sq + K_OFF[i];
      if (!(t & 0x88) && b[t] === (KING | c)) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = B_OFF[i];
      let t = sq + d;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p) {
          if (p === (BISHOP | c) || p === (QUEEN | c)) return true;
          break;
        }
        t += d;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = R_OFF[i];
      let t = sq + d;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p) {
          if (p === (ROOK | c) || p === (QUEEN | c)) return true;
          break;
        }
        t += d;
      }
    }
    return false;
  }

  inCheck(side = this.side) {
    return this.attacked(this.kings[side], side ^ 1);
  }

  /** Псевдолегальные ходы (без проверки шаха своему королю). */
  genMoves(out: Int32Array, capsOnly = false): number {
    const b = this.board;
    const us = this.side;
    const them = us ^ 1;
    let n = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (!p || p >> 3 !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const dir = us ? -16 : 16;
        const startRank = us ? 6 : 1;
        const promoRank = us ? 0 : 7;
        const to = sq + dir;
        if (!(to & 0x88) && !b[to]) {
          if (to >> 4 === promoRank) {
            out[n++] = encodeMove(sq, to, QUEEN, F_PROMO);
            if (!capsOnly) {
              out[n++] = encodeMove(sq, to, ROOK, F_PROMO);
              out[n++] = encodeMove(sq, to, BISHOP, F_PROMO);
              out[n++] = encodeMove(sq, to, KNIGHT, F_PROMO);
            }
          } else if (!capsOnly) {
            out[n++] = encodeMove(sq, to);
            if (sq >> 4 === startRank && !b[to + dir]) out[n++] = encodeMove(sq, to + dir, 0, F_DOUBLE);
          }
        }
        for (let k = -1; k <= 1; k += 2) {
          const c = to + k;
          if (c & 0x88) continue;
          const q = b[c];
          if (q && q >> 3 === them) {
            if (c >> 4 === promoRank) {
              out[n++] = encodeMove(sq, c, QUEEN, F_PROMO | F_CAP);
              out[n++] = encodeMove(sq, c, ROOK, F_PROMO | F_CAP);
              out[n++] = encodeMove(sq, c, BISHOP, F_PROMO | F_CAP);
              out[n++] = encodeMove(sq, c, KNIGHT, F_PROMO | F_CAP);
            } else out[n++] = encodeMove(sq, c, 0, F_CAP);
          } else if (c === this.ep) out[n++] = encodeMove(sq, c, 0, F_CAP | F_EP);
        }
      } else if (t === KNIGHT || t === KING) {
        const offs = t === KNIGHT ? N_OFF : K_OFF;
        for (let i = 0; i < 8; i++) {
          const to = sq + offs[i];
          if (to & 0x88) continue;
          const q = b[to];
          if (!q) {
            if (!capsOnly) out[n++] = encodeMove(sq, to);
          } else if (q >> 3 === them) out[n++] = encodeMove(sq, to, 0, F_CAP);
        }
        if (t === KING && !capsOnly) n = this.genCastles(out, n);
      } else {
        const dirs = t === BISHOP ? B_OFF : t === ROOK ? R_OFF : K_OFF;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          let to = sq + d;
          while (!(to & 0x88)) {
            const q = b[to];
            if (!q) {
              if (!capsOnly) out[n++] = encodeMove(sq, to);
            } else {
              if (q >> 3 === them) out[n++] = encodeMove(sq, to, 0, F_CAP);
              break;
            }
            to += d;
          }
        }
      }
    }
    return n;
  }

  private genCastles(out: Int32Array, n: number) {
    const b = this.board;
    const us = this.side;
    const base = us ? 0x70 : 0;
    const kSide = us ? CASTLE_BK : CASTLE_WK;
    const qSide = us ? CASTLE_BQ : CASTLE_WQ;
    const them = us ^ 1;
    if (this.kings[us] !== base + 4) return n;
    if (
      this.castle & kSide &&
      !b[base + 5] &&
      !b[base + 6] &&
      b[base + 7] === (ROOK | (us << 3)) &&
      !this.attacked(base + 4, them) &&
      !this.attacked(base + 5, them) &&
      !this.attacked(base + 6, them)
    )
      out[n++] = encodeMove(base + 4, base + 6, 0, F_CASTLE);
    if (
      this.castle & qSide &&
      !b[base + 3] &&
      !b[base + 2] &&
      !b[base + 1] &&
      b[base] === (ROOK | (us << 3)) &&
      !this.attacked(base + 4, them) &&
      !this.attacked(base + 3, them) &&
      !this.attacked(base + 2, them)
    )
      out[n++] = encodeMove(base + 4, base + 2, 0, F_CASTLE);
    return n;
  }

  private xorPiece(p: number, sq: number) {
    this.hashLo ^= Z_PIECE_LO[p * 128 + sq];
    this.hashHi ^= Z_PIECE_HI[p * 128 + sq];
  }

  /** Сделать ход. Если он оставляет своего короля под шахом — откатывает и возвращает false. */
  make(m: number): boolean {
    const b = this.board;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const promo = (m >> 14) & 7;
    const flags = m >> 17;
    const us = this.side;
    const them = us ^ 1;
    const ply = this.ply;

    this.uMove[ply] = m;
    this.uCastle[ply] = this.castle;
    this.uEp[ply] = this.ep;
    this.uHalf[ply] = this.half;

    const p = b[from];
    let captured = 0;
    if (flags & F_EP) {
      const capSq = to + (us ? 16 : -16);
      captured = b[capSq];
      b[capSq] = 0;
      this.xorPiece(captured, capSq);
    } else {
      captured = b[to];
      if (captured) this.xorPiece(captured, to);
    }
    this.uCapt[ply] = captured;

    this.xorPiece(p, from);
    b[from] = 0;
    const np = promo ? promo | (us << 3) : p;
    b[to] = np;
    this.xorPiece(np, to);
    if ((p & 7) === KING) this.kings[us] = to;

    if (flags & F_CASTLE) {
      const rFrom = to > from ? from + 3 : from - 4;
      const rTo = to > from ? from + 1 : from - 1;
      const r = b[rFrom];
      b[rFrom] = 0;
      b[rTo] = r;
      this.xorPiece(r, rFrom);
      this.xorPiece(r, rTo);
    }

    this.hashLo ^= Z_CASTLE_LO[this.castle];
    this.hashHi ^= Z_CASTLE_HI[this.castle];
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.hashLo ^= Z_CASTLE_LO[this.castle];
    this.hashHi ^= Z_CASTLE_HI[this.castle];

    if (this.ep >= 0) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
    this.ep = -1;
    if (flags & F_DOUBLE) {
      // Поле взятия на проходе ставим, только если его действительно можно взять —
      // иначе одинаковые позиции не считались бы повторением.
      const enemyPawn = PAWN | (them << 3);
      if ((!((to + 1) & 0x88) && b[to + 1] === enemyPawn) || (!((to - 1) & 0x88) && b[to - 1] === enemyPawn)) {
        this.ep = (from + to) >> 1;
        this.hashLo ^= Z_EP_LO[this.ep & 7];
        this.hashHi ^= Z_EP_HI[this.ep & 7];
      }
    }

    this.half = (p & 7) === PAWN || captured ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.side = them;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.ply = ply + 1;
    this.histLo[this.ply] = this.hashLo;
    this.histHi[this.ply] = this.hashHi;

    if (this.attacked(this.kings[us], them)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake() {
    const ply = --this.ply;
    const m = this.uMove[ply];
    const b = this.board;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const promo = (m >> 14) & 7;
    const flags = m >> 17;
    this.side ^= 1;
    const us = this.side;
    if (us === BLACK) this.full--;

    const np = b[to];
    b[from] = promo ? PAWN | (us << 3) : np;
    b[to] = 0;
    if ((b[from] & 7) === KING) this.kings[us] = from;
    const captured = this.uCapt[ply];
    if (flags & F_EP) b[to + (us ? 16 : -16)] = captured;
    else b[to] = captured;

    if (flags & F_CASTLE) {
      const rFrom = to > from ? from + 3 : from - 4;
      const rTo = to > from ? from + 1 : from - 1;
      b[rFrom] = b[rTo];
      b[rTo] = 0;
    }
    this.castle = this.uCastle[ply];
    this.ep = this.uEp[ply];
    this.half = this.uHalf[ply];
    this.hashLo = this.histLo[ply];
    this.hashHi = this.histHi[ply];
  }

  /** «Пропуск хода» для поиска (нулевой ход). */
  makeNull() {
    const ply = this.ply;
    this.uMove[ply] = 0;
    this.uEp[ply] = this.ep;
    this.uHalf[ply] = this.half;
    this.uCastle[ply] = this.castle;
    if (this.ep >= 0) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
    this.ep = -1;
    this.half++;
    this.side ^= 1;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.ply = ply + 1;
    this.histLo[this.ply] = this.hashLo;
    this.histHi[this.ply] = this.hashHi;
  }

  unmakeNull() {
    const ply = --this.ply;
    this.side ^= 1;
    this.ep = this.uEp[ply];
    this.half = this.uHalf[ply];
    this.hashLo = this.histLo[ply];
    this.hashHi = this.histHi[ply];
  }

  /** Откатить ходы (в том числе нулевые) до заданной глубины — после прерванного поиска. */
  undoTo(ply: number) {
    while (this.ply > ply) {
      if (this.uMove[this.ply - 1] === 0) this.unmakeNull();
      else this.unmake();
    }
  }

  /** Все легальные ходы. */
  legalMoves(): number[] {
    const buf = new Int32Array(256);
    const n = this.genMoves(buf);
    const res: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.make(buf[i])) {
        res.push(buf[i]);
        this.unmake();
      }
    }
    return res;
  }

  /** Повторилась ли текущая позиция (count раз считая текущую). */
  repetitions(): number {
    let count = 1;
    const lo = this.hashLo;
    const hi = this.hashHi;
    const stop = Math.max(0, this.ply - this.half);
    for (let i = this.ply - 2; i >= stop; i -= 2) {
      if (this.histLo[i] === lo && this.histHi[i] === hi) count++;
    }
    return count;
  }

  /** Ни у одной стороны не хватает материала, чтобы поставить мат. */
  insufficientMaterial(): boolean {
    let minors = 0;
    const bishopColors: number[] = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const t = this.board[sq] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === BISHOP) bishopColors.push(((sq >> 4) + (sq & 7)) & 1);
    }
    if (minors <= 1) return true;
    // Только слоны, все на полях одного цвета
    return bishopColors.length === minors && bishopColors.every((c) => c === bishopColors[0]);
  }
}

// ── Нотация ──

const RU_PIECE = ["", "", "К", "С", "Л", "Ф", "Кр"];

/** Ход в краткой алгебраической нотации (русские буквы фигур). Вызывать ДО хода. */
export function toSan(pos: Position, m: number, legal = pos.legalMoves()): string {
  const from = mFrom(m);
  const to = mTo(m);
  const flags = mFlags(m);
  const t = pos.board[from] & 7;
  let s: string;
  if (flags & F_CASTLE) s = to > from ? "O-O" : "O-O-O";
  else if (t === PAWN) {
    s = flags & F_CAP ? `${"abcdefgh"[from & 7]}x${sqName(to)}` : sqName(to);
    if (flags & F_PROMO) s += `=${RU_PIECE[mPromo(m)]}`;
  } else {
    // Уточнение, если на ту же клетку может пойти такая же фигура
    const twins = legal.filter(
      (o) => o !== m && mTo(o) === to && (pos.board[mFrom(o)] & 7) === t && mFrom(o) !== from,
    );
    let dis = "";
    if (twins.length) {
      const sameFile = twins.some((o) => (mFrom(o) & 7) === (from & 7));
      const sameRank = twins.some((o) => mFrom(o) >> 4 === from >> 4);
      if (!sameFile) dis = "abcdefgh"[from & 7];
      else if (!sameRank) dis = String((from >> 4) + 1);
      else dis = sqName(from);
    }
    s = RU_PIECE[t] + dis + (flags & F_CAP ? "x" : "") + sqName(to);
  }
  if (pos.make(m)) {
    if (pos.inCheck()) s += pos.legalMoves().length ? "+" : "#";
    pos.unmake();
  }
  return s;
}

export const moveToUci = (m: number) =>
  sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? " pnbrqk"[mPromo(m)] : "");

/** Найти легальный ход по строке вида e2e4 / e7e8q. */
export function moveFromUci(pos: Position, uci: string): number | null {
  const from = sqFromName(uci.slice(0, 2));
  const to = sqFromName(uci.slice(2, 4));
  const promo = uci[4] ? " pnbrqk".indexOf(uci[4]) : 0;
  for (const m of pos.legalMoves()) {
    if (mFrom(m) === from && mTo(m) === to && mPromo(m) === promo) return m;
  }
  return null;
}

export type GameResult =
  | { over: false; check: boolean }
  | {
      over: true;
      check: boolean;
      winner: number | null;
      reason: "checkmate" | "stalemate" | "fifty" | "repetition" | "material";
    };

export function gameResult(pos: Position): GameResult {
  const check = pos.inCheck();
  if (!pos.legalMoves().length)
    return check
      ? { over: true, check, winner: pos.side ^ 1, reason: "checkmate" }
      : { over: true, check, winner: null, reason: "stalemate" };
  if (pos.half >= 100) return { over: true, check, winner: null, reason: "fifty" };
  if (pos.repetitions() >= 3) return { over: true, check, winner: null, reason: "repetition" };
  if (pos.insufficientMaterial()) return { over: true, check, winner: null, reason: "material" };
  return { over: false, check };
}

// ── Оценка позиции ──

const VAL = [0, 100, 320, 330, 500, 900, 0];
// prettier-ignore
const PST: number[][] = [
  [],
  [ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
    0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0 ],
  [ -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
    -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50 ],
  [ -20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
    -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20 ],
  [ 0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
    -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0 ],
  [ -20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
    0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20 ],
  [ -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20 ],
];
// prettier-ignore
const KING_EG = [
  -50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
  -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50 ];
const PASSED = [0, 10, 15, 25, 45, 75, 120, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];

/** Индекс в таблицах (они записаны с 8-го ряда для белых). */
const pstIndex = (sq: number, color: number) =>
  color === WHITE ? (7 - (sq >> 4)) * 8 + (sq & 7) : (sq >> 4) * 8 + (sq & 7);

/** Оценка с точки зрения стороны, которая ходит (в сотых пешки). */
export function evaluate(pos: Position): number {
  const b = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  const bishops = [0, 0];
  const material = [0, 0];
  const pawnsCnt = [0, 0];

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (!p) continue;
    const t = p & 7;
    const c = p >> 3;
    const sign = c === WHITE ? 1 : -1;
    const idx = pstIndex(sq, c);
    phase += PHASE[t];
    if (t === KING) {
      mg += sign * PST[KING][idx];
      eg += sign * KING_EG[idx];
      continue;
    }
    const v = VAL[t] + PST[t][idx];
    mg += sign * v;
    eg += sign * (t === PAWN ? VAL[t] + PST[t][idx] / 2 : v);
    material[c] += VAL[t];
    if (t === PAWN) {
      pawnFiles[c][sq & 7]++;
      pawnsCnt[c]++;
    } else if (t === BISHOP) bishops[c]++;
  }

  // Пешечная структура и проходные
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if ((p & 7) !== PAWN) continue;
    const c = p >> 3;
    const sign = c === WHITE ? 1 : -1;
    const f = sq & 7;
    const r = sq >> 4;
    const own = pawnFiles[c];
    if ((f === 0 || !own[f - 1]) && (f === 7 || !own[f + 1])) {
      mg -= sign * 12;
      eg -= sign * 16;
    }
    // Проходная: впереди на своей и соседних вертикалях нет чужих пешек
    let passed = true;
    const enemy = PAWN | ((c ^ 1) << 3);
    const dir = c === WHITE ? 16 : -16;
    for (let s = sq + dir; !(s & 0x88) && passed; s += dir) {
      if (b[s] === enemy || (f > 0 && b[s - 1] === enemy) || (f < 7 && b[s + 1] === enemy)) passed = false;
    }
    if (passed) {
      const adv = c === WHITE ? r : 7 - r;
      mg += (sign * PASSED[adv]) / 2;
      eg += sign * PASSED[adv];
    }
  }
  for (let c = 0; c < 2; c++) {
    const sign = c === WHITE ? 1 : -1;
    for (let f = 0; f < 8; f++) {
      if (pawnFiles[c][f] > 1) {
        mg -= sign * 12 * (pawnFiles[c][f] - 1);
        eg -= sign * 20 * (pawnFiles[c][f] - 1);
      }
    }
    if (bishops[c] >= 2) {
      mg += sign * 30;
      eg += sign * 45;
    }
  }
  // Ладьи на открытых линиях
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if ((p & 7) !== ROOK) continue;
    const c = p >> 3;
    const f = sq & 7;
    if (!pawnFiles[c][f]) {
      const bonus = pawnFiles[c ^ 1][f] ? 8 : 18;
      mg += (c === WHITE ? 1 : -1) * bonus;
    }
  }

  if (phase > 24) phase = 24;
  let score = Math.round((mg * phase + eg * (24 - phase)) / 24);

  // Добивание в эндшпиле: у слабой стороны нет пешек и мало материала —
  // гоним короля к краю и подводим своего (иначе ферзь с ладьёй «не видят» мат).
  for (let c = 0; c < 2; c++) {
    const o = c ^ 1;
    if (pawnsCnt[o] === 0 && material[c] - material[o] >= 400 && material[o] <= 330) {
      const ek = pos.kings[o];
      const ok = pos.kings[c];
      const ef = ek & 7;
      const er = ek >> 4;
      const center = Math.max(3 - ef, ef - 4) + Math.max(3 - er, er - 4);
      const dist = Math.abs((ok & 7) - ef) + Math.abs((ok >> 4) - er);
      const bonus = center * 12 + (14 - dist) * 6;
      score += c === WHITE ? bonus : -bonus;
    }
  }

  return pos.side === WHITE ? score : -score;
}

// ── Поиск ──

export const MATE = 30000;
const INF = 32000;

export interface SearchOptions {
  /** Предельная глубина (полуходов). */
  depth: number;
  /** Ограничение по времени, мс. */
  timeMs: number;
  /** Случайный разброс оценки корневых ходов (сотые пешки) — для слабых уровней. */
  noise?: number;
  /** Вероятность сделать случайный (но не зевающий мат) ход. */
  blunder?: number;
}

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  pv: number[];
}

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

class TimeUp extends Error {}

export class Searcher {
  private ttKey = new Int32Array(TT_SIZE);
  private ttMove = new Int32Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Int8Array(TT_SIZE);
  private killers = new Int32Array(128 * 2);
  private history = new Int32Array(16 * 128);
  private moveBufs: Int32Array[] = [];
  private scoreBufs: Int32Array[] = [];
  private nodes = 0;
  private deadline = 0;
  private pos!: Position;

  private buf(ply: number) {
    while (this.moveBufs.length <= ply) {
      this.moveBufs.push(new Int32Array(256));
      this.scoreBufs.push(new Int32Array(256));
    }
    return this.moveBufs[ply];
  }

  search(pos: Position, opts: SearchOptions): SearchResult {
    this.pos = pos;
    this.nodes = 0;
    this.deadline = performance.now() + opts.timeMs;
    this.killers.fill(0);
    this.history.fill(0);

    const basePly = pos.ply;
    const legal = pos.legalMoves();
    if (!legal.length) return { move: 0, score: 0, depth: 0, nodes: 0, pv: [] };
    if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0, pv: [legal[0]] };

    // Слабые уровни: оцениваем каждый корневой ход и выбираем с шумом.
    if (opts.noise || opts.blunder) return this.searchNoisy(pos, legal, opts);

    let best: SearchResult = { move: legal[0], score: 0, depth: 0, nodes: 0, pv: [legal[0]] };
    for (let depth = 1; depth <= opts.depth; depth++) {
      try {
        const score = this.root(depth);
        const move = this.ttProbeMove();
        best = { move: move || best.move, score, depth, nodes: this.nodes, pv: this.pv(depth) };
        if (Math.abs(score) > MATE - 200) break; // мат найден — глубже не нужно
        // Не начинаем новую итерацию, если она точно не успеет
        if (performance.now() > this.deadline - (opts.timeMs * 0.45)) break;
      } catch (e) {
        pos.undoTo(basePly);
        if (!(e instanceof TimeUp)) throw e;
        break;
      }
    }
    return best;
  }

  private searchNoisy(pos: Position, legal: number[], opts: SearchOptions): SearchResult {
    const depth = Math.max(1, opts.depth);
    const scored: { m: number; s: number }[] = [];
    this.deadline = Infinity;
    for (const m of legal) {
      pos.make(m);
      const s = -this.negamax(depth - 1, -INF, INF, 1, true);
      pos.unmake();
      scored.push({ m, s });
    }
    const bestScore = Math.max(...scored.map((x) => x.s));
    // Мат в один ход не упускаем даже новичком — иначе игра выглядит сломанной.
    if (bestScore > MATE - 10) {
      const m = scored.find((x) => x.s === bestScore)!.m;
      return { move: m, score: bestScore, depth, nodes: this.nodes, pv: [m] };
    }
    let pool = scored;
    if (opts.blunder && Math.random() < opts.blunder) {
      // «Зевок»: любой ход, кроме ведущих к мату в 1–2 хода
      pool = scored.filter((x) => x.s > -MATE + 10);
    } else {
      const noise = opts.noise ?? 0;
      pool = scored
        .map((x) => ({ m: x.m, s: x.s + (Math.random() * 2 - 1) * noise }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 1);
    }
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? scored[0];
    const real = scored.find((x) => x.m === pick.m)!;
    return { move: pick.m, score: real.s, depth, nodes: this.nodes, pv: [pick.m] };
  }

  private ttProbeMove() {
    const i = this.pos.hashLo & TT_MASK;
    return this.ttKey[i] === this.pos.hashHi ? this.ttMove[i] : 0;
  }

  private pv(depth: number): number[] {
    const res: number[] = [];
    const pos = this.pos;
    for (let i = 0; i < depth; i++) {
      const m = this.ttProbeMove();
      if (!m || !pos.legalMoves().includes(m)) break;
      pos.make(m);
      res.push(m);
    }
    for (let i = 0; i < res.length; i++) pos.unmake();
    return res;
  }

  private root(depth: number): number {
    return this.negamax(depth, -INF, INF, 0, false);
  }

  private store(depth: number, score: number, flag: number, move: number, ply: number) {
    const i = this.pos.hashLo & TT_MASK;
    // Маты храним относительно текущей позиции
    if (score > MATE - 500) score += ply;
    else if (score < -MATE + 500) score -= ply;
    if (this.ttKey[i] === this.pos.hashHi && this.ttDepth[i] > depth && flag !== TT_EXACT) return;
    this.ttKey[i] = this.pos.hashHi;
    this.ttMove[i] = move;
    this.ttScore[i] = score;
    this.ttDepth[i] = depth;
    this.ttFlag[i] = flag;
  }

  private hasPieces(side: number) {
    const b = this.pos.board;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (p && p >> 3 === side && (p & 7) !== PAWN && (p & 7) !== KING) return true;
    }
    return false;
  }

  private orderScores(moves: Int32Array, n: number, scores: Int32Array, ttMove: number, ply: number) {
    const b = this.pos.board;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      const flags = m >> 17;
      if (m === ttMove) scores[i] = 2_000_000;
      else if (flags & F_CAP) {
        const victim = flags & F_EP ? PAWN : b[(m >> 7) & 127] & 7;
        const attacker = b[m & 127] & 7;
        scores[i] = 1_000_000 + victim * 10 - attacker + (flags & F_PROMO ? 5000 : 0);
      } else if (flags & F_PROMO) scores[i] = 950_000 + ((m >> 14) & 7);
      else if (m === k1) scores[i] = 900_000;
      else if (m === k2) scores[i] = 800_000;
      else scores[i] = this.history[(b[m & 127] & 15) * 128 + ((m >> 7) & 127)];
    }
  }

  private pickNext(moves: Int32Array, scores: Int32Array, i: number, n: number) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const tm = moves[i];
      moves[i] = moves[best];
      moves[best] = tm;
      const ts = scores[i];
      scores[i] = scores[best];
      scores[best] = ts;
    }
    return moves[i];
  }

  private checkTime() {
    if ((++this.nodes & 2047) === 0 && performance.now() > this.deadline) throw new TimeUp();
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    const pos = this.pos;
    this.checkTime();

    if (ply > 0) {
      if (pos.half >= 100 || pos.repetitions() >= 2 || pos.insufficientMaterial()) return 0;
      // Отсечение по дистанции до мата
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    if (ply >= 100) return evaluate(pos);

    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    const ti = pos.hashLo & TT_MASK;
    let ttMove = 0;
    if (this.ttKey[ti] === pos.hashHi) {
      ttMove = this.ttMove[ti];
      if (ply > 0 && this.ttDepth[ti] >= depth) {
        let s = this.ttScore[ti];
        if (s > MATE - 500) s -= ply;
        else if (s < -MATE + 500) s += ply;
        const f = this.ttFlag[ti];
        if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
      }
    }

    const pvNode = beta - alpha > 1;
    if (!pvNode && !inCheck && allowNull && depth >= 3 && this.hasPieces(pos.side) && evaluate(pos) >= beta) {
      pos.makeNull();
      const s = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      pos.unmakeNull();
      if (s >= beta) return beta;
    }

    const moves = this.buf(ply);
    const scores = this.scoreBufs[ply];
    const n = pos.genMoves(moves);
    this.orderScores(moves, n, scores, ttMove, ply);

    const alpha0 = alpha;
    let bestScore = -INF;
    let bestMove = 0;
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = this.pickNext(moves, scores, i, n);
      if (!pos.make(m)) continue;
      legal++;
      const quiet = !((m >> 17) & (F_CAP | F_PROMO));
      let s: number;
      if (legal === 1) s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        // Поздние тихие ходы сначала смотрим мельче
        const reduce = depth >= 3 && legal > 4 && quiet && !inCheck && !pos.inCheck() ? (legal > 10 ? 2 : 1) : 0;
        s = -this.negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && (reduce || s < beta)) s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake();

      if (s > bestScore) {
        bestScore = s;
        bestMove = m;
        if (s > alpha) {
          alpha = s;
          if (s >= beta) {
            if (quiet) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              this.history[(pos.board[m & 127] & 15) * 128 + ((m >> 7) & 127)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (!legal) return inCheck ? -MATE + ply : 0;

    this.store(depth, bestScore, bestScore >= beta ? TT_LOWER : bestScore > alpha0 ? TT_EXACT : TT_UPPER, bestMove, ply);
    return bestScore;
  }

  private quiesce(alpha: number, beta: number, ply: number): number {
    this.checkTime();
    const pos = this.pos;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply >= 120) return stand;

    const moves = this.buf(ply);
    const scores = this.scoreBufs[ply];
    const n = pos.genMoves(moves, true);
    this.orderScores(moves, n, scores, 0, ply);
    const b = pos.board;
    for (let i = 0; i < n; i++) {
      const m = this.pickNext(moves, scores, i, n);
      const flags = m >> 17;
      // Дельта-отсечение: даже взятие этой фигуры не поднимет оценку до alpha
      if (!(flags & F_PROMO)) {
        const victim = flags & F_EP ? PAWN : b[(m >> 7) & 127] & 7;
        if (stand + VAL[victim] + 200 < alpha) continue;
      }
      if (!pos.make(m)) continue;
      const s = -this.quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
}

/** Подсчёт листьев дерева ходов — для проверки генератора. */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const buf = new Int32Array(256);
  const n = pos.genMoves(buf);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!pos.make(buf[i])) continue;
    total += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return total;
}
