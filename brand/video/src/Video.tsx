import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import "./fonts";
import "../../../web/ui.css";
import "./site.css";
import { Backgrounds } from "./Backgrounds";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Reveal } from "./scenes/Reveal";
import { Rule } from "./scenes/Rule";
import { End } from "./scenes/End";
import { SCENE, TAIL } from "./theme";
import { AUDIO } from "./audio";

const scenes: [keyof typeof SCENE, React.FC][] = [["hook", Hook], ["problem", Problem], ["reveal", Reveal], ["rule", Rule], ["end", End]];

/** The whole walkthrough: footage under five scenes, each overlapping the next by its exit (TAIL). */
export const Walkthrough: React.FC = () => (
  <AbsoluteFill className="frame">
    {AUDIO.bed && <Audio src={staticFile(AUDIO.bed)} volume={AUDIO.bedGain} />}
    {AUDIO.cues.map((c, i) => (
      <Sequence key={i} from={c.frame} layout="none"><Audio src={staticFile(`audio/sfx-${c.sfx}.wav`)} volume={c.gain} /></Sequence>
    ))}
    <Backgrounds />
    {scenes.map(([k, Comp]) => {
      const [from, to] = SCENE[k];
      const tail = k === "end" ? 0 : TAIL;
      return (
        <Sequence key={k} from={from} durationInFrames={to - from + tail} layout="none">
          <Comp />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
