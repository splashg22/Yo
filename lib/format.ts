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
export const formatSol = (lamports: bigint | string, maximumPlaces = 4): string => `${formatAmount(lamports, SOL_DECIMALS, maximumPlaces)} SOL`;

/** A coin's price, given in millionths of a lamport, as SOL. */
export const formatPrice = (microLamportsPerCoin: bigint | string): string => `${formatAmount(microLamportsPerCoin, SOL_DECIMALS + 6, 12)} SOL`;

/** Hundredths of a percent -> "+1.25%". */
export function formatChange(basisPoints: number): string {
  const sign = basisPoints > 0 ? "+" : basisPoints < 0 ? "-" : "";
  const magnitude = Math.abs(basisPoints);
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
