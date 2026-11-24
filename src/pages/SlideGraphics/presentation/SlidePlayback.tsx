import { useEffect, useState } from "react";
import AnimationTimeline, { type TimelineClip } from "../components/AnimationTimeline";
import type { SlideClock } from "./slideEdits";

type Props = { clock: SlideClock; duration: number; loop: boolean; poster?: number; clip?: TimelineClip };

export default function SlidePlayback({ clock, duration, loop, poster, clip }: Props) {
  const [playing, setPlaying] = useState(clock.time !== null);
  const [elapsed, setElapsed] = useState<number | null>(clock.time);
  useEffect(() => {
    if (clock.time !== null && !loop && clock.time > duration) {
      clock.time = duration;
      setElapsed(duration);
    }
    clock.playing = playing;
    clock.paint?.(clock.time, playing);
    if (!playing) return;
    let raf = 0, last: number | null = null, shown = 0;
    const tick = (now: number) => {
      if (!clock.paint || document.hidden) last = null;
      else if (last === null || now - last >= 1000 / 30 - 1) {
        const t = (clock.time ?? 0) + (last === null ? 0 : (now - last) / 1000);
        last = now;
        clock.time = loop ? t : Math.min(t, duration);
        clock.paint(clock.time, true);
        if (!loop && t >= duration) { setElapsed(duration); setPlaying(false); return; }
        if (now - shown >= 66) { setElapsed(clock.time); shown = now; }
      }
      raf = requestAnimationFrame(tick);
    };
    const visibility = () => { last = null; };
    document.addEventListener("visibilitychange", visibility);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility); };
  }, [clock, duration, loop, playing]);

  function restart() {
    clock.time = 0;
    clock.paint?.(0, true);
    setElapsed(0);
    setPlaying(true);
  }
  function seek(time: number) {
    clock.time = time;
    clock.playing = false;
    clock.paint?.(time, false);
    setElapsed(time);
    setPlaying(false);
  }
  const ended = !playing && !loop && elapsed !== null && elapsed >= duration;
  const time = elapsed === null ? (poster ?? (loop ? 0 : duration))
    : loop && elapsed > duration ? elapsed % duration : Math.min(elapsed, duration);
  return <footer className="pw-transport" aria-label="Анимация на слайде">
    <AnimationTimeline playing={playing} time={time} duration={duration} clip={clip}
      playLabel={playing ? "Пауза" : ended ? "Повторить анимацию" : "Воспроизвести"} restartLabel="Воспроизвести с начала"
      onRestart={restart} onSeek={seek} onPlay={() => {
        if (playing) seek(clock.time ?? 0);
        else if (ended || clock.time === null) restart();
        else setPlaying(true);
      }} />
  </footer>;
}
