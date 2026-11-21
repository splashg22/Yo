/** Launching, trading and reading coins. Everything here is public on-chain. */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NATIVE } from "../../constants";
import type { CoinView } from "../../contract";
import { buildClaimFees, buildLaunch, buildTrade } from "../transactions";
import { settings } from "../env";
import { claimableFees, curveOf, tokenProgramOf } from "../pump";
import { ring } from "../ring";
import { connection } from "../solana";
import { save, state, type Coin } from "../store";
import { addressOf, amountOf, plainText } from "../validate";
import type { Handlers } from "./types";

const DAY_MS = 86_400_000;
const PRICE_POINTS_KEPT = 2_000;

async function coinView(coin: Coin): Promise<CoinView> {
  const curve = await curveOf(coin.mint);
  const now = Date.now();
  const history = (state().prices[coin.mint] ??= []);
  const last = history[history.length - 1];
  if (!last || now - last.at > 60_000 || last.microLamportsPerCoin !== curve.microLamportsPerCoin.toString()) {
    history.push({ at: now, microLamportsPerCoin: curve.microLamportsPerCoin.toString() });
    if (history.length > PRICE_POINTS_KEPT) history.splice(0, history.length - PRICE_POINTS_KEPT);
    save();
  }
  // Measured from the oldest price inside the last 24 hours; a younger coin is measured from its launch.
  const reference = history.find((point) => point.at >= now - DAY_MS) ?? history[0]!;
  const referencePrice = BigInt(reference.microLamportsPerCoin);
  const stats = ring.coinStats(coin.mint);
  return {
    ...coin,
    marketCapLamports: curve.marketCapLamports.toString(),
    microLamportsPerCoin: curve.microLamportsPerCoin.toString(),
    changeBasisPoints: referencePrice > 0n ? Number(((curve.microLamportsPerCoin - referencePrice) * 10_000n) / referencePrice) : 0,
    changeSince: reference.at,
    complete: curve.complete,
    privacy: {
      supply: curve.supply.toString(),
      inRing: stats.inRing.toString(),
      shareInRingPartsPerMillion: curve.supply > 0n ? Number((stats.inRing * 1_000_000n) / curve.supply) : 0,
      walletsThatDeposited: stats.depositors,
    },
  };
}

export async function publicBalance(wallet: string, mint: string): Promise<bigint> {
  const owner = new PublicKey(wallet);
  if (mint === NATIVE) return BigInt(await connection().getBalance(owner));
  const account = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, await tokenProgramOf(mint));
  const balance = await connection()
    .getTokenAccountBalance(account)
    .catch((error: unknown) => {
      if (/could not find account|Invalid param/i.test(String(error))) return null; // the wallet has never held this coin
      throw error;
    });
  return BigInt(balance?.value.amount ?? "0");
}

export const market: Handlers<"explore" | "coin" | "stats" | "wallet/public" | "launch/build" | "trade/build" | "fees/claimable" | "fees/build"> = {
  explore: async () => ({ coins: await Promise.all([...state().coins].reverse().map(coinView)) }),

  coin: async (input) => {
    const mint = addressOf(input.mint, "coin address");
    const coin = state().coins.find((candidate) => candidate.mint === mint);
    if (!coin) throw new Error("that coin was not launched here");
    return coinView(coin);
  },

  stats: () => {
    const { coins, events } = state();
    const depositors = new Set(events.filter((event) => event.kind === "deposit" && event.public.coin !== NATIVE).map((event) => event.public.wallet));
    if (coins.length === 0) return { network: settings().network, available: false, reason: "No coin has been launched here yet." };
    return { network: settings().network, available: true, launched: coins.length, registered: coins.length, depositors: depositors.size };
  },

  "wallet/public": async (input) => {
    const wallet = addressOf(input.wallet, "wallet address");
    const balances: Record<string, string> = {};
    await Promise.all(
      [NATIVE, ...state().coins.map((coin) => coin.mint)].map(async (mint) => {
        const value = await publicBalance(wallet, mint);
        if (value > 0n || mint === NATIVE) balances[mint] = value.toString();
      }),
    );
    return { balances };
  },

  "launch/build": async (input) => {
    const wallet = addressOf(input.wallet, "wallet address");
    const mint = addressOf(input.mint, "new coin's address");
    const name = plainText(input.name, "coin name", 32);
    const symbol = plainText(input.symbol, "ticker", 10).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error("the ticker must be 1 to 10 letters or digits");
    const firstBuyLamports = input.firstBuyLamports === undefined || input.firstBuyLamports === "" ? 0n : amountOf(input.firstBuyLamports, "first buy");
    const built = await buildLaunch({ wallet, mint, name, symbol, firstBuyLamports, toRing: input.toRing === true });
    // Remembered so the coin can be listed, under this name, once its launch is confirmed on-chain.
    state().pendingLaunches[mint] = { wallet, name, symbol, at: Date.now() };
    save();
    return { transaction: built.transaction, firstBuyTokens: built.firstBuyTokens.toString() };
  },

  "trade/build": async (input) => {
    if (input.side !== "buy" && input.side !== "sell") throw new Error("choose buy or sell");
    const built = await buildTrade({
      wallet: addressOf(input.wallet, "wallet address"),
      mint: addressOf(input.mint, "coin address"),
      side: input.side,
      amount: amountOf(input.amount, "amount"),
    });
    return { transaction: built.transaction, expected: built.expected.toString() };
  },

  "fees/claimable": async (input) => ({ lamports: (await claimableFees(addressOf(input.wallet, "wallet address"))).toString() }),

  "fees/build": async (input) => {
    const built = await buildClaimFees({ wallet: addressOf(input.wallet, "wallet address"), toRing: input.toRing !== false });
    return { transaction: built.transaction, claimable: built.claimable.toString() };
  },
};
