/** A split withdrawal waiting in the browser: what is due, what is never sent twice, what bad storage does. */
import { describe, expect, it } from "vitest";
import { SENDING_LIMIT_MS, newPlan, nextDue, parsePlans, planOutstanding, planOver, withPart } from "../../lib/client/withdraw-queue";

const NOW = 1_800_000_000_000;
const plan = (id: string, offsets: number[]) =>
  newPlan({
    id,
    mint: "So11111111111111111111111111111111111111112",
    destination: "",
    now: NOW,
    parts: offsets.map((afterMs, index) => ({ amount: BigInt(100 + index), afterMs })),
  });

describe("a split withdrawal's queue", () => {
  it("starts with every part waiting, due at its own time", () => {
    const made = plan("a", [0, 60_000, 300_000]);
    expect(made.parts.map((part) => [part.amount, part.dueAt - NOW, part.state])).toEqual([
      ["100", 0, "waiting"],
      ["101", 60_000, "waiting"],
      ["102", 300_000, "waiting"],
    ]);
    expect(planOutstanding(made)).toBe(303n);
    expect(planOver(made)).toBe(false);
  });

  it("gives the earliest due part across plans, and nothing before its time", () => {
    const plans = [plan("a", [0, 60_000]), plan("b", [0])];
    expect(nextDue(plans, NOW - 1)).toBeNull();
    expect(nextDue(plans, NOW)).toEqual({ plan: "a", index: 0 });
    const afterFirst = withPart(plans, "a", 0, { state: "sent", signature: "sig" });
    expect(nextDue(afterFirst, NOW)).toEqual({ plan: "b", index: 0 });
    const afterBoth = withPart(afterFirst, "b", 0, { state: "sent" });
    expect(nextDue(afterBoth, NOW + 59_999)).toBeNull();
    expect(nextDue(afterBoth, NOW + 60_000)).toEqual({ plan: "a", index: 1 });
    expect(planOver(afterBoth[1]!)).toBe(true);
    expect(planOutstanding(afterBoth[0]!)).toBe(101n);
  });

  it("sends nothing while any part is being sent, and never picks a failed or interrupted part by itself", () => {
    const sending = withPart([plan("a", [0, 0]), plan("b", [0])], "a", 0, { state: "sending", startedAt: NOW });
    expect(nextDue(sending, NOW + 10)).toBeNull();
    const failed = withPart(withPart([plan("a", [0, 0])], "a", 0, { state: "failed", problem: "no" }), "a", 1, { state: "interrupted" });
    expect(nextDue(failed, NOW + 10)).toBeNull();
  });

  it("reads a part cut off mid-send as interrupted only once a withdrawal could no longer be under way", () => {
    const stored = JSON.stringify(withPart([plan("a", [0, 0])], "a", 0, { state: "sending", startedAt: NOW }));
    expect(parsePlans(stored, NOW + 1000)[0]!.parts[0]!.state).toBe("sending");
    expect(parsePlans(stored, NOW + SENDING_LIMIT_MS + 1)[0]!.parts[0]!.state).toBe("interrupted");
    // Without a start time there is nothing to wait for.
    const undated = JSON.stringify(withPart([plan("a", [0])], "a", 0, { state: "sending" }));
    expect(parsePlans(undated, NOW)[0]!.parts[0]!.state).toBe("interrupted");
  });

  it("ignores storage that is not a list of plans, entry by entry", () => {
    expect(parsePlans(null)).toEqual([]);
    expect(parsePlans("{not json")).toEqual([]);
    expect(parsePlans('{"a":1}')).toEqual([]);
    const good = plan("a", [0]);
    const mixed = JSON.stringify([
      good,
      { id: "b" },
      { ...good, id: "c", parts: [{ amount: "-5", dueAt: 1, state: "waiting" }] },
      { ...good, id: "d", parts: [{ amount: "5", dueAt: 1, state: "paid" }] },
      7,
    ]);
    expect(parsePlans(mixed, NOW).map((entry) => entry.id)).toEqual(["a"]);
  });
});
