import React, { useRef, useState, useCallback } from "react";
import type { CanvasTool, DrawingPath, TextAnnotation } from "../types";

interface Props {
  tool: CanvasTool;
  drawColor: string;
  drawWidth: number;
  drawOpacity: number;
  paths: DrawingPath[];
  texts: TextAnnotation[];
  onPathsChange: (p: DrawingPath[]) => void;
  onTextsChange: (t: TextAnnotation[]) => void;
  canvasWidth: number;
  canvasHeight: number;
}

const DrawingLayer: React.FC<Props> = ({
  tool,
  drawColor,
  drawWidth,
  drawOpacity,
  paths,
  texts,
  onPathsChange,
  onTextsChange,
  canvasWidth,
  canvasHeight,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<
    { x: number; y: number }[]
  >([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [dragText, setDragText] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Ключевое исправление: правильный расчёт координат
  // Учитываем все трансформации (scale) через getScreenCTM
  const getPos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };

      // Используем SVG coordinate system для точного позиционирования
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;

      const ctm = svg.getScreenCTM();
      if (ctm) {
        const svgPoint = pt.matrixTransform(ctm.inverse());
        return { x: svgPoint.x, y: svgPoint.y };
      }

      // Fallback: ручной расчёт через getBoundingClientRect
      const rect = svg.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [canvasWidth, canvasHeight],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool === "select") return;

      const pos = getPos(e);

      if (tool === "text") {
        const id = `text-${Date.now()}`;
        const newText: TextAnnotation = {
          id,
          x: pos.x,
          y: pos.y,
          text: "Текст",
          fontSize: 16,
          fontWeight: "normal",
          color: drawColor,
          backgroundColor: "transparent",
          isEditing: true,
          rotation: 0,
          width: 200,
        };
        onTextsChange([...texts, newText]);
        setEditingTextId(id);
        return;
      }

      if (tool === "eraser") {
        const hitPath = findPathAtPoint(pos.x, pos.y);
        if (hitPath) onPathsChange(paths.filter((p) => p.id !== hitPath));
        return;
      }

      setDrawing(true);
      setCurrentPoints([pos]);
    },
    [tool, getPos, drawColor, texts, paths, onPathsChange, onTextsChange],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragText) {
        const pos = getPos(e);
        onTextsChange(
          texts.map((t) =>
            t.id === dragText.id
              ? {
                  ...t,
                  x: pos.x - dragText.offsetX,
                  y: pos.y - dragText.offsetY,
                }
              : t,
          ),
        );
        return;
      }
      if (!drawing) return;
      const pos = getPos(e);
      setCurrentPoints((p) => [...p, pos]);
    },
    [drawing, getPos, dragText, texts, onTextsChange],
  );

  const handleMouseUp = useCallback(() => {
    if (dragText) {
      setDragText(null);
      return;
    }
    if (!drawing || currentPoints.length < 2) {
      setDrawing(false);
      setCurrentPoints([]);
      return;
    }

    const type =
      tool === "arrow"
        ? ("arrow" as const)
        : tool === "rect"
          ? ("rect" as const)
          : ("freehand" as const);

    const newPath: DrawingPath = {
      id: `path-${Date.now()}`,
      type,
      points: currentPoints,
      color: drawColor,
      width: drawWidth,
      opacity: drawOpacity,
    };

    onPathsChange([...paths, newPath]);
    setDrawing(false);
    setCurrentPoints([]);
  }, [
    drawing,
    currentPoints,
    tool,
    drawColor,
    drawWidth,
    drawOpacity,
    paths,
    onPathsChange,
    dragText,
  ]);

  const findPathAtPoint = (x: number, y: number): string | null => {
    for (const p of [...paths].reverse()) {
      for (const pt of p.points) {
        if (Math.abs(pt.x - x) < 15 && Math.abs(pt.y - y) < 15) return p.id;
      }
    }
    return null;
  };

  const pointsToPath = (pts: { x: number; y: number }[]): string => {
    if (pts.length < 2) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  };

  const renderPath = (path: DrawingPath) => {
    if (path.type === "rect" && path.points.length >= 2) {
      const f = path.points[0];
      const l = path.points[path.points.length - 1];
      return (
        <rect
          key={path.id}
          x={Math.min(f.x, l.x)}
          y={Math.min(f.y, l.y)}
          width={Math.abs(l.x - f.x)}
          height={Math.abs(l.y - f.y)}
          stroke={path.color}
          strokeWidth={path.width}
          fill="none"
          opacity={path.opacity}
        />
      );
    }
    if (path.type === "arrow" && path.points.length >= 2) {
      const l = path.points[path.points.length - 1];
      const p = path.points[Math.max(0, path.points.length - 5)];
      const angle = Math.atan2(l.y - p.y, l.x - p.x);
      const headLen = 14;
      return (
        <g key={path.id} opacity={path.opacity}>
          <path
            d={pointsToPath(path.points)}
            stroke={path.color}
            strokeWidth={path.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points={`${l.x},${l.y} ${l.x - headLen * Math.cos(angle - 0.4)},${l.y - headLen * Math.sin(angle - 0.4)} ${l.x - headLen * Math.cos(angle + 0.4)},${l.y - headLen * Math.sin(angle + 0.4)}`}
            fill={path.color}
          />
        </g>
      );
    }
    return (
      <path
        key={path.id}
        d={pointsToPath(path.points)}
        stroke={path.color}
        strokeWidth={path.width}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={path.opacity}
      />
    );
  };

  const renderCurrentDrawing = () => {
    if (!drawing || currentPoints.length < 2) return null;
    if (tool === "rect") {
      const f = currentPoints[0];
      const l = currentPoints[currentPoints.length - 1];
      return (
        <rect
          x={Math.min(f.x, l.x)}
          y={Math.min(f.y, l.y)}
          width={Math.abs(l.x - f.x)}
          height={Math.abs(l.y - f.y)}
          stroke={drawColor}
          strokeWidth={drawWidth}
          fill="none"
          opacity={drawOpacity}
          strokeDasharray="4"
        />
      );
    }
    return (
      <path
        d={pointsToPath(currentPoints)}
        stroke={drawColor}
        strokeWidth={drawWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={drawOpacity}
      />
    );
  };

  const handleTextChange = (id: string, text: string) => {
    onTextsChange(texts.map((t) => (t.id === id ? { ...t, text } : t)));
  };

  const handleTextBlur = (id: string) => {
    setEditingTextId(null);
    onTextsChange(
      texts.map((t) => (t.id === id ? { ...t, isEditing: false } : t)),
    );
  };

  const handleTextMouseDown = (e: React.MouseEvent, t: TextAnnotation) => {
    if (tool === "eraser") {
      e.stopPropagation();
      onTextsChange(texts.filter((tx) => tx.id !== t.id));
      return;
    }
    if (tool === "select" || tool === "text") {
      e.stopPropagation();
      const pos = getPos(e);
      setDragText({ id: t.id, offsetX: pos.x - t.x, offsetY: pos.y - t.y });
    }
  };

  const pointerEvents = tool === "select" ? "none" : "all";

  return (
    <svg
      ref={svgRef}
      className="cc-drawing-layer"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      width={canvasWidth}
      height={canvasHeight}
      preserveAspectRatio="none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        pointerEvents,
        cursor:
          tool === "draw" || tool === "arrow" || tool === "rect"
            ? "crosshair"
            : tool === "text"
              ? "text"
              : tool === "eraser"
                ? "pointer"
                : "default",
      }}
    >
      {paths.map(renderPath)}
      {renderCurrentDrawing()}

      {texts.map((t) => (
        <foreignObject
          key={t.id}
          x={t.x}
          y={t.y}
          width={t.width + 20}
          height={100}
          style={{ overflow: "visible", pointerEvents: "all" }}
          onMouseDown={(e) => handleTextMouseDown(e, t)}
        >
          {editingTextId === t.id ? (
            <input
              type="text"
              value={t.text}
              autoFocus
              onChange={(e) => handleTextChange(t.id, e.target.value)}
              onBlur={() => handleTextBlur(t.id)}
              onKeyDown={(e) => e.key === "Enter" && handleTextBlur(t.id)}
              style={{
                fontSize: t.fontSize,
                fontWeight: t.fontWeight,
                color: t.color,
                background:
                  t.backgroundColor === "transparent"
                    ? "rgba(255,255,255,0.9)"
                    : t.backgroundColor,
                border: "2px solid #667eea",
                borderRadius: 4,
                padding: "4px 8px",
                outline: "none",
                width: t.width,
                transform: `rotate(${t.rotation}deg)`,
              }}
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingTextId(t.id);
              }}
              style={{
                fontSize: t.fontSize,
                fontWeight: t.fontWeight,
                color: t.color,
                background: t.backgroundColor,
                cursor: "move",
                padding: "2px 4px",
                borderRadius: 2,
                display: "inline-block",
                userSelect: "none",
                transform: `rotate(${t.rotation}deg)`,
                whiteSpace: "nowrap",
              }}
            >
              {t.text}
            </div>
          )}
        </foreignObject>
      ))}
    </svg>
  );
};

export default DrawingLayer;
