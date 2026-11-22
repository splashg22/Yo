/** Mainnet is read-only: every door a transaction could leave by is shut, whatever else is set. */
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_ONLY_REFUSAL, assertMaySend, settings } from "../../lib/server/env";
import { READS_ALLOWED_ON_MAINNET, operationNames, run } from "../../lib/server/handlers";
import { submit } from "../../lib/server/sender";
import { forget } from "../../lib/server/store";

const names = ["RING_NETWORK", "MAINNET_RPC_URL", "HELIUS_API_KEY", "APP_STORE", "FEED_PROVIDER", "FEED_SCOPE", "FEED_FOLLOW_NEWEST"] as const;
const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
beforeEach(() => {
  process.env.APP_STORE = "memory";
  process.env.RING_NETWORK = "mainnet";
  // An address nothing listens at: no test here may reach a real chain.
  process.env.MAINNET_RPC_URL = "http://127.0.0.1:1";
  delete process.env.HELIUS_API_KEY;
});
afterEach(() => {
  forget();
  for (const name of names) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
});

describe("mainnet, read only", () => {
  it("is what RING_NETWORK=mainnet means, and nothing switches the sending back on", () => {
    expect(settings()).toMatchObject({ network: "mainnet", readOnly: true });
    expect(() => assertMaySend()).toThrow(READ_ONLY_REFUSAL);
    delete process.env.MAINNET_RPC_URL;
    expect(() => settings()).toThrow(/neither HELIUS_API_KEY nor MAINNET_RPC_URL/);
    process.env.HELIUS_API_KEY = "not-a-real-key";
    expect(settings().rpcUrl).toBe("https://mainnet.helius-rpc.com/?api-key=not-a-real-key");
    expect(settings().readOnly).toBe(true);
  });

  it("refuses every operation that builds, sends or moves anything, before the operation starts", async () => {
    const refused: string[] = [];
    for (const name of operationNames()) {
      if (READS_ALLOWED_ON_MAINNET.has(name)) continue;
      await expect(
        run(name, { wallet: Keypair.generate().publicKey.toBase58(), mint: Keypair.generate().publicKey.toBase58(), amount: "1", side: "buy" }),
        name,
      ).rejects.toThrow(/only reads Solana mainnet/);
      refused.push(name);
    }
    // No name on the allowed list builds, sends, signs in, or touches a Ring balance, an offer or a window.
    for (const name of READS_ALLOWED_ON_MAINNET) expect(name, name).not.toMatch(/build|send|prepare|faucet|session|^ring\/|^otc\/|^window\/|^tx\/|^fees\//);
    // The ones that matter most are among the refused by name.
    for (const name of [
      "trade/build",
      "trade/prepare",
      "launch/build",
      "tx/send",
      "faucet",
      "ring/deposit/build",
      "ring/withdraw",
      "otc/offer",
      "graduate/build",
    ])
      expect(refused, name).toContain(name);
  });

  it("refuses a signed transaction at the sender itself, should one ever get that far", async () => {
    const payer = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([payer]);
    await expect(submit(Buffer.from(transaction.serialize()).toString("base64"))).rejects.toThrow(/only reads Solana mainnet/);
  });

  it("still answers what this build runs on, and says mainnet", async () => {
    expect(await run("config")).toMatchObject({ network: "mainnet", ring: "unavailable" });
  });
});

describe("where the indexer's data comes from", () => {
  it("is whole blocks over the RPC unless set otherwise, and refuses a setting it does not know", () => {
    process.env.RING_NETWORK = "local";
    expect(settings()).toMatchObject({ feedProvider: "rpc", feedScope: "coins", feedFollowNewest: 300, readOnly: false });
    process.env.FEED_PROVIDER = "carrier-pigeon";
    expect(() => settings()).toThrow(/FEED_PROVIDER must be/);
    process.env.FEED_PROVIDER = "helius-ws";
    process.env.FEED_SCOPE = "everything";
    expect(() => settings()).toThrow(/FEED_SCOPE must be/);
    process.env.FEED_SCOPE = "all";
    process.env.FEED_FOLLOW_NEWEST = "-3";
    expect(() => settings()).toThrow(/FEED_FOLLOW_NEWEST/);
    process.env.FEED_FOLLOW_NEWEST = "1200";
    expect(settings()).toMatchObject({ feedProvider: "helius-ws", feedScope: "all", feedFollowNewest: 1200 });
  });
});
