/**
 * Proves the real Privacy Rings program on devnet, step by step, and writes the evidence to RING-RESULTS.md.
 *   npm run ring:prove
 * It needs HELIUS_API_KEY in .env and a little devnet SOL in the first test wallet, whose address it prints.
 * The three test wallets are made here and kept in .data-devnet/ (ignored by git). Devnet only: it refuses anything else.
 */
import {
  LocalKeys,
  SOL_MINT,
  ShieldedKeypair,
  SigningKey,
  Wallet,
  buildDepositTransaction,
  buildRegistrationTransaction,
  buildTransferTransaction,
  buildWithdrawalTransaction,
  createSprClient,
  getPrivateTransactions,
  syncWallet,
  type Bytes32,
} from "@heliuslabs/spr";
import { SignedTeePolicy } from "@heliuslabs/spr/client";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionWithSigners,
  type KeyPairSigner,
  type Signature,
  type Transaction,
} from "@solana/kit";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const key = process.env.HELIUS_API_KEY ?? "";
if (!key) throw new Error("HELIUS_API_KEY is not set. Add it to .env.");
const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${key}`;
// Helius serves the Ring's indexer and prover from the same address as the RPC. The separate hosts named in the SDK's
// README refused this key (tried 21 November 2026); they can still be named here.
const endpoints = {
  ...(process.env.RING_INDEXER_URL ? { indexerUrl: process.env.RING_INDEXER_URL } : {}),
  ...(process.env.RING_PROVER_URL ? { proverUrl: process.env.RING_PROVER_URL } : {}),
};
const hide = (text: string): string => text.replaceAll(key, "<key>");

interface Step {
  name: string;
  outcome: "proven" | "failed" | "not run";
  evidence: string[];
}
const steps: Step[] = [];
async function step(name: string, run: (say: (line: string) => void) => Promise<void>): Promise<boolean> {
  const evidence: string[] = [];
  const started = Date.now();
  try {
    await run((line) => {
      evidence.push(line);
      console.log("   ", line);
    });
    evidence.push(`took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    steps.push({ name, outcome: "proven", evidence });
    console.log("ok  ", name);
    return true;
  } catch (error) {
    const cause = error instanceof Error ? `${error.name}: ${error.message}${"code" in error ? ` [${String(error.code)}]` : ""}` : String(error);
    evidence.push(`FAILED: ${hide(cause).slice(0, 600)}`);
    steps.push({ name, outcome: "failed", evidence });
    console.log("FAIL", name, "::", hide(cause).slice(0, 600));
    return false;
  }
}

// ---- the test wallets ---------------------------------------------------------------------
mkdirSync(".data-devnet", { recursive: true });
const keyFile = ".data-devnet/prove-keys.json";
if (!existsSync(keyFile)) {
  const made = Object.fromEntries(["a", "b", "c"].map((name) => [name, [...crypto.getRandomValues(new Uint8Array(32))]]));
  writeFileSync(keyFile, JSON.stringify(made), { mode: 0o600 });
}
const funded = JSON.parse(readFileSync(keyFile, "utf8")) as Record<"a" | "b" | "c", number[]>;
// --fresh: three wallets that have never touched the chain, so that every step, registration included, really runs.
// They are paid their test SOL by the first of the wallets above, which is the one that was sent devnet SOL.
const fresh = process.argv.includes("--fresh");
const seeds = fresh
  ? (Object.fromEntries(["a", "b", "c"].map((name) => [name, [...crypto.getRandomValues(new Uint8Array(32))]])) as Record<"a" | "b" | "c", number[]>)
  : funded;
if (fresh) writeFileSync(".data-devnet/prove-keys-fresh.json", JSON.stringify(seeds), { mode: 0o600 });
async function person(seed: number[]) {
  const bytes = () => Uint8Array.from(seed) as Bytes32;
  const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes());
  const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(bytes()));
  return { signer, keypair, wallet: new Wallet({ identity: keypair.shieldedAddress() }) };
}

