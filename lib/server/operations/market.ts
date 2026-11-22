/**
 * Launching, trading and reading coins. Everything here is public on-chain.
 * Reads come from the indexer: none of them asks the chain about a coin.
 */
import { PublicKey } from "@solana/web3.js";
import { NATIVE } from "../../constants";
import type { Activity, BuiltTradeView, HolderView, PositionView } from "../../contract";
import { cached, publicBalances } from "../balances";
import { ringAvailable, settings } from "../env";
import { escrow } from "../escrow";
import { follow } from "../follow";
import { isTimeframe, priceOf } from "../indexer/model";
import { candleWire, market, tradeView } from "../market";
import { PICTURE_MAX_BYTES, storeCoinDetails } from "../pictures";
import { claimableFees } from "../pump";
import { walletOfSession } from "../sessions";
import { connection } from "../solana";
import { save, state } from "../store";
import { buildClaimFees, buildGraduate, buildLaunch, buildTrade, type TradeRequest } from "../transactions";
import { addressOf, amountOf, plainText, text, type Input } from "../validate";
import type { Handlers } from "./types";

const ACTIVITY_SHOWN = 20;
const PENDING_LAUNCH_MS = 3_600_000;
const WHOLE_COIN = 1_000_000n;
const MICRO = 1_000_000n;

const activityKept = cached<Activity[]>(3_000);
/** The chain's own list of transactions that touched an address. One call, kept for a moment. */
function activityOf(address: string): Promise<Activity[]> {
  return activityKept.get(`${connection().rpcEndpoint}|${address}`, async () => {
    const found = await connection().getSignaturesForAddress(new PublicKey(address), { limit: ACTIVITY_SHOWN }, "confirmed");
    return found.map((entry) => ({ signature: entry.signature, blockTime: entry.blockTime ?? undefined, failed: entry.err !== null }));
  });
}

async function tradeRequest(input: Input): Promise<Omit<TradeRequest, "side" | "amount">> {
  const lamports = (value: unknown, name: string): bigint | undefined =>
    value === undefined || value === "" || value === "0" ? undefined : amountOf(value, name);
  const slippage = input.slippageBps;
  if (slippage !== undefined && (typeof slippage !== "number" || !Number.isInteger(slippage)))
    throw new Error("slippage must be a whole number of hundredths of a percent");
  const mint = addressOf(input.mint, "coin address");
  return {
    wallet: addressOf(input.wallet, "wallet address"),
    mint,
    // What the indexer already knows saves the trade a read of the curve.
    graduated: (await market()).indexer.markets.get(mint)?.complete === true,
    ...(slippage === undefined ? {} : { slippageBps: slippage }),
    priorityLamports: lamports(input.priorityLamports, "priority fee"),
    tipLamports: lamports(input.tipLamports, "tip"),
  };
}
const builtView = (built: { transaction: string; expected: bigint; feeLamports: bigint }): BuiltTradeView => ({
  transaction: built.transaction,
  expected: built.expected.toString(),
  feeLamports: built.feeLamports.toString(),
});
const limitOf = (value: unknown, most: number, usual: number): number => {
  if (value === undefined) return usual;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > most) throw new Error(`"limit" must be a whole number from 1 to ${most}`);
  return value;
};
async function followed(mintInput: unknown) {
  const mint = addressOf(mintInput, "coin address");
  const service = await market();
  // A pump.fun coin this server has not seen before is read from the chain once, here, and followed from then on.
  if (!service.indexer.markets.has(mint)) await follow(service, mint);
  const found = service.indexer.markets.get(mint);
  if (!found) throw new Error("that coin is not followed here");
  return { mint, service, market: found };
}

export const marketOperations: Handlers<
  | "explore"
  | "coin"
  | "coin/trades"
  | "coin/candles"
  | "coin/holders"
  | "position"
  | "portfolio"
  | "wallet/activity"
  | "address/seen"
  | "stats"
  | "wallet/public"
  | "launch/build"
  | "trade/build"
  | "trade/prepare"
  | "graduate/build"
  | "fees/claimable"
  | "fees/build"
