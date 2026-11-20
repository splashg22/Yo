// The split bar: the dashboard's own #bar styling (web/ui.css) drawn on in three segments, the percentages counting.
import React from "react";
import { interpolate } from "remotion";
import { ease } from "../theme";

const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** The split bar (the dashboard's own #bar styling) drawn on in three segments, with the percentages counting. */
export const SplitBar: React.FC<{ frame: number; start: number; width: number; active: number }> = ({ frame, start, width, active }) => {
  const segs = [
    { cls: "a", pct: 40, k: "burns DCTY", pc: "pct-burn", at: 0, glow: "rgba(255,45,149,.7)" },
    { cls: "b", pct: 20, k: "buys back", pc: "pct-buyback", at: 40, glow: "rgba(182,92,255,.7)" },
    { cls: "c", pct: 40, k: "to holders", pc: "pct-holders", at: 60, glow: "rgba(62,232,255,.7)" },
  ];
  const starts = [start, start + 40, start + 70];
  const prog = segs.map((_, i) => ease(frame, starts[i], i === 1 ? 36 : 50));
  return (
    <div style={{ position: "relative", width }}>
      <div id="bar" style={{ overflow: "visible" }}>
        {segs.map((sg, i) => (
          <i key={sg.cls} className={sg.cls} style={{ width: `${sg.pct * prog[i]}%`, boxShadow: active === i ? `0 0 16px ${sg.glow}` : "none", borderRadius: i === 0 ? "999px 0 0 999px" : i === 2 ? "0 999px 999px 0" : 0 }} />
        ))}
      </div>
      <div id="split" style={{ display: "block", marginTop: 18, position: "relative", height: 90 }}>
        {segs.map((sg, i) => {
          const t = prog[i];
          return (
            <div key={sg.cls} style={{ position: "absolute", left: `${sg.at}%`, top: 0, opacity: interpolate(t, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }) }}>
              <div className={`p ${sg.pc}`} style={{ margin: 0, fontSize: 40, lineHeight: 1 }}>{Math.round(sg.pct * easeOutCubic(t))}%</div>
              <div className="k" style={{ fontSize: 15, marginTop: 6 }}>{sg.k}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
