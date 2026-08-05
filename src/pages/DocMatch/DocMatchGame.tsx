// DocMatchGame.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import PageShell from "../../components/PageShell";
import "./DocMatch.css";

const BOARD_SIZE = 8;
const ICONS = ["📄", "📘", "📗", "📊", "📁", "🗃️"];

// --- Types ---
interface Tile {
  id: string;
  icon: string;
  row: number;
  col: number;
  isMatched: boolean;
  isSpecial?: boolean;
}

interface Particle {
  id: string;
  x: number;
  y: number;
  emoji: string;
  angle: number;
  speed: number;
  life: number;
}

// --- Constants ---
const LEVEL_TIME = 60;
const POINTS_PER_TILE = 10;
const COMBO_MULTIPLIER = 1.5;

// Прогрессия уровней: каждый следующий уровень требует в 1.5 раз больше очков
const getLevelTarget = (level: number): number => {
  return Math.floor(500 * Math.pow(1.5, level - 1));
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const createBoard = (): Tile[][] => {
  let board: Tile[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      board[r][c] = {
        id: generateId(),
        icon: ICONS[Math.floor(Math.random() * ICONS.length)],
        row: r,
        col: c,
        isMatched: false,
        isSpecial: false,
      };
    }
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      while (checkMatchesAt(board, r, c).length > 0) {
        board[r][c].icon = ICONS[Math.floor(Math.random() * ICONS.length)];
      }
    }
  }
  return board;
};

const checkMatchesAt = (board: Tile[][], r: number, c: number): string[] => {
  const matchedIds: string[] = [];
  const icon = board[r][c].icon;
  if (!icon) return matchedIds;

  if (
    c >= 2 &&
    board[r][c - 1].icon === icon &&
    board[r][c - 2].icon === icon
  ) {
    matchedIds.push(board[r][c].id, board[r][c - 1].id, board[r][c - 2].id);
  }
  if (
    r >= 2 &&
    board[r - 1][c].icon === icon &&
    board[r - 2][c].icon === icon
  ) {
    matchedIds.push(board[r][c].id, board[r - 1][c].id, board[r - 2][c].id);
  }
  return matchedIds;
};

const findAllMatches = (board: Tile[][]): Set<string> => {
  const matchedIds = new Set<string>();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const matches = checkMatchesAt(board, r, c);
      matches.forEach((id) => matchedIds.add(id));
    }
  }
  return matchedIds;
};

