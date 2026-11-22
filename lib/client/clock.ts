/**
 * What time it is, for everything on a page that shows an age or measures "the last hour".
 * The real time, except when the server is playing back a recording: then it is the recording's clock, so a coin made
 * ten seconds before the newest trade played reads as ten seconds old, not as old as the recording is.
 */
let behind = 0;
let last = Infinity;
/** Called once, with the server's own account of its playback: how far it has got, and where the recording ends. */
export function followRecording(recording: { now: number; to: number } | undefined): void {
  behind = recording === undefined ? 0 : Math.max(0, Date.now() - recording.now);
  last = recording === undefined ? Infinity : recording.to;
}
// A recording played to its end stays at its last moment: its coins do not go on ageing with nothing happening.
export const clockNow = (): number => Math.min(Date.now() - behind, last);
