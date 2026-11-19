import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ammCreatorVaultPda, creatorVaultPda } from "@pump-fun/pump-sdk";
// @ts-expect-error plain JavaScript shared with the browser page
import * as proof from "../web/proof.js";

const TREASURY = "7ZGiZyFjBEKNS5qGhtfonJdKmhvechrHK1HW3P4uRjqP";
const TTWO = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const DCTY = "9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump";
const STRAT = Keypair.generate().publicKey.toBase58();
const ALICE = Keypair.generate().publicKey.toBase58();
const BOB = Keypair.generate().publicKey.toBase58();
const cfg = { treasury: TREASURY, burnMint: DCTY, strategyMint: STRAT, strategySymbol: "DSTRAT", quoteMint: TTWO };

interface Bal { i: number; mint: string; owner: string; amount: string; decimals: number }
const bal = (i: number, mint: string, owner: string, amount: string, decimals = 6): Bal => ({ i, mint, owner, amount, decimals });
const row = (b: Bal) => ({ accountIndex: b.i, mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount, decimals: b.decimals } });

/** A `getTransaction` result with jsonParsed encoding, reduced to what the classifier reads. */
function tx(o: { keys: string[]; pre?: Bal[]; post?: Bal[]; ixs?: unknown[]; inner?: unknown[]; lamports?: [number, number]; err?: unknown }) {
  return {
    blockTime: 1_800_000_000,
    meta: {
      err: o.err ?? null,
      preTokenBalances: (o.pre ?? []).map(row),
      postTokenBalances: (o.post ?? []).map(row),
      preBalances: o.lamports ? [o.lamports[0]] : [1_000_000_000],
      postBalances: o.lamports ? [o.lamports[1]] : [1_000_000_000],
      innerInstructions: o.inner ? [{ index: 0, instructions: o.inner }] : [],
    },
    transaction: { message: { accountKeys: o.keys.map((pubkey) => ({ pubkey })), instructions: o.ixs ?? [] } },
  };
}
const program = (programId: string) => ({ programId, accounts: [], data: "" });
const transfer = (destination: string, amount: string, mint = TTWO) => ({
  programId: TOKEN_2022_PROGRAM_ID.toBase58(), program: "spl-token",
  parsed: { type: "transferChecked", info: { authority: TREASURY, source: "SRC", destination, mint, tokenAmount: { amount, decimals: 6 } } },
});
const burn = (amount: string, mint = DCTY) => ({
  programId: TOKEN_PROGRAM_ID.toBase58(), program: "spl-token",
  parsed: { type: "burnChecked", info: { authority: TREASURY, account: "ATA", mint, tokenAmount: { amount, decimals: 6 } } },
});