// --- Main Component ---
const DocMatchGame: React.FC = () => {
  const [board, setBoard] = useState<Tile[][]>(createBoard);
  const [selected, setSelected] = useState<Tile | null>(null);
  const [totalScore, setTotalScore] = useState(0); // Общий счёт за все уровни
  const [levelScore, setLevelScore] = useState(0); // Счёт текущего уровня (для прогресс-бара)
  const [moves, setMoves] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(LEVEL_TIME);
  const [level, setLevel] = useState(1);
  const [comboCount, setComboCount] = useState(0);
  const [showCombo, setShowCombo] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [hintsLeft, setHintsLeft] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [levelComplete, setLevelComplete] = useState(false);
  const [scorePopups, setScorePopups] = useState<
    { id: string; x: number; y: number; text: string }[]
  >([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const currentTarget = getLevelTarget(level);

  // --- Timer ---
  useEffect(() => {
    if (!gameOver && !levelComplete) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setGameOver(true);
            clearInterval(timerRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameOver, levelComplete, level]);

  // --- Particles Animation ---
  useEffect(() => {
    if (particles.length === 0) return;
    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .filter((p) => p.life > 0)
          .map((p) => ({
            ...p,
            x: p.x + Math.cos(p.angle) * p.speed,
            y: p.y + Math.sin(p.angle) * p.speed + 1,
            life: p.life - 0.02,
            speed: p.speed * 0.98,
          })),
      );
    }, 16);
    return () => clearInterval(interval);
  }, [particles]);

  const spawnParticles = (x: number, y: number, emoji: string) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < 8; i++) {
      newParticles.push({
        id: generateId(),
        x,
        y,
        emoji,
        angle: (Math.PI * 2 * i) / 8 + Math.random() * 0.5,
        speed: 2 + Math.random() * 3,
        life: 1,
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
  };

  const showScorePopup = (x: number, y: number, text: string) => {
    const id = generateId();
    setScorePopups((prev) => [...prev, { id, x, y, text }]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== id));
    }, 800);
  };

  // --- Process Matches with Combos ---
  const processBoard = useCallback(
    async (newBoard: Tile[][], currentCombo: number = 0) => {
      let currentBoard = newBoard.map((row) =>
        row.map((tile) => ({ ...tile })),
      );
      let matches = findAllMatches(currentBoard);

      if (matches.size === 0) {
        setComboCount(0);
        setShowCombo(false);
        return;
      }

      const newCombo = currentCombo + 1;
      setComboCount(newCombo);
      setShowCombo(true);

      const basePoints = matches.size * POINTS_PER_TILE;
      const comboBonus = Math.floor(
        basePoints * (COMBO_MULTIPLIER - 1) * (newCombo - 1),
      );
      const totalPoints = basePoints + comboBonus;
      const timeBonus = Math.min(newCombo * 2, 15);

      // Обновляем оба счётчика
      setLevelScore((prev) => prev + totalPoints);
      setTotalScore((prev) => prev + totalPoints);
      setTimeLeft((prev) => prev + timeBonus);

      const matchArray = Array.from(matches);
      const centerTile = currentBoard
        .flat()
        .find((t) => t.id === matchArray[Math.floor(matchArray.length / 2)]);

      if (centerTile && boardRef.current) {
        const tileElement = boardRef.current.querySelector(
          `[data-id="${centerTile.id}"]`,
        );
        if (tileElement) {
          const rect = tileElement.getBoundingClientRect();
          const boardRect = boardRef.current.getBoundingClientRect();
          spawnParticles(
            rect.left - boardRect.left + rect.width / 2,
            rect.top - boardRect.top + rect.height / 2,
            centerTile.icon,
          );
        }
      }

      const hasLongMatch = matchArray.length >= 4;

      currentBoard = currentBoard.map((row) =>
        row.map((tile) => ({
          ...tile,
          isMatched: matches.has(tile.id),
        })),
      );
      setBoard([...currentBoard]);

      if (newCombo > 1) {
        showScorePopup(
          (centerTile?.col ?? 4) * 60,
          (centerTile?.row ?? 4) * 60,
          `+${totalPoints} COMBO x${newCombo}!`,
        );
      } else {
        showScorePopup(
          (centerTile?.col ?? 4) * 60,
          (centerTile?.row ?? 4) * 60,
          `+${totalPoints}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 250));

      // Gravity
      for (let c = 0; c < BOARD_SIZE; c++) {
        let emptySpaces = 0;
        for (let r = BOARD_SIZE - 1; r >= 0; r--) {
          if (currentBoard[r][c].isMatched) {
            emptySpaces++;
          } else if (emptySpaces > 0) {
            currentBoard[r + emptySpaces][c] = {
              ...currentBoard[r][c],
              row: r + emptySpaces,
            };
            currentBoard[r][c] = {
              id: generateId(),
              icon: "",
              row: r,
              col: c,
              isMatched: false,
              isSpecial: false,
            };
          }
        }
        for (let r = 0; r < emptySpaces; r++) {
          currentBoard[r][c] = {
            id: generateId(),
            icon: ICONS[Math.floor(Math.random() * ICONS.length)],
            row: r,
            col: c,
            isMatched: false,
            isSpecial: Math.random() < (hasLongMatch ? 0.4 : 0.05),
          };
        }
      }

      setBoard([...currentBoard]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Проверяем завершение уровня (используем levelScore, который обновится асинхронно)
      // Поэтому проверим текущее значение + то, что добавили
      const newLevelScore = levelScore + totalPoints;
      if (newLevelScore >= currentTarget) {
        setLevelComplete(true);
        clearInterval(timerRef.current!);
        // Бонус за завершение уровня
        const bonusPoints = level * 100;
        setTotalScore((prev) => prev + bonusPoints);
        return;
      }

      await processBoard(currentBoard, newCombo);
    },
    [levelScore, currentTarget, level],
  );

  // --- Hint System ---
  const findHint = useCallback((): { tile1: Tile; tile2: Tile } | null => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (c < BOARD_SIZE - 1) {
          const testBoard = board.map((row) => row.map((t) => ({ ...t })));
          const temp = testBoard[r][c].icon;
          testBoard[r][c].icon = testBoard[r][c + 1].icon;
          testBoard[r][c + 1].icon = temp;
          if (findAllMatches(testBoard).size > 0) {
            return { tile1: board[r][c], tile2: board[r][c + 1] };
          }
        }
        if (r < BOARD_SIZE - 1) {
          const testBoard = board.map((row) => row.map((t) => ({ ...t })));
          const temp = testBoard[r][c].icon;
          testBoard[r][c].icon = testBoard[r + 1][c].icon;
          testBoard[r + 1][c].icon = temp;
          if (findAllMatches(testBoard).size > 0) {
            return { tile1: board[r][c], tile2: board[r + 1][c] };
          }
        }
      }
    }
    return null;
  }, [board]);

  const showHint = () => {
    if (hintsLeft <= 0 || isProcessing) return;
    const hint = findHint();
    if (hint) {
      setHintsLeft((prev) => prev - 1);
      setSelected(hint.tile1);
      setTimeout(() => {
        handleTileClick(hint.tile2);
      }, 500);
    }
  };

  // --- Handle Clicks ---
  const handleTileClick = async (tile: Tile) => {
    if (isProcessing || gameOver || levelComplete) return;

    if (!selected) {
      setSelected(tile);
      return;
    }

    if (selected.id === tile.id) {
      setSelected(null);
      return;
    }

    const isAdjacent =
      (Math.abs(selected.row - tile.row) === 1 && selected.col === tile.col) ||
      (Math.abs(selected.col - tile.col) === 1 && selected.row === tile.row);

    if (!isAdjacent) {
      setSelected(tile);
      return;
    }

    setIsProcessing(true);
    setMoves((prev) => prev + 1);

    const newBoard = board.map((row) => row.map((t) => ({ ...t })));
    const tempIcon = newBoard[selected.row][selected.col].icon;
    const tempSpecial = newBoard[selected.row][selected.col].isSpecial;

    newBoard[selected.row][selected.col].icon =
      newBoard[tile.row][tile.col].icon;
    newBoard[selected.row][selected.col].isSpecial =
      newBoard[tile.row][tile.col].isSpecial;
    newBoard[tile.row][tile.col].icon = tempIcon;
    newBoard[tile.row][tile.col].isSpecial = tempSpecial;

    const matches = findAllMatches(newBoard);

    if (matches.size === 0) {
      setTimeLeft((prev) => Math.max(0, prev - 5));
      setSelected(null);
      setIsProcessing(false);
      return;
    }

    setSelected(null);
    await processBoard(newBoard, 0);
    setIsProcessing(false);
  };

  // --- Level Progression ---
  const nextLevel = () => {
    const nextLvl = level + 1;
    setLevel(nextLvl);
    setLevelScore(0); // Сбрасываем счёт уровня!
    setTimeLeft(LEVEL_TIME + nextLvl * 3); // Немного больше времени на сложных уровнях
    setBoard(createBoard());
    setLevelComplete(false);
    setGameOver(false);
    setComboCount(0);
    setHintsLeft(3 + nextLvl); // Больше подсказок на высоких уровнях
    setMoves(0);
    setSelected(null);
    setParticles([]);
    setScorePopups([]);
  };

  const resetGame = () => {
    setBoard(createBoard());
    setTotalScore(0);
    setLevelScore(0);
    setMoves(0);
    setSelected(null);
    setIsProcessing(false);
    setTimeLeft(LEVEL_TIME);
    setLevel(1);
    setComboCount(0);
    setGameOver(false);
    setLevelComplete(false);
    setHintsLeft(3);
    setParticles([]);
    setScorePopups([]);
  };

  return (
    <PageShell
      title="Документный Три-в-Ряд 🎮"
      subtitle={`Уровень ${level}: собери ${currentTarget} очков!`}
      fill
    >

        <div className="game-layout">
          <div className="glass-card game-board-wrapper" ref={boardRef}>
            {/* Progress Bar - теперь показывает прогресс текущего уровня */}
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${Math.min(100, (levelScore / currentTarget) * 100)}%`,
                }}
              />
              <span className="progress-text">
                {levelScore} / {currentTarget}
              </span>
            </div>

            {/* Timer & Level */}
            <div className="game-header">
              <div className={`timer ${timeLeft <= 10 ? "timer-danger" : ""}`}>
                ⏱️ {timeLeft}s
              </div>
              <div className="level-badge">Уровень {level}</div>
              <div className="target-score">🎯 {currentTarget}</div>
            </div>

            {/* Game Board */}
            <div className="game-board">
              {board.map((row) =>
                row.map((tile) => (
                  <div
                    key={tile.id}
                    data-id={tile.id}
                    className={`
                      game-tile 
                      ${tile.isMatched ? "matched" : ""} 
                      ${selected?.id === tile.id ? "selected" : ""}
                      ${tile.isSpecial ? "special-tile" : ""}
                    `}
                    onClick={() => handleTileClick(tile)}
                  >
                    <span className="tile-icon">{tile.icon}</span>
                    {tile.isSpecial && <span className="special-glow"></span>}
                  </div>
                )),
              )}
              {particles.map((p) => (
                <div
                  key={p.id}
                  className="particle"
                  style={{
                    left: p.x,
                    top: p.y,
                    opacity: p.life,
                    transform: `scale(${p.life})`,
                  }}
                >
                  {p.emoji}
                </div>
              ))}
              {scorePopups.map((p) => (
                <div
                  key={p.id}
                  className="score-popup"
                  style={{ left: p.x, top: p.y }}
                >
                  {p.text}
                </div>
              ))}
            </div>

            {showCombo && comboCount > 1 && (
              <div className="combo-display">🔥 x{comboCount} КОМБО!</div>
            )}
          </div>

          {/* Sidebar */}
          <div className="game-sidebar">
            <div className="glass-card stats-card">
              <h3>Статистика</h3>
              <div className="stat-block">
                <span className="stat-label">Всего очков</span>
                <span className="stat-value-score">{totalScore}</span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Очки уровня</span>
                <span className="stat-value-level">
                  {levelScore} / {currentTarget}
                </span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Ходы</span>
                <span className="stat-value-moves">{moves}</span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Подсказки</span>
                <span className="stat-value-hints">{hintsLeft}</span>
              </div>
              <div className="stat-block">
                <span className="stat-label">Уровень</span>
                <span className="stat-value-level-num">{level}</span>
              </div>
            </div>

            <button
              onClick={showHint}
              disabled={hintsLeft <= 0 || isProcessing}
              className="glass-button hint-btn"
            >
              💡 Подсказка ({hintsLeft})
            </button>

            <button
              onClick={resetGame}
              className="glass-button primary reset-btn"
            >
              🔄 Начать заново
            </button>

            {gameOver && (
              <div className="modal-overlay">
                <div className="glass-card modal-content-game">
                  <h2>⏰ Время вышло!</h2>
                  <p>
                    Вы набрали {totalScore} очков и дошли до уровня {level}
                  </p>
                  <p className="level-progress-detail">
                    Прогресс уровня: {levelScore} / {currentTarget}(
                    {Math.floor((levelScore / currentTarget) * 100)}%)
                  </p>
                  <button onClick={resetGame} className="glass-button primary">
                    Попробовать снова
                  </button>
                </div>
              </div>
            )}

            {levelComplete && (
              <div className="modal-overlay">
                <div className="glass-card modal-content-game">
                  <h2>🎉 Уровень {level} пройден!</h2>
                  <p>
                    Собрано {levelScore} очков из {currentTarget}
                  </p>
                  <p className="next-level-info">
                    Следующая цель: {getLevelTarget(level + 1)} очков
                  </p>
                  <p className="bonus-info">+{level * 100} бонусных очков!</p>
                  <button onClick={nextLevel} className="glass-button primary">
                    Уровень {level + 1} ➡️
                  </button>
                </div>
              </div>
            )}

            <div className="glass-card legend-card">
              <h3>Легенда</h3>
              <div className="legend-item-game">
                <span>📄</span> PDF
              </div>
              <div className="legend-item-game">
                <span>📘</span> Word
              </div>
              <div className="legend-item-game">
                <span>📗</span> Excel
              </div>
              <div className="legend-item-game">
                <span>📊</span> PPT
              </div>
              <div className="legend-item-game">
                <span>📁</span> Папка
              </div>
              <div className="legend-item-game">
                <span>🗃️</span> Архив
              </div>
              <div className="legend-item-game special-legend">
                <span>✨</span> Спец. фишка
              </div>
            </div>
          </div>
        </div>
    </PageShell>
  );
};

export default DocMatchGame;
