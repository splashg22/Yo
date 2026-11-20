import React from "react";
import { interpolate } from "remotion";
import { EASE } from "../theme";

export type Pt = { x: number; y: number };
export type Move = { from: Pt; to: Pt; start: number; dur: number; bulge?: number };

/** Position along a quadratic bezier from `from` to `to`, bowed sideways by `bulge` px, eased out. */
export function along(frame: number, m: Move): Pt {
  const t = interpolate(frame, [m.start, m.start + m.dur], [0, 1], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y;
  const L = Math.hypot(dx, dy) || 1;
  const b = m.bulge ?? L * 0.22;
  const cx = (m.from.x + m.to.x) / 2 - (dy / L) * b, cy = (m.from.y + m.to.y) / 2 + (dx / L) * b;
  const u = 1 - t;
  return { x: u * u * m.from.x + 2 * u * t * cx + t * t * m.to.x, y: u * u * m.from.y + 2 * u * t * cy + t * t * m.to.y };
}
/** Where the cursor is at `frame` given a list of moves (it rests between them). */
export function cursorAt(frame: number, moves: Move[]): Pt {
  let p = moves[0].from;
  for (const m of moves) { if (frame >= m.start) p = along(frame, m); }
  return p;
}

/** A macOS-style pointer with a press (scale) and a ripple ring on each click frame. */
export const Cursor: React.FC<{ frame: number; moves: Move[]; clicks?: number[]; opacity?: number; size?: number }> = ({ frame, moves, clicks = [], opacity = 1, size = 26 }) => {
  const p = cursorAt(frame, moves);
  let press = 1;
  let ring: React.ReactNode = null;
  for (const c of clicks) {
    const d = frame - c;
    if (d >= 0 && d < 14) press = interpolate(d, [0, 5, 14], [1, 0.86, 1]);
    if (d >= 0 && d < 40) {
      const r = interpolate(d, [0, 40], [6, 44], { easing: EASE });
      const o = interpolate(d, [0, 40], [0.7, 0]);
      ring = <div style={{ position: "absolute", left: p.x - r, top: p.y - r, width: r * 2, height: r * 2, borderRadius: 999, border: `2px solid rgba(255,225,243,${o})`, boxShadow: `0 0 18px rgba(255,45,149,${o * 0.6})` }} />;
    }
  }
  return (
    <>
      {ring}
      <svg width={size} height={size * 1.25} viewBox="0 0 20 25" style={{ position: "absolute", left: p.x - 2, top: p.y - 2, opacity, transform: `scale(${press})`, transformOrigin: "2px 2px", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
        <path d="M2 2 L2 19.5 L6.6 15.3 L9.7 22.6 L13 21.2 L10 14 L16.5 14 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </>
  );
};