> = {
  explore: async () => (await market()).board(),

  coin: async (input) => {
    const { mint, service } = await followed(input.mint);
    const seq = service.hub.seq(`coin:${mint}`);
    return { ...(await service.view(mint))!, seq };
  },

  /** A coin's trades, newest first. With no `before`, the newest ones, from memory. */
  "coin/trades": async (input) => {
    const { mint, service } = await followed(input.mint);
    const limit = limitOf(input.limit, 200, 100);
    const wallet = input.wallet === undefined ? undefined : addressOf(input.wallet, "wallet address");
    const seq = service.hub.seq(`coin:${mint}`);
    if (input.before === undefined && wallet === undefined) {
      const recent = await service.indexer.recent(mint);
      return {
        trades: recent
          .slice(-limit)
          .reverse()
          .map((trade) => tradeView(trade)),
        seq,
      };
    }
    const before = input.before as { slot?: unknown; x?: unknown; i?: unknown } | undefined;
    if (before !== undefined && (!Number.isInteger(before.slot) || !Number.isInteger(before.x) || !Number.isInteger(before.i)))
      throw new Error('"before" is not a place in the list');
    const cursor = before ? { slot: before.slot as number, txIndex: before.x as number, idx: before.i as number } : null;
    return { trades: (await service.indexer.tradesBefore(mint, cursor, limit, wallet)).map((trade) => tradeView(trade)), seq };
  },

  /** Candles, oldest first, as [time, open, high, low, close, volume, trades, buys]. With no `before`, the newest, from memory. */
  "coin/candles": async (input) => {
    const { mint, service } = await followed(input.mint);
    if (!isTimeframe(input.tf)) throw new Error('"tf" must be one of 1, 60, 300, 900, 3600, 86400 (seconds)');
    const limit = limitOf(input.limit, 600, 300);
    const seq = service.hub.seq(`k:${mint}:${input.tf}`);
    if (input.before === undefined) return { candles: (await service.indexer.candles(mint, input.tf)).slice(-limit).map(candleWire), seq };
    if (typeof input.before !== "number" || !Number.isInteger(input.before) || input.before < 0) throw new Error('"before" must be a time in seconds');
    return { candles: (await service.indexer.candlesBefore(mint, input.tf, input.before, limit)).map(candleWire), seq };
  },

  "coin/holders": async (input) => {
    const { mint, service, market: found } = await followed(input.mint);
    const escrowAddress = ringAvailable() ? escrow().publicKey.toBase58() : null;
    const seq = service.hub.seq(`coin:${mint}`);
    const top = await service.indexer.topHolders(mint, 100);
    const holders: HolderView[] = top.map((holder) => ({
      owner: holder.owner,
      amount: holder.amount.toString(),
      tags: service.tagsOf(found, holder.owner, escrowAddress),
    }));
    return { holders, supply: found.supply.toString(), creator: found.creator, seq };
  },

  position: async (input) => {
    const { mint } = await followed(input.mint);
    const wallet = addressOf(input.wallet, "wallet address");
    return { position: (await positionsOf(wallet, mint))[0] ?? null };
  },

  portfolio: async (input) => {
    const wallet = addressOf(input.wallet, "wallet address");
    return { positions: await positionsOf(wallet) };
  },

  "address/seen": async (input) => ({ seen: (await activityOf(addressOf(input.address, "address"))).length > 0 }),

  "wallet/activity": async (input) => ({ activity: await activityOf(addressOf(input.wallet, "wallet address")) }),

  stats: () => {
    const { coins, events } = state();
    const depositors = new Set(events.filter((event) => event.kind === "deposit" && event.public.coin !== NATIVE).map((event) => event.public.wallet));
    if (coins.length === 0) return { network: settings().network, available: false, reason: "No coin has been launched here yet." };
    return { network: settings().network, available: true, launched: coins.length, registered: coins.length, depositors: depositors.size };
  },

  "wallet/public": async (input) => ({ balances: await publicBalances(addressOf(input.wallet, "wallet address")) }),

  "launch/build": async (input) => {
    const wallet = addressOf(input.wallet, "wallet address");
    const mint = addressOf(input.mint, "new coin's address");
    const name = plainText(input.name, "coin name", 32);
    const symbol = plainText(input.symbol, "ticker", 10).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error("the ticker must be 1 to 10 letters or digits");
    const firstBuyLamports = input.firstBuyLamports === undefined || input.firstBuyLamports === "" ? 0n : amountOf(input.firstBuyLamports, "first buy");
    // A coin's address is claimed by the first wallet to prepare its launch; nobody else can rename it meanwhile.
    // Launches prepared and never sent are forgotten after an hour.
    const pending = state().pendingLaunches;
    for (const [address, launch] of Object.entries(pending)) if (Date.now() - launch.at > PENDING_LAUNCH_MS) delete pending[address];
    if (pending[mint] && pending[mint].wallet !== wallet) throw new Error("that coin address is already being launched by another wallet");
    if (state().coins.some((coin) => coin.mint === mint)) throw new Error("that coin has already been launched");
    const description = input.description === undefined || input.description === "" ? "" : plainText(input.description, "description", 280);
    const picture =
      input.picture === undefined || input.picture === "" ? undefined : text(input.picture, "picture", Math.ceil((PICTURE_MAX_BYTES * 4) / 3) + 4);
    // A picture is stored on this server before anything is on-chain, so it is taken only from a wallet that has signed in.
    if (picture !== undefined && walletOfSession(input.session) !== wallet) throw new Error("the session belongs to a different wallet than the one launching");
    // The coin's details are stored first, so the address written on-chain already answers when the coin exists.
    const details = await storeCoinDetails({ name, symbol, description, picture });
    const built = await buildLaunch({ wallet, mint, name, symbol, uri: details.uri, firstBuyLamports, toRing: input.toRing === true });
    // Remembered so the coin can be listed, under this name, once its launch is confirmed on-chain.
    state().pendingLaunches[mint] = { wallet, name, symbol, at: Date.now(), ...(details.image ? { image: details.image } : {}) };
    save();
    return { transaction: built.transaction, firstBuyTokens: built.firstBuyTokens.toString(), feeLamports: built.feeLamports.toString() };
  },

  "trade/build": async (input) => {
    if (input.side !== "buy" && input.side !== "sell") throw new Error("choose buy or sell");
    return builtView(await buildTrade({ ...(await tradeRequest(input)), side: input.side, amount: amountOf(input.amount, "amount") }));
  },

  /**
   * Builds several trades ahead of the click: a set of buys (lamports each) and sells (coin base units each).
   * A sell the wallet cannot cover comes back as null rather than failing the rest.
   */
  "trade/prepare": async (input) => {
    const request = await tradeRequest(input);
    const amounts = (value: unknown, name: string): bigint[] => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > 8) throw new Error(`"${name}" must be a list of at most 8 amounts`);
      return value.map((amount) => amountOf(amount, name));
    };
    const one = (side: "buy" | "sell") => async (amount: bigint) => {
      try {
        return builtView(await buildTrade({ ...request, side, amount }));
      } catch {
        return null; // too small to buy anything, or more than the wallet holds: that button simply is not ready
      }
    };
    const [buys, sells] = await Promise.all([
      Promise.all(amounts(input.buys, "buys").map(one("buy"))),
      Promise.all(amounts(input.sells, "sells").map(one("sell"))),
    ]);
    return { buys, sells };
  },

  "graduate/build": async (input) => buildGraduate({ wallet: addressOf(input.wallet, "wallet address"), mint: addressOf(input.mint, "coin address") }),

  "fees/claimable": async (input) => ({ lamports: (await claimableFees(addressOf(input.wallet, "wallet address"))).toString() }),

  "fees/build": async (input) => {
    const built = await buildClaimFees({ wallet: addressOf(input.wallet, "wallet address"), toRing: input.toRing !== false });
    return { transaction: built.transaction, claimable: built.claimable.toString() };
  },
};

