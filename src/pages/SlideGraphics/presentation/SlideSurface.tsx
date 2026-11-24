import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlideHandle } from "@aiden0z/pptx-renderer";
import type { Presentation, Rect, Slide, SlideEdit } from "../core/presentation";
import { previewSlide, type SlideClock } from "./slideEdits";

type Props = { deck: Presentation; slide: Slide; edits: SlideEdit[]; thumbnail?: boolean; clock?: SlideClock; motion?: { id: string; box: Rect } };

function SlideSurface({ deck, slide, edits, thumbnail = false, clock, motion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rendered = useRef<SlideHandle | null>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!thumbnail || !host.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--page-scale", String(el.clientWidth / deck.model.width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [deck]);
  useEffect(() => () => { rendered.current?.dispose(); rendered.current = null; }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    if (!visible) {
      rendered.current?.dispose(); rendered.current = null;
      root.replaceChildren();
      return;
    }
    let stale = false;
    let pending: SlideHandle | undefined;
    // Keep the previous frame on screen while composing the next edit.
    async function draw() {
      try {
        const next = await previewSlide(deck, slide, edits, !!clock);
        if (stale) { next.dispose(); return; }
        pending = next;
        next.element.style.position = "absolute";
        next.element.style.visibility = rendered.current ? "hidden" : "visible";
        next.element.style.transformOrigin = "top left";
        next.element.style.transform = "scale(var(--page-scale))";
        // Native charts measure their mounted container on the next animation frame.
        root.append(next.element);
        await next.ready;
        if (stale) return;
        if (clock) {
          clock.paint = next.paint;
          clock.paint?.(clock.time, clock.playing);
        }
        next.element.style.visibility = "visible";
        root.replaceChildren(next.element);
        pending = undefined;
        rendered.current?.dispose();
        rendered.current = next;
        setFailed(false);
      } catch {
        if (!stale) setFailed(true);
      }
    }
    void draw();
    return () => {
      stale = true;
      if (clock) clock.paint = undefined;
      if (pending) { pending.dispose(); pending.element.remove(); }
    };
  }, [deck, slide, edits, visible, clock]);
  useLayoutEffect(() => {
    if (!motion) return;
    const layer = rendered.current?.element.querySelector<HTMLElement>(`[data-studio-graphic="${CSS.escape(motion.id)}"]`);
    if (!layer) return;
    const base = layer.style.cssText;
    const { x, y, w, h } = motion.box;
    Object.assign(layer.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    return () => { layer.style.cssText = base; };
  }, [motion]);
  return <><div className="pw-render" ref={host} aria-hidden="true" inert />
    {failed && <span className="pw-render-failed">Предпросмотр недоступен</span>}</>;
}

export default memo(SlideSurface, (a, b) => a.motion === b.motion && a.clock === b.clock && a.deck === b.deck && a.slide === b.slide && a.thumbnail === b.thumbnail
  && a.edits.length === b.edits.length && a.edits.every((e, i) => e === b.edits[i]));
