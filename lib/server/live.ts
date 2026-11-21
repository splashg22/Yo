/**
 * Live data: channels that clients subscribe to, each a numbered stream of small changes.
 *
 * - What changed is queued per channel and sent as one frame per channel at most every FLUSH_MS.
 * - A frame is turned into text once, however many clients receive it.
 * - Each channel numbers its frames. A client that reconnects says the last number it saw and is sent
 *   what it missed, or is told to start again from a snapshot if it was away too long.
 * - A client that cannot keep up is dropped, and catches up when it reconnects, rather than slowing the rest.
 *
 * This file knows nothing of websockets: a client is anything with `send`. The server wires real sockets to it.
 */
export const FLUSH_MS = 40;
const KEPT_FRAMES = 256;
const KEPT_MS = 30_000;

export interface LiveClient {
  /** Sends one text frame. Returns false if the client is too far behind and should be dropped. */
  send(text: string): boolean;
  close(): void;
}
interface Channel {
  seq: number;
  pending: unknown[];
  frames: { seq: number; at: number; text: string }[];
  clients: Set<LiveClient>;
}

export class Hub {
  private readonly channels = new Map<string, Channel>();
  private readonly subscriptions = new Map<LiveClient, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Frames sent since the start, for the health page. */
  sent = 0;
  dropped = 0;

  private channel(name: string): Channel {
    let channel = this.channels.get(name);
    if (!channel) {
      channel = { seq: 0, pending: [], frames: [], clients: new Set() };
      this.channels.set(name, channel);
    }
    return channel;
  }

  /** The number of the last frame sent on a channel. A snapshot taken now is complete up to it. */
  seq(name: string): number {
    return this.channels.get(name)?.seq ?? 0;
  }
  get clients(): number {
    return this.subscriptions.size;
  }
  hasListeners(name: string): boolean {
    return (this.channels.get(name)?.clients.size ?? 0) > 0;
  }

  /** Queues one change for a channel. It goes out with the next flush. */
  publish(name: string, change: unknown): void {
    this.channel(name).pending.push(change);
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Sends everything queued. Called by the timer; tests call it directly. */
  flush(): void {
    this.timer = undefined;
    const now = Date.now();
    for (const [name, channel] of this.channels) {
      if (channel.pending.length === 0) continue;
      channel.seq += 1;
      const text = JSON.stringify({ ch: name, seq: channel.seq, d: channel.pending });
      channel.pending = [];
      channel.frames.push({ seq: channel.seq, at: now, text });
      while (channel.frames.length > KEPT_FRAMES || (channel.frames.length > 0 && now - channel.frames[0]!.at > KEPT_MS)) channel.frames.shift();
      for (const client of channel.clients) this.deliver(client, text);
      // A channel nobody listens to and that has nothing recent is forgotten, so the map does not grow for ever.
      if (channel.clients.size === 0 && channel.frames.length === 0) this.channels.delete(name);
    }
  }
  private deliver(client: LiveClient, text: string): void {
    this.sent += 1;
    if (client.send(text)) return;
    this.dropped += 1;
    this.leave(client);
    client.close();
  }

  /**
   * Subscribes a client. `since` is the last frame number it has (from a snapshot or from before a disconnect).
   * Frames after it are replayed at once. If they are no longer kept, the client is told to take a new snapshot.
   */
  subscribe(client: LiveClient, name: string, since?: number): void {
    const channel = this.channel(name);
    let mine = this.subscriptions.get(client);
    if (!mine) this.subscriptions.set(client, (mine = new Set()));
    mine.add(name);
    channel.clients.add(client);
    if (since === undefined || since >= channel.seq) {
      // Behind nothing; or ahead of us, which means this server restarted and its numbers began again.
      if (since !== undefined && since > channel.seq) this.deliver(client, JSON.stringify({ ch: name, reset: true, seq: channel.seq }));
      return;
    }
    const oldest = channel.frames[0]?.seq;
    if (oldest === undefined || since + 1 < oldest) {
      this.deliver(client, JSON.stringify({ ch: name, reset: true, seq: channel.seq }));
      return;
    }
    for (const frame of channel.frames) if (frame.seq > since) this.deliver(client, frame.text);
  }
  unsubscribe(client: LiveClient, name: string): void {
    this.subscriptions.get(client)?.delete(name);
    this.channels.get(name)?.clients.delete(client);
  }
  /** Forgets a client that has gone. */
  leave(client: LiveClient): void {
    for (const name of this.subscriptions.get(client) ?? []) this.channels.get(name)?.clients.delete(client);
    this.subscriptions.delete(client);
  }
  /** Tells every listener of a channel to start again from a snapshot: used after a reorganisation. */
  reset(name: string): void {
    const channel = this.channels.get(name);
    if (!channel) return;
    channel.pending = [];
    channel.frames = [];
    channel.seq += 1;
    const text = JSON.stringify({ ch: name, reset: true, seq: channel.seq });
    for (const client of channel.clients) this.deliver(client, text);
  }
  /** Sends one message to one client, outside any channel: the answer to something it asked. */
  tell(client: LiveClient, message: unknown): void {
    this.deliver(client, JSON.stringify(message));
  }
  subscriptionsOf(client: LiveClient): number {
    return this.subscriptions.get(client)?.size ?? 0;
  }
}
