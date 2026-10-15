// SnakeGame.tsx — «Змейка» в духе классической Nokia Snake II:
// змейка ест файлы и растёт, периодически появляются бонусы с таймером,
// уровни с лабиринтами и растущей скоростью, жизни и рекорд.
import React, { useCallback, useEffect, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import { useTheme } from "../../hooks/useTheme";
import "./SnakeGame.css";

// ─── Поле и правила ───
const COLS = 28;
const ROWS = 18;
const FILES_PER_LEVEL = 10; // сколько файлов съесть для перехода на уровень
const BONUS_EVERY = 5; // бонус появляется после каждых N съеденных файлов
const START_LIVES = 3;
const MAX_LIVES = 5;
const START_LENGTH = 4;
const SLOW_TICKS = 45; // длительность «замедления», в шагах змейки
const BEST_KEY = "snake-best";

const FILES = [
  { icon: "📄", label: "PDF" },
  { icon: "📘", label: "Word" },
  { icon: "📗", label: "Excel" },
  { icon: "📊", label: "PowerPoint" },
  { icon: "📁", label: "Папка" },
  { icon: "🗃️", label: "Архив" },
];

type BonusKind = "gem" | "slow" | "shrink" | "life";

const BONUSES: Record<
  BonusKind,
  { icon: string; label: string; desc: string; ttl: number }
> = {
  gem: { icon: "💎", label: "Премия", desc: "много очков — чем быстрее, тем больше", ttl: 40 },
  slow: { icon: "🐢", label: "Замедление", desc: "змейка временно ползёт медленнее", ttl: 45 },
  shrink: { icon: "✂️", label: "Архиватор", desc: "хвост короче на 3 звена", ttl: 45 },
  life: { icon: "❤️", label: "Жизнь", desc: "+1 жизнь (не больше 5)", ttl: 35 },
};

const DIFFICULTIES = [
  { id: "easy", label: "Спокойно", factor: 1.3 },
  { id: "normal", label: "Классика", factor: 1 },
  { id: "hard", label: "Турбо", factor: 0.72 },
] as const;
type DifficultyId = (typeof DIFFICULTIES)[number]["id"];

// ─── Типы ───
type Pt = { x: number; y: number };
type Dir = "up" | "down" | "left" | "right";
type Status = "ready" | "playing" | "paused" | "crashed" | "levelup" | "gameover";

interface Maze {
  name: string;
  wrap: boolean; // змейка проходит сквозь края поля
  walls: Pt[];
}

interface Bonus {
  pos: Pt;
  kind: BonusKind;
  ttl: number;
  maxTtl: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number; // мс
}

interface Game {
  snake: Pt[]; // [0] — голова
  dir: Dir;
  queue: Dir[];
  grow: number;
  food: { pos: Pt; icon: string };
  bonus: Bonus | null;
  maze: Maze;
  wallSet: Set<number>;
  level: number;
  score: number;
  lives: number;
  eaten: number; // файлов на текущем уровне
  sinceBonus: number;
  slowTicks: number;
  popups: Popup[];
  flash: number; // мс красной вспышки после столкновения
}

interface Hud {
  score: number;
  level: number;
  lives: number;
  eaten: number;
  length: number;
  slow: boolean;
  mazeName: string;
}

const DELTA: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

const key = (p: Pt) => p.y * COLS + p.x;
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

// ─── Лабиринты (повторяются по кругу, скорость растёт) ───
// Стартовая полоса змейки (строка 9, x 2…16) во всех лабиринтах свободна.
function hLine(y: number, x1: number, x2: number): Pt[] {
  const out: Pt[] = [];
  for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}
function vLine(x: number, y1: number, y2: number): Pt[] {
  const out: Pt[] = [];
  for (let y = y1; y <= y2; y++) out.push({ x, y });
  return out;
}
function border(): Pt[] {
  return [
    ...hLine(0, 0, COLS - 1),
    ...hLine(ROWS - 1, 0, COLS - 1),
    ...vLine(0, 1, ROWS - 2),
    ...vLine(COLS - 1, 1, ROWS - 2),
  ];
}
/** Отражение точек по горизонтали/вертикали — для симметричных лабиринтов. */
function mirror4(pts: Pt[]): Pt[] {
  return pts.flatMap((p) => [
    p,
    { x: COLS - 1 - p.x, y: p.y },
    { x: p.x, y: ROWS - 1 - p.y },
    { x: COLS - 1 - p.x, y: ROWS - 1 - p.y },
  ]);
}

const MAZES: (() => Maze)[] = [
  () => ({ name: "Открытое поле", wrap: true, walls: [] }),
  () => ({ name: "Коробка", wrap: false, walls: border() }),
  () => ({
    name: "Полки",
    wrap: true,
    walls: [...hLine(4, 6, 21), ...hLine(13, 6, 21)],
  }),
  () => ({
    name: "Папки",
    wrap: false,
    walls: [...border(), ...vLine(19, 4, 13), ...hLine(4, 4, 14), ...hLine(13, 4, 14)],
  }),
  () => ({
    name: "Углы",
    wrap: true,
    walls: mirror4([...hLine(3, 5, 10), ...vLine(5, 4, 6)]),
  }),
  () => ({
    name: "Колонны",
    wrap: false,
    walls: [
      ...border(),
      ...[6, 13, 20].flatMap((x) =>
        [4, 12].flatMap((y) => [
          { x, y },
          { x: x + 1, y },
          { x, y: y + 1 },
          { x: x + 1, y: y + 1 },
        ]),
      ),
    ],
  }),
];

function buildMaze(level: number): Maze {
  return MAZES[(level - 1) % MAZES.length]();
}

/** Базовая длительность шага, мс: каждый уровень чуть быстрее. */
function baseTick(level: number) {
  return Math.max(55, 140 - (level - 1) * 9);
}

// ─── Логика ───
function randomFreeCell(g: Game): Pt | null {
  const busy = new Set<number>(g.wallSet);
  g.snake.forEach((p) => busy.add(key(p)));
  if (g.food) busy.add(key(g.food.pos));
  if (g.bonus) busy.add(key(g.bonus.pos));
  // не кладём еду вплотную перед головой
  const head = g.snake[0];
  if (head) {
    const d = DELTA[g.dir];
    busy.add(key({ x: (head.x + d.x + COLS) % COLS, y: (head.y + d.y + ROWS) % ROWS }));
  }
  const free: Pt[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) if (!busy.has(y * COLS + x)) free.push({ x, y });
  return free.length ? free[(Math.random() * free.length) | 0] : null;
}

function placeFood(g: Game) {
  const pos = randomFreeCell(g) ?? { x: 0, y: 0 };
  g.food = { pos, icon: FILES[(Math.random() * FILES.length) | 0].icon };
}

function resetSnake(g: Game) {
  const y = 9;
  g.snake = Array.from({ length: START_LENGTH }, (_, i) => ({ x: 8 - i, y }));
  g.dir = "right";
  g.queue = [];
  g.grow = 0;
  g.slowTicks = 0;
  if (g.food && g.snake.some((p) => same(p, g.food.pos))) placeFood(g);
}

function setupLevel(g: Game, level: number) {
  g.level = level;
  g.maze = buildMaze(level);
  g.wallSet = new Set(g.maze.walls.map(key));
  g.eaten = 0;
  g.sinceBonus = 0;
  g.bonus = null;
  g.popups = [];
  g.flash = 0;
  g.snake = [];
  resetSnake(g);
  placeFood(g);
}

function newGame(): Game {
  const g = {
    score: 0,
    lives: START_LIVES,
  } as Game;
  setupLevel(g, 1);
  return g;
}

function addPopup(g: Game, p: Pt, text: string, color: string) {
  g.popups.push({ x: p.x + 0.5, y: p.y, text, color, life: 900 });
}

function spawnBonus(g: Game) {
  const kinds: BonusKind[] = ["gem", "gem", "slow", "shrink"];
  if (g.lives < MAX_LIVES) kinds.push("life");
  const kind = kinds[(Math.random() * kinds.length) | 0];
  const pos = randomFreeCell(g);
  if (!pos) return;
  const ttl = BONUSES[kind].ttl;
  g.bonus = { pos, kind, ttl, maxTtl: ttl };
}

type StepResult = "none" | "crash" | "levelup" | "update";

/** Один шаг змейки. Возвращает, что произошло (для обновления HUD/статуса). */
function step(g: Game): StepResult {
  // берём следующий поворот из очереди (без разворота на 180°)
  while (g.queue.length) {
    const d = g.queue.shift()!;
    if (d !== g.dir && d !== OPPOSITE[g.dir]) {
      g.dir = d;
      break;
    }
  }

  const head = g.snake[0];
  const d = DELTA[g.dir];
  let nx = head.x + d.x;
  let ny = head.y + d.y;
  if (g.maze.wrap) {
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
  } else if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
    return "crash";
  }
  const next = { x: nx, y: ny };
  if (g.wallSet.has(key(next))) return "crash";

  // хвост освобождает клетку в этом же шаге, если змейка не растёт
  const bodyToCheck = g.grow > 0 ? g.snake : g.snake.slice(0, -1);
  if (bodyToCheck.some((p) => same(p, next))) return "crash";

  g.snake.unshift(next);
  if (g.grow > 0) g.grow -= 1;
  else g.snake.pop();

  let result: StepResult = "none";
  if (g.slowTicks > 0) {
    g.slowTicks -= 1;
    if (g.slowTicks === 0) result = "update";
  }

  // бонус тикает и исчезает
  if (g.bonus) {
    g.bonus.ttl -= 1;
    if (g.bonus.ttl <= 0) g.bonus = null;
  }

  // съели файл
  if (same(next, g.food.pos)) {
    const pts = 10 * g.level;
    g.score += pts;
    g.grow += 1;
    g.eaten += 1;
    g.sinceBonus += 1;
    addPopup(g, next, `+${pts}`, "#22c55e");
    if (g.eaten >= FILES_PER_LEVEL) {
      const levelBonus = 100 * g.level;
      g.score += levelBonus;
      return "levelup";
    }
    placeFood(g);
    if (g.sinceBonus >= BONUS_EVERY && !g.bonus) {
      g.sinceBonus = 0;
      spawnBonus(g);
    }
    result = "update";
  }

  // съели бонус
  if (g.bonus && same(next, g.bonus.pos)) {
    const b = g.bonus;
    g.bonus = null;
    switch (b.kind) {
      case "gem": {
        const pts = Math.max(10, Math.round((50 + 25 * g.level) * (b.ttl / b.maxTtl))) * 2;
        g.score += pts;
        addPopup(g, next, `💎 +${pts}`, "#f59e0b");
        break;
      }
      case "slow":
        g.slowTicks = SLOW_TICKS;
        g.score += 5 * g.level;
        addPopup(g, next, "🐢 медленнее", "#14b8a6");
        break;
      case "shrink": {
        const cut = Math.min(3, Math.max(0, g.snake.length - 3));
        g.snake.splice(g.snake.length - cut, cut);
        g.score += 15 * g.level;
        addPopup(g, next, `✂️ −${cut}`, "#a855f7");
        break;
      }
      case "life":
        g.lives = Math.min(MAX_LIVES, g.lives + 1);
        addPopup(g, next, "❤️ +1", "#ef4444");
        break;
    }
    result = "update";
  }

  return result;
}

