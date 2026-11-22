/**
 * How the server hands two things to the page it is rendering, as request headers it sets itself: the price of SOL
 * and what this build runs on. The first HTML then already holds the dollar figures and the right notice, and
 * nothing moves when the page would otherwise have fetched them. Read in app/layout.tsx, set in server/app.ts.
 */
import type { Config } from "./contract";

export const PRICE_HEADER = "x-ring-sol-price";

export interface HandedPrice {
  usd: number;
  at: number;
  source: string;
}
/** Reads the header. Anything that is not a price is no price. */
export function parseHandedPrice(text: string | null | undefined): HandedPrice | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<HandedPrice> | null;
    if (!value || typeof value.usd !== "number" || !Number.isFinite(value.usd) || value.usd <= 0) return null;
    if (typeof value.at !== "number" || !Number.isFinite(value.at) || typeof value.source !== "string") return null;
    return { usd: value.usd, at: value.at, source: value.source.slice(0, 120) };
  } catch {
    return null;
  }
}

export const CONFIG_HEADER = "x-ring-config";
/** Reads the build's settings from the header. Anything that is not exactly the expected shape is no settings, and the page asks for them itself. */
export function parseHandedConfig(text: string | null | undefined): Config | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<Config> | null;
    if (!value || (value.network !== "local" && value.network !== "devnet" && value.network !== "mainnet")) return null;
    if (value.ring !== "mock" && value.ring !== "real" && value.ring !== "unavailable") return null;
    if (typeof value.features?.sealedWindow !== "boolean") return null;
    const fees = value.fees;
    if (!fees || typeof fees.wallet !== "string" || !/^\d{1,12}$/.test(fees.launchLamports)) return null;
    if (!Number.isInteger(fees.tradeBps) || !Number.isInteger(fees.otcBps) || fees.tradeBps < 0 || fees.otcBps < 0) return null;
    const recording = value.recording;
    const played = recording && [recording.from, recording.to, recording.now].every((moment) => Number.isSafeInteger(moment) && moment > 0);
    return {
      network: value.network,
      ...(played ? { recording: { from: recording.from, to: recording.to, now: recording.now } } : {}),
      ring: value.ring,
      features: { sealedWindow: value.features.sealedWindow },
      fees: { wallet: fees.wallet.slice(0, 44), tradeBps: fees.tradeBps, launchLamports: fees.launchLamports, otcBps: fees.otcBps },
    };
  } catch {
    return null;
  }
}
