import React, { useCallback, useEffect, useRef } from "react";
import { renderFrame, stillTime } from "../core/render";
import type { Scene, Template } from "../core/types";

const Thumb: React.FC<{ tpl: Template; scene: Scene; images: HTMLImageElement[]; w?: number; h?: number; hover?: boolean; duration?: number }> = ({ tpl, scene, images, w = 360, h = 202, hover = false, duration = tpl.duration }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const transparent = !tpl.ownBackground && scene.background.kind === "transparent";
  const drawAt = useCallback(
    (t: number) => {
      const c = ref.current;
      if (!c) return;
      renderFrame(c.getContext("2d")!, w, h, t, scene, tpl, images, duration, transparent ? (scene.ink === "light" ? "#16181f" : "#eceef3") : undefined);
    },
    [w, h, scene, tpl, images, duration, transparent],
  );
  useEffect(() => {
    if (!hover || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawAt(stillTime(tpl, duration, duration * 0.3));
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawAt(t);
      if (tpl.loop || t < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover, drawAt, tpl, duration]);
  return <canvas ref={ref} width={w} height={h} className="sg-thumb" />;
};

export default Thumb;