function tickMs(g: Game, factor: number) {
  return baseTick(g.level) * factor * (g.slowTicks > 0 ? 1.7 : 1);
}

function hudOf(g: Game): Hud {
  return {
    score: g.score,
    level: g.level,
    lives: g.lives,
    eaten: g.eaten,
    length: g.snake.length,
    slow: g.slowTicks > 0,
    mazeName: g.maze.name,
  };
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* хранилище недоступно — рекорд живёт до перезагрузки */
  }
}

// ─── Отрисовка ───
type Palette = {
  bg: string;
  bgAlt: string;
  wall: string;
  wallTop: string;
  snake: string[];
  eye: string;
  pupil: string;
  foodGlow: string;
  ring: string;
};

const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#f5f7fc",
    bgAlt: "#edf0f8",
    wall: "#3b4252",
    wallTop: "#58627a",
    snake: ["#0087cd", "#515dad", "#8253aa", "#ff1c77"],
    eye: "#ffffff",
    pupil: "#111827",
    foodGlow: "rgba(0, 135, 205, 0.14)",
    ring: "#f59e0b",
  },
  dark: {
    bg: "#141722",
    bgAlt: "#181c29",
    wall: "#4b5368",
    wallTop: "#6b7590",
    snake: ["#38b6ff", "#7b86e0", "#a77bd6", "#ff4f95"],
    eye: "#ffffff",
    pupil: "#0b0d14",
    foodGlow: "rgba(56, 182, 255, 0.16)",
    ring: "#fbbf24",
  },
};

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Цвет вдоль градиента палитры, t ∈ [0, 1]. */
function gradientAt(stops: string[], t: number) {
  const pos = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEmoji(ctx: CanvasRenderingContext2D, icon: string, cx: number, cy: number, size: number) {
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // цветные эмодзи берут прозрачность из fillStyle — задаём непрозрачный
  ctx.fillStyle = "#000";
  ctx.fillText(icon, cx, cy + size * 0.06);
}

function draw(
  ctx: CanvasRenderingContext2D,
  g: Game,
  cell: number,
  pal: Palette,
  now: number,
) {
  const W = COLS * cell;
  const H = ROWS * cell;

  // фон «в клетку»
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = pal.bgAlt;
  for (let y = 0; y < ROWS; y++)
    for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);

  // стены
  for (const w of g.maze.walls) {
    const x = w.x * cell;
    const y = w.y * cell;
    ctx.fillStyle = pal.wall;
    roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, cell * 0.18);
    ctx.fill();
    ctx.fillStyle = pal.wallTop;
    roundRect(ctx, x + 2, y + 2, cell - 4, (cell - 4) * 0.45, cell * 0.14);
    ctx.fill();
  }

  // еда-файл (покачивается)
  const fx = (g.food.pos.x + 0.5) * cell;
  const fy = (g.food.pos.y + 0.5) * cell + Math.sin(now / 260) * cell * 0.06;
  ctx.fillStyle = pal.foodGlow;
  ctx.beginPath();
  ctx.arc(fx, (g.food.pos.y + 0.5) * cell, cell * 0.48, 0, Math.PI * 2);
  ctx.fill();
  drawEmoji(ctx, g.food.icon, fx, fy, cell * 0.8);

  // бонус: пульсирует, кольцо показывает оставшееся время
  if (g.bonus) {
    const b = g.bonus;
    const bx = (b.pos.x + 0.5) * cell;
    const by = (b.pos.y + 0.5) * cell;
    const pulse = 1 + Math.sin(now / 140) * 0.08;
    const left = b.ttl / b.maxTtl;
    const blinking = left < 0.3 && Math.floor(now / 120) % 2 === 0;
    ctx.strokeStyle = pal.ring;
    ctx.lineWidth = Math.max(2, cell * 0.09);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(bx, by, cell * 0.56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.stroke();
    if (!blinking) drawEmoji(ctx, BONUSES[b.kind].icon, bx, by, cell * 0.78 * pulse);
  }

  // змейка: линия от центра к центру соседних звеньев, цвет — фирменный градиент
  const n = g.snake.length;
  ctx.lineCap = "round";
  ctx.lineWidth = cell * 0.74;
  for (let i = n - 1; i > 0; i--) {
    const a = g.snake[i];
    const b = g.snake[i - 1];
    const color = gradientAt(pal.snake, i / Math.max(1, n - 1));
    const ax = (a.x + 0.5) * cell;
    const ay = (a.y + 0.5) * cell;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
      ctx.stroke();
    } else {
      // переход через край поля — рисуем звено отдельно
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ax, ay, cell * 0.37, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // голова
  const head = g.snake[0];
  const hx = (head.x + 0.5) * cell;
  const hy = (head.y + 0.5) * cell;
  ctx.fillStyle = pal.snake[0];
  ctx.beginPath();
  ctx.arc(hx, hy, cell * 0.46, 0, Math.PI * 2);
  ctx.fill();
  const d = DELTA[g.dir];
  const px = -d.y; // перпендикуляр к направлению
  const py = d.x;
  for (const s of [-1, 1]) {
    const ex = hx + d.x * cell * 0.14 + px * s * cell * 0.2;
    const ey = hy + d.y * cell * 0.14 + py * s * cell * 0.2;
    ctx.fillStyle = pal.eye;
    ctx.beginPath();
    ctx.arc(ex, ey, cell * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.pupil;
    ctx.beginPath();
    ctx.arc(ex + d.x * cell * 0.05, ey + d.y * cell * 0.05, cell * 0.065, 0, Math.PI * 2);
    ctx.fill();
  }

  // всплывающие очки
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of g.popups) {
    const t = p.life / 900;
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.font = `700 ${Math.round(cell * 0.62)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x * cell, (p.y - (1 - t) * 1.6) * cell);
  }
  ctx.globalAlpha = 1;

  // вспышка при столкновении
  if (g.flash > 0) {
    ctx.fillStyle = `rgba(239, 68, 68, ${(g.flash / 500) * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ─── Компонент ───
const SnakeGame: React.FC = () => {
  const [theme] = useTheme();
  const [status, setStatusState] = useState<Status>("ready");
  const [difficulty, setDifficulty] = useState<DifficultyId>(() => {
    try {
      const saved = localStorage.getItem("snake-difficulty");
      return DIFFICULTIES.some((d) => d.id === saved) ? (saved as DifficultyId) : "normal";
    } catch {
      return "normal";
    }
  });
  const [best, setBest] = useState<number>(readBest);
  const [isRecord, setIsRecord] = useState(false);

  const [initialGame] = useState(newGame);
  const gameRef = useRef<Game>(initialGame);
  const [hud, setHud] = useState<Hud>(() => hudOf(initialGame));
  const statusRef = useRef<Status>("ready");
  const factorRef = useRef<number>(1);
  const paletteRef = useRef<Palette>(PALETTES.light);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<number>(24);
  const [cell, setCell] = useState(24);

  useEffect(() => {
    paletteRef.current = PALETTES[theme];
  }, [theme]);

  useEffect(() => {
    factorRef.current = DIFFICULTIES.find((d) => d.id === difficulty)!.factor;
    try {
      localStorage.setItem("snake-difficulty", difficulty);
    } catch {
      /* не критично */
    }
  }, [difficulty]);

  const setStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const syncHud = useCallback(() => setHud(hudOf(gameRef.current)), []);

  // ─── Действия ───
  const startGame = useCallback(() => {
    gameRef.current = newGame();
    setIsRecord(false);
    syncHud();
    setStatus("playing");
  }, [setStatus, syncHud]);

  const continueAfterCrash = useCallback(() => {
    resetSnake(gameRef.current);
    gameRef.current.bonus = null;
    syncHud();
    setStatus("playing");
  }, [setStatus, syncHud]);

  const nextLevel = useCallback(() => {
    const g = gameRef.current;
    setupLevel(g, g.level + 1);
    syncHud();
    setStatus("playing");
  }, [setStatus, syncHud]);

  const primaryAction = useCallback(() => {
    switch (statusRef.current) {
      case "ready":
      case "gameover":
        startGame();
        break;
      case "crashed":
        continueAfterCrash();
        break;
      case "levelup":
        nextLevel();
        break;
      case "playing":
        setStatus("paused");
        break;
      case "paused":
        setStatus("playing");
        break;
    }
  }, [startGame, continueAfterCrash, nextLevel, setStatus]);

  const turn = useCallback(
    (d: Dir) => {
      const s = statusRef.current;
      if (s === "ready") startGame();
      else if (s === "paused") setStatus("playing");
      else if (s !== "playing") return;
      const g = gameRef.current;
      const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
      if (d === last || d === OPPOSITE[last]) return;
      if (g.queue.length < 3) g.queue.push(d);
    },
    [startGame, setStatus],
  );

  // ─── Клавиатура ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        KeyW: "up",
        ArrowDown: "down",
        KeyS: "down",
        ArrowLeft: "left",
        KeyA: "left",
        ArrowRight: "right",
        KeyD: "right",
      };
      const d = map[e.code];
      if (d) {
        e.preventDefault();
        turn(d);
        return;
      }
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        primaryAction();
      } else if (e.code === "KeyP" || e.code === "Escape") {
        if (statusRef.current === "playing") setStatus("paused");
        else if (statusRef.current === "paused") setStatus("playing");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, primaryAction, setStatus]);

  // ─── Свайпы на сенсорных экранах ───
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    swipeRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? "right" : "left");
    else turn(dy > 0 ? "down" : "up");
  };

  // Автопауза, если вкладку скрыли
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && statusRef.current === "playing") setStatus("paused");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [setStatus]);

  // ─── Размер поля под контейнер ───
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const maxH = Math.max(r.height, 200);
      const c = Math.max(12, Math.floor(Math.min(r.width / COLS, maxH / ROWS)));
      cellRef.current = c;
      setCell(c);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = COLS * cell * dpr;
    canvas.height = ROWS * cell * dpr;
    canvas.style.width = `${COLS * cell}px`;
    canvas.style.height = `${ROWS * cell}px`;
  }, [cell]);

  // ─── Игровой цикл ───
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      const dt = Math.min(now - last, 250);
      last = now;
      const g = gameRef.current;

      if (statusRef.current === "playing") {
        acc += dt;
        let changed = false;
        while (statusRef.current === "playing") {
          const t = tickMs(g, factorRef.current);
          if (acc < t) break;
          acc -= t;
          const res = step(g);
          if (res === "crash") {
            g.lives -= 1;
            g.flash = 500;
            if (g.lives <= 0) {
              const prevBest = readBest();
              if (g.score > prevBest) {
                writeBest(g.score);
                setBest(g.score);
                setIsRecord(true);
              }
              setStatus("gameover");
            } else {
              setStatus("crashed");
            }
            changed = true;
          } else if (res === "levelup") {
            if (g.score > readBest()) {
              writeBest(g.score);
              setBest(g.score);
            }
            setStatus("levelup");
            changed = true;
          } else if (res === "update") {
            changed = true;
          }
        }
        if (changed) setHud(hudOf(g));
      } else {
        acc = 0;
      }

      // анимации всплывающих надписей и вспышки идут всегда
      if (g.popups.length) {
        g.popups.forEach((p) => (p.life -= dt));
        g.popups = g.popups.filter((p) => p.life > 0);
      }
      if (g.flash > 0) g.flash = Math.max(0, g.flash - dt);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const dpr = canvas.width / (COLS * cellRef.current) || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(ctx, g, cellRef.current, paletteRef.current, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [setStatus]);

  const canChangeDifficulty = status === "ready" || status === "gameover";
  const hearts = Array.from({ length: MAX_LIVES }, (_, i) => i < hud.lives);

  return (
    <PageShell
      title="Змейка 🐍"
      subtitle="Собирай файлы, лови бонусы и проходи уровни"
      fill
      width="100%"
    >
      <div className="snake-layout">
        <div className="glass-card snake-board">
          <div className="snake-hud">
            <div className="snake-hud__item">
              <span className="snake-hud__label">Очки</span>
              <span className="snake-hud__value">{hud.score}</span>
            </div>
            <div className="snake-hud__item">
              <span className="snake-hud__label">Уровень {hud.level}</span>
              <span className="snake-hud__value snake-hud__value--small">{hud.mazeName}</span>
            </div>
            <div className="snake-hud__progress" title="Файлов до следующего уровня">
              <div
                className="snake-hud__progress-fill"
                style={{ width: `${(hud.eaten / FILES_PER_LEVEL) * 100}%` }}
              />
              <span className="snake-hud__progress-text">
                📂 {hud.eaten} / {FILES_PER_LEVEL}
              </span>
            </div>
            <div className="snake-hud__lives" aria-label={`Жизни: ${hud.lives}`}>
              {hearts.map((on, i) => (
                <span key={i} className={on ? "" : "is-off"}>
                  ❤️
                </span>
              ))}
            </div>
            {hud.slow && <span className="snake-chip">🐢 замедление</span>}
          </div>

          <div ref={stageRef} className="snake-stage">
            <div className="snake-canvas-wrap" style={{ width: COLS * cell, height: ROWS * cell }}>
              <canvas
                ref={canvasRef}
                className="snake-canvas"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
              />

              {status !== "playing" && (
                <div className="snake-overlay">
                  <div className="snake-overlay__card">
                    {status === "ready" && (
                      <>
                        <div className="snake-overlay__icon">🐍</div>
                        <h2>Змейка</h2>
                        <p>
                          Съешьте {FILES_PER_LEVEL} файлов, чтобы пройти уровень. Не врезайтесь
                          в стены и в собственный хвост!
                        </p>
                        <button className="snake-btn snake-btn--primary" onClick={startGame}>
                          ▶ Играть
                        </button>
                        <p className="snake-overlay__hint">Пробел или стрелки — старт</p>
                      </>
                    )}
                    {status === "paused" && (
                      <>
                        <div className="snake-overlay__icon">⏸</div>
                        <h2>Пауза</h2>
                        <button className="snake-btn snake-btn--primary" onClick={primaryAction}>
                          ▶ Продолжить
                        </button>
                        <p className="snake-overlay__hint">Пробел, P или Esc</p>
                      </>
                    )}
                    {status === "crashed" && (
                      <>
                        <div className="snake-overlay__icon">💥</div>
                        <h2>Ой! Столкновение</h2>
                        <p>
                          Осталось жизней: <b>{hud.lives}</b>
                        </p>
                        <button className="snake-btn snake-btn--primary" onClick={primaryAction}>
                          Продолжить
                        </button>
                      </>
                    )}
                    {status === "levelup" && (
                      <>
                        <div className="snake-overlay__icon">🎉</div>
                        <h2>Уровень {hud.level} пройден!</h2>
                        <p>
                          Бонус за уровень: <b>+{100 * hud.level}</b>
                          <br />
                          Дальше: «{buildMaze(hud.level + 1).name}», скорость выше
                        </p>
                        <button className="snake-btn snake-btn--primary" onClick={primaryAction}>
                          Уровень {hud.level + 1} ➡️
                        </button>
                      </>
                    )}
                    {status === "gameover" && (
                      <>
                        <div className="snake-overlay__icon">{isRecord ? "🏆" : "🪦"}</div>
                        <h2>{isRecord ? "Новый рекорд!" : "Игра окончена"}</h2>
                        <p>
                          Очки: <b>{hud.score}</b> · уровень {hud.level}
                          <br />
                          Рекорд: {best}
                        </p>
                        <button className="snake-btn snake-btn--primary" onClick={startGame}>
                          🔄 Сыграть ещё
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Экранный джойстик для телефонов и планшетов */}
          <div className="snake-pad" aria-label="Управление">
            <button className="snake-pad__btn snake-pad__up" onClick={() => turn("up")} aria-label="Вверх">
              ▲
            </button>
            <button className="snake-pad__btn snake-pad__left" onClick={() => turn("left")} aria-label="Влево">
              ◀
            </button>
            <button className="snake-pad__btn snake-pad__mid" onClick={primaryAction} aria-label="Пауза / старт">
              {status === "playing" ? "⏸" : "▶"}
            </button>
            <button className="snake-pad__btn snake-pad__right" onClick={() => turn("right")} aria-label="Вправо">
              ▶
            </button>
            <button className="snake-pad__btn snake-pad__down" onClick={() => turn("down")} aria-label="Вниз">
              ▼
            </button>
          </div>
        </div>

        <aside className="snake-sidebar">
          <div className="glass-card snake-card">
            <h3>Статистика</h3>
            <div className="snake-stat">
              <span>Рекорд</span>
              <b>🏆 {best}</b>
            </div>
            <div className="snake-stat">
              <span>Длина змейки</span>
              <b>{hud.length}</b>
            </div>
            <div className="snake-stat">
              <span>Очков за файл</span>
              <b>{10 * hud.level}</b>
            </div>
          </div>

          <div className="glass-card snake-card">
            <h3>Скорость</h3>
            <div className="snake-seg" role="radiogroup" aria-label="Скорость">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={difficulty === d.id}
                  className={difficulty === d.id ? "is-active" : ""}
                  disabled={!canChangeDifficulty}
                  onClick={() => setDifficulty(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {!canChangeDifficulty && (
              <p className="snake-muted">Меняется перед началом игры</p>
            )}
          </div>

          <div className="snake-actions">
            <button
              className="snake-btn"
              onClick={primaryAction}
              disabled={status === "crashed" || status === "levelup"}
            >
              {status === "playing" ? "⏸ Пауза" : status === "paused" ? "▶ Продолжить" : "▶ Старт"}
            </button>
            <button className="snake-btn snake-btn--primary" onClick={startGame}>
              🔄 Заново
            </button>
          </div>

          <div className="glass-card snake-card">
            <h3>Еда</h3>
            <div className="snake-legend snake-legend--files">
              {FILES.map((f) => (
                <span key={f.icon} title={f.label}>
                  {f.icon}
                </span>
              ))}
            </div>
            <p className="snake-muted">Каждый файл: +1 звено и очки</p>
            <h3 className="snake-card__sub">Бонусы</h3>
            {(Object.keys(BONUSES) as BonusKind[]).map((k) => (
              <div key={k} className="snake-legend__row">
                <span className="snake-legend__icon">{BONUSES[k].icon}</span>
                <span>
                  <b>{BONUSES[k].label}</b> — {BONUSES[k].desc}
                </span>
              </div>
            ))}
            <p className="snake-muted">
              Бонус появляется после каждых {BONUS_EVERY} файлов и исчезает, когда кольцо
              таймера закончится.
            </p>
          </div>

          <div className="glass-card snake-card">
            <h3>Управление</h3>
            <p className="snake-muted">
              <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> или <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> — поворот
              <br />
              <kbd>Пробел</kbd> — старт / пауза
              <br />
              На телефоне — свайпы или кнопки под полем
            </p>
          </div>
        </aside>
      </div>
    </PageShell>
  );
};

export default SnakeGame;