describe("proof page: classifying the treasury's transactions", () => {
  it("recognises a creator-fee claim (TTWO arrives through pump)", () => {
    const r = proof.classify(cfg, "s1", 1, tx({
      keys: [TREASURY, "ATA", proof.PUMP_PROGRAM], ixs: [program(proof.PUMP_PROGRAM)],
      pre: [bal(1, TTWO, TREASURY, "0")], post: [bal(1, TTWO, TREASURY, "1500000")],
    }));
    expect(r).toMatchObject({ kind: "claim", amount: "1.5 TTWO", sign: 1, quoteDelta: 1500000n, err: false });
  });
  it("recognises a DCTY buy and names the venue", () => {
    const r = proof.classify(cfg, "s2", 2, tx({
      keys: [TREASURY, "Q", "B", proof.JUPITER_PROGRAM], ixs: [program(proof.JUPITER_PROGRAM)],
      pre: [bal(1, TTWO, TREASURY, "1000000"), bal(2, DCTY, TREASURY, "0")],
      post: [bal(1, TTWO, TREASURY, "250000"), bal(2, DCTY, TREASURY, "42000000")],
    }));
    expect(r.kind).toBe("buy");
    expect(r.text).toContain("Jupiter");
    expect(r.amount).toBe("0.75 TTWO → 42 DCTY");
  });
  it("recognises a burn from the burn instruction, not just the balance drop", () => {
    const r = proof.classify(cfg, "s3", 3, tx({
      keys: [TREASURY, "B"], ixs: [burn("42000000")],
      pre: [bal(1, DCTY, TREASURY, "42000000")], post: [bal(1, DCTY, TREASURY, "0")],
    }));
    expect(r).toMatchObject({ kind: "burn", coin: "burn", burned: 42000000n, amount: "42 DCTY", sign: -1 });
  });
  it("tells a buyback of the strategy coin from a DCTY buy", () => {
    const r = proof.classify(cfg, "bb", 2, tx({
      keys: [TREASURY, "Q", "S", proof.PUMP_PROGRAM], ixs: [program(proof.PUMP_PROGRAM)],
      pre: [bal(1, TTWO, TREASURY, "1000000"), bal(2, STRAT, TREASURY, "0")],
      post: [bal(1, TTWO, TREASURY, "800000"), bal(2, STRAT, TREASURY, "5000000000")],
    }));
    expect(r).toMatchObject({ kind: "buy", coin: "self", selfDelta: 5000000000n, amount: "0.2 TTWO → 5,000 DSTRAT" });
    expect(r.text).toContain("Bought DSTRAT back");
  });
  it("recognises a burn of the strategy coin and keeps it apart from DCTY burns", () => {
    const r = proof.classify(cfg, "sb", 3, tx({
      keys: [TREASURY, "S"], ixs: [burn("5000000000", STRAT)],
      pre: [bal(1, STRAT, TREASURY, "5000000000")], post: [bal(1, STRAT, TREASURY, "0")],
    }));
    expect(r).toMatchObject({ kind: "burn", coin: "self", selfBurned: 5000000000n, burned: 0n, amount: "5,000 DSTRAT", sign: -1 });
    const dcty = proof.classify(cfg, "db", 4, tx({ keys: [TREASURY, "B"], ixs: [burn("7000000")], pre: [bal(1, DCTY, TREASURY, "7000000")], post: [bal(1, DCTY, TREASURY, "0")] }));
    expect(proof.summarize([r, dcty])).toMatchObject({ burned: 7000000n, burns: 1, selfBurned: 5000000000n, selfBurns: 1 });
  });
  it("never counts a transfer of the strategy coin as a holder payout", () => {
    const r = proof.classify(cfg, "st", 5, tx({
      keys: [TREASURY, "SRC", "X"], ixs: [transfer("X", "5", STRAT)],
      pre: [bal(1, STRAT, TREASURY, "5")], post: [bal(2, STRAT, ALICE, "5")],
    }));
    expect(r.kind).not.toBe("payout");
    expect(r.payouts).toEqual([]);
  });
  it("recognises a payout, with each recipient and amount", () => {
    const r = proof.classify(cfg, "s4", 4, tx({
      keys: [TREASURY, "SRC", "A_ATA", "B_ATA"], ixs: [transfer("A_ATA", "300000"), transfer("B_ATA", "100000")],
      pre: [bal(1, TTWO, TREASURY, "400000")],
      post: [bal(1, TTWO, TREASURY, "0"), bal(2, TTWO, ALICE, "300000"), bal(3, TTWO, BOB, "100000")],
    }));
    expect(r).toMatchObject({ kind: "payout", paid: 400000n, amount: "0.4 TTWO", text: "2 holders paid" });
    expect(r.payouts).toEqual([[ALICE, 300000n], [BOB, 100000n]]);
  });
  it("notes when fees were claimed in the same transaction as a payout", () => {
    const r = proof.classify(cfg, "s5", 5, tx({
      keys: [TREASURY, "SRC", "A_ATA", proof.PUMP_PROGRAM], ixs: [program(proof.PUMP_PROGRAM), transfer("A_ATA", "1")],
      pre: [bal(1, TTWO, TREASURY, "0")], post: [bal(1, TTWO, TREASURY, "999"), bal(2, TTWO, ALICE, "1")],
    }));
    expect(r.kind).toBe("payout");
    expect(r.text).toContain("fees claimed in the same transaction");
  });
  it("works out the pair token from a payout when the page is not told it", () => {
    const r = proof.classify({ ...cfg, quoteMint: null }, "s6", 6, tx({
      keys: [TREASURY, "SRC", "A_ATA"], ixs: [transfer("A_ATA", "5")],
      pre: [bal(1, TTWO, TREASURY, "5")], post: [bal(1, TTWO, TREASURY, "0"), bal(2, TTWO, ALICE, "5")],
    }));
    expect(r.quoteMint).toBe(TTWO);
  });
  it("never counts a DCTY transfer or a transfer to the treasury itself as a payout", () => {
    const r = proof.classify(cfg, "s7", 7, tx({
      keys: [TREASURY, "SRC", "X", "OWN"], ixs: [transfer("X", "5", DCTY), transfer("OWN", "5")],
      pre: [bal(1, DCTY, TREASURY, "5")], post: [bal(2, DCTY, ALICE, "5"), bal(3, TTWO, TREASURY, "5")],
    }));
    expect(r.kind).not.toBe("payout");
    expect(r.payouts).toEqual([]);
  });
  it("shows SOL housekeeping plainly and hides a zero amount", () => {
    expect(proof.classify(cfg, "s8", 8, tx({ keys: [TREASURY], lamports: [1_000_000_000, 998_000_000] }))).toMatchObject({ kind: "other", amount: "-0.002 SOL" });
    expect(proof.classify(cfg, "s9", 9, tx({ keys: [TREASURY], lamports: [1_000_000_000, 999_999_990] })).amount).toBe("");
  });
  it("marks a failed transaction and leaves it out of totals", () => {
    const failed = proof.classify(cfg, "f", 10, tx({ keys: [TREASURY, "B"], ixs: [burn("7")], err: { InstructionError: [0, "Custom"] } }));
    const good = proof.classify(cfg, "g", 11, tx({ keys: [TREASURY, "B"], ixs: [burn("7000000")], pre: [bal(1, DCTY, TREASURY, "7000000")], post: [bal(1, DCTY, TREASURY, "0")] }));
    expect(failed.err).toBe(true);
    expect(proof.summarize([failed, good])).toMatchObject({ burned: 7000000n, burns: 1 });
  });
  it("adds up totals and a wallet's own payouts", () => {
    const rows = [
      proof.classify(cfg, "c", 1, tx({ keys: [TREASURY, "A", proof.PUMP_PROGRAM], ixs: [program(proof.PUMP_PROGRAM)], pre: [bal(1, TTWO, TREASURY, "0")], post: [bal(1, TTWO, TREASURY, "1000")] })),
      proof.classify(cfg, "p1", 2, tx({ keys: [TREASURY, "S", "A_ATA"], ixs: [transfer("A_ATA", "300")], pre: [bal(1, TTWO, TREASURY, "500")], post: [bal(1, TTWO, TREASURY, "200"), bal(2, TTWO, ALICE, "300")] })),
      proof.classify(cfg, "p2", 3, tx({ keys: [TREASURY, "S", "A_ATA", "B_ATA"], ixs: [transfer("A_ATA", "100"), transfer("B_ATA", "100")], pre: [bal(1, TTWO, TREASURY, "200")], post: [bal(1, TTWO, TREASURY, "0"), bal(2, TTWO, ALICE, "400"), bal(3, TTWO, BOB, "100")] })),
    ];
    expect(proof.summarize(rows)).toMatchObject({ claimed: 1000n, claims: 1, paid: 500n, payouts: 2, recipients: 2 });
    expect(proof.receivedBy(rows, ALICE).map((r: { amount: bigint }) => r.amount)).toEqual([300n, 100n]);
    expect(proof.receivedBy(rows, BOB)).toHaveLength(1);
  });
});

