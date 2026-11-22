/**
 * Measures, on mainnet as it is now, how much of the trading goes through each launchpad and pool program, so the
 * order in which the terminal adds them rests on a count and not on a guess.
 *
 *   npm run measure -- 120        120 consecutive blocks
 *
 * READ ONLY: getSlot, getBlocks, getBlock and one getMultipleAccounts. For each successful transaction that names one
 * of the programs below it adds: one transaction, the transaction's size as the RPC sends it (what a stream of that
 * program would carry), and the SOL and USDC the paying wallet's balances changed by. A transaction routed through
 * two programs is counted under both. Volume is therefore an upper estimate per program and the shares do not add
 * up to 100%.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { NEWEST_TRANSACTION_VERSION, rawCall } from "../lib/server/solana";

const PROGRAMS: Record<string, string> = {
  "pump.fun curve": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pump.fun pools (PumpSwap)": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "Raydium AMM v4": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "Raydium CPMM": "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  "Raydium CLMM": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "Raydium LaunchLab (LetsBonk)": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  "Meteora DLMM": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "Meteora DAMM v1": "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
  "Meteora DAMM v2": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  "Meteora DBC (Believe, Bags, Jupiter Studio)": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  "Orca Whirlpool": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  Moonshot: "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG",
  Boop: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4",
  Heaven: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o",
};
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const count = Number(process.argv[2] ?? 120);
const url = process.env.MAINNET_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : "");
if (!url) throw new Error("set MAINNET_RPC_URL or HELIUS_API_KEY");
const chain = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });

// Each address is checked to be a program on this chain before anything is counted under its name.
const infos = await chain.getMultipleAccountsInfo(Object.values(PROGRAMS).map((address) => new PublicKey(address)));
const real = new Map<string, string>();
Object.entries(PROGRAMS).forEach(([name, address], index) => {
  if (infos[index]?.executable) real.set(address, name);
  else console.log(`NOT A PROGRAM on this chain, left out: ${name} ${address}`);
});

interface Balance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
interface Tx {
  transaction: { message: { accountKeys: string[] } };
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: Balance[];
    postTokenBalances?: Balance[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
}
const totals = new Map<string, { txs: number; bytes: number; sol: number; usdc: number }>();
const from = (await chain.getSlot("confirmed")) - count - 40;
const slots = (await chain.getBlocks(from, from + count - 1, "confirmed")).slice(0, count);
let first = 0;
let last = 0;
let allTxs = 0;
async function read(slot: number): Promise<{ blockTime: number | null; transactions: Tx[] } | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawCall(chain, "getBlock", [
        slot,
        { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION, transactionDetails: "full", rewards: false },
      ]);
    } catch (error) {
      if (attempt >= 8 || !/429|Too Many/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
const held = (balances: Balance[] | undefined, owner: string, mint: string): number =>
  (balances ?? [])
    .filter((balance) => balance.owner === owner && balance.mint === mint)
    .reduce((sum, balance) => sum + Number(balance.uiTokenAmount.amount), 0);
for (let at = 0; at < slots.length; at += 2) {
  for (const block of await Promise.all(slots.slice(at, at + 2).map(read))) {
    if (!block) continue;
    first ||= block.blockTime ?? 0;
    last = block.blockTime ?? last;
    for (const tx of block.transactions) {
      if (!tx.meta || tx.meta.err) continue;
      allTxs += 1;
      const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
      const named = [...new Set(keys.filter((key) => real.has(key)))];
      if (named.length === 0) continue;
      const payer = keys[0]!;
      const sol = Math.abs(
        tx.meta.postBalances[0]! - tx.meta.preBalances[0]! + held(tx.meta.postTokenBalances, payer, WSOL) - held(tx.meta.preTokenBalances, payer, WSOL),
      );
      const usdc = Math.abs(held(tx.meta.postTokenBalances, payer, USDC) - held(tx.meta.preTokenBalances, payer, USDC));
      const bytes = JSON.stringify(tx).length;
      for (const address of named) {
        const total = totals.get(address) ?? { txs: 0, bytes: 0, sol: 0, usdc: 0 };
        total.txs += 1;
        total.bytes += bytes;
        total.sol += sol;
        total.usdc += usdc;
        totals.set(address, total);
      }
    }
  }
  process.stdout.write(`\r${Math.min(at + 2, slots.length)} of ${slots.length} blocks`);
}
const seconds = Math.max(1, last - first);
console.log(`\n${slots.length} blocks from slot ${slots[0]}, ${seconds} seconds of chain time, ${allTxs} successful transactions in all.`);
console.log("program | transactions a second | MB a second as the RPC sends them | SOL a second moved by the paying wallet | USDC a second");
for (const [address, total] of [...totals].sort((a, b) => b[1].sol + b[1].usdc * 7e6 - (a[1].sol + a[1].usdc * 7e6)))
  console.log(
    `${real.get(address)} | ${(total.txs / seconds).toFixed(1)} | ${(total.bytes / 1e6 / seconds).toFixed(2)} | ${(total.sol / 1e9 / seconds).toFixed(1)} | ${(total.usdc / 1e6 / seconds).toFixed(0)}`,
  );
