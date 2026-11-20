import React from "react";
import { Img, staticFile } from "remotion";
import { depth, frontIndex } from "../../../../web/ring.js";

/** The ring on the home page, rebuilt with the site's own markup, CSS and maths, turned by `spin` degrees. */
const ART = [
  { n: "tickets", title: "One rule", subtitle: "Every fee, split three ways" },
  { n: "ticket-pink", title: "DCTY burn", subtitle: "40% of every fee" },
  { n: "bay", title: "On-chain", subtitle: "Every step a Solana transaction" },
  { n: "ticket-white", title: "Buyback", subtitle: "20% of every fee" },
  { n: "ticket-blue", title: "Holders", subtitle: "40% paid in TTWO" },
];
export const Ring: React.FC<{ spin: number; width?: number; height?: number; gap?: number; tilt?: number; repeat?: number }> = ({ spin, width = 210, height = 280, gap = 48, tilt = -12, repeat = 2 }) => {
  const cards: number[] = [];
  for (let r = 0; r < repeat; r++) for (let i = 0; i < ART.length; i++) cards.push(i);
  const n = cards.length, m = ART.length, step = 360 / n;
  const radius = Math.round(((width + gap) * n) / (2 * Math.PI));
  const front = cards[frontIndex(spin, n)];
  return (
    <div className="ring" style={{ ["--w" as string]: `${width}px`, ["--h" as string]: `${height}px`, margin: 0, height: 560 }}>
      <div className="ring-view">
        <div className="ring-camera" style={{ transform: `translateY(${-Math.round(height * 0.16)}px) translateZ(${-radius}px) rotateX(${tilt}deg)` }}>
          <div className="ring-spin" style={{ transform: `rotateY(${spin.toFixed(2)}deg)` }}>
            {cards.map((it, i) => (
              <div className="ring-card" key={i} style={{ transform: `rotateY(${i * step}deg) translateZ(${radius}px)` }}>
                <Img src={staticFile(`site/art/ring/${ART[it].n}.jpg`)} />
                <div className="shade" style={{ opacity: (depth(i * step + spin) * 0.88).toFixed(2) }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ring-caption">
        <div className="ring-title"><b>{ART[front].title}</b><span>{ART[front].subtitle}</span></div>
        <div className="ring-count"><span className="digits">{front + 1}</span><span className="slash">/</span><span>{m}</span></div>
      </div>
    </div>
  );
};
