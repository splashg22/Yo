/**
 * Following a pump.fun coin that was not launched here and was made before this server was watching:
 * its curve is read once, its past trades are fetched from the chain, and from then on the indexer keeps it
 * up to date like any other. This is the one place a read goes to the chain about a coin, and it does so
 * once per coin, when somebody asks for it by address.
 */
import type * as PumpSdk from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import { createRequire } from "node:module";
import { eventsInCalls, eventsInLogs } from "./indexer/decode";
import { priceOf, type Market, type Trade } from "./indexer/model";
import { failure, log } from "./log";
import type { MarketService } from "./market";
import { connection } from "./solana";
import { pumpSettings } from "./warm";
import bs58 from "bs58";

const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;
const big = (value: { toString(): string }): bigint => BigInt(value.toString());
import { HISTORY_LIMIT } from "./history-limit";
export { HISTORY_LIMIT };
const following = new Map<string, Promise<void>>();
/** Addresses lately found not to be coins. Asking again inside a minute is answered from here, not from the chain. */
const notCoins = new Map<string, number>();
const NOT_A_COIN = "that address is not a pump.fun coin on this chain";

/** Makes sure a coin is followed. Throws one plain sentence if the address is not a pump.fun coin on this chain. */
export function follow(service: MarketService, mint: string): Promise<void> {
  if (service.indexer.markets.has(mint)) return Promise.resolve();
  const refused = notCoins.get(mint);
  if (refused !== undefined && Date.now() - refused < 60_000) return Promise.reject(new Error(NOT_A_COIN));
  let running = following.get(mint);
  if (!running) {
    running = adopt(service, mint).finally(() => following.delete(mint));
    following.set(mint, running);
  }
  return running;
}

async function adopt(service: MarketService, mint: string): Promise<void> {
  const chain = connection();
  const key = new PublicKey(mint);
  const curveAddress = sdk.bondingCurvePda(key);
  const pool = sdk.canonicalPumpPoolPda(key);
  const [[curveInfo, poolInfo], { global }, slot] = await Promise.all([
    chain.getMultipleAccountsInfo([curveAddress, pool]),
    pumpSettings(),
    chain.getSlot("confirmed"),
  ]);
  if (!curveInfo) {
    if (notCoins.size > 20_000) notCoins.clear();
    notCoins.set(mint, Date.now());
    throw new Error(NOT_A_COIN);
  }
  const curve = sdk.PUMP_SDK.decodeBondingCurve(curveInfo);
  const now: Market = {
    mint,
    creator: curve.creator.toBase58(),
    name: "",
    symbol: "",
    uri: "",
    createdAt: Date.now(),
    createdSlot: slot,
    supply: big(curve.tokenTotalSupply),
    initialRealTokens: big(global.initialRealTokenReserves),
    virtualSol: big(curve.virtualQuoteReserves),
    virtualTokens: big(curve.virtualTokenReserves),
    realSol: big(curve.realQuoteReserves),
    realTokens: big(curve.realTokenReserves),
    complete: curve.complete,
    ...(poolInfo ? { pool: pool.toBase58() } : {}),
    holders: 0,
    trades: 0,
    // Until the event that made it is found among its past trades, it is a coin first seen now, and says so.
    seenFromSlot: slot,
  };
  // Followed from this moment: anything that happens while the past is being fetched is not missed.
  if (!(await service.indexer.adopt(now))) return;
  try {
    const history = await pastTrades(mint, curveAddress, poolInfo ? pool : null);
    const created = history.created;
    if (created) {
      const market = service.indexer.markets.get(mint)!;
      Object.assign(market, { name: created.name, symbol: created.symbol, uri: created.uri, createdAt: created.at, createdSlot: created.slot });
      // Its whole past is held: it is no longer a coin seen from part-way.
      delete market.seenFromSlot;
    }
    await service.indexer.backfill(mint, history.trades, await largestHolders(key));
    if (created) await service.indexer.rename(mint, created);
    service.touch(mint);
  } catch (error) {
    // The coin is followed from now on either way; only its past is missing, and asking again fetches it.
    log("warn", "a coin's past could not be fetched", { mint, ...failure(error) });
  }
}

