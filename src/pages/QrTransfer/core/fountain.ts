// Фонтанный код Луби (LT) для передачи через «односторонний» канал камеры.
//
// Почему не просто «кадр № i из N»: камера пропускает часть кадров (смаз,
// блик, переключение кадра посреди экспозиции), а обратного канала нет.
// С фонтанным кодом отправитель бесконечно генерирует новые символы, и
// получателю нужно поймать ЛЮБЫЕ ~K·(1+5…10%) символов, а не конкретные.
//
// Код намеренно НЕ систематический: при потере кадров систематическая
// схема требует +40% символов, а чистый LT с робастным солитоном — около
// +4% для 30 МБ, и этот избыток не зависит от доли потерь.

/** Детерминированный ГПСЧ mulberry32 — одинаков на обеих сторонах. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CDF робастного распределения солитона для K блоков. */
function robustSolitonCdf(k: number, c = 0.03, delta = 0.5): Float64Array {
  const rho = new Float64Array(k + 1);
  rho[1] = 1 / k;
  for (let d = 2; d <= k; d++) rho[d] = 1 / (d * (d - 1));

  const tau = new Float64Array(k + 1);
  const r = c * Math.log(k / delta) * Math.sqrt(k);
  const spike = Math.max(1, Math.min(k, Math.floor(k / r)));
  for (let d = 1; d < spike; d++) tau[d] = r / (d * k);
  tau[spike] = (r * Math.log(r / delta)) / k;

  let z = 0;
  for (let d = 1; d <= k; d++) z += rho[d] + Math.max(0, tau[d]);
  const cdf = new Float64Array(k + 1);
  let acc = 0;
  for (let d = 1; d <= k; d++) {
    acc += (rho[d] + Math.max(0, tau[d])) / z;
    cdf[d] = acc;
  }
  cdf[k] = 1;
  return cdf;
}

/** Номера блоков, из которых собран символ `id`. */
export class SymbolPlanner {
  private readonly cdf: Float64Array | null;
  constructor(readonly k: number) {
    this.cdf = k > 1 ? robustSolitonCdf(k) : null;
  }

  indices(id: number): number[] {
    const k = this.k;
    if (!this.cdf) return [0];
    const rnd = mulberry32(id ^ 0x9e3779b9);
    const u = rnd();
    // бинарный поиск степени по CDF
    let lo = 1;
    let hi = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const degree = lo;
    const picked = new Set<number>();
    while (picked.size < degree) picked.add(Math.floor(rnd() * k));
    return [...picked];
  }
}

function xorInto(dst: Uint8Array, src: Uint8Array) {
  const n = dst.length;
  // по 4 байта, когда оба буфера выровнены (обычный случай)
  if ((dst.byteOffset & 3) === 0 && (src.byteOffset & 3) === 0 && (n & 3) === 0) {
    const d = new Uint32Array(dst.buffer, dst.byteOffset, n >> 2);
    const s = new Uint32Array(src.buffer, src.byteOffset, n >> 2);
    for (let i = 0; i < d.length; i++) d[i] ^= s[i];
    return;
  }
  for (let i = 0; i < n; i++) dst[i] ^= src[i];
}

export class FountainEncoder {
  readonly k: number;
  private readonly planner: SymbolPlanner;
  private readonly padded: Uint8Array;

  constructor(data: Uint8Array, readonly blockSize: number) {
    this.k = Math.max(1, Math.ceil(data.length / blockSize));
    this.planner = new SymbolPlanner(this.k);
    this.padded = new Uint8Array(this.k * blockSize);
    this.padded.set(data);
  }

  private block(i: number) {
    return this.padded.subarray(i * this.blockSize, (i + 1) * this.blockSize);
  }

  /** Полезная нагрузка символа `id` (всегда ровно blockSize байт). */
  symbol(id: number): Uint8Array {
    const idx = this.planner.indices(id);
    const out = new Uint8Array(this.blockSize);
    out.set(this.block(idx[0]));
    for (let i = 1; i < idx.length; i++) xorInto(out, this.block(idx[i]));
    return out;
  }
}

interface Pending {
  data: Uint8Array;
  unknown: number[];
  done: boolean;
}

/** Декодер «распутыванием» (peeling): принимает символы в любом порядке. */
export class FountainDecoder {
  readonly k: number;
  private readonly planner: SymbolPlanner;
  private readonly blocks: Uint8Array;
  private readonly known: Uint8Array;
  private readonly waiting: Pending[][];
  private readonly seen = new Set<number>();
  knownCount = 0;
  uniqueSymbols = 0;

  constructor(readonly dataLength: number, readonly blockSize: number) {
    this.k = Math.max(1, Math.ceil(dataLength / blockSize));
    this.planner = new SymbolPlanner(this.k);
    this.blocks = new Uint8Array(this.k * blockSize);
    this.known = new Uint8Array(this.k);
    this.waiting = Array.from({ length: this.k }, () => []);
  }

  get complete() {
    return this.knownCount === this.k;
  }

  isKnown(i: number) {
    return this.known[i] === 1;
  }

  private block(i: number) {
    return this.blocks.subarray(i * this.blockSize, (i + 1) * this.blockSize);
  }

  /** Добавить символ. Возвращает true, если он новый (не дубль). */
  add(id: number, payload: Uint8Array): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.uniqueSymbols++;
    if (this.complete) return true;

    const idx = this.planner.indices(id);
    const data = payload.slice(0, this.blockSize);
    const unknown: number[] = [];
    for (const i of idx) {
      if (this.known[i]) xorInto(data, this.block(i));
      else unknown.push(i);
    }
    if (unknown.length === 0) return true;
    if (unknown.length === 1) {
      this.resolve(unknown[0], data);
      return true;
    }
    const p: Pending = { data, unknown, done: false };
    for (const i of unknown) this.waiting[i].push(p);
    return true;
  }

  private resolve(first: number, firstData: Uint8Array) {
    const queue: [number, Uint8Array][] = [[first, firstData]];
    while (queue.length) {
      const [i, data] = queue.pop()!;
      if (this.known[i]) continue;
      this.block(i).set(data);
      this.known[i] = 1;
      this.knownCount++;
      const list = this.waiting[i];
      this.waiting[i] = [];
      for (const p of list) {
        if (p.done) continue;
        xorInto(p.data, this.block(i));
        p.unknown.splice(p.unknown.indexOf(i), 1);
        if (p.unknown.length <= 1) {
          p.done = true;
          if (p.unknown.length === 1) queue.push([p.unknown[0], p.data]);
        }
      }
    }
  }

  result(): Uint8Array {
    return this.blocks.slice(0, this.dataLength);
  }
}
