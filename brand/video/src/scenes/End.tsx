import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Mark } from "../ui/Mark";
import { Wordmark } from "../ui/Wordmark";
import { ease, len, pop } from "../theme";

/** 7 · End card: the glow blooms from the wall, the lockup, the tagline, the URL and the disclaimer. */
export const End: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bloom = ease(f, 0, 80);
  const mk = pop(f, fps, 14);
  const wm: [number, number] = [ease(f, 40, 44), ease(f, 54, 44)];
  const tag = ease(f, 84, 48);
  const url = ease(f, 116, 40), line = ease(f, 134, 40);
  const disc = ease(f, 158, 40);
  const fadeOut = ease(f, len("end") - 22, 22);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(56% 52% at 50% -6%, rgba(255,45,149,${0.5 * bloom}) 0%, rgba(255,45,149,${0.18 * bloom}) 45%, rgba(255,45,149,0) 100%)` }} />
      <div className="wall" style={{ opacity: 0.55 * bloom }} />
      <div style={{ position: "absolute", left: 960 - 64, top: 272, transform: `scale(${interpolate(mk, [0, 1], [0.7, 1])})`, opacity: ease(f, 14, 14) }}>
        <Mark size={128} glow={0.6} id="end" />
      </div>
      <div style={{ position: "absolute", left: 960 - 170, top: 426 }}>
        <Wordmark width={340} reveal={wm} rise={[(1 - wm[0]) * 12, (1 - wm[1]) * 12]} />
      </div>
      <div style={{ position: "absolute", left: 0, width: 1920, top: 600, textAlign: "center", opacity: tag, transform: `translateY(${(1 - tag) * 26}px)` }}>
        <h1 style={{ fontSize: 60, lineHeight: 1, letterSpacing: "-0.045em", fontWeight: 300, margin: 0 }}>Every fee works <b style={{ fontWeight: 800 }}>for holders.</b></h1>
      </div>
      <div style={{ position: "absolute", left: 0, width: 1920, top: 706, textAlign: "center", opacity: url, transform: `translateY(${(1 - url) * 16}px)` }}>
        <span style={{ display: "inline-block", position: "relative", fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", padding: "0 2px 6px" }}>
          splashg22.github.io/Yo
          <span style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${line * 100}%`, background: "var(--pink)", boxShadow: "0 0 12px rgba(255,45,149,.7)" }} />
        </span>
      </div>
      <div style={{ position: "absolute", left: 0, width: 1920, top: 950, textAlign: "center", opacity: disc }}>
        <p style={{ margin: "0 auto", maxWidth: 1100, color: "var(--muted)", fontSize: 15, lineHeight: 1.6 }}>Independent project. Not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun. Not financial advice.</p>
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#0b0308", opacity: fadeOut }} />
    </div>
  );
};
