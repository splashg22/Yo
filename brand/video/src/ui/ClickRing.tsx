import React from "react";
import { interpolate } from "remotion";
import { C, EASE } from "../theme";

/** Click feedback without a pointer: a small ring in brand pink that appears at the click and is gone within 300 ms (18 frames). */
export const ClickRing: React.FC<{ frame: number; at: number; x: number; y: number }> = ({ frame, at, x, y }) => {
  const d = frame - at;
  if (d < 0 || d > 18) return null;
  const r = interpolate(d, [0, 18], [6, 30], { easing: EASE });
  const o = interpolate(d, [0, 3, 18], [0, 0.9, 0]);
  return <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, border: `2px solid ${C.pink}`, boxShadow: `0 0 14px rgba(255,45,149,${o * 0.7})`, opacity: o }} />;
};
