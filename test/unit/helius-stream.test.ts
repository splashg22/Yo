/**
 * The part of the Helius stream that needs no socket: turning a notification, in the shape Helius documents,
 * into a transaction the block reader understands. The socket itself has never been run (see the file's header).
 */
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { rawFromNotification } from "../../lib/server/indexer/helius-stream";
import { txOf } from "../../lib/server/indexer/rpc-source";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const WALLET = "FRWJRfk54ei2vLj82y827WwHnGcgpEewM8Nobo8PFb3v";
const MINT = "GXkoRHv8sragai47uZswpt1czVThZu1jQHvp3qddpump";
const balance = (amount: string) => ({ accountIndex: 1, mint: MINT, owner: WALLET, uiTokenAmount: { amount } });
/** Any bytes that are not one of the programs' events: the point here is which program a call is placed under. */
const data = bs58.encode(Buffer.from("e445a52e51cb9a1d0000000000000000", "hex"));

describe("a Helius transaction notification", () => {
  it("in parsed form is put back the way a block has it: plain keys, and each inner call under its program's place", () => {
    const tx = rawFromNotification({
      slot: 472_395_020,
      signature: "sig-parsed",
      transaction: {
        transaction: { message: { accountKeys: [{ pubkey: WALLET }, { pubkey: MINT }, { pubkey: PUMP }] } },
        meta: {
          err: null,
          loadedAddresses: { writable: ["ignored-because-keys-are-parsed"], readonly: [] },
          innerInstructions: [
            {
              instructions: [
                { programId: PUMP, data },
                { programId: "Tokenz", data: undefined },
              ],
            },
          ],
          preTokenBalances: [balance("5")],
          postTokenBalances: [balance("9")],
        },
      },
    })!;
    expect(tx.slot).toBe(472_395_020);
    expect(tx.raw.transaction.signatures).toEqual(["sig-parsed"]);
    expect(tx.raw.transaction.message.accountKeys).toEqual([WALLET, MINT, PUMP]);
    expect(tx.raw.meta!.loadedAddresses).toBeUndefined();
    // The call with no data (a call the RPC parsed into words) is left out; the other sits under key 2, the program.
    expect(tx.raw.meta!.innerInstructions).toEqual([{ instructions: [{ programIdIndex: 2, data }] }]);
    // And the block reader takes it: the wallet's balance of the coin after the transaction.
    expect(txOf(tx.raw, 0)!.balances).toEqual([{ mint: MINT, owner: WALLET, amount: 9n }]);
  });

  it("in plain form passes through, loaded addresses and all", () => {
    const tx = rawFromNotification({
      slot: 7,
      signature: "sig-plain",
      transaction: {
        transaction: { message: { accountKeys: [WALLET, MINT] } },
        meta: {
          err: null,
          loadedAddresses: { writable: [PUMP], readonly: [] },
          innerInstructions: [{ instructions: [{ programIdIndex: 2, data }] }],
          postTokenBalances: [balance("1")],
        },
      },
    })!;
    expect(tx.raw.meta!.loadedAddresses).toEqual({ writable: [PUMP], readonly: [] });
    expect(tx.raw.meta!.innerInstructions![0]!.instructions[0]!.programIdIndex).toBe(2);
  });

  it("is nothing when the transaction failed or carries no result", () => {
    const failed = {
      slot: 1,
      signature: "s",
      transaction: { transaction: { message: { accountKeys: [WALLET] } }, meta: { err: { InstructionError: [0, "Custom"] } } },
    };
    expect(rawFromNotification(failed)).toBeNull();
    expect(rawFromNotification({ slot: 1, signature: "s", transaction: { transaction: { message: { accountKeys: [WALLET] } }, meta: null } })).toBeNull();
  });
});
