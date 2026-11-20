// Audio placeholders. Nothing ships until a licensed file is supplied (see README › Audio):
// drop the files into public/audio/ and set the paths here; the composition's <Audio> elements are gated on them.
export const AUDIO: { bed: string | null; sfx: Partial<Record<keyof typeof CUES, string>> } = {
  bed: null, // e.g. "audio/bed.mp3" — one music bed, 38 s or longer, licensed for online video
  sfx: {},   // e.g. { click: "audio/click.wav" }
};
/** Cue points in seconds, for the bed's accents and the sound effects. */
export const CUES = {
  logoBloom: 0.9,
  typeSnap: 5.3,
  pageRise: 7.4,
  barDraw: 13.4,
  tilePops: 20.0,
  click: 23.7,
  copyClick: 30.5,
  endBloom: 31.8,
} as const;
