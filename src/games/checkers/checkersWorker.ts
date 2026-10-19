// Поиск хода в шашках в отдельном потоке.
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

const searcher = new CheckersSearcher();

self.onmessage = (e: MessageEvent<CheckersRequest>) => {
  const { id, moves, opts } = e.data;
  const b = Board.initial();
  for (const t of moves) {
    const m = b.moves().find((x) => moveText(x) === t);
    if (!m) break;
    b.make(m);
  }
  const r = searcher.search(b, opts);
  const res: CheckersResponse = { id, move: r.move ? moveText(r.move) : null };
  (self as unknown as Worker).postMessage(res);
};