describe("proof page: amounts and addresses", () => {
  it("formats base units without rounding up and never shows -0", () => {
    expect(proof.fmt(1234567890n, 6)).toBe("1,234.5678");
    expect(proof.fmt(-5n, 9)).toBe("0");
    expect(proof.fmt(-2_000_000n, 9, 4)).toBe("-0.002");
    expect(proof.toBase("100000", 6)).toBe(100000000000n);
    expect(proof.toBase("1.5", 2)).toBe(150n);
  });
  it("round-trips base58, including leading zero bytes", () => {
    for (const key of [TREASURY, DCTY, PublicKey.default.toBase58()]) {
      expect(proof.b58encode(proof.b58decode(key))).toBe(key);
      expect(proof.b58decode(key)).toHaveLength(32);
    }
  });
  it("tells wallets (on the curve) from program addresses (off the curve) like web3.js does", () => {
    for (let i = 0; i < 25; i++) {
      const key = Keypair.generate().publicKey;
      expect(proof.onCurve(key.toBytes())).toBe(true);
      const [pda] = PublicKey.findProgramAddressSync([key.toBytes()], new PublicKey(proof.ATA_PROGRAM));
      expect(proof.onCurve(pda.toBytes())).toBe(false);
    }
  });
  it("derives the two creator fee vaults exactly like the pump SDK", async () => {
    const creator = Keypair.generate().publicKey;
    const [curveVault, ammVault] = await proof.creatorVaults(creator.toBase58());
    expect(curveVault).toBe(creatorVaultPda(creator).toBase58());
    expect(ammVault).toBe(ammCreatorVaultPda(creator).toBase58());
  });
  it("derives associated token accounts exactly like @solana/spl-token", async () => {
    for (let i = 0; i < 12; i++) {
      const owner = Keypair.generate().publicKey;
      for (const [mint, programId] of [[DCTY, TOKEN_PROGRAM_ID], [TTWO, TOKEN_2022_PROGRAM_ID]] as const) {
        const want = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, programId).toBase58();
        expect(await proof.ata(owner.toBase58(), mint, programId.toBase58())).toBe(want);
      }
    }
  });
});

describe("proof page: RPC client", () => {
  const reply = (status: number, body: unknown) => ({ status, json: async () => body });
  it("moves to the next endpoint when one refuses the request", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return url.includes("first") ? reply(403, { error: { message: "Indexed requests require a personal token" } }) : reply(200, { result: { value: 42 } });
    };
    const rpc = proof.makeRpc(["https://first", "https://second"], fetchImpl);
    expect(await rpc("getBalance", ["x"])).toEqual({ value: 42 });
    expect(calls).toEqual(["https://first", "https://second"]);
  });
  it("surfaces the RPC's own error when there is nowhere else to go", async () => {
    const rpc = proof.makeRpc(["https://only"], async () => reply(200, { error: { message: "Invalid param" } }));
    await expect(rpc("getBalance", ["x"])).rejects.toThrow("Invalid param");
  });
});
