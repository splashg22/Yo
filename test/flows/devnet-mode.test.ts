/**
 * Devnet mode, as far as it can be proven without devnet: RING_NETWORK=devnet with the chain
 * address pointed at the local validator. What this shows is that the code takes the devnet
 * paths (no stand-in Ring, no faucet, its own lookup table) and that launching and trading work
 * on them. It does NOT show that Helius or real devnet behave the same: that is unverified.
 */
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import { newActor } from "../../lib/keys";
import { RingClient } from "../../lib/sdk";
import { settings } from "../../lib/server/env";
import { devnetOpsKey } from "../../lib/server/opskey";
import { devnetSetup } from "../../scripts/devnet-setup";
import { PUMP_PROGRAM, RING_PROGRAM, RPC_URL, SOL, call, chain, freshServer, logsOf, onChain } from "./helpers";

freshServer();
async function funded(): Promise<RingClient> {
  const client = new RingClient(call, newActor());
  await chain.confirmTransaction(await chain.requestAirdrop(new PublicKey(client.address), 10 * LAMPORTS_PER_SOL), "confirmed");
  return client;
}
let creator: RingClient, buyer: RingClient;

beforeAll(async () => {
  process.env.RING_NETWORK = "devnet";
  process.env.DEVNET_RPC_URL = RPC_URL;
  [creator, buyer] = await Promise.all([funded(), funded()]);
});
afterAll(() => {
  process.env.RING_NETWORK = "local";
  delete process.env.DEVNET_RPC_URL;
});

describe("settings", () => {
  it("needs a Helius key or an explicit address on devnet, and builds the Helius address from the key", () => {
    const url = process.env.DEVNET_RPC_URL;
    delete process.env.DEVNET_RPC_URL;
    try {
      expect(() => settings()).toThrow(/neither HELIUS_API_KEY nor DEVNET_RPC_URL/);
      process.env.HELIUS_API_KEY = "test-key-not-real";
      expect(settings().rpcUrl).toBe("https://devnet.helius-rpc.com/?api-key=test-key-not-real");
    } finally {
      delete process.env.HELIUS_API_KEY;
      process.env.DEVNET_RPC_URL = url;
    }
  });

  it("says Ring balances are not connected, and gives nothing away about the chain address", async () => {
    const config = await call("config", {});
    expect(config).toMatchObject({ network: "devnet", ring: "unavailable" });
    expect(JSON.stringify(config)).not.toContain("api-key");
    const status = await call("status", {});
    expect(status).toMatchObject({ network: "devnet", ring: "unavailable", escrowAddress: "", escrow: [] });
    expect(status.programs.every((program) => program.present)).toBe(true);
  });
});

describe("what works without the stand-in Ring", () => {
  it("launches a coin with the real programs, lists it, and trades it", async () => {
    const launched = await creator.launch({ name: "Devnet Lantern", symbol: "DLNT" });
    const programs = (await logsOf(launched.signature)).join("\n");
    expect(programs).toContain(`Program ${PUMP_PROGRAM} invoke`);
    expect(programs).toContain(`Program ${RING_PROGRAM} invoke`); // the coin is registered with the real Ring program
    expect((await call("explore", {})).coins.map((coin) => coin.symbol)).toContain("DLNT");
    const bought = await buyer.trade(launched.mint, "buy", SOL / 20n);
    expect(await onChain(buyer.address, launched.mint)).toBe(bought.expected);
    await buyer.trade(launched.mint, "sell", bought.expected / 2n);
    expect((await call("coin/activity", { mint: launched.mint })).activity).toHaveLength(3);
    const receipt = await call("tx/status", { signature: bought.signature });
    expect(receipt).toMatchObject({ status: "confirmed", payer: buyer.address, deposits: [] });
    expect((await call("stats", {})).launched).toBe(1);
  });

  it("refuses everything that needs a Ring balance or the local faucet, in one plain sentence each", async () => {
    await expect(creator.register()).rejects.toThrow(/Ring balances are not connected on this network/);
    await expect(creator.deposit(NATIVE, SOL)).rejects.toThrow(/not connected on this network/);
    await expect(creator.transfer(buyer.address, NATIVE, 1n)).rejects.toThrow(/not connected on this network/);
    await expect(creator.withdraw(NATIVE, 1n)).rejects.toThrow(/not connected on this network/);
    await expect(creator.offer({ mint: NATIVE, amount: 1n, priceLamports: 1n, buyer: buyer.address })).rejects.toThrow(/not connected on this network/);
    await expect(call("faucet", { wallet: creator.address })).rejects.toThrow(/local-validator mock/);
    await expect(creator.launch({ name: "To Ring", symbol: "RING", firstBuyLamports: SOL / 50n, toRing: true })).rejects.toThrow(
      /not connected on this network/,
    );
    await expect(call("fees/build", { wallet: creator.address, toRing: true })).rejects.toThrow(/no creator fees|not connected on this network/);
    expect(await call("ring/reconcile", {})).toEqual({ credited: 0, payoutsResolved: 0 });
  });
});

describe("the one-off devnet set-up", () => {
  it("asks for the operator wallet to be funded, then makes the lookup table that a launch with a first buy needs", async () => {
    await expect(creator.launch({ name: "Too Early", symbol: "EARLY", firstBuyLamports: SOL / 50n, toRing: false })).rejects.toThrow(
      /lookup table.*has not been made/,
    );
    const said: string[] = [];
    expect(await devnetSetup((line) => said.push(line))).toBe("funded-needed");
    const operator = devnetOpsKey().publicKey;
    expect(said.join("\n")).toContain(operator.toBase58());
    expect(said.join("\n")).toContain("faucet.solana.com");
    await chain.confirmTransaction(await chain.requestAirdrop(operator, LAMPORTS_PER_SOL), "confirmed");
    expect(await devnetSetup(() => undefined)).toBe("ready");
    expect(await devnetSetup((line) => said.push(line))).toBe("ready"); // running it again changes nothing
    expect(said.at(-1)).toMatch(/already exists/);
    expect((await call("status", {})).launchTable).toBe(true);
    const launched = await creator.launch({ name: "With A Buy", symbol: "WBUY", firstBuyLamports: SOL / 50n, toRing: false });
    expect(await onChain(creator.address, launched.mint)).toBe(launched.firstBuyTokens);
  });
});
