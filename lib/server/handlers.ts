/**
 * Every server operation, as plain functions, so tests can call them without HTTP.
 * Operations that move or reveal a wallet's Ring balance take a signed request.
 */
import { verifyRequest, type Signed } from "../auth";
import { randomBytes, toHex } from "../bytes";
import { NATIVE, settings } from "./env";
import * as chain from "./chain";
import { ring } from "./ring";
import { save, state, type Coin, type Offer } from "./store";

type Json = Record<string, unknown>;
const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value) throw new Error(`"${name}" is missing`);
  return value;
};
const amount = (value: unknown, name: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`"${name}" must be a whole number of base units`);
  return BigInt(value);
};
const signed = <T>(op: string, input: unknown) => verifyRequest<T>(op, input as Signed<T>, state().nonces);

async function coinView(coin: Coin) {
  const curve = await chain.curveOf(coin.mint);
  const now = Date.now();
  const history = (state().prices[coin.mint] ??= []);
  const last = history[history.length - 1];
  if (!last || now - last.at > 60_000 || Math.abs(last.lamportsPerMillion - curve.priceLamports) / (last.lamportsPerMillion || 1) > 0.0005) {
    history.push({ at: now, lamportsPerMillion: curve.priceLamports });
    if (history.length > 2_000) history.splice(0, history.length - 2_000);
    save();
  }
  // The change is measured from the oldest price inside the last 24 hours. A coin younger than that is measured from its launch.
  const dayAgo = now - 86_400_000;
  const reference = history.find((p) => p.at >= dayAgo) ?? history[0]!;
  const stats = ring.coinStats(coin.mint);
  return {
    ...coin,
    marketCapLamports: curve.marketCapLamports.toString(),
    priceLamports: curve.priceLamports,
    changePercent: reference.lamportsPerMillion ? ((curve.priceLamports - reference.lamportsPerMillion) / reference.lamportsPerMillion) * 100 : 0,
    changeSince: reference.at,
    complete: curve.complete,
    /** The privacy score: two public facts, each named for exactly what it measures. */
    privacy: {
      supply: curve.supply.toString(),
      inRing: stats.inRing.toString(),
      shareInRingPercent: curve.supply > 0n ? Number((stats.inRing * 1_000_000n) / curve.supply) / 10_000 : 0,
      walletsThatDeposited: stats.depositors,
    },
  };
}