interface Created {
  name: string;
  symbol: string;
  uri: string;
  at: number;
  slot: number;
}
/** A coin's trades from the chain's own record of its curve (and pool), oldest first, with the event that made it if that is within reach. */
async function pastTrades(mint: string, curve: PublicKey, pool: PublicKey | null): Promise<{ trades: Trade[]; created: Created | undefined }> {
  const chain = connection();
  const signatures: { signature: string; slot: number; blockTime: number | null }[] = [];
  for (const address of pool ? [pool, curve] : [curve]) {
    let before: string | undefined;
    while (signatures.length < HISTORY_LIMIT) {
      const page = await chain.getSignaturesForAddress(address, { limit: 1000, ...(before ? { before } : {}) }, "confirmed");
      for (const entry of page) if (!entry.err) signatures.push({ signature: entry.signature, slot: entry.slot, blockTime: entry.blockTime ?? null });
      if (page.length < 1000) break;
      before = page[page.length - 1]!.signature;
    }
  }
  const oldestFirst = signatures.slice(0, HISTORY_LIMIT).reverse();
  const trades: Trade[] = [];
  let created: Created | undefined;
  let before = 0n;
  for (let start = 0; start < oldestFirst.length; start += 20) {
    const batch = oldestFirst.slice(start, start + 20);
    const found = await Promise.all(
      // One transaction the library cannot read (a newer version than it knows) is left out; it does not stop the rest.
      batch.map((entry) =>
        chain.getTransaction(entry.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch((error: unknown) => {
          if (/transaction version/i.test(String(error))) return null;
          throw error;
        }),
      ),
    );
    found.forEach((transaction, index) => {
      const entry = batch[index]!;
      if (!transaction?.meta) return;
      const message = transaction.transaction.message;
      const keys = [...message.staticAccountKeys, ...(transaction.meta.loadedAddresses?.writable ?? []), ...(transaction.meta.loadedAddresses?.readonly ?? [])];
      let events = eventsInCalls(
        (transaction.meta.innerInstructions ?? []).flatMap((group) =>
          group.instructions.map((instruction) => ({
            program: keys[instruction.programIdIndex]?.toBase58() ?? "",
            data: Buffer.from(bs58.decode(instruction.data)),
          })),
        ),
      );
      if (events.length === 0) events = eventsInLogs(transaction.meta.logMessages ?? []);
      const at = (entry.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
      let idx = 0;
      for (const event of events) {
        if (event.kind === "create" && event.mint === mint) {
          created = { name: event.name, symbol: event.symbol, uri: event.uri, at, slot: entry.slot };
          before = priceOf(event.virtualSol, event.virtualTokens);
        }
        if (event.kind !== "trade") continue;
        const place = idx++;
        const mine = event.venue === "amm" ? pool !== null && event.mint === `pool:${pool.toBase58()}` : event.mint === mint;
        if (!mine) continue;
        const price = priceOf(event.virtualSol, event.virtualTokens);
        trades.push({
          signature: entry.signature,
          idx: place,
          mint,
          slot: entry.slot,
          // The place in its block is not known from here. Within one slot the order the chain listed them in is kept.
          txIndex: index + start,
          at,
          wallet: event.wallet,
          isBuy: event.isBuy,
          venue: event.venue,
          sol: event.sol,
          tokens: event.tokens,
          price,
          priceBefore: before > 0n ? before : price,
        });
        before = price;
      }
    });
  }
  return { trades, created };
}

/** The twenty largest holders, from the chain. A coin's full list of holders builds up from here as the indexer sees balances change. */
async function largestHolders(mint: PublicKey): Promise<{ owner: string; amount: bigint }[]> {
  const chain = connection();
  const largest = (await chain.getTokenLargestAccounts(mint, "confirmed")).value.filter((account) => BigInt(account.amount) > 0n);
  if (largest.length === 0) return [];
  const infos = await chain.getMultipleAccountsInfo(largest.map((account) => account.address));
  const totals = new Map<string, bigint>();
  largest.forEach((account, index) => {
    const data = infos[index]?.data;
    if (!data || data.length < 64) return;
    const owner = new PublicKey(data.subarray(32, 64)).toBase58();
    totals.set(owner, (totals.get(owner) ?? 0n) + BigInt(account.amount));
  });
  return [...totals].map(([owner, amount]) => ({ owner, amount }));
}