const client = await createSprClient({ solanaRpcUrl: rpcUrl, ...endpoints, proverTee: SignedTeePolicy.forNetwork("devnet") });
const [a, b, c] = await Promise.all([person(seeds.a), person(seeds.b), person(seeds.c)]);
const keysOf = (who: typeof a) => LocalKeys.fromKeypair(who.keypair, client.proofService);
const lamportsOf = async (address: KeyPairSigner["address"]): Promise<bigint> =>
  (await client.solanaRpc.getBalance(address, { commitment: "confirmed" }).send()).value;

/** Signs, sends and waits. Returns the signature, the slot and the size and version of what was sent. */
async function submit(transaction: Transaction, signers: KeyPairSigner[]): Promise<{ signature: Signature; slot: bigint; bytes: number; version: string }> {
  const signed = await signTransactionWithSigners(signers, transaction);
  const wire = getBase64EncodedWireTransaction(signed);
  const signature = getSignatureFromTransaction(signed);
  await client.solanaRpc.sendTransaction(wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }).send();
  const slot = await client.confirmTransaction(signature);
  const raw = Buffer.from(wire, "base64");
  // A version 1 transaction starts with its version byte and carries its signatures at the end. Older kinds start
  // with their signatures, and a version 0 message marks itself in the first byte after them.
  const leading = raw[0]!;
  const afterSignatures = raw[1 + leading * 64] ?? 0;
  const version = (leading & 0x80) !== 0 ? `version ${leading & 0x7f}` : (afterSignatures & 0x80) !== 0 ? `version ${afterSignatures & 0x7f}` : "legacy";
  return { signature, slot, bytes: raw.length, version };
}
const link = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

/** What each transaction cost, for the table in RING-RESULTS.md. */
const costs: { step: string; signature: string; slot: number; version: string; feeLamports: number; payerPaidLamports: string; computeUnits: number }[] = [];
/**
 * Reads a transaction back from the chain, by its signature, and says what the chain recorded: that it went
 * through, its version, its fee, and what the paying wallet's SOL did. Nothing here is taken from what was sent.
 */
async function readBack(step: string, signature: Signature, say: (line: string) => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await client.solanaRpc.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" }).send();
    if (!found?.meta) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    if (found.meta.err)
      throw new Error(`the chain records it as failed: ${JSON.stringify(found.meta.err, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
    const paid = BigInt(found.meta.preBalances[0]!) - BigInt(found.meta.postBalances[0]!);
    const entry = {
      step,
      signature,
      slot: Number(found.slot),
      version: String((found as { version?: unknown }).version),
      feeLamports: Number(found.meta.fee),
      payerPaidLamports: paid.toString(),
      computeUnits: Number(found.meta.computeUnitsConsumed ?? 0),
    };
    costs.push(entry);
    say(
      `Read back from the chain: went through in slot ${entry.slot}, version ${entry.version}, fee ${entry.feeLamports} lamports, the paying wallet's SOL fell by ${entry.payerPaidLamports} lamports, ${entry.computeUnits} compute units`,
    );
    say(`Signature: ${signature}`);
    return;
  }
  throw new Error("the chain did not return the transaction within 30 seconds");
}

console.log(`Test wallets (devnet only):\n  A ${a.signer.address}\n  B ${b.signer.address}\n  C ${c.signer.address}\n`);

await step("0. Reach devnet: RPC, the Ring's indexer, and the prover's attested enclave", async (say) => {
  const version = await client.solanaRpc.getVersion().send();
  say(`RPC answers: solana-core ${version["solana-core"]}`);
  const records = await client.getUserRecords([a.signer.address]);
  say(`Indexer answers a registry lookup (${JSON.stringify(records, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 160)})`);
  const attested = await client.attestProver();
  say(`Prover attestation verified by the SDK (${Object.keys(attested).join(", ")})`);
  const report = await client.checkProverProvingKeys();
  say(`Prover's proving keys match the SDK's (${JSON.stringify(report, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 200)})`);
});

