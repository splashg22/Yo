/** The narrow door to the real Ring's services: what it passes on and what it refuses, with nothing sent anywhere. */
import { Keypair, SystemProgram, Transaction, TransactionInstruction, PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { RING_PROGRAMS, passOn, programsOf, ringGateOpen } from "../../lib/server/ringgate";

const payer = Keypair.generate();
function signed(...programs: string[]): string {
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() });
  for (const program of programs)
    transaction.add(
      program === SystemProgram.programId.toBase58()
        ? SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })
        : new TransactionInstruction({
            programId: new PublicKey(program),
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            data: Buffer.from([1]),
          }),
    );
  transaction.sign(payer);
  return transaction.serialize().toString("base64");
}
const RING = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const rpc = (body: unknown) => passOn("rpc", "POST", new URLSearchParams(), Buffer.from(JSON.stringify(body)));
const text = (passed: { body: Buffer }): string => passed.body.toString("utf8");
const names = ["RING_NETWORK", "HELIUS_API_KEY", "DEVNET_RPC_URL"] as const;
const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of names) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
});
const openGate = (): void => {
  process.env.RING_NETWORK = "devnet";
  process.env.HELIUS_API_KEY = "test-key-not-real";
  delete process.env.DEVNET_RPC_URL;
};

describe("the gate to the real Ring", () => {
  it("is shut on a local chain, without a key, and when devnet is pointed somewhere of our own", async () => {
    delete process.env.RING_NETWORK;
    expect(ringGateOpen()).toBe(false);
    expect((await rpc({ method: "getSlot" })).status).toBe(404);
    process.env.RING_NETWORK = "devnet";
    process.env.DEVNET_RPC_URL = "http://127.0.0.1:8799";
    process.env.HELIUS_API_KEY = "test-key-not-real";
    expect(ringGateOpen()).toBe(false);
    openGate();
    expect(ringGateOpen()).toBe(true);
  });

  it("reads which programs a transaction calls", () => {
    expect(programsOf(signed(RING))).toEqual([RING]);
    expect(programsOf(signed(SystemProgram.programId.toBase58(), RING, RING)).sort()).toEqual([SystemProgram.programId.toBase58(), RING].sort());
    expect(() => programsOf("not a transaction")).toThrow();
  });

  it("refuses, before anything leaves this server, a method it does not pass on and a transaction for any other program", async () => {
    openGate();
    for (const method of ["requestAirdrop", "getProgramAccounts", "getBlock", "", 7]) {
      const refused = await rpc({ jsonrpc: "2.0", id: 1, method });
      expect(refused.status).toBe(403);
      expect(text(refused)).toMatch(/does not pass on/);
    }
    // One bad call in a batch refuses the whole batch.
    expect((await rpc([{ method: "getSlot" }, { method: "requestAirdrop" }])).status).toBe(403);
    for (const wire of [signed(PUMP), signed(RING, PUMP), "AAAA", ""]) {
      const refused = await rpc({ method: "sendTransaction", params: [wire] });
      expect(refused.status).toBe(403);
      expect(text(refused)).toMatch(/only transactions/);
      expect((await rpc({ method: "simulateTransaction", params: [wire] })).status).toBe(403);
    }
    expect((await passOn("rpc", "GET", new URLSearchParams(), null)).status).toBe(405);
    expect((await rpc("not an object")).status).toBe(403);
    expect((await passOn("rpc", "POST", new URLSearchParams(), Buffer.from("{not json"))).status).toBe(400);
    expect((await passOn("rpc", "POST", new URLSearchParams(), Buffer.alloc(1_600_000, 32))).status).toBe(413);
  });

  it("refuses any path that is not one of the Ring's own", async () => {
    openGate();
    for (const path of ["../v0/addresses", "prove/../../x", "a/b/c/d/e/f", "", "/abs", "with space", "a?b"]) {
      expect((await passOn(path, "GET", new URLSearchParams(), null)).status).toBe(404);
    }
    expect((await passOn("getUserRecords", "DELETE", new URLSearchParams(), null)).status).toBe(405);
  });

  it("lists only the Ring's programs and the ones the Ring needs", () => {
    expect(RING_PROGRAMS.has(RING)).toBe(true);
    expect(RING_PROGRAMS.has(PUMP)).toBe(false);
    expect(RING_PROGRAMS.size).toBe(7);
  });
});
