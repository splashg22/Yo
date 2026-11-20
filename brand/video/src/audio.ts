// The soundtrack: a bed and effects synthesized in code (audio/synth.mjs), levelled by audio/mix.mjs to the
// loudness in public/audio/loudness.json, and placed at the frames in cues.json (the mixer reads the same file).
import cues from "./cues.json";

export const AUDIO = {
  bed: cues.bed as string | null,
  bedGain: cues.bedGain,
  cues: cues.cues as { sfx: string; frame: number; gain: number }[],
};
