/** Turns pump.fun's own event bytes into the indexer's events. The decoding itself is the pump SDK's. */
import type * as PumpSdk from "@pump-fun/pump-sdk";
import type BN from "bn.js";
import { createRequire } from "node:module";
import type { ChainEvent } from "./types";

const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;
export const PUMP_PROGRAM = sdk.PUMP_PROGRAM_ID.toBase58();
export const AMM_PROGRAM = sdk.PUMP_AMM_PROGRAM_ID.toBase58();
const WSOL = "So11111111111111111111111111111111111111112";
const big = (value: BN): bigint => BigInt(value.toString());

interface IdlEvent {
  name: string;
  discriminator: number[];
}
const discriminators = (events: IdlEvent[]): Map<string, string> =>
  new Map(events.map((event) => [Buffer.from(event.discriminator).toString("hex"), event.name]));
const CURVE_EVENTS = discriminators((sdk.pumpIdl as unknown as { events: IdlEvent[] }).events);
const ammIdl = (sdk.getPumpAmmProgram as unknown as (connection: unknown) => { idl: { events: IdlEvent[] } })({ rpcEndpoint: "http://localhost" }).idl;
const AMM_EVENTS = discriminators(ammIdl.events);
/** Anchor writes an event as a call to the program itself, whose data starts with this marker. */
const EVENT_CALL = Buffer.from("e445a52e51cb9a1d", "hex");

/** One event from its bytes (discriminator first), or null if it is not one the indexer follows or cannot be read. */
export function decodeEvent(program: string, data: Buffer): ChainEvent | null {
  if (data.length < 8) return null;
  const tag = data.subarray(0, 8).toString("hex");
  const body = data.subarray(8);
  try {
    if (program === PUMP_PROGRAM) {
      const name = CURVE_EVENTS.get(tag);
      if (name === "TradeEvent") {
        const event = sdk.PUMP_SDK.decodeTradeEventBc(body);
        return {
          kind: "trade",
          venue: "curve",
          mint: event.mint.toBase58(),
          wallet: event.user.toBase58(),
          isBuy: event.isBuy,
          sol: big(event.solAmount),
          tokens: big(event.tokenAmount),
          virtualSol: big(event.virtualSolReserves),
          virtualTokens: big(event.virtualTokenReserves),
          realSol: big(event.realSolReserves),
          realTokens: big(event.realTokenReserves),
        };
      }
      if (name === "CreateEvent") {
        const event = sdk.PUMP_SDK.decodeCreateEventBc(body);
        return {
          kind: "create",
          mint: event.mint.toBase58(),
          creator: event.creator.toBase58(),
          name: event.name,
          symbol: event.symbol,
          uri: event.uri,
          supply: big(event.tokenTotalSupply),
          virtualSol: big(event.virtualSolReserves),
          virtualTokens: big(event.virtualTokenReserves),
          realTokens: big(event.realTokenReserves),
        };
      }
      if (name === "CompleteEvent") return { kind: "complete", mint: sdk.PUMP_SDK.decodeCompleteEventBc(body).mint.toBase58() };
      return null;
    }
    if (program === AMM_PROGRAM) {
      const name = AMM_EVENTS.get(tag);
      if (name === "CreatePoolEvent") {
        const event = sdk.PUMP_SDK.decodeCreatePoolEventAmm(body);
        if (event.quoteMint.toBase58() !== WSOL) return null;
        return { kind: "pool", mint: event.baseMint.toBase58(), pool: event.pool.toBase58() };
      }
      if (name === "BuyEvent" || name === "SellEvent") {
        // The pool's event does not name the coin; the indexer fills it in from the pool's address.
        const isBuy = name === "BuyEvent";
        const event = isBuy ? sdk.PUMP_SDK.decodeBuyEventAmm(body) : sdk.PUMP_SDK.decodeSellEventAmm(body);
        const tokens = big(isBuy ? (event as PumpSdk.BuyEventAmm).baseAmountOut : (event as PumpSdk.SellEventAmm).baseAmountIn);
        const sol = big(isBuy ? (event as PumpSdk.BuyEventAmm).quoteAmountIn : (event as PumpSdk.SellEventAmm).quoteAmountOut);
        const poolTokens = big(event.poolBaseTokenReserves) + (isBuy ? -tokens : tokens);
        const poolSol = big(event.poolQuoteTokenReserves) + (isBuy ? sol : -sol);
        return {
          kind: "trade",
          venue: "amm",
          mint: `pool:${event.pool.toBase58()}`,
          wallet: event.user.toBase58(),
          isBuy,
          sol,
          tokens,
          virtualSol: poolSol,
          virtualTokens: poolTokens,
          realSol: poolSol,
          realTokens: poolTokens,
        };
      }
    }
  } catch {
    return null; // bytes that do not decode are not an event the indexer can use
  }
  return null;
}

/** The events in a transaction's log lines: each `Program data:` line under one of the two programs. */
export function eventsInLogs(logs: string[]): ChainEvent[] {
  const events: ChainEvent[] = [];
  const stack: string[] = [];
  for (const line of logs) {
    const invoked = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoked) stack.push(invoked[1]!);
    else if (/^Program \w+ (success|failed)/.test(line)) stack.pop();
    else if (line.startsWith("Program data: ")) {
      const program = stack[stack.length - 1];
      if (program !== PUMP_PROGRAM && program !== AMM_PROGRAM) continue;
      const event = decodeEvent(program, Buffer.from(line.slice(14), "base64"));
      if (event) events.push(event);
    }
  }
  return events;
}

/** The same events from the calls a program made to itself, which survive when a long log has been cut short. */
export function eventsInCalls(calls: { program: string; data: Buffer }[]): ChainEvent[] {
  const events: ChainEvent[] = [];
  for (const call of calls) {
    if ((call.program !== PUMP_PROGRAM && call.program !== AMM_PROGRAM) || !call.data.subarray(0, 8).equals(EVENT_CALL)) continue;
    const event = decodeEvent(call.program, call.data.subarray(8));
    if (event) events.push(event);
  }
  return events;
}
