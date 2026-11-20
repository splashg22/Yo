import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import captured from "../captured.json";
import { Layer } from "../ui/Layer";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { Kpis, Overview } from "../ui/Dash";
import { ease, len, lin } from "../theme";

const B = captured.boxes.dashboard;
const OFF = 86; // the dashboard page shifted down so its heading sits under the caption
const link = B.treasuryLink;
const raw = { x: link.x + link.w * 0.55, y: link.y + OFF + link.h * 0.55 };
// Page coordinates → frame coordinates under the page group's scale(1.12) about (960, 0).
const target = { x: 960 + (raw.x - 960) * 1.12, y: raw.y * 1.12 };

/** 5 · The live dashboard: overview and tiles as the site renders them, the supply counting up. */
export const Dash: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = len("dash");
  const ex = ease(f, L - 4, 24);
  const push = lin(f, 30, L, 1, 1.03);
  const headIn = ease(f, 16, 40);
  const CLICK = 262;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - ex, transform: `translateY(${-50 * ex}px) scale(${push})`, transformOrigin: "50% 58%" }}>
      <div className="wall" style={{ opacity: 0.8 }} />
      <Caption frame={f} start={6} light="Every number," bold="on-chain." line={<>Read from a public Solana RPC in your browser, nothing taken on trust.</>} />
      <div className="page" style={{ transform: `translateY(${OFF}px) scale(1.12)`, transformOrigin: "960px 0px" }}>
        <Layer name="dash-head" x={B.head.x} y={B.head.y} style={{ opacity: headIn, transform: `translateY(${(1 - headIn) * 20}px)` }} />
        <div className="abs" style={{ left: B.overview.x, top: B.overview.y }}><Overview frame={f} start={24} fps={fps} countStart={64} countDur={96} /></div>
        <div className="abs" style={{ left: B.kpis.x, top: B.kpis.y }}><Kpis frame={f} start={80} fps={fps} /></div>
      </div>
      <Cursor frame={f} moves={[{ from: { x: 1560, y: 1070 }, to: target, start: 170, dur: 80 }]} clicks={[CLICK]} opacity={ease(f, 170, 10)} />
    </div>
  );
};
