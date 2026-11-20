import React from "react";
import { Composition, Still } from "remotion";
import { Walkthrough } from "./Video";
import { DURATION, FPS, H, W } from "./theme";

export const Root: React.FC = () => (
  <>
    <Composition id="Walkthrough" component={Walkthrough} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
    <Still id="Thumbnail" component={Walkthrough} width={W} height={H} />
  </>
);
