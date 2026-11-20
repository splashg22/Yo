import React from "react";
import { WORDMARK, WORDMARK_VIEWBOX } from "../wordmark";

/** The kit's wordmark ("Dacity" in text colour, "STRATEGY" in cyan) with per-word reveal. */
export const Wordmark: React.FC<{ width: number; reveal?: [number, number]; rise?: [number, number]; style?: React.CSSProperties }> = ({ width, reveal = [1, 1], rise = [0, 0], style }) => {
  const height = (width * 118) / 305.2;
  return (
    <svg width={width} height={height} viewBox={WORDMARK_VIEWBOX} style={{ display: "block", overflow: "visible", ...style }}>
      <defs>
        <clipPath id="wm-0"><rect x="0" y="0" width={305.2 * reveal[0]} height="118" /></clipPath>
        <clipPath id="wm-1"><rect x="0" y="0" width={305.2 * reveal[1]} height="118" /></clipPath>
      </defs>
      {WORDMARK.map((p, i) => (
        <g key={i} clipPath={`url(#wm-${i})`} opacity={reveal[i] > 0.02 ? 1 : 0} transform={`translate(0 ${rise[i]})`}>
          <path fill={p.fill} transform={p.transform} d={p.d} />
        </g>
      ))}
    </svg>
  );
};
