/**
 * The board's filters: a lowest and a highest allowed value for every figure a row shows, and sets of them
 * saved under a name. Pure: the same coin and the same filters always give the same answer.
 *
 * A figure that is not known for a coin (its launch was not watched, so nobody can say how many snipers it had)
 * fails any filter set on that figure. A filter is a demand for evidence, and "not known" is not evidence.
 */
import type { CoinView } from "./contract";

export interface Figure {
  key: string;
  /** What the filter's two fields are headed with. */
  label: string;
  unit: "SOL" | "%" | "minutes" | "";
  /** The coin's value in the figure's own unit, or null when it is not known. */
  of: (coin: CoinView, now: number) => number | null;
}
const sol = (lamports: string): number => Number(BigInt(lamports)) / 1e9;
const percent = (bps: number | undefined | null): number | null => (bps === undefined || bps === null ? null : bps / 100);

export const FIGURES: Figure[] = [
  { key: "age", label: "Age", unit: "minutes", of: (coin, now) => (coin.followedSince === undefined ? (now - coin.createdAt) / 60_000 : null) },
  { key: "cap", label: "Market cap", unit: "SOL", of: (coin) => sol(coin.marketCapLamports) },
  { key: "liquidity", label: "Liquidity", unit: "SOL", of: (coin) => sol(coin.liquidityLamports) },
  { key: "volume", label: "Volume, 24h", unit: "SOL", of: (coin) => sol(coin.volume24hLamports) },
  { key: "buys", label: "Buys, 24h", unit: "", of: (coin) => coin.buys24h },
  { key: "sells", label: "Sells, 24h", unit: "", of: (coin) => coin.sells24h },
  { key: "holders", label: "Holders", unit: "", of: (coin) => coin.holders },
  { key: "progress", label: "Curve sold", unit: "%", of: (coin) => (coin.complete ? 100 : coin.progressBps / 100) },
  { key: "top10", label: "Top ten hold", unit: "%", of: (coin) => percent(coin.risk?.top10Bps) },
  { key: "dev", label: "Dev holds", unit: "%", of: (coin) => (coin.followedSince === undefined ? percent(coin.risk?.devBps) : null) },
  { key: "snipers", label: "Snipers hold", unit: "%", of: (coin) => percent(coin.risk?.snipers?.heldBps) },
  { key: "bundles", label: "Bundles hold", unit: "%", of: (coin) => percent(coin.risk?.bundles?.heldBps) },
  { key: "insiders", label: "Insiders hold", unit: "%", of: (coin) => percent(coin.risk?.insiders?.heldBps) },
];
const BY_KEY = new Map(FIGURES.map((figure) => [figure.key, figure]));

/** For each figure, what was typed as its lowest and highest allowed value. Empty: no limit. */
export type Ranges = Record<string, { min?: string; max?: string }>;
export interface BoardFilters {
  ranges: Ranges;
  /** Only coins launched on this site. */
  hereOnly: boolean;
}
export const NO_FILTERS: BoardFilters = { ranges: {}, hereOnly: false };

const numberOf = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const value = Number(text.trim().replace(/,/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : null;
};
/** The filters that are actually set, as numbers. A field that does not read as a number sets nothing. */
export function limitsOf(filters: BoardFilters): { figure: Figure; min: number | null; max: number | null }[] {
  const limits = [];
  for (const [key, range] of Object.entries(filters.ranges)) {
    const figure = BY_KEY.get(key);
    const [min, max] = [numberOf(range.min), numberOf(range.max)];
    if (figure && (min !== null || max !== null)) limits.push({ figure, min, max });
  }
  return limits;
}
export function matches(coin: CoinView, filters: BoardFilters, now: number, limits = limitsOf(filters)): boolean {
  if (filters.hereOnly && !coin.launchedHere) return false;
  for (const { figure, min, max } of limits) {
    const value = figure.of(coin, now);
    if (value === null) return false;
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
  }
  return true;
}
/** How many filters are set: shown on the button that opens them. */
export const countSet = (filters: BoardFilters): number => limitsOf(filters).length + (filters.hereOnly ? 1 : 0);

// ---- presets ---------------------------------------------------------------------------------

export interface Preset {
  name: string;
  filters: BoardFilters;
  /** True for the ones that come with the site. They can be copied and changed, not removed. */
  builtIn?: boolean;
}
/**
 * Starting points, not advice. The numbers are round and arguable on purpose; none of them makes a coin safe.
 * "Spread holdings" asks for evidence about the launch, so a coin whose launch was not watched does not pass it.
 */
export const BUILT_IN_PRESETS: Preset[] = [
  {
    name: "Spread holdings",
    builtIn: true,
    filters: {
      hereOnly: false,
      ranges: { top10: { max: "30" }, dev: { max: "5" }, snipers: { max: "10" }, bundles: { max: "10" }, insiders: { max: "5" }, holders: { min: "50" } },
    },
  },
  { name: "Very early", builtIn: true, filters: { hereOnly: false, ranges: { age: { max: "5" } } } },
  { name: "Migration watch", builtIn: true, filters: { hereOnly: false, ranges: { progress: { min: "80" } } } },
];

/** Filters as a short piece of text for a link, and back. Unknown figures and stray fields are dropped on the way back. */
export function encodeFilters(filters: BoardFilters): string {
  const parts: string[] = [];
  for (const { figure } of limitsOf(filters)) {
    const range = filters.ranges[figure.key]!;
    parts.push(`${figure.key}:${(range.min ?? "").trim()}-${(range.max ?? "").trim()}`);
  }
  if (filters.hereOnly) parts.push("here");
  return parts.join(",");
}
export function decodeFilters(text: string | null | undefined): BoardFilters {
  const filters: BoardFilters = { ranges: {}, hereOnly: false };
  for (const part of (text ?? "").split(",")) {
    if (part === "here") {
      filters.hereOnly = true;
      continue;
    }
    const found = /^([a-z0-9]+):([0-9.]*)-([0-9.]*)$/.exec(part);
    if (!found || !BY_KEY.has(found[1]!)) continue;
    const range = { ...(found[2] ? { min: found[2] } : {}), ...(found[3] ? { max: found[3] } : {}) };
    if (numberOf(range.min) !== null || numberOf(range.max) !== null) filters.ranges[found[1]!] = range;
  }
  return filters;
}
/** Presets as kept in the browser, read back with nothing trusted: a damaged or foreign entry is left out. */
export function parsePresets(stored: string | null): Preset[] {
  let found: unknown;
  try {
    found = JSON.parse(stored ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(found)) return [];
  const presets: Preset[] = [];
  for (const entry of found as { name?: unknown; code?: unknown }[]) {
    if (typeof entry?.name !== "string" || typeof entry.code !== "string") continue;
    const name = entry.name.trim().slice(0, 40);
    if (name === "" || presets.some((preset) => preset.name === name) || BUILT_IN_PRESETS.some((preset) => preset.name === name)) continue;
    presets.push({ name, filters: decodeFilters(entry.code) });
  }
  return presets.slice(0, 30);
}
export const serialisePresets = (presets: Preset[]): string =>
  JSON.stringify(presets.filter((preset) => !preset.builtIn).map((preset) => ({ name: preset.name, code: encodeFilters(preset.filters) })));
