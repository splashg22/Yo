// The Higgsfield footage under each scene, cross-dissolved at the cuts and darkened so the UI reads.
import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { SCENE, TAIL, s } from "./theme";

type Clip = { src: string; from: number; to: number; startFrom?: number; rate?: number; shade: number; zoom?: [number, number] };
const X = 24; // dissolve length
const CLIPS: Clip[] = [
  { src: "bay", from: SCENE.hook[0], to: SCENE.hook[1] + TAIL, shade: 0.42, zoom: [1.06, 1] },
  { src: "grid", from: SCENE.problem[0], to: SCENE.problem[1] + TAIL, rate: 0.95, shade: 0.55, zoom: [1, 1.05] },
  { src: "sky", from: SCENE.reveal[0], to: SCENE.reveal[1] + TAIL, rate: 0.78, shade: 0.3 },
  { src: "tickets", from: SCENE.rule[0], to: SCENE.rule[1] + TAIL, shade: 0.62, zoom: [1.04, 1] },
  { src: "bay", from: SCENE.end[0], to: SCENE.end[1], startFrom: s(2.5), shade: 0.5, zoom: [1.06, 1] },
];

const ClipLayer: React.FC<{ c: Clip }> = ({ c }) => {
  const f = useCurrentFrame();
  const d = c.to - c.from;
  // The very first clip is there from frame 0; every other one dissolves in over X frames.
  const fadeIn = c.from === 0 ? 1 : interpolate(f, [0, X], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(f, [d - X, d], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const o = fadeIn * fadeOut;
  const z = c.zoom ? interpolate(f, [0, d], c.zoom) : 1;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <OffthreadVideo src={staticFile(`footage/${c.src}.mp4`)} muted startFrom={c.startFrom ?? 0} playbackRate={c.rate ?? 1} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z})` }} />
      <AbsoluteFill style={{ background: `rgba(11,3,8,${c.shade})` }} />
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(11,3,8,0.1), rgba(11,3,8,0) 30%, rgba(11,3,8,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};

export const Backgrounds: React.FC = () => (
  <AbsoluteFill style={{ background: "#0b0308" }}>
    {CLIPS.map((c, i) => (
      <Sequence key={i} from={c.from} durationInFrames={c.to - c.from} layout="none">
        <ClipLayer c={c} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
