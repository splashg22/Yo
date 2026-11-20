import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import captured from "../captured.json";
import { Layer } from "../ui/Layer";
import { Ring } from "../ui/Ring";
import { ClickRing } from "../ui/ClickRing";
import { ease, len, lin } from "../theme";

const B = captured.boxes.home;
const btn = B.btnDash;
const target = { x: btn.x + btn.w * 0.5, y: btn.y + btn.h * 0.5 };

/** 3 · The real home page rises in one move; the cursor takes the "Open the dashboard" button. */
export const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const rise = ease(f, 0, 72);
  const push = lin(f, 40, 340, 1, 1.035);
  const spin = -10 - 8 * (f / 60); // the site's own 8°/s
  const hover = ease(f, 232, 14);
  const CLICK = 252;
  const RIPPLE = 300;
  const r = ease(f, RIPPLE, 36) * 2300;
  const gone = ease(f, RIPPLE + 6, 24); // the page fades under the ripple so nothing shows through later
  const veil = 1 - ease(f, len("reveal") - 8, 24);
  return (
    <>
      <div className="wall" style={{ opacity: rise * (1 - gone) }} />
      <div style={{ position: "absolute", inset: 0, opacity: rise * (1 - gone), transform: `translateY(${(1 - rise) * 90}px) scale(${push})`, transformOrigin: "50% 60%" }}>
        <div className="page">
          <Layer name="home-nav" x={B.nav.x} y={B.nav.y} />
          <Layer name="home-h1" x={B.h1.x} y={B.h1.y} />
          <Layer name="home-side" x={B.side.x} y={B.side.y} />
          <div style={{ position: "absolute", left: btn.x, top: btn.y, width: btn.w, height: btn.h, borderRadius: 10, background: `rgba(255,255,255,${0.5 * hover})` }} />
          <div style={{ position: "absolute", left: B.ring.x, top: B.ring.y, width: 1920 }}>
            <Ring spin={spin} />
          </div>
        </div>
        <ClickRing frame={f} at={CLICK} x={target.x} y={target.y} />
      </div>
      {r > 0 && (
        <div style={{ position: "absolute", left: target.x - r, top: target.y - r, width: r * 2, height: r * 2, borderRadius: 999, background: "#0b0308", boxShadow: "0 0 120px 30px rgba(255,45,149,0.35)", opacity: veil }} />
      )}
    </>
  );
};
