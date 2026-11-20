import React from "react";
import { ease, ms } from "../theme";

/** The scene caption in the site's section-head voice: a light phrase, one bold phrase, a muted line. */
export const Caption: React.FC<{ frame: number; start: number; light: string; bold: string; line?: React.ReactNode; x?: number; y?: number; exit?: number; width?: number }> = ({ frame, start, light, bold, line, x = 360, y = 96, exit, width = 1200 }) => {
  const a = ease(frame, start, 42), b = ease(frame, start + ms(120), 42);
  const out = exit == null ? 1 : 1 - ease(frame, exit, 20);
  return (
    <div className="cap" style={{ position: "absolute", left: x, top: y, width, opacity: out }}>
      <h2 style={{ opacity: a, transform: `translateY(${(1 - a) * 28}px)` }}><span>{light}</span> <b>{bold}</b></h2>
      {line && <p style={{ opacity: b, transform: `translateY(${(1 - b) * 16}px)` }}>{line}</p>}
    </div>
  );
};
