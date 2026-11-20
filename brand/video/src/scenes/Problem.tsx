import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ease, len, ms, pop } from "../theme";

/** 2 · The problem, as two lines of kinetic type: light statement, bold payoff. */
export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = "Creator fees usually stay with the creator.".split(" ");
  const p = pop(f, fps, 96);
  const o2 = ease(f, 96, 18);
  const outAt = len("problem") - 20;
  const ex = ease(f, outAt, 36);
  return (
    <div style={{ position: "absolute", left: 360, top: 0, width: 1200, height: 1080, display: "flex", flexDirection: "column", justifyContent: "center", opacity: 1 - ex, transform: `translateY(${-90 * ex}px)` }}>
      <div className="kin" style={{ color: "var(--muted)" }}>
        {words.map((w, i) => {
          const a = ease(f, 12 + i * ms(60), 44);
          return <span className="w" key={i} style={{ opacity: a, transform: `translateY(${(1 - a) * 34}px)` }}>{w}{i < words.length - 1 ? " " : ""}</span>;
        })}
      </div>
      <div className="kin" style={{ marginTop: 10, opacity: o2, transform: `scale(${interpolate(p, [0, 1], [1.12, 1])}) translateY(${(1 - p) * 10}px)`, transformOrigin: "0% 50%" }}>
        <b>Here, nothing is kept.</b>
      </div>
    </div>
  );
};
