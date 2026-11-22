/** The by-the-minute record of what each coin traded: the figures behind "volume in the last hour" and the trending list. */
import { describe, expect, it } from "vitest";
import { Rolling, WINDOWS, isWindowKey } from "../../lib/server/rolling";

const NOW = 1_800_000_000;
describe("how much each coin traded lately", () => {
  it("counts a trade in every window that reaches back to it, and in none that does not", () => {
    const rolling = new Rolling();
    rolling.add("a", NOW - 30, 5, true);
    rolling.add("a", NOW - 20 * 60, 7, false);
    rolling.add("a", NOW - 3 * 3600, 11, true);
    rolling.add("a", NOW - 20 * 3600, 13, false);
    rolling.add("a", NOW - 30 * 3600, 1_000, true);
    expect(rolling.window("a", WINDOWS.m5, NOW)).toEqual({ volume: 5, trades: 1, buys: 1 });
    expect(rolling.window("a", WINDOWS.h1, NOW)).toEqual({ volume: 12, trades: 2, buys: 1 });
    expect(rolling.window("a", WINDOWS.h6, NOW)).toEqual({ volume: 23, trades: 3, buys: 2 });
    expect(rolling.window("a", WINDOWS.h24, NOW)).toEqual({ volume: 36, trades: 4, buys: 2 });
    expect(rolling.window("nobody", WINDOWS.h24, NOW)).toEqual({ volume: 0, trades: 0, buys: 0 });
  });

  it("gives the same answer whichever way it counts: by the coin's minutes or by the window's", () => {
    const busy = new Rolling();
    let total = 0;
    // A coin that traded in every one of the last 600 minutes: more minutes than a five-minute window has.
    for (let minute = 0; minute < 600; minute++) {
      busy.add("a", NOW - minute * 60, minute + 1, minute % 2 === 0);
      if (minute < 60) total += minute + 1;
    }
    expect(busy.window("a", WINDOWS.h1, NOW).volume).toBe(total);
    expect(busy.window("a", WINDOWS.m5, NOW).volume).toBe(1 + 2 + 3 + 4 + 5);
  });

  it("ranks coins by what they traded in the window asked for, and leaves out the ones that did not trade in it", () => {
    const rolling = new Rolling();
    rolling.add("old-and-big", NOW - 2 * 3600, 900, true);
    rolling.add("new-and-small", NOW - 60, 10, true);
    rolling.add("new-and-bigger", NOW - 90, 40, false);
    expect(rolling.top(WINDOWS.m5, NOW, 10).map((entry) => entry.mint)).toEqual(["new-and-bigger", "new-and-small"]);
    expect(rolling.top(WINDOWS.h6, NOW, 10).map((entry) => entry.mint)).toEqual(["old-and-big", "new-and-bigger", "new-and-small"]);
    expect(rolling.top(WINDOWS.h6, NOW, 1)).toEqual([{ mint: "old-and-big", volume: 900 }]);
    rolling.drop("old-and-big");
    expect(rolling.top(WINDOWS.h24, NOW, 10).map((entry) => entry.mint)).toEqual(["new-and-bigger", "new-and-small"]);
  });

  it("takes a whole minute's candle at once, as it does when the server starts", () => {
    const rolling = new Rolling();
    rolling.add("a", NOW - 120, 500, false, 9, 4);
    expect(rolling.window("a", WINDOWS.m5, NOW)).toEqual({ volume: 500, trades: 9, buys: 4 });
  });

  it("knows its own windows by name and refuses any other", () => {
    for (const key of ["m5", "h1", "h6", "h24"]) expect(isWindowKey(key)).toBe(true);
    for (const key of ["h2", "", "toString", "constructor", 5, null]) expect(isWindowKey(key)).toBe(false);
  });
});
