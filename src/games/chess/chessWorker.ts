// Поиск хода в отдельном потоке — доска не подвисает, пока компьютер думает.
import { Position, Searcher, moveFromUci, moveToUci, type SearchOptions } from "./engine";

export interface ChessRequest {
  id: number;
  /** Ходы партии от начальной позиции (e2e4, e7e8q…). */
  moves: string[];
  opts: SearchOptions;
}
export interface ChessResponse {
  id: number;
  move: string | null;
  /** Оценка с точки зрения белых, сотые пешки. */
  score: number;
  depth: number;
}

const searcher = new Searcher();

self.onmessage = (e: MessageEvent<ChessRequest>) => {
  const { id, moves, opts } = e.data;
  const pos = new Position();
  for (const u of moves) {
    const m = moveFromUci(pos, u);
    if (m === null) break;
    pos.make(m);
  }
  const r = searcher.search(pos, opts);
  const score = pos.side === 0 ? r.score : -r.score;
  const res: ChessResponse = { id, move: r.move ? moveToUci(r.move) : null, score, depth: r.depth };
  (self as unknown as Worker).postMessage(res);
};
