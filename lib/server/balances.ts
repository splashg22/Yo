/** What a wallet holds in public, read from the chain in a fixed number of calls and kept for a moment. */
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NATIVE } from "../constants";
import { connection } from "./solana";

/** A short-lived answer kept per key, so a page that asks again a moment later does not cost another chain call. */
export function cached<Value>(ttlMs: number) {
  const kept = new Map<string, { at: number; value: Promise<Value> }>();
  return {
    get(key: string, make: () => Promise<Value>): Promise<Value> {
      const now = Date.now();
      const found = kept.get(key);
      if (found && now - found.at < ttlMs) return found.value;
      if (kept.size > 5_000) for (const [other, entry] of kept) if (now - entry.at >= ttlMs) kept.delete(other);
      const value = make();
      kept.set(key, { at: now, value });
      value.catch(() => kept.delete(key));
      return value;
    },
    drop: (key: string) => kept.delete(key),
  };
}

/**
 * Everything a wallet holds in public: three calls to the chain however many coins there are
 * (SOL, and its accounts under each of the two token programs), kept for a moment.
 */
const balancesKept = cached<Record<string, string>>(1_500);
export function publicBalances(wallet: string): Promise<Record<string, string>> {
  const key = `${connection().rpcEndpoint}|${wallet}`;
  return balancesKept.get(key, async () => {
    const owner = new PublicKey(wallet);
    const chain = connection();
    const [sol, ...accounts] = await Promise.all([
      chain.getBalance(owner),
      chain.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
      chain.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    ]);
    const balances: Record<string, string> = { [NATIVE]: String(sol) };
    for (const { value } of accounts)
      for (const { account } of value) {
        const info = (account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
        const amount = BigInt(info?.tokenAmount?.amount ?? "0");
        if (info?.mint && amount > 0n) balances[info.mint] = (BigInt(balances[info.mint] ?? "0") + amount).toString();
      }
    return balances;
  });
}
export async function publicBalance(wallet: string, mint: string): Promise<bigint> {
  return BigInt((await publicBalances(wallet))[mint] ?? "0");
}
/** Called when the indexer sees a wallet's balance change, so the next read is fresh. */
export const forgetBalances = (wallet: string): boolean => balancesKept.drop(`${connection().rpcEndpoint}|${wallet}`);
