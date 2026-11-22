/** The page's side of the live connection: subscribe to channels, hand over a signed trade, read the connection's state. */
import type { FromWorker, LiveEvent, LiveStatus, ToWorker } from "./live.worker";

export type { LiveEvent, LiveStatus };
export interface Listener {
  /** Changes on the channel, already merged for this frame. */
  events: (events: LiveEvent[]) => void;
  /** The server could not replay what was missed: take a fresh snapshot, then carry on. */
  reset: () => void;
}

let worker: Worker | undefined;
const listeners = new Map<string, Set<Listener>>();
const seqs = new Map<string, number>();
const statusListeners = new Set<(status: LiveStatus, latencyMs: number | null) => void>();
const sends = new Map<string, (answer: { signature?: string; state?: string; error?: string }) => void>();
let current: { status: LiveStatus; latencyMs: number | null } = { status: "connecting", latencyMs: null };
let nextSend = 0;

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./live.worker.ts", import.meta.url), { type: "module", name: "live" });
  worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.kind === "status") {
      current = { status: message.status, latencyMs: message.latencyMs };
      for (const listener of statusListeners) listener(current.status, current.latencyMs);
    } else if (message.kind === "sent") {
      sends.get(message.id)?.(message);
      sends.delete(message.id);
    } else {
      for (const [ch, seq] of Object.entries(message.seqs)) seqs.set(ch, seq);
      for (const ch of message.resets) for (const listener of listeners.get(ch) ?? []) listener.reset();
      for (const [ch, events] of Object.entries(message.frames)) for (const listener of listeners.get(ch) ?? []) listener.events(events);
    }
  });
  const wake = (): void => worker?.postMessage({ op: "wake" } satisfies ToWorker);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake());
  return worker;
}

/**
 * Listens to a channel from frame number `since` (the `seq` that came with the snapshot the page is showing).
 * Returns how to stop. The connection is shared: the same channel asked for twice is subscribed once.
 */
export function subscribe(channel: string, since: number | undefined, listener: Listener): () => void {
  const target = start();
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    target.postMessage({ op: "sub", ch: channel, since } satisfies ToWorker);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size > 0) return;
    listeners.delete(channel);
    seqs.delete(channel);
    target.postMessage({ op: "unsub", ch: channel } satisfies ToWorker);
  };
}

/** Hands a signed transaction to the server over the open connection. Resolves as soon as the network has it. */
export function sendOverLive(transaction: string): Promise<{ signature: string; state: string }> {
  const target = start();
  const id = `s${++nextSend}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sends.delete(id);
      reject(new Error("this site did not answer in time. Check your activity before trying again: the trade may have gone out."));
    }, 15_000);
    sends.set(id, (answer) => {
      clearTimeout(timer);
      if (answer.error || !answer.signature) reject(new Error(answer.error ?? "the trade was not taken"));
      else resolve({ signature: answer.signature, state: answer.state ?? "sent" });
    });
    target.postMessage({ op: "send", id, tx: transaction } satisfies ToWorker);
  });
}

export function onLiveStatus(listener: (status: LiveStatus, latencyMs: number | null) => void): () => void {
  start();
  statusListeners.add(listener);
  listener(current.status, current.latencyMs);
  return () => statusListeners.delete(listener);
}
export const liveStatus = (): { status: LiveStatus; latencyMs: number | null } => current;
