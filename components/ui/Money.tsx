"use client";

/**
 * Figures as they are shown: SOL with its dollar value beside it, a coin's price in both, and times as
 * "how long ago" with the exact moment a tap away. One place, so every page shows them the same way.
 */
import { clockNow } from "@/lib/client/clock";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { formatAge, formatPrice, formatSol, formatTime, formatUsd, usdOfLamports, usdOfPrice } from "@/lib/format";

interface SolPrice {
  usd: number;
  at: number;
  source: string;
}
const PriceContext = createContext<SolPrice | null>(null);

/** Reads the price of SOL when the site opens and every half minute. With no price, dollar figures are simply left out. */
export function PriceProvider({ children, initial = null }: { children: ReactNode; initial?: SolPrice | null }) {
  // `initial` is the price the server rendered the page with: the same figures are there before and after the page wakes up.
  const [price, setPrice] = useState<SolPrice | null>(initial);
  useEffect(() => {
    let stopped = false;
    const read = () =>
      void api("price/sol").then(
        (answer) => !stopped && setPrice(answer.price),
        () => undefined, // an older price stays until a newer one arrives
      );
    read();
    const timer = setInterval(read, 30_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return <PriceContext.Provider value={price}>{children}</PriceContext.Provider>;
}
/** The price of SOL in dollars, or null if there is none worth showing. */
export const useSolPrice = (): SolPrice | null => useContext(PriceContext);

/** An amount of SOL, with its dollar value beside it when the price is known. The exact figure is the tooltip. */
export function Sol({ lamports, places, stack, compact }: { lamports: bigint | string; places?: number; stack?: boolean; compact?: boolean }) {
  const price = useSolPrice();
  return (
    <span className={`money num${stack ? " stack" : ""}`} title={formatSol(lamports, 9)}>
      <span>{formatSol(lamports, places)}</span>
      {price && <span className="usd">{formatUsd(usdOfLamports(lamports, price.usd), compact)}</span>}
    </span>
  );
}
/** Only the dollar value of an amount of SOL: for places too tight for both. Falls back to SOL when there is no price. */
export function UsdOfSol({ lamports, compact = true }: { lamports: bigint | string | number; compact?: boolean }) {
  const price = useSolPrice();
  const exact = formatSol(BigInt(Math.round(Number(lamports))), 9);
  if (!price)
    return (
      <span className="num" title={exact}>
        {formatSol(BigInt(Math.round(Number(lamports))))}
      </span>
    );
  return (
    <span className="num" title={exact}>
      {formatUsd(usdOfLamports(lamports, price.usd), compact)}
    </span>
  );
}
/** A coin's price: in SOL, written so a tiny figure can be read, with dollars beside it. */
export function CoinPrice({ micro, stack }: { micro: bigint | string | number; stack?: boolean }) {
  const price = useSolPrice();
  const value = BigInt(Math.round(Number(micro)));
  return (
    <span className={`money num${stack ? " stack" : ""}`} title={formatPrice(value, true)}>
      <span>{formatPrice(value)}</span>
      {price && <span className="usd">{formatUsd(usdOfPrice(value, price.usd))}</span>}
    </span>
  );
}

// One clock for every age on the page: a single timer, and each figure re-renders only when its own text changes.
let now = clockNow();
const watchers = new Set<() => void>();
let clock: ReturnType<typeof setInterval> | undefined;
function watch(listener: () => void): () => void {
  watchers.add(listener);
  // Read again as soon as anything is watching: the page's clock may have been set since this file was loaded.
  now = clockNow();
  clock ??= setInterval(() => {
    now = clockNow();
    for (const each of watchers) each();
  }, 1000);
  return () => {
    watchers.delete(listener);
    if (watchers.size === 0) {
      clearInterval(clock);
      clock = undefined;
    }
  };
}
/** The current time, to the second, shared by everything that shows an age. */
export function useNow(): number {
  return useSyncExternalStore(
    watch,
    () => now,
    () => 0,
  );
}

/** A moment: shown as how long ago ("3s", "5m"), with the exact time as the tooltip and shown in place when tapped. */
export function Time({ at }: { at: number }) {
  const [exact, setExact] = useState(false);
  const age = useSyncExternalStore(
    watch,
    () => formatAge(at, now),
    () => "",
  );
  return (
    <button type="button" className="when" aria-pressed={exact} title={formatTime(at)} onClick={() => setExact(!exact)}>
      {exact ? formatTime(at) : age}
    </button>
  );
}

/** An age as plain text, for inside a link or a button, where a second thing to press would be wrong. */
export function Age({ at }: { at: number }) {
  const age = useSyncExternalStore(
    watch,
    () => formatAge(at, now),
    () => "",
  );
  return (
    <span className="mono" title={formatTime(at)}>
      {age}
    </span>
  );
}
