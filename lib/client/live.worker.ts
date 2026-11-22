/**
 * The page's live connection, in a worker of its own.
 *
 * One websocket to this site's server. Frames are parsed here, off the page's main thread, and handed over
 * at most once per animation frame, already merged: of several updates to the same candle or the same
 * board row inside one frame, only the last matters, so only the last is sent on.
 *
 * It reconnects by itself, with a growing wait, and on reconnecting tells the server the last frame number
 * it saw on each channel, so the server sends what was missed or says to start again from a snapshot.
 */
export type LiveStatus = "connecting" | "live" | "offline";
export type LiveEvent = [string, ...unknown[]];
export type ToWorker = { op: "sub"; ch: string; since?: number } | { op: "unsub"; ch: string } | { op: "send"; id: string; tx: string } | { op: "wake" };
export type FromWorker =
  | { kind: "frames"; frames: Record<string, LiveEvent[]>; resets: string[]; seqs: Record<string, number> }
  | { kind: "status"; status: LiveStatus; latencyMs: number | null; staleMs: number }
  | { kind: "sent"; id: string; signature?: string; state?: string; error?: string };

const HAND_OVER_MS = 16;
const PING_MS = 10_000;
const scope = self as unknown as { postMessage(message: FromWorker): void; location: Location };
const post = (message: FromWorker): void => scope.postMessage(message);

let socket: WebSocket | undefined;
let status: LiveStatus = "connecting";
let latencyMs: number | null = null;
/** How far behind the chain the server said its figures are, at the last ping. */
let staleMs = 0;
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let handOver: ReturnType<typeof setTimeout> | undefined;
/** Channels wanted, with the last frame number seen on each (undefined: none yet). */
const wanted = new Map<string, number | undefined>();
const pending = new Map<string, LiveEvent[]>();
const resets = new Set<string>();
/** Trades handed over while the socket was down are refused at once: a trade must not go out late. */
const awaiting = new Set<string>();

function say(next: LiveStatus): void {
  if (status === next && next !== "live") return;
  status = next;
  post({ kind: "status", status, latencyMs, staleMs });
}

function connect(): void {
  clearTimeout(retry);
  say("connecting");
  const address = `${scope.location.protocol === "https:" ? "wss" : "ws"}://${scope.location.host}/ws`;
  let opened: WebSocket;
  try {
    opened = new WebSocket(address);
  } catch {
    return again();
  }
  socket = opened;
  opened.onopen = () => {
    attempt = 0;
    for (const [ch, since] of wanted) opened.send(JSON.stringify({ t: "sub", ch, ...(since === undefined ? {} : { since }) }));
    ping();
    say("live");
  };
  opened.onmessage = (message) => {
    let frame: {
      ch?: string;
      seq?: number;
      d?: LiveEvent[];
      reset?: boolean;
      t?: string;
      at?: number;
      stale?: number;
      id?: string;
      signature?: string;
      state?: string;
      error?: string;
    };
    try {
      frame = JSON.parse(message.data as string) as typeof frame;
    } catch {
      return;
    }
    if (frame.t === "pong" && typeof frame.at === "number") {
      latencyMs = Math.round(performance.now() - frame.at);
      staleMs = typeof frame.stale === "number" ? frame.stale : 0;
      return post({ kind: "status", status, latencyMs, staleMs });
    }
    if (frame.t === "sent" && typeof frame.id === "string") {
      awaiting.delete(frame.id);
      return post({ kind: "sent", id: frame.id, signature: frame.signature, state: frame.state, error: frame.error });
    }
    if (typeof frame.ch !== "string" || !wanted.has(frame.ch)) return;
    if (typeof frame.seq === "number") wanted.set(frame.ch, frame.seq);
    if (frame.reset) {
      pending.delete(frame.ch);
      resets.add(frame.ch);
    } else if (frame.d) {
      const queue = pending.get(frame.ch);
      if (queue) queue.push(...frame.d);
      else pending.set(frame.ch, frame.d);
    }
    handOver ??= setTimeout(flush, HAND_OVER_MS);
  };
  opened.onclose = () => {
    if (socket !== opened) return;
    socket = undefined;
    for (const id of awaiting)
      post({ kind: "sent", id, error: "the connection to this site dropped as the trade was handed over. Check your activity before trying again." });
    awaiting.clear();
    again();
  };
  opened.onerror = () => opened.close();
}
function again(): void {
  say(attempt > 1 ? "offline" : "connecting");
  // 0.25 s, 0.5 s, 1 s ... up to 5 s, with a little randomness so a crowd does not come back in step.
  const wait = Math.min(5_000, 250 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
  attempt += 1;
  retry = setTimeout(connect, wait);
}
let pinging: ReturnType<typeof setInterval> | undefined;
function ping(): void {
  clearInterval(pinging);
  const once = (): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ping", at: performance.now() }));
  };
  once();
  pinging = setInterval(once, PING_MS);
}

