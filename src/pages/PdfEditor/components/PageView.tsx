import React from "react";
import type { Annotation } from "./PageAnnotator";
import type { PageItem } from "../core/types";
import { MM } from "../core/types";
import { STUDIO_FONT } from "./studioFont";

// Страница так, как она выйдет в файл: поворот, аннотации и обрезка полей
// поверх растровой миниатюры. Размеры считаются через единицы контейнера
// (cqw/cqh), поэтому один компонент подходит и для сетки, и для просмотра.

export type ThumbInfo = { url: string; w: number; h: number; failed?: boolean };

const arrowHead = (a: Extract<Annotation, { type: "line" | "arrow" }>, W: number, H: number) => {
  const x1 = a.x1 * W;
  const y1 = a.y1 * H;
  const x2 = a.x2 * W;
  const y2 = a.y2 * H;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.min(8 * a.strokeWidth, Math.hypot(x2 - x1, y2 - y1));
  const half = 3 * a.strokeWidth;
  const bx = x2 - len * Math.cos(ang);
  const by = y2 - len * Math.sin(ang);
  const nx = -Math.sin(ang) * half;
  const ny = Math.cos(ang) * half;
  return { bx, by, points: `${x2},${y2} ${bx + nx},${by + ny} ${bx - nx},${by - ny}` };
};

export const AnnotationLayer: React.FC<{ anns: Annotation[]; W: number; H: number }> = ({ anns, W, H }) => (
  <svg className="pv-annots" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
    {anns.map((a) => {
      switch (a.type) {
        case "highlight":
          return <rect key={a.id} x={a.x * W} y={a.y * H} width={a.w * W} height={a.h * H} fill={a.color} opacity={0.35} />;
        case "redact":
          return <rect key={a.id} x={a.x * W} y={a.y * H} width={a.w * W} height={a.h * H} fill="#000" />;
        case "rect":
          return (
            <rect
              key={a.id}
              x={a.x * W}
              y={a.y * H}
              width={a.w * W}
              height={a.h * H}
              fill="none"
              stroke={a.color}
              strokeWidth={a.strokeWidth}
            />
          );
        case "image":
          return (
            <image key={a.id} href={a.dataUrl} x={a.x * W} y={a.y * H} width={a.w * W} height={a.h * H} preserveAspectRatio="none" />
          );
        case "draw":
          return (
            <polyline
              key={a.id}
              points={a.points.map((p) => `${p.x * W},${p.y * H}`).join(" ")}
              fill="none"
              stroke={a.color}
              strokeWidth={a.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        case "line":
          return (
            <line
              key={a.id}
              x1={a.x1 * W}
              y1={a.y1 * H}
              x2={a.x2 * W}
              y2={a.y2 * H}
              stroke={a.color}
              strokeWidth={a.strokeWidth}
              strokeLinecap="round"
            />
          );
        case "arrow": {
          const h = arrowHead(a, W, H);
          return (
            <g key={a.id}>
              <line x1={a.x1 * W} y1={a.y1 * H} x2={h.bx} y2={h.by} stroke={a.color} strokeWidth={a.strokeWidth} strokeLinecap="round" />
              <polygon points={h.points} fill={a.color} />
            </g>
          );
        }
        case "text":
          return (
            <foreignObject key={a.id} x={a.x * W} y={a.y * H} width={Math.max(a.w * W, a.fontSize * H)} height={H}>
              <div
                style={{
                  fontFamily: STUDIO_FONT,
                  fontSize: `${a.fontSize * H}px`,
                  lineHeight: 1.2,
                  color: a.color,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {a.text}
              </div>
            </foreignObject>
          );
        default:
          return null;
      }
    })}
  </svg>
);

interface Props {
  item: PageItem;
  thumb?: ThumbInfo;
  /** Картинка вместо миниатюры (просмотр в высоком разрешении) */
  src?: string;
  alt?: string;
}

const PageView: React.FC<Props> = ({ item, thumb, src, alt }) => {
  const w = thumb?.w || 595;
  const h = thumb?.h || 842;
  const rot = (((item.rotation ?? 0) % 360) + 360) % 360;
  const side = rot % 180 !== 0;
  // Пропорции страницы на экране (после поворота)
  const dw = side ? h : w;
  const dh = side ? w : h;
  const url = src || thumb?.url;
  const crop = item.crop;
  const cropPct = crop
    ? {
        top: ((crop.top * MM) / dh) * 100,
        bottom: ((crop.bottom * MM) / dh) * 100,
        left: ((crop.left * MM) / dw) * 100,
        right: ((crop.right * MM) / dw) * 100,
      }
    : null;
  return (
    <div className="pv-box" style={{ ["--pa" as string]: String(dw / dh) }}>
      <div className={`pv-frame ${item.fitA4 ? "is-a4" : ""}`}>
        <div className={`pv-page ${side ? "is-side" : ""}`} style={{ transform: `translate(-50%, -50%) rotate(${rot}deg)` }}>
          {url ? <img src={url} alt={alt ?? ""} className="pv-img" draggable={false} /> : <div className="pv-blank" />}
          {item.annotations && item.annotations.length > 0 && <AnnotationLayer anns={item.annotations} W={w} H={h} />}
        </div>
        {cropPct && (
          <div
            className="pv-crop"
            style={{
              top: `${cropPct.top}%`,
              bottom: `${cropPct.bottom}%`,
              left: `${cropPct.left}%`,
              right: `${cropPct.right}%`,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default PageView;
