import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import captured from "../captured.json";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { Addresses, HistoryPanel } from "../ui/Dash";
import { ease, len } from "../theme";

const B = captured.boxes.dashboard;
const PANEL_Y = 292;
const ADDR_Y = PANEL_Y + B.history.h + 20;
const copy = B.copyTreasury;
const target = { x: copy.x - B.addresses.x + 360 + copy.w * 0.5, y: ADDR_Y + (copy.y - B.addresses.y) + copy.h * 0.5 };
/** Page coordinates → frame coordinates under the page group's scale(1.1) about (960, 0). */
const scaled = (p: { x: number; y: number }) => ({ x: 960 + (p.x - 960) * 1.1, y: p.y * 1.1 });

/** 6 · Every step is public: the history panel in its real (empty) state and the addresses, with a Copy click. */
export const History: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = len("history");
  const ex = ease(f, L - 4, 24);
  const CLICK = 284;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - ex }}>
      <Caption frame={f} start={6} light="Every" bold="transaction." line="The treasury's full history, classified from what each transaction did on-chain. Each row links to Solscan." />
      <div className="page" style={{ transform: "scale(1.1)", transformOrigin: "960px 0px" }}>
        <div className="abs" style={{ left: 360, top: PANEL_Y }}><HistoryPanel frame={f} start={22} fps={fps} /></div>
        <div className="abs" style={{ left: 360, top: ADDR_Y }}><Addresses frame={f} start={150} copiedFrom={CLICK + 3} copiedTo={CLICK + 3 + 84} /></div>
      </div>
      <Cursor frame={f} moves={[{ from: { x: 1720, y: 1070 }, to: scaled(target), start: 204, dur: 72 }]} clicks={[CLICK]} opacity={ease(f, 204, 10)} />
    </div>
  );
};
