import type { CSSProperties } from "react";
import NumberInput from "./NumberInput";

const formatSeconds = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

export type TimelineClip = { duration: number; name?: string; onChange: (duration: number) => void };
type Props = {
  playing: boolean; time: number; duration: number;
  onPlay: () => void; onRestart: () => void; onSeek: (time: number) => void;
  playLabel?: string; restartLabel?: string;
  clip?: TimelineClip;
};

export default function AnimationTimeline({ playing, time, duration, onPlay, onRestart, onSeek,
  playLabel = playing ? "Пауза" : "Воспроизвести", restartLabel = "С начала", clip }: Props) {
  return <div className="sg-timeline" role="group" aria-label="Воспроизведение анимации">
    <button type="button" className={`sg-play${playing ? " is-playing" : ""}`} onClick={onPlay} aria-label={playLabel} title={playLabel}>
      <span aria-hidden="true" />
    </button>
    <button type="button" className="sg-round" onClick={onRestart} aria-label={restartLabel} title={restartLabel}>↺</button>
    <input type="range" min={0} max={duration} step={0.01} value={time} aria-label="Время"
      style={{ "--k": `${time / duration * 100}%` } as CSSProperties} onChange={e => onSeek(e.currentTarget.valueAsNumber)} />
    <span className="sg-time">{formatSeconds.format(time)} / {formatSeconds.format(duration)} с</span>
    {clip && <label className="sg-dur" title={clip.name ? `Длительность объекта «${clip.name}»` : "Длительность ролика"}>
      Длительность <NumberInput aria-label="Длительность ролика, секунды" min={1} max={60} step={0.01} value={clip.duration}
        onValue={n => clip.onChange(Math.round(n * 100) / 100)} />с
    </label>}
  </div>;
}