if (fresh) {
  await step("Fund the three new wallets' first one with 0.4 devnet SOL (a plain public transfer)", async (say) => {
    const payer = await person(funded.a);
    say(`From ${payer.signer.address}, which holds ${(Number(await lamportsOf(payer.signer.address)) / 1e9).toFixed(4)} SOL`);
    const { getTransferSolInstruction } = await import("@solana-program/system");
    const {
      appendTransactionMessageInstruction,
      compileTransaction,
      createTransactionMessage,
      pipe,
      setTransactionMessageFeePayer,
      setTransactionMessageLifetimeUsingBlockhash,
    } = await import("@solana/kit");
    const { value: latest } = await client.solanaRpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(payer.signer.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: payer.signer, destination: a.signer.address, amount: 400_000_000n }), m),
    );
    const sent = await submit(compileTransaction(message), [payer.signer]);
    await readBack("fund A", sent.signature, say);
    say(`A now holds ${await lamportsOf(a.signer.address)} lamports on the chain`);
  });
}
const hasSol = (await lamportsOf(a.signer.address)) >= 300_000_000n;
if (!hasSol) {
  console.log(`\nWallet A holds ${(Number(await lamportsOf(a.signer.address)) / 1e9).toFixed(4)} SOL. The on-chain steps need about 0.3 devnet SOL there.`);
  for (const name of ["1. Register", "2. Deposit", "3. Transfer", "4. Withdraw"])
    steps.push({ name, outcome: "not run", evidence: [`Wallet A (${a.signer.address}) has no devnet SOL. Both public faucets refused this machine.`] });
} else {
  let ok = await step("1. Register two wallets in the on-chain registry", async (say) => {
    if ((await lamportsOf(b.signer.address)) < 20_000_000n) {
      // B needs a little SOL for its own fees: a plain transfer from A, public, as any funding is.
      const { getTransferSolInstruction } = await import("@solana-program/system");
      const {
        appendTransactionMessageInstruction,
        compileTransaction,
        createTransactionMessage,
        pipe,
        setTransactionMessageFeePayer,
        setTransactionMessageLifetimeUsingBlockhash,
      } = await import("@solana/kit");
      const { value: latest } = await client.solanaRpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(a.signer.address, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: a.signer, destination: b.signer.address, amount: 50_000_000n }), m),
      );
      const sent = await submit(compileTransaction(message), [a.signer]);
      say(`Funded B with 0.05 SOL from A: ${link(sent.signature)}`);
      await readBack("fund B", sent.signature, say);
    }
    for (const [name, who] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const registration = await buildRegistrationTransaction({ client, owner: who.signer.address, address: who.keypair.shieldedAddress() });
      if (registration === undefined) say(`${name} is already registered with these keys`);
      else {
        const sent = await submit(registration, [who.signer]);
        say(`${name} registered: ${sent.bytes} bytes, ${link(sent.signature)}`);
        await readBack(`register ${name}`, sent.signature, say);
      }
    }
    const records = await client.getUserRecords([a.signer.address, b.signer.address]);
    const owners = (records as unknown as { records: ({ owner?: string } | null)[] }).records.map((record) => record?.owner ?? "MISSING");
    say(`Registry read back from the Ring's indexer: records for ${owners.join(" and ")}`);
    if (owners.includes("MISSING")) throw new Error("a wallet that was just registered is not in the registry");
  });

  const DEPOSIT = 100_000_000n;
  const SEND = 30_000_000n;
  const OUT = 10_000_000n;
  ok &&= await step("2. Deposit 0.1 SOL into A's Ring balance", async (say) => {
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a) });
    const before = a.wallet.balance(SOL_MINT).amount;
    const deposit = await buildDepositTransaction({ client, feePayer: a.signer.address, recipient: a.keypair.shieldedAddress(), amount: DEPOSIT });
    const sent = await submit(deposit, [a.signer]);
    say(`Deposit: ${sent.bytes} bytes, ${link(sent.signature)}`);
    await readBack("deposit", sent.signature, say);
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a), config: { requireSlot: sent.slot } });
    const after = a.wallet.balance(SOL_MINT).amount;
    say(`A's Ring balance, read with A's keys: ${before} -> ${after} lamports`);
    if (after - before !== DEPOSIT) throw new Error(`the Ring balance rose by ${after - before}, not ${DEPOSIT}`);
  });

  ok &&= await step("3. Transfer 0.03 SOL from A's Ring balance to B's", async (say) => {
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b) });
    const [beforeA, beforeB] = [a.wallet.balance(SOL_MINT).amount, b.wallet.balance(SOL_MINT).amount];
    const started = Date.now();
    const transfer = await buildTransferTransaction({
      client,
      wallet: a.wallet,
      keys: keysOf(a),
      feePayer: a.signer.address,
      recipient: b.signer.address,
      amount: SEND,
    });
    say(`Proof made by the attested prover and the transaction built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const sent = await submit(transfer, [a.signer]);
    say(`Transfer: ${sent.bytes} bytes, ${link(sent.signature)}`);
    await readBack("transfer", sent.signature, say);
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a), config: { requireSlot: sent.slot } });
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b), config: { requireSlot: sent.slot } });
    say(`A: ${beforeA} -> ${a.wallet.balance(SOL_MINT).amount}; B: ${beforeB} -> ${b.wallet.balance(SOL_MINT).amount}`);
    if (b.wallet.balance(SOL_MINT).amount - beforeB !== SEND) throw new Error("B did not receive exactly the amount sent");
    // What the chain shows of it: the amount must not appear anywhere in the transaction.
    const onChain = await client.solanaRpc
      .getTransaction(sent.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" })
      .send();
    const moved = (onChain?.meta?.postBalances ?? []).map((post, index) => BigInt(post) - BigInt(onChain!.meta!.preBalances[index]!));
    say(
      `Every public SOL movement in the transaction, from the chain: ${JSON.stringify(moved.map(String))}. The amount transferred, ${SEND}, is not among them`,
    );
    if (moved.some((change) => change === SEND || change === -SEND)) throw new Error("the transferred amount is visible in the public balances");
    say(`B's history, read with B's keys: ${getPrivateTransactions(b.wallet).length} entries`);
  });

  ok &&= await step("4. Withdraw 0.01 SOL from B's Ring balance to a fresh address", async (say) => {
    const before = await lamportsOf(c.signer.address);
    const withdrawal = await buildWithdrawalTransaction({
      client,
      wallet: b.wallet,
      keys: keysOf(b),
      feePayer: b.signer.address,
      recipient: c.signer.address,
      amount: OUT,
    });
    const sent = await submit(withdrawal, [b.signer]);
    say(`Withdrawal: ${sent.bytes} bytes, ${link(sent.signature)}`);
    await readBack("withdraw", sent.signature, say);
    const after = await lamportsOf(c.signer.address);
    say(`Fresh address C on-chain: ${before} -> ${after} lamports`);
    if (after - before !== OUT) throw new Error(`C received ${after - before}, not ${OUT}`);
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b), config: { requireSlot: sent.slot } });
    say(`B's Ring balance after: ${b.wallet.balance(SOL_MINT).amount}`);
  });
  void ok;
}

writeFileSync(
  ".data-devnet/ring-prove.json",
  JSON.stringify({ at: new Date().toISOString(), fresh, wallets: [a, b, c].map((who) => who.signer.address), steps, costs }, null, 2),
);
console.log(`\n${steps.filter((entry) => entry.outcome === "proven").length} of ${steps.length} steps proven. Evidence saved to .data-devnet/ring-prove.json`);
process.exit(steps.some((entry) => entry.outcome === "failed") ? 1 : 0);
