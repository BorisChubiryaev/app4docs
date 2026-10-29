// Поиск хода в отдельном потоке — доска не подвисает, пока компьютер думает.
import { Searcher } from "./engine";
import { runChessRequest, type ChessRequest } from "./search";

const searcher = new Searcher();

self.onmessage = (e: MessageEvent<ChessRequest>) => {
  (self as unknown as Worker).postMessage(runChessRequest(searcher, e.data));
};
