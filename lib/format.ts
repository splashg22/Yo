/**
 * The one place amounts, prices, addresses and times are turned into text, and text back
 * into amounts. Money is whole base units (bigint) everywhere else; only here does it
 * become something with a decimal point, and only as a string.
 */
import { COIN_DECIMALS, SOL_DECIMALS, U64_MAX, decimalsOf } from "./constants";

/** "1.5" with 9 decimals -> 1500000000n. Refuses anything that is not a plain positive number the chain can hold. */
export function parseAmount(text: string, decimals: number): bigint {
  const cleaned = text.trim().replace(/,/g, "");
  const match = /^(\d{1,30})?(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[1] === undefined && !match[2])) throw new Error("enter an amount as a number, such as 1.5");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`that has more than ${decimals} decimal places`);
  const amount = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= 0n) throw new Error("the amount must be above zero");
  if (amount > U64_MAX) throw new Error("that amount is larger than the chain can hold");
  return amount;
}

/** 1500000000n with 9 decimals -> "1.5". Thousands are grouped; trailing zeros are dropped. */
export function formatAmount(amount: bigint | string, decimals: number, maximumPlaces = decimals): string {
  const value = BigInt(amount);
  const digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits
    .slice(digits.length - decimals)
    .slice(0, maximumPlaces)
    .replace(/0+$/, "");
  // A positive amount too small for the places shown must not read as zero.
  if (value !== 0n && whole === "0" && fraction === "") return `${value < 0n ? "-" : ""}<${(10 ** -maximumPlaces).toFixed(maximumPlaces)}`;
  return `${value < 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export const formatCoin = (mint: string, amount: bigint | string, maximumPlaces?: number): string => formatAmount(amount, decimalsOf(mint), maximumPlaces);

/**
 * How many decimal places an amount is shown with when nobody asked for a particular number: enough to
 * mean something, never a wall of digits. 1,234.5 · 12.345 · 0.1234 · 0.001234
 */
function placesFor(amount: bigint, decimals: number): number {
  const size = amount < 0n ? -amount : amount;
  const whole = size / 10n ** BigInt(decimals);
  if (whole >= 1000n) return Math.min(decimals, 1);
  if (whole >= 1n) return Math.min(decimals, 3);
  // Below one: four figures from the first that is not zero.
  const digits = size.toString().padStart(decimals, "0");
  const zeros = digits.length - digits.replace(/^0+/, "").length;
  return Math.min(decimals, zeros + 4);
}
/** An amount of SOL. With no `maximumPlaces` the places follow the size of the amount; pass one where an exact figure matters. */
export const formatSol = (lamports: bigint | string, maximumPlaces?: number): string =>
  `${formatAmount(lamports, SOL_DECIMALS, maximumPlaces ?? placesFor(BigInt(lamports), SOL_DECIMALS))} SOL`;
/** An amount of a coin, sized the same way. */
export const formatTokens = (amount: bigint | string, decimals = COIN_DECIMALS): string => formatAmount(amount, decimals, placesFor(BigInt(amount), decimals));

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
/**
 * A very small decimal, written so its size can be read at a glance: 0.0000000281 becomes 0.0 followed by a
 * small 7 and then 281, the small figure being the number of zeros after the point. Anything with fewer than
 * four such zeros is written out. `text` is a plain decimal such as "0.0000000281".
 */
export function compactZeros(text: string, figures = 4): string {
  const match = /^(-?)0\.(0{4,})(\d+)$/.exec(text);
  if (!match) return text;
  const count = [...String(match[2]!.length)].map((digit) => SUBSCRIPT[Number(digit)]).join("");
  return `${match[1]}0.0${count}${match[3]!.slice(0, figures).replace(/0+$/, "") || "0"}`;
}
/** A coin's price, given in millionths of a lamport, as SOL. Tiny prices are written in the compact form; `exact` gives every digit. */
export function formatPrice(microLamportsPerCoin: bigint | string, exact = false): string {
  const value = BigInt(microLamportsPerCoin);
  if (exact) return `${formatAmount(value, SOL_DECIMALS + 6, SOL_DECIMALS + 6)} SOL`;
  return `${compactZeros(formatAmount(value, SOL_DECIMALS + 6, placesFor(value, SOL_DECIMALS + 6)))} SOL`;
}

/** A plain decimal for a number below one, with no exponent: 2.81e-8 becomes "0.0000000281". */
const plainSmall = (size: number): string => size.toFixed(20).replace(/0+$/, "");

/** 1234567 -> "1.23M". For figures where the size matters more than the last digit: market caps, volumes, holder counts. */
export function formatCompact(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const scaled = (divisor: number, suffix: string): string => {
    const shown = size / divisor;
    return `${sign}${shown >= 100 ? shown.toFixed(0) : shown >= 10 ? shown.toFixed(1) : shown.toFixed(2)}${suffix}`;
  };
  if (size >= 1e12) return scaled(1e12, "T");
  if (size >= 1e9) return scaled(1e9, "B");
  if (size >= 1e6) return scaled(1e6, "M");
  if (size >= 1e4) return scaled(1e3, "K");
  if (size >= 100) return `${sign}${size.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  // A whole number is a count (holders, trades): it has no decimals to show.
  if (Number.isInteger(size)) return `${sign}${size}`;
  if (size >= 1) return `${sign}${size.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (size >= 0.0001) return `${sign}${Number(size.toPrecision(3))}`;
  return `${sign}${compactZeros(plainSmall(size), 3)}`;
}
/** A dollar figure. `compact`: 1,234,567 becomes $1.23M. Otherwise cents above a dollar, three figures below, the compact form when tiny. */
export function formatUsd(usd: number, compact = false): string {
  if (!Number.isFinite(usd)) return "";
  const sign = usd < 0 ? "-" : "";
  const size = Math.abs(usd);
  if (compact && size >= 1e4) return `${sign}$${formatCompact(size)}`;
  if (size >= 1) return `${sign}$${size.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (size === 0) return "$0.00";
  if (size >= 0.0001) return `${sign}$${Number(size.toPrecision(3))}`;
  return `${sign}$${compactZeros(plainSmall(size), 3)}`;
}
/** What an amount of lamports is worth in dollars, as a number for showing. Never used to build anything. */
export const usdOfLamports = (lamports: bigint | string | number, solUsd: number): number => (Number(lamports) / 1e9) * solUsd;
/** The dollar price of one coin whose price is given in millionths of a lamport. */
export const usdOfPrice = (microLamportsPerCoin: bigint | string | number, solUsd: number): number => (Number(microLamportsPerCoin) / 1e15) * solUsd;

/** How long ago, as traders read it: 3s, 5m, 2h, 4d. The exact time is shown beside it on request. */
export function formatAge(milliseconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - milliseconds) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86_400 * 365) return `${Math.floor(seconds / 86_400)}d`;
  return `${Math.floor(seconds / (86_400 * 365))}y`;
}

/** Hundredths of a percent -> "+1.25%". Always two places below a thousand percent; whole percents above. */
export function formatChange(basisPoints: number): string {
  const sign = basisPoints > 0 ? "+" : basisPoints < 0 ? "-" : "";
  const magnitude = Math.abs(basisPoints);
  if (magnitude >= 100_000) return `${sign}${Math.round(magnitude / 100).toLocaleString("en-US")}%`;
  return `${sign}${Math.floor(magnitude / 100).toLocaleString("en-US")}.${String(magnitude % 100).padStart(2, "0")}%`;
}
/** Parts per million -> "15.1700%". */
export function formatShare(partsPerMillion: number): string {
  return `${Math.floor(partsPerMillion / 10_000)}.${String(partsPerMillion % 10_000)
    .padStart(4, "0")
    .slice(0, 2)}%`;
}

export const shortAddress = (address: string): string => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

/** A moment in the reader's own time zone, with the zone named so it cannot be misread. */
export function formatTime(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(milliseconds));
}

export { COIN_DECIMALS, SOL_DECIMALS };
