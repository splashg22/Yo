/** Reading a block from the RPC: a block that holds a version 1 transaction is read like any other. */
import type { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { RpcSource } from "../../lib/server/indexer/rpc-source";

const MINT = "So11111111111111111111111111111111111111112";
const OWNER = "6qzxNcsYgLcS3ixWtkoQu1YDxcCp5AGFEnXg6sgF31Qs";
const balance = (amount: string) => ({ accountIndex: 1, mint: MINT, owner: OWNER, uiTokenAmount: { amount } });
const tx = (signature: string, version: number | "legacy", before: string, after: string, err: unknown = null) => ({
  version,
  transaction: { signatures: [signature], message: { accountKeys: [OWNER, "AyWmYT9nRXamUysRTqPv75s7sVL2Kxg6RdmCKXfn2VY"] } },
  meta: { err, innerInstructions: [], logMessages: [], preTokenBalances: [balance(before)], postTokenBalances: [balance(after)] },
});
/** A connection that answers `getBlock` with what the RPC sends, and records what it was asked. */
function chain(answer: unknown): { connection: () => Connection; asked: unknown[][] } {
  const asked: unknown[][] = [];
  const fake = {
    _rpcRequest: (method: string, params: unknown[]) => {
      asked.push([method, ...params]);
      return Promise.resolve(answer);
    },
  };
  return { connection: () => fake as unknown as Connection, asked };
}

describe("reading blocks from the RPC", () => {
  it("asks for the newest transaction version and reads version 1 transactions beside the older kinds", async () => {
    const { connection, asked } = chain({
      result: {
        blockhash: "hash",
        previousBlockhash: "parent",
        parentSlot: 9,
        blockTime: 1_800_000_000,
        transactions: [
          tx("old", "legacy", "5", "7"),
          tx("zero", 0, "7", "8"),
          tx("one", 1, "8", "20"),
          tx("failed", 1, "20", "99", { InstructionError: [0, "Custom"] }),
        ],
      },
    });
    const block = await new RpcSource(connection).block(10);
    expect(asked[0]![0]).toBe("getBlock");
    expect(asked[0]![2]).toMatchObject({ maxSupportedTransactionVersion: 1, encoding: "json", transactionDetails: "full" });
    expect(block).toMatchObject({ slot: 10, hash: "hash", parentSlot: 9, parentHash: "parent", time: 1_800_000_000 });
    // Every transaction that went through is there, in its place in the block; the failed one is left out.
    expect(block!.txs.map((entry) => [entry.signature, entry.index, entry.balances[0]!.amount])).toEqual([
      ["old", 0, 7n],
      ["zero", 1, 8n],
      ["one", 2, 20n],
    ]);
  });

  it("treats a skipped slot as no block, and any other refusal as a failure to be retried", async () => {
    const skipped = chain({ error: { code: -32007, message: "Slot 10 was skipped, or missing due to ledger jump to recent snapshot" } });
    expect(await new RpcSource(skipped.connection).block(10)).toBeNull();
    const refused = chain({ error: { code: -32015, message: "Transaction version (1) is not supported by the requesting client" } });
    await expect(new RpcSource(refused.connection).block(10)).rejects.toThrow(/getBlock failed/);
    expect(await new RpcSource(chain({ result: null }).connection).block(10)).toBeNull();
  });
});
