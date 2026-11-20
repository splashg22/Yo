import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Layer } from "../ui/Layer";
import { Mark } from "../ui/Mark";
import { Caption } from "../ui/Caption";
import { SplitBar } from "../ui/SplitBar";
import { SOFT, ease, len, pop } from "../theme";

/** 4 · One fixed rule: the bar draws on 40 / 20 / 40 and the home page's own cycle wheel steps through it. */
export const Rule: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = len("rule");
  const ex = ease(f, L - 6, 26);
  const barIn = ease(f, 26, 44);
  const cardIn = pop(f, fps, 64, SOFT), cardO = ease(f, 64, 20);
  const STEPS = [60, 180, 300];
  const step = f >= STEPS[2] ? 2 : f >= STEPS[1] ? 1 : 0;
  const layerO = (i: number) => {
    const on = i === 0 ? 1 : ease(f, STEPS[i], 20);
    const off = i === 2 ? 0 : ease(f, STEPS[i + 1], 20);
    return on * (1 - off);
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - ex, transform: `translateY(${-30 * ex}px)` }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(11,3,8,0.78) 0%, rgba(11,3,8,0.72) 42%, rgba(11,3,8,0.15) 62%, rgba(11,3,8,0) 100%)", opacity: cardO }} />
      <Caption frame={f} start={8} light="One rule," bold="every cycle." line="Nothing is kept. Every fee the coin earns is split the same way, every time, and every step is public." />
      <div style={{ position: "absolute", left: 360, top: 262, display: "flex", alignItems: "flex-start", gap: 22, opacity: barIn, transform: `translateY(${(1 - barIn) * 20}px)` }}>
        <Mark size={40} id="rule" glow={0.4} style={{ marginTop: -14 }} />
        <SplitBar frame={f} start={48} width={1138} active={step} />
      </div>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, opacity: cardO, transform: `translateY(${(1 - cardIn) * 44}px)` }}>
        {[1, 2, 3].map((n, i) => (
          <React.Fragment key={n}>
            <Layer name={`home-wheel-${n}`} x={330} y={478} scale={0.92} style={{ opacity: layerO(i) }} />
            <Layer name={`home-cycle-card-${n}`} x={905} y={438} scale={0.97} style={{ opacity: layerO(i), transform: `scale(${interpolate(layerO(i), [0, 1], [1.02, 1])})`, transformOrigin: "50% 50%" }} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