/** A wallet's positions, from the trades the indexer has stored. No chain call. */
async function positionsOf(wallet: string, onlyMint?: string): Promise<PositionView[]> {
  const service = await market();
  const [flows, holdings] = await Promise.all([service.indexer.flows(wallet, onlyMint), service.indexer.holdings(wallet)]);
  const held = new Map(holdings.map((holding) => [holding.mint, holding.amount]));
  const mints = new Set([...flows.map((flow) => flow.mint), ...(onlyMint ? (held.has(onlyMint) ? [onlyMint] : []) : held.keys())]);
  const positions: PositionView[] = [];
  for (const mint of mints) {
    const found = service.indexer.markets.get(mint);
    if (!found) continue;
    const flow = flows.find((candidate) => candidate.mint === mint) ?? {
      boughtSol: 0n,
      boughtTokens: 0n,
      soldSol: 0n,
      soldTokens: 0n,
      buys: 0,
      sells: 0,
      lastAt: 0,
    };
    const listed = state().coins.find((coin) => coin.mint === mint);
    const holding = held.get(mint) ?? 0n;
    const price = priceOf(found.virtualSol, found.virtualTokens);
    const value = (holding * price) / (WHOLE_COIN * MICRO);
    // Cost is worked out at the average buy price. Coins that arrived some other way (a transfer, a withdrawal from the Ring) have no cost here.
    const costOf = (tokens: bigint): bigint => (flow.boughtTokens > 0n ? (flow.boughtSol * tokens) / flow.boughtTokens : 0n);
    const stillFromBuys = flow.boughtTokens > flow.soldTokens ? flow.boughtTokens - flow.soldTokens : 0n;
    const costed = holding < stillFromBuys ? holding : stillFromBuys;
    const soldFromBuys = flow.soldTokens < flow.boughtTokens ? flow.soldTokens : flow.boughtTokens;
    positions.push({
      mint,
      symbol: listed?.symbol ?? found.symbol,
      name: listed?.name ?? found.name,
      ...(listed?.image ? { image: listed.image } : {}),
      held: holding.toString(),
      boughtLamports: flow.boughtSol.toString(),
      boughtTokens: flow.boughtTokens.toString(),
      soldLamports: flow.soldSol.toString(),
      soldTokens: flow.soldTokens.toString(),
      buys: flow.buys,
      sells: flow.sells,
      valueLamports: value.toString(),
      realisedLamports: (flow.soldSol - costOf(soldFromBuys)).toString(),
      unrealisedLamports: ((costed * price) / (WHOLE_COIN * MICRO) - costOf(costed)).toString(),
      lastTradeAt: flow.lastAt,
    });
  }
  return positions.sort((a, b) => (BigInt(b.valueLamports) > BigInt(a.valueLamports) ? 1 : -1));
}
