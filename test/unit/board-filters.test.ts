import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  FIGURES,
  NO_FILTERS,
  countSet,
  decodeFilters,
  encodeFilters,
  matches,
  parsePresets,
  serialisePresets,
  type BoardFilters,
} from "../../lib/board-filters";
import type { CoinView } from "../../lib/contract";

const NOW = 1_800_000_000_000;
const coin = (over: Partial<CoinView> = {}): CoinView =>
  ({
    mint: "m",
    name: "Lantern",
    symbol: "LNT",
    creator: "c",
    createdAt: NOW - 10 * 60_000,
    signature: "",
    launchedHere: false,
    marketCapLamports: "40000000000",
    microLamportsPerCoin: "40",
    volume24hLamports: "12000000000",
    liquidityLamports: "8000000000",
    buys24h: 30,
    sells24h: 10,
    complete: false,
    hasPool: false,
    progressBps: 2500,
    holders: 60,
    trades: 40,
    risk: {
      top10Bps: 2000,
      devBps: 300,
      devSells: 0,
      snipers: { wallets: 4, heldBps: 600 },
      bundles: { wallets: 3, heldBps: 400 },
      insiders: { wallets: 0, heldBps: 0 },
    },
    ...over,
  }) as CoinView;
const only = (key: string, range: { min?: string; max?: string }): BoardFilters => ({ hereOnly: false, ranges: { [key]: range } });

describe("the board's filters", () => {
  it("let everything through when nothing is set", () => {
    expect(matches(coin(), NO_FILTERS, NOW)).toBe(true);
    expect(countSet(NO_FILTERS)).toBe(0);
  });

  it("hold every figure to its lowest and highest allowed value, in the figure's own unit", () => {
    const facts: Record<string, number> = {
      age: 10,
      cap: 40,
      liquidity: 8,
      volume: 12,
      buys: 30,
      sells: 10,
      holders: 60,
      progress: 25,
      top10: 20,
      dev: 3,
      snipers: 6,
      bundles: 4,
      insiders: 0,
    };
    // Every figure the board has is covered here.
    expect(Object.keys(facts).sort()).toEqual(FIGURES.map((figure) => figure.key).sort());
    for (const [key, value] of Object.entries(facts)) {
      expect(matches(coin(), only(key, { min: String(value) }), NOW), `${key} at least its own value`).toBe(true);
      expect(matches(coin(), only(key, { max: String(value) }), NOW), `${key} at most its own value`).toBe(true);
      expect(matches(coin(), only(key, { min: String(value + 0.5) }), NOW), `${key} at least a little more`).toBe(false);
      if (value > 0) expect(matches(coin(), only(key, { max: String(value - 0.5) }), NOW), `${key} at most a little less`).toBe(false);
    }
  });

  it("fail a coin on a figure that is not known for it, and never treat not known as zero", () => {
    const seenLate = coin({ followedSince: NOW - 60_000, risk: { top10Bps: 2000, devBps: 0, devSells: 0, snipers: null, bundles: null, insiders: null } });
    for (const key of ["snipers", "bundles", "insiders", "dev", "age"]) expect(matches(seenLate, only(key, { max: "100" }), NOW), key).toBe(false);
    // Its holders and its top ten are floors: only wallets seen since it was first followed. A floor is not the figure.
    for (const key of ["top10", "holders"]) expect(matches(seenLate, only(key, { max: "1000000" }), NOW), key).toBe(false);
    // What is known of it still filters as usual.
    expect(matches(seenLate, only("cap", { min: "0" }), NOW)).toBe(true);
    // A coin this site cannot read has no risk figures at all.
    expect(matches(coin({ risk: undefined }), only("top10", { max: "100" }), NOW)).toBe(false);
  });

  it("ignore a field that does not read as a number, and count only what is really set", () => {
    const filters: BoardFilters = {
      hereOnly: true,
      ranges: { cap: { min: "abc" }, holders: { min: "50", max: "" }, nothing: { min: "1" }, top10: { max: "-4" } },
    };
    expect(countSet(filters)).toBe(2); // holders, and "launched here"
    expect(matches(coin({ launchedHere: true }), filters, NOW)).toBe(true);
    expect(matches(coin(), filters, NOW)).toBe(false);
  });

  it("treat a graduated coin as having sold its whole curve", () => {
    expect(matches(coin({ complete: true, progressBps: 0 }), only("progress", { min: "100" }), NOW)).toBe(true);
  });
});

describe("filters in a link, and presets in the browser", () => {
  it("survive being written into a link and read back", () => {
    for (const preset of BUILT_IN_PRESETS) expect(decodeFilters(encodeFilters(preset.filters)), preset.name).toEqual(preset.filters);
    const mixed: BoardFilters = { hereOnly: true, ranges: { cap: { min: "5", max: "250.5" }, age: { max: "30" } } };
    expect(encodeFilters(mixed)).toBe("cap:5-250.5,age:-30,here");
    expect(decodeFilters("cap:5-250.5,age:-30,here")).toEqual(mixed);
  });

  it("read nothing dangerous or unknown out of a link", () => {
    expect(decodeFilters(null)).toEqual(NO_FILTERS);
    expect(decodeFilters("<script>:1-2,unknown:1-2,cap:x-y,cap:,holders:10-,__proto__:1-2")).toEqual({ hereOnly: false, ranges: { holders: { min: "10" } } });
  });

  it("keep saved presets, drop damaged ones, and never let a saved one take a built-in's name", () => {
    const mine = { name: "Mine", filters: only("cap", { min: "100" }) };
    const stored = serialisePresets([...BUILT_IN_PRESETS, mine]);
    expect(JSON.parse(stored)).toEqual([{ name: "Mine", code: "cap:100-" }]);
    expect(parsePresets(stored)).toEqual([mine]);
    expect(parsePresets("{not json")).toEqual([]);
    expect(parsePresets('{"a":1}')).toEqual([]);
    const messy = JSON.stringify([
      { name: "Very early", code: "age:-1" },
      { name: "  ", code: "" },
      { name: 5, code: "x" },
      { name: "Ok", code: "holders:5-" },
      { name: "Ok", code: "holders:9-" },
      null,
    ]);
    expect(parsePresets(messy)).toEqual([{ name: "Ok", filters: only("holders", { min: "5" }) }]);
  });
});
