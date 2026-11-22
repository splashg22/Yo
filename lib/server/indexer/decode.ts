/** Turns pump.fun's own event bytes into the indexer's events. The decoding itself is the pump SDK's. */
import type * as PumpSdk from "@pump-fun/pump-sdk";
import type BN from "bn.js";
import { createRequire } from "node:module";
import { DAMM2_PROGRAM, decodeDamm2 } from "./meteora";
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
// The two programs' descriptions spell event names differently ("TradeEvent", "buyEvent"); they are compared in lower case.
const discriminators = (events: IdlEvent[]): Map<string, string> =>
  new Map(events.map((event) => [Buffer.from(event.discriminator).toString("hex"), event.name.toLowerCase()]));
const CURVE_EVENTS = discriminators((sdk.pumpIdl as unknown as { events: IdlEvent[] }).events);
const ammIdl = (sdk.getPumpAmmProgram as unknown as (connection: unknown) => { idl: { events: IdlEvent[] } })({ rpcEndpoint: "http://localhost" }).idl;
const AMM_EVENTS = discriminators(ammIdl.events);
/** Anchor writes an event as a call to the program itself, whose data starts with this marker. */
const EVENT_CALL = Buffer.from("e445a52e51cb9a1d", "hex");

/** True for a coin priced in SOL: the field is absent on older events, and all ones or wrapped SOL on newer ones. */
const pricedInSol = (quoteMint: { toBase58(): string } | undefined): boolean => {
  const quote = quoteMint?.toBase58();
  return quote === undefined || quote === "11111111111111111111111111111111" || quote === WSOL;
};

/** One event from its bytes (discriminator first), or null if it is not one the indexer follows or cannot be read. */
export function decodeEvent(program: string, data: Buffer): ChainEvent | null {
  if (data.length < 8) return null;
  const tag = data.subarray(0, 8).toString("hex");
  const body = data.subarray(8);
  try {
    if (program === PUMP_PROGRAM) {
      const name = CURVE_EVENTS.get(tag);
      if (name === "tradeevent") {
        const event = sdk.PUMP_SDK.decodeTradeEventBc(body);
        // A coin priced in something other than SOL (pump.fun has USDC-priced coins on mainnet) carries its amounts
        // in other fields and zero in the SOL ones. Read as SOL it would be a trade at no price, so it is not read at all.
        if (!pricedInSol((event as { quoteMint?: { toBase58(): string } }).quoteMint)) return null;
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
      if (name === "createevent") {
        const event = sdk.PUMP_SDK.decodeCreateEventBc(body);
        // A coin priced in something else is still a new coin: it is passed on, marked, so it can be shown as not supported.
        const quote = (event as { quoteMint?: { toBase58(): string } }).quoteMint;
        return {
          ...(pricedInSol(quote) ? {} : { quoteMint: quote!.toBase58() }),
          kind: "create",
          mint: event.mint.toBase58(),
          creator: event.creator.toBase58(),
          name: event.name,
          symbol: event.symbol,
          uri: event.uri,
          // A "Mayhem mode" coin has a second thousand million coins minted to pump.fun's Mayhem vault. pump.fun's own SDK
          // works out such a coin's market cap on the mint's whole supply, and every other coin's on the thousand million
          // (getFee and v3Rates in @pump-fun/pump-sdk: `isMayhemMode ? mintSupply : ONE_BILLION_SUPPLY`). So does this.
          supply: big(event.tokenTotalSupply) * ((event as { isMayhemMode?: boolean }).isMayhemMode === true ? 2n : 1n),
          virtualSol: big(event.virtualSolReserves),
          virtualTokens: big(event.virtualTokenReserves),
          realTokens: big(event.realTokenReserves),
        };
      }
      if (name === "completeevent") return { kind: "complete", mint: sdk.PUMP_SDK.decodeCompleteEventBc(body).mint.toBase58() };
      return null;
    }
    if (program === AMM_PROGRAM) {
      const name = AMM_EVENTS.get(tag);
      if (name === "createpoolevent") {
        const event = sdk.PUMP_SDK.decodeCreatePoolEventAmm(body);
        if (event.quoteMint.toBase58() !== WSOL) return null;
        return { kind: "pool", mint: event.baseMint.toBase58(), pool: event.pool.toBase58() };
      }
      if (name === "buyevent" || name === "sellevent") {
        // The pool's event does not name the coin; the indexer fills it in from the pool's address.
        const isBuy = name === "buyevent";
        const event = isBuy ? sdk.PUMP_SDK.decodeBuyEventAmm(body) : sdk.PUMP_SDK.decodeSellEventAmm(body);
        const tokens = big(isBuy ? (event as PumpSdk.BuyEventAmm).baseAmountOut : (event as PumpSdk.SellEventAmm).baseAmountIn);
        const sol = big(isBuy ? (event as PumpSdk.BuyEventAmm).quoteAmountIn : (event as PumpSdk.SellEventAmm).quoteAmountOut);
        const poolTokens = big(event.poolBaseTokenReserves) + (isBuy ? -tokens : tokens);
        // What the pool holds afterwards. On a buy the pool keeps its own share of the fee on top of the price paid.
        const paidIn = isBuy ? big((event as PumpSdk.BuyEventAmm).quoteAmountInWithLpFee ?? (event as PumpSdk.BuyEventAmm).quoteAmountIn) : 0n;
        const poolSol = big(event.poolQuoteTokenReserves) + (isBuy ? paidIn : -sol);
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
    if (!call.data.subarray(0, 8).equals(EVENT_CALL)) continue;
    if (call.program === DAMM2_PROGRAM) {
      const found = decodeDamm2(call.data.subarray(8));
      if (found) events.push(found);
      continue;
    }
    if (call.program !== PUMP_PROGRAM && call.program !== AMM_PROGRAM) continue;
    const event = decodeEvent(call.program, call.data.subarray(8));
    if (event) events.push(event);
  }
  return events;
}
