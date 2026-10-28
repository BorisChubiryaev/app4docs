// Поиск хода компьютера: в фоновом потоке, а если поток не запустился
// (старый браузер, политика безопасности портала, файл потока не загрузился
// или поток упал) — в основном потоке. Без этого компьютер молча «не ходил».

interface Job {
  id: number;
  opts: { timeMs: number };
}

/** Сколько ждать ответа потока сверх времени на обдумывание. */
const GRACE_MS = 6000;

export class EngineRunner<Req extends Job, Res extends { id: number }> {
  onmessage: ((res: Res) => void) | null = null;
  private worker: Worker | null = null;
  private pending = new Map<number, { req: Req; timer: number }>();
  private closed = false;

  constructor(
    makeWorker: () => Worker,
    private local: (req: Req) => Res,
  ) {
    try {
      const w = makeWorker();
      w.onmessage = (e: MessageEvent<Res>) => this.receive(e.data);
      w.onerror = (e) => {
        e.preventDefault();
        this.fallback(`ошибка потока: ${e.message || "файл не загрузился"}`);
      };
      w.onmessageerror = () => this.fallback("ошибка передачи данных");
      this.worker = w;
    } catch (err) {
      console.warn("[engine] фоновый поток недоступен, считаем в основном потоке", err);
    }
  }

  post(req: Req) {
    if (this.closed) return;
    if (!this.worker) return this.runLocal(req);
    const timer = window.setTimeout(() => this.fallback("поток не ответил вовремя"), req.opts.timeMs + GRACE_MS);
    this.pending.set(req.id, { req, timer });
    this.worker.postMessage(req);
  }

  terminate() {
    this.closed = true;
    this.pending.forEach((p) => clearTimeout(p.timer));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private receive(res: Res) {
    const p = this.pending.get(res.id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(res.id);
    }
    if (!this.closed) this.onmessage?.(res);
  }

  /** Поток сломан: переходим на основной поток и пересчитываем ожидающие ходы. */
  private fallback(reason: string) {
    if (!this.worker) return;
    console.warn(`[engine] ${reason}; считаем в основном потоке`);
    this.worker.terminate();
    this.worker = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) {
      clearTimeout(p.timer);
      this.runLocal(p.req);
    }
  }

  private runLocal(req: Req) {
    // Небольшая пауза, чтобы интерфейс успел показать «компьютер думает»
    window.setTimeout(() => {
      if (this.closed) return;
      let res: Res;
      try {
        res = this.local(req);
      } catch (err) {
        console.error("[engine] ошибка поиска хода", err);
        return;
      }
      this.onmessage?.(res);
    }, 30);
  }
}
