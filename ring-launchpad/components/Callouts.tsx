import { site } from "@/site.config";

/** How far from the object's centre line the boxes begin, as a share of the frame width. */
const REACH = 0.262;

/** The five numbered callouts as boxes joined to their layers. Positioned in shares of the frame, so they hold at any size. */
export function CalloutBoxes({ centre }: { centre: number }) {
  return (
    <div className="callouts" aria-hidden="true">
      {site.layers.map((layer, index) => {
        const left = index % 2 === 0;
        const rim = left ? centre - layer.edge : centre + layer.edge;
        // Every box on a side starts at the same edge; only the line's length follows the layer.
        const boxEdge = left ? centre - REACH : centre + REACH;
        return (
          <div key={layer.n} className="callout" style={{ top: `${layer.y * 100}%` }}>
            <span className="line" style={{ left: `${Math.min(rim, boxEdge) * 100}%`, width: `${Math.abs(rim - boxEdge) * 100}%` }} />
            <div className="box" style={left ? { right: `${(1 - boxEdge) * 100}%` } : { left: `${boxEdge * 100}%` }}>
              <b>{layer.n} {layer.label}</b>
              <span>{layer.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The same five as a numbered list: phones, narrow windows and screen readers. */
export function CalloutList({ className }: { className?: string }) {
  return (
    <ol className={`callout-list ${className ?? ""}`}>
      {site.layers.map((layer) => (
        <li key={layer.n}>
          <b>{layer.n}</b>
          <span><b>{layer.label}</b>{layer.text}</span>
        </li>
      ))}
    </ol>
  );
}
