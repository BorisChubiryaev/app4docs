import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { Icon } from "../../ChartCraft/components/icons";
import type { Box } from "../../PptxRestyle/engine/shapes";
import { objectLabel, type Presentation, type Slide } from "../core/presentation";
import ChartPreview from "./ChartPreview";

function boxStyle(box: Box, deck: Presentation): CSSProperties {
  return {
    left: box.x / deck.width * 100 + "%", top: box.y / deck.height * 100 + "%",
    width: box.cx / deck.width * 100 + "%", height: box.cy / deck.height * 100 + "%",
  };
}

function Picture({ blob, style }: { blob: Blob; style: CSSProperties }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <img className="sg-pptx-picture" ref={ref} alt="" style={style} />;
}

interface CanvasProps {
  deck: Presentation;
  slide: Slide;
  selected?: string;
  order: string[];
  select: (id: string) => void;
  targets: RefObject<Map<string, HTMLDivElement>>;
}

export default function SlideCanvas({ deck, slide, selected, select, targets, order }: CanvasProps) {
  return <div className="sg-pptx-mat">
    <div className="sg-pptx-paper" style={{ aspectRatio: deck.width / deck.height, maxWidth: 'min(100%, ' + 45 * deck.width / deck.height + 'vh)' }}>
      {slide.pictures.map((p, i) => <Picture key={i} blob={p.blob} style={boxStyle(p.box, deck)} />)}
      {slide.objects.map((o, i) => {
        const box = o.box && o.box.cx > 0 && o.box.cy > 0 ? boxStyle(o.box, deck) : {
          left: "5%", width: "90%", top: (5 + i * 90 / slide.objects.length) + "%", height: 80 / slide.objects.length + "%",
        };
        return <div className="sg-pptx-shape" key={o.id} data-selected={o.id === selected} style={box}>
          <div className="sg-pptx-shape-content" aria-hidden="true" ref={node => {
            if (node) targets.current.set(o.id, node);
            else targets.current.delete(o.id);
          }}>
            {o.sketch ? <ChartPreview chart={o.sketch} /> : o.kind === "Диаграмма" ?
              <span className="sg-pptx-chart-placeholder"><Icon name="chart" />{objectLabel(o)}</span> :
              <div className="sg-pptx-shape-text" style={{ fontSize: ((o.textPt || 22) * 12700 / deck.width * 100) + "cqw" }}>{o.content}</div>}
          </div>
          {order.includes(o.id) && <span className="sg-pptx-step" aria-hidden="true">{order.indexOf(o.id) + 1}</span>}
          <button className="sg-pptx-shape-hit" aria-label={o.kind + " на эскизе · " + objectLabel(o)}
            aria-pressed={o.id === selected} onClick={() => select(o.id)} />
        </div>;
      })}
    </div>
  </div>;
}