/** Of several updates to one thing inside a frame, the last wins: a candle, a board row, a coin's figures, a holder's balance. */
function merged(events: LiveEvent[]): LiveEvent[] {
  if (events.length < 2) return events;
  const last = new Map<string, number>();
  const patches = new Map<string, Record<string, unknown>>();
  events.forEach((event, index) => {
    const [kind, first, second] = event;
    let key: string | undefined;
    if (kind === "k") key = `k:${(first as number[])[0]}`;
    else if (kind === "h") key = `h:${first as string}`;
    else if (kind === "u") {
      key = `u:${first as string}`;
      // Board patches carry only what changed, so two of them are joined rather than one dropped.
      patches.set(key, { ...patches.get(key), ...(second as Record<string, unknown>) });
    } else if (kind === "m") {
      key = "m";
      patches.set(key, { ...patches.get(key), ...(first as Record<string, unknown>) });
    }
    if (key) last.set(key, index);
  });
  if (last.size === 0) return events;
  const kept: LiveEvent[] = [];
  events.forEach((event, index) => {
    const [kind, first] = event;
    const key =
      kind === "k"
        ? `k:${(first as number[])[0]}`
        : kind === "h"
          ? `h:${first as string}`
          : kind === "u"
            ? `u:${first as string}`
            : kind === "m"
              ? "m"
              : undefined;
    if (key === undefined) return void kept.push(event);
    if (last.get(key) !== index) return;
    if (kind === "u") kept.push(["u", first, patches.get(key)!]);
    else if (kind === "m") kept.push(["m", patches.get(key)!]);
    else kept.push(event);
  });
  return kept;
}
function flush(): void {
  handOver = undefined;
  if (pending.size === 0 && resets.size === 0) return;
  const frames: Record<string, LiveEvent[]> = {};
  for (const [ch, events] of pending) frames[ch] = merged(events);
  const seqs: Record<string, number> = {};
  for (const [ch, seq] of wanted) if (seq !== undefined) seqs[ch] = seq;
  post({ kind: "frames", frames, resets: [...resets], seqs });
  pending.clear();
  resets.clear();
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.op === "sub") {
    wanted.set(message.ch, message.since);
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ t: "sub", ch: message.ch, ...(message.since === undefined ? {} : { since: message.since }) }));
  } else if (message.op === "unsub") {
    wanted.delete(message.ch);
    pending.delete(message.ch);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "unsub", ch: message.ch }));
  } else if (message.op === "send") {
    if (socket?.readyState !== WebSocket.OPEN) return post({ kind: "sent", id: message.id, error: "this site's live connection is down. Nothing was sent." });
    awaiting.add(message.id);
    socket.send(JSON.stringify({ t: "send", id: message.id, tx: message.tx }));
  } else if (message.op === "wake" && !socket) {
    // The tab came back to the front, or the network returned: try now rather than at the end of the wait.
    attempt = 0;
    connect();
  }
});
connect();