export const operations: Record<string, (input: Json) => Promise<unknown> | unknown> = {
  config: () => ({ network: settings().network, ring: "mock", rpcUrl: settings().network === "local" ? settings().rpcUrl : undefined, native: NATIVE, decimals: chain.DECIMALS }),

  faucet: async (input) => { await chain.faucet(text(input.wallet, "wallet")); return { ok: true }; },

  "launch/build": (input) => chain.buildLaunch({
    wallet: text(input.wallet, "wallet"), mint: text(input.mint, "mint"), name: text(input.name, "name"), symbol: text(input.symbol, "symbol"),
    uri: typeof input.uri === "string" ? input.uri : "", firstBuyLamports: input.firstBuyLamports ? amount(input.firstBuyLamports, "firstBuyLamports") : 0n, toRing: Boolean(input.toRing),
  }),

  /** Lists a coin once its launch is confirmed on-chain. The name and ticker are the creator's; the rest is read from the chain. */
  "launch/record": async (input) => {
    const mint = text(input.mint, "mint"), signature = text(input.signature, "signature");
    if (!(await chain.coinExists(mint))) throw new Error("no bonding curve exists for that coin");
    if (!state().coins.some((c) => c.mint === mint)) {
      const curve = await chain.curveOf(mint);
      state().coins.push({
        mint, name: text(input.name, "name").slice(0, 32), symbol: text(input.symbol, "symbol").slice(0, 10).toUpperCase(),
        creator: curve.creator, createdAt: Date.now(), signature, tokenProgram: "Token-2022",
      });
      save();
    }
    return operations["ring/credit"]!({ signature });
  },

  "trade/build": (input) => {
    const side = text(input.side, "side");
    if (side !== "buy" && side !== "sell") throw new Error('"side" must be buy or sell');
    return chain.buildTrade({ wallet: text(input.wallet, "wallet"), mint: text(input.mint, "mint"), side, amount: amount(input.amount, "amount") });
  },

  "fees/claimable": async (input) => ({ lamports: (await chain.claimableFees(text(input.wallet, "wallet"))).toString() }),
  "fees/build": (input) => chain.buildClaimFees({ wallet: text(input.wallet, "wallet"), toRing: input.toRing !== false }),

  /** Submits a transaction the wallet has signed and waits for it. The browser never needs the RPC address. */
  "tx/send": async (input) => ({ signature: await chain.sendSigned(text(input.transaction, "transaction")) }),

  "ring/deposit/build": (input) => chain.buildDeposit({ wallet: text(input.wallet, "wallet"), mint: text(input.mint, "mint"), amount: amount(input.amount, "amount") }),

  /** Credits whatever a confirmed transaction paid into escrow, to whoever paid for the transaction. Safe to call twice. */
  "ring/credit": async (input) => {
    const signature = text(input.signature, "signature");
    if (state().credited.includes(signature)) return { credited: [] };
    const { payer, receipts } = await chain.escrowReceipts(signature);
    state().credited.push(signature);
    const credited = receipts.map((r) => ring.credit(payer, r.mint, r.amount, signature));
    save();
    return { credited: credited.map((e) => e.public) };
  },

  "ring/register": (input) => { const body = signed<Json>("ring/register", input); return { event: ring.register(body.wallet) }; },

  "ring/transfer": (input) => {
    const body = signed<Json>("ring/transfer", input);
    return { event: ring.transfer(body.wallet, text(body.to, "to"), text(body.mint, "mint"), amount(body.amount, "amount"), typeof body.memo === "string" ? body.memo : undefined) };
  },

  "ring/withdraw": async (input) => {
    const body = signed<Json>("ring/withdraw", input);
    const mint = text(body.mint, "mint"), value = amount(body.amount, "amount");
    const destination = typeof body.destination === "string" && body.destination ? body.destination : body.wallet;
    const event = ring.debitForWithdrawal(body.wallet, mint, value, destination);
    try {
      const signature = await chain.payFromEscrow(destination, mint, value);
      ring.attach(event, signature);
      return { event, signature };
    } catch (error) {
      ring.undoWithdrawal(event); // nothing left the Ring
      throw error;
    }
  },

  /** A wallet's own Ring balances and history. Signed, because on the real Ring only the wallet's keys can read them. */
  "ring/mine": async (input) => {
    const body = signed<Json>("ring/mine", input);
    return { registered: ring.isRegistered(body.wallet), balances: ring.balances(body.wallet), history: ring.history(body.wallet) };
  },
  /** What anyone can see. */
  "ring/public": (input) => ({ events: ring.publicView(typeof input.wallet === "string" ? input.wallet : undefined) }),

  "wallet/public": async (input) => {
    const wallet = text(input.wallet, "wallet");
    const mints = [NATIVE, ...state().coins.map((c) => c.mint)];
    const balances: Record<string, string> = {};
    await Promise.all(mints.map(async (mint) => { const value = await chain.publicBalance(wallet, mint).catch(() => 0n); if (value > 0n || mint === NATIVE) balances[mint] = value.toString(); }));
    return { balances };
  },

  explore: async () => ({ coins: await Promise.all([...state().coins].reverse().map(coinView)) }),
  coin: async (input) => {
    const coin = state().coins.find((c) => c.mint === text(input.mint, "mint"));
    if (!coin) throw new Error("that coin was not launched here");
    return coinView(coin);
  },
  stats: async () => {
    const coins = state().coins;
    const wallets = new Set(state().events.filter((e) => e.kind === "deposit" && e.public.coin !== NATIVE).map((e) => e.public.wallet));
    return { network: settings().network, available: coins.length > 0, reason: coins.length ? undefined : "No coin has been launched here yet.", launched: coins.length, registered: coins.length, depositors: wallets.size };
  },

  "otc/offer": (input) => {
    const body = signed<Json>("otc/offer", input);
    const offer: Offer = {
      id: toHex(randomBytes(6)), seller: body.wallet, buyer: text(body.buyer, "buyer"), mint: text(body.mint, "mint"),
      amount: amount(body.amount, "amount").toString(), priceLamports: amount(body.priceLamports, "priceLamports").toString(),
      createdAt: Date.now(), expiresAt: Date.now() + Math.min(Number(body.hours ?? 24), 168) * 3_600_000, status: "open",
    };
    if (offer.buyer === offer.seller) throw new Error("the buyer must be another wallet");
    if (BigInt(offer.amount) <= 0n || BigInt(offer.priceLamports) <= 0n) throw new Error("size and price must be above zero");
    if (BigInt(ring.balances(body.wallet)[offer.mint] ?? "0") < BigInt(offer.amount)) throw new Error("you do not hold that block in your Ring balance");
    state().offers.push(offer);
    save();
    return { offer };
  },
  /** Only the two parties can list an offer. */
  "otc/mine": (input) => {
    const body = signed<Json>("otc/mine", input);
    return { offers: state().offers.filter((o) => o.seller === body.wallet || o.buyer === body.wallet).slice(-100).reverse() };
  },
  "otc/cancel": (input) => {
    const body = signed<Json>("otc/cancel", input);
    const offer = state().offers.find((o) => o.id === body.id);
    if (!offer || offer.seller !== body.wallet) throw new Error("that is not your offer");
    if (offer.status !== "open") throw new Error(`the offer is already ${offer.status}`);
    offer.status = "cancelled";
    save();
    return { offer };
  },
  /** The buyer accepts: the coin and the payment change hands together, or nothing moves. */
  "otc/accept": (input) => {
    const body = signed<Json>("otc/accept", input);
    const offer = state().offers.find((o) => o.id === body.id);
    if (!offer || offer.buyer !== body.wallet) throw new Error("that offer is not addressed to you");
    if (offer.status !== "open") throw new Error(`the offer is already ${offer.status}`);
    if (Date.now() > offer.expiresAt) throw new Error("the offer has expired");
    if (!ring.isRegistered(offer.buyer)) ring.register(offer.buyer);
    const event = ring.swap(offer.seller, offer.buyer, offer.mint, BigInt(offer.amount), NATIVE, BigInt(offer.priceLamports));
    offer.status = "settled";
    save();
    return { offer, event };
  },
};

export async function run(op: string, input: Json): Promise<unknown> {
  const operation = operations[op];
  if (!operation) throw new Error(`unknown operation "${op}"`);
  return operation(input ?? {});
}
