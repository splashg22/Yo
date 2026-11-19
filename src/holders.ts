/** Holder snapshot: every token account of a mint, added up per owner wallet. */
import { Connection, PublicKey, type GetProgramAccountsFilter } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface RawHolding {
  owner: string;
  amount: bigint;
}

export function aggregateByOwner(holdings: Iterable<RawHolding>): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const { owner, amount } of holdings) {
    if (amount <= 0n) continue;
    totals.set(owner, (totals.get(owner) ?? 0n) + amount);
  }
  return totals;
}

/** Decodes the `owner` + `amount` slice (bytes 32..72) of a token account. */
export function decodeOwnerAmount(slice: Uint8Array): RawHolding {
  if (slice.length < 40) throw new Error("token account slice is too short");
  const buffer = Buffer.from(slice);
  return {
    owner: new PublicKey(buffer.subarray(0, 32)).toBase58(),
    amount: buffer.readBigUInt64LE(32),
  };
}

/** Standard RPC: getProgramAccounts filtered by mint. Many RPCs disable this. */
export async function snapshotViaProgramAccounts(
  connection: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<RawHolding[]> {
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: 0, bytes: mint.toBase58() } },
  ];
  // Classic token accounts are always 165 bytes; Token-2022 ones vary in size.
  if (tokenProgram.equals(TOKEN_PROGRAM_ID)) filters.push({ dataSize: 165 });
  const accounts = await connection.getProgramAccounts(tokenProgram, {
    commitment: "confirmed",
    filters,
    dataSlice: { offset: 32, length: 40 },
  });
  return accounts.map((account) => decodeOwnerAmount(account.account.data));
}

/** Helius-style DAS `getTokenAccounts`, used when getProgramAccounts is blocked. */
export async function snapshotViaTokenAccountsApi(rpcUrl: string, mint: PublicKey): Promise<RawHolding[]> {
  const holdings: RawHolding[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page++) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "holders",
        method: "getTokenAccounts",
        params: { mint: mint.toBase58(), limit: 1000, ...(cursor ? { cursor } : {}) },
      }),
    });
    const body = (await response.json()) as {
      error?: { message?: string };
      result?: { token_accounts?: { owner: string; amount: number | string }[]; cursor?: string };
    };
    if (body.error || !body.result) {
      throw new Error(body.error?.message ?? `getTokenAccounts failed with HTTP ${response.status}`);
    }
    const accounts = body.result.token_accounts ?? [];
    for (const account of accounts) {
      holdings.push({ owner: account.owner, amount: BigInt(account.amount) });
    }
    cursor = body.result.cursor;
    if (!cursor || accounts.length === 0) return holdings;
  }
  throw new Error("getTokenAccounts did not finish paging");
}
