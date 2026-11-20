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
import { Dash } from "./scenes/Dash";
import { History } from "./scenes/History";
import { End } from "./scenes/End";
import { FPS, SCENE, TAIL } from "./theme";
import { AUDIO, CUES } from "./audio";

const scenes: [keyof typeof SCENE, React.FC][] = [["hook", Hook], ["problem", Problem], ["reveal", Reveal], ["rule", Rule], ["dash", Dash], ["history", History], ["end", End]];

/** The whole walkthrough: footage under seven scenes, each overlapping the next by its exit (TAIL). */
export const Walkthrough: React.FC = () => (
  <AbsoluteFill className="frame">
    {AUDIO.bed && <Audio src={staticFile(AUDIO.bed)} volume={0.9} />}
    {Object.entries(AUDIO.sfx).map(([cue, file]) => file && (
      <Sequence key={cue} from={Math.round(CUES[cue as keyof typeof CUES] * FPS)} layout="none"><Audio src={staticFile(file)} /></Sequence>
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
