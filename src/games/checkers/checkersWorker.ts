// Поиск хода в шашках в отдельном потоке.
import { CheckersSearcher } from "./engine";
import { runCheckersRequest, type CheckersRequest } from "./search";

const searcher = new CheckersSearcher();

self.onmessage = (e: MessageEvent<CheckersRequest>) => {
  (self as unknown as Worker).postMessage(runCheckersRequest(searcher, e.data));
};
