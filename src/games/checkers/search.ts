// Разбор запроса на поиск хода — общий для фонового и основного потока.
import { Board, CheckersSearcher, moveText, type CheckersSearchOptions } from "./engine";

export interface CheckersRequest {
  id: number;
  /** Ходы партии в нотации c3-d4 / c3:e5:g3. */
  moves: string[];
  opts: CheckersSearchOptions;
}
export interface CheckersResponse {
  id: number;
  move: string | null;
}

export function runCheckersRequest(searcher: CheckersSearcher, { id, moves, opts }: CheckersRequest): CheckersResponse {
  const b = Board.initial();
  for (const t of moves) {
    const m = b.moves().find((x) => moveText(x) === t);
    if (!m) break;
    b.make(m);
  }
  const r = searcher.search(b, opts);
  return { id, move: r.move ? moveText(r.move) : null };
}
