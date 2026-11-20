import React from "react";
import { C } from "../theme";

/**
 * The site's mark (web/logo.svg, the D sliced 40 / 20 / 40), with each band's slide-in and the D's
 * outline as separate progress values so the hook can build it up.
 */
export const Mark: React.FC<{ size: number; bands?: [number, number, number]; outline?: number; fill?: number; glow?: number; style?: React.CSSProperties; id?: string }> = ({ size, bands = [1, 1, 1], outline = 0, fill = 1, glow = 0, style, id = "mk" }) => {
  const d = "M12 6h18a26 26 0 0 1 0 52H12z";
  // Path length of the D: 18 + half circle (π·26) + 18 + 52 ≈ 169.7
  const L = 170;
  const off = (p: number) => -64 * (1 - p);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", overflow: "visible", filter: glow ? `drop-shadow(0 0 ${18 * glow}px rgba(255,45,149,${0.55 * glow}))` : undefined, ...style }}>
      <defs>
        <clipPath id={`${id}-d`}><path d={d} /></clipPath>
        <linearGradient id={`${id}-top`} x1="0" y1="6" x2="0" y2="24.72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ffd1e8" /><stop offset=".62" stopColor={C.pink} /><stop offset="1" stopColor={C.pink} /></linearGradient>
        <linearGradient id={`${id}-bot`} x1="0" y1="39.28" x2="0" y2="58" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor={C.cyan} /><stop offset="1" stopColor="#8ff3ff" /></linearGradient>
      </defs>
      <g clipPath={`url(#${id}-d)`} opacity={fill}>
        <rect x={off(bands[0])} y="6" width="64" height="18.72" fill={`url(#${id}-top)`} />
        <rect x={off(bands[1])} y="27.32" width="64" height="9.36" fill={C.violet} />
        <rect x={off(bands[2])} y="39.28" width="64" height="18.72" fill={`url(#${id}-bot)`} />
      </g>
      {outline > 0 && <path d={d} fill="none" stroke="rgba(255,225,243,0.9)" strokeWidth="1.2" strokeDasharray={L} strokeDashoffset={L * (1 - outline)} strokeLinecap="round" />}
    </svg>
  );
};
