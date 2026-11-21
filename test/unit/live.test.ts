import { describe, expect, it } from "vitest";
import { Hub, type LiveClient } from "../../lib/server/live";

interface Fake extends LiveClient {
  got: { ch: string; seq?: number; reset?: boolean; d?: unknown[] }[];
  closed: boolean;
  full: boolean;
}
const client = (): Fake => {
  const fake: Fake = {
    got: [],
    closed: false,
    full: false,
    send(text) {
      if (fake.full) return false;
      fake.got.push(JSON.parse(text) as Fake["got"][number]);
      return true;
    },
    close: () => (fake.closed = true),
  };
  return fake;
};

describe("live channels", () => {
  it("sends what changed as one numbered frame per flush, the same text to everyone", () => {
    const hub = new Hub();
    const [a, b] = [client(), client()];
    hub.subscribe(a, "coin:x");
    hub.subscribe(b, "coin:x");
    hub.publish("coin:x", ["t", 1]);
    hub.publish("coin:x", ["t", 2]);
    hub.publish("coin:y", ["t", 9]);
    expect(a.got).toEqual([]); // nothing until the flush
    hub.flush();
    expect(a.got).toEqual([
      {
        ch: "coin:x",
        seq: 1,
        d: [
          ["t", 1],
          ["t", 2],
        ],
      },
    ]);
    expect(b.got).toEqual(a.got);
    hub.publish("coin:x", ["t", 3]);
    hub.flush();
    expect(a.got[1]).toEqual({ ch: "coin:x", seq: 2, d: [["t", 3]] });
    expect(hub.seq("coin:x")).toBe(2);
  });

  it("gives a client that reconnects exactly what it missed, in order", () => {
    const hub = new Hub();
    for (let frame = 1; frame <= 5; frame++) {
      hub.publish("board", ["u", frame]);
      hub.flush();
    }
    const back = client();
    hub.subscribe(back, "board", 3);
    expect(back.got.map((frame) => frame.seq)).toEqual([4, 5]);
    const current = client();
    hub.subscribe(current, "board", 5);
    expect(current.got).toEqual([]); // up to date: nothing to send
  });

  it("tells a client to start again when what it missed is no longer kept, or its number is from another run of the server", () => {
    const hub = new Hub();
    for (let frame = 1; frame <= 300; frame++) {
      hub.publish("board", ["u", frame]);
      hub.flush();
    }
    const late = client();
    hub.subscribe(late, "board", 10); // 290 frames behind; only the last 256 are kept
    expect(late.got).toEqual([{ ch: "board", reset: true, seq: 300 }]);
    const stale = client();
    hub.subscribe(stale, "board", 5000);
    expect(stale.got).toEqual([{ ch: "board", reset: true, seq: 300 }]);
  });

  it("drops a client that cannot keep up, without holding back the others", () => {
    const hub = new Hub();
    const [slow, fine] = [client(), client()];
    hub.subscribe(slow, "board");
    hub.subscribe(fine, "board");
    slow.full = true;
    hub.publish("board", ["u", 1]);
    hub.flush();
    expect(slow.closed).toBe(true);
    expect(fine.got).toHaveLength(1);
    expect(hub.clients).toBe(1);
    expect(hub.dropped).toBe(1);
    hub.publish("board", ["u", 2]);
    hub.flush();
    expect(fine.got).toHaveLength(2);
  });

  it("forgets a client that leaves, and after a reset tells every listener to take a new snapshot", () => {
    const hub = new Hub();
    const [a, b] = [client(), client()];
    hub.subscribe(a, "coin:x");
    hub.subscribe(b, "coin:x");
    hub.leave(a);
    hub.publish("coin:x", ["t", 1]);
    hub.reset("coin:x"); // a reorganisation: what was queued is void
    hub.flush();
    expect(a.got).toEqual([]);
    expect(b.got).toEqual([{ ch: "coin:x", reset: true, seq: 1 }]);
  });
});
