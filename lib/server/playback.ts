/**
 * Set only when the server is playing back a recorded stretch of the chain (scripts/replay-server.ts) instead of
 * following it. Every page then says so in a bar that cannot be dismissed: a recording is never shown as live.
 */
export interface Playback {
  /** The first and last moments of the recording, in milliseconds. */
  from: number;
  to: number;
  /** How far the playback has got: the time of the newest block played, in milliseconds. */
  now: number;
}
let playing: (() => Playback) | undefined;
export function setPlayback(read: (() => Playback) | undefined): void {
  playing = read;
}
export const playback = (): Playback | undefined => playing?.();
