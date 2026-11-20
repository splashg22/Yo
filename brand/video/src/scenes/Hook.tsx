import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Mark } from "../ui/Mark";
import { Wordmark } from "../ui/Wordmark";
import { ease, len, pop } from "../theme";

/** 1 · Hook: the mark builds itself (outline, then the three bands), the wordmark rises. */
export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outline = ease(f, 4, 56);
  const bands: [number, number, number] = [ease(f, 34, 36), ease(f, 46, 36), ease(f, 58, 36)];
  const fill = ease(f, 34, 20);
  const sc = interpolate(pop(f, fps, 18), [0, 1], [0.72, 1]);
  const glow = interpolate(f, [78, 100, 170], [0, 1, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wm: [number, number] = [ease(f, 98, 44), ease(f, 112, 44)];
  const outAt = len("hook") - 16;
  const ex = ease(f, outAt, 34);
  const size = 184;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - ex, transform: `translateY(${-70 * ex}px) scale(${1 - 0.08 * ex})`, transformOrigin: "50% 45%" }}>
      <div style={{ position: "absolute", left: 960 - size / 2, top: 330, transform: `scale(${sc})`, transformOrigin: "50% 50%" }}>
        <Mark size={size} bands={bands} outline={outline * (1 - ease(f, 110, 30) * 0.85)} fill={fill} glow={glow} id="hook" />
      </div>
      <div style={{ position: "absolute", left: 960 - 210, top: 560 }}>
        <Wordmark width={420} reveal={wm} rise={[(1 - wm[0]) * 14, (1 - wm[1]) * 14]} />
      </div>
    </div>
  );
};
