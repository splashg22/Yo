// Timing, easing and the brand tokens the composition needs in code (the CSS comes from web/ui.css).
import { Easing, interpolate, spring } from "remotion";

export const FPS = 60;
export const W = 1920;
export const H = 1080;
export const DURATION = 1728; // 28.8 s = 12 bars at 100 BPM; every cut sits on a beat (36 frames)

/** Seconds to frames. */
export const s = (sec: number) => Math.round(sec * FPS);
/** Milliseconds to frames (for staggers). */
export const ms = (m: number) => Math.round((m / 1000) * FPS);

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
/** Springs with a slight overshoot for UI pops, and a soft one for larger moves. */
export const POP = { damping: 13, stiffness: 160, mass: 0.8 };
export const SOFT = { damping: 18, stiffness: 110, mass: 1 };

export const C = {
  pink: "#ff2d95", pinkHi: "#ff5fae", pinkDeep: "#d10070", cyan: "#3ee8ff", violet: "#b65cff",
  ink: "#0b0308", card: "#170810", frame: "#140811", text: "#fff4fa", muted: "rgba(255, 228, 243, 0.72)",
  primary: "#ffe1f3", primaryInk: "#1c0713", line: "rgba(255, 225, 243, 0.12)",
};

/** Ease-out from `from` to `to` over `dur` frames starting at `start`. */
export const ease = (frame: number, start: number, dur: number, from = 0, to = 1) =>
  interpolate(frame, [start, start + dur], [from, to], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
/** Linear 0..1 over `dur` frames. */
export const lin = (frame: number, start: number, dur: number, from = 0, to = 1) =>
  interpolate(frame, [start, start + dur], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
/** A spring that starts at `start` (0 before it). */
export const pop = (frame: number, fps: number, start: number, config = POP) =>
  frame < start ? 0 : spring({ frame: frame - start, fps, config });

/** The scene boundaries in frames (nominal cuts; each scene gets 20 extra frames to finish its exit). */
export const SCENE = {
  hook: [0, 216],
  problem: [216, 504],
  reveal: [504, 864],
  rule: [864, 1296],
  end: [1296, 1728],
} as const;
export const TAIL = 20;
export const len = (k: keyof typeof SCENE) => SCENE[k][1] - SCENE[k][0];
