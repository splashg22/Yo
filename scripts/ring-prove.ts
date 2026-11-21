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
const seeds = JSON.parse(readFileSync(keyFile, "utf8")) as Record<"a" | "b" | "c", number[]>;
async function person(seed: number[]) {
  const bytes = () => Uint8Array.from(seed) as Bytes32;
  const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes());
  const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(bytes()));
  return { signer, keypair, wallet: new Wallet({ identity: keypair.shieldedAddress() }) };
}

const client = await createSprClient({ solanaRpcUrl: rpcUrl, ...endpoints, proverTee: SignedTeePolicy.forNetwork("devnet") });
const [a, b, c] = await Promise.all([person(seeds.a), person(seeds.b), person(seeds.c)]);
const keysOf = (who: typeof a) => LocalKeys.fromKeypair(who.keypair, client.proofService);
const lamportsOf = async (address: KeyPairSigner["address"]): Promise<bigint> => (await client.solanaRpc.getBalance(address, { commitment: "confirmed" }).send()).value;

/** Signs, sends and waits. Returns the signature, the slot and the size and version of what was sent. */
async function submit(transaction: Transaction, signers: KeyPairSigner[]): Promise<{ signature: Signature; slot: bigint; bytes: number; version: string }> {
  const signed = await signTransactionWithSigners(signers, transaction);
  const wire = getBase64EncodedWireTransaction(signed);
  const signature = getSignatureFromTransaction(signed);
  await client.solanaRpc.sendTransaction(wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }).send();
  const slot = await client.confirmTransaction(signature);
  const raw = Buffer.from(wire, "base64");
  const first = raw[1 + raw[0]! * 64]!;
  return { signature, slot, bytes: raw.length, version: (first & 0x80) === 0 ? "legacy" : `version ${first & 0x7f}` };
}
const link = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

console.log(`Test wallets (devnet only):\n  A ${a.signer.address}\n  B ${b.signer.address}\n  C ${c.signer.address}\n`);

await step("0. Reach devnet: RPC, the Ring's indexer, and the prover's attested enclave", async (say) => {
  const version = await client.solanaRpc.getVersion().send();
  say(`RPC answers: solana-core ${version["solana-core"]}`);
  const records = await client.getUserRecords([a.signer.address]);
  say(`Indexer answers a registry lookup (${JSON.stringify(records, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 160)})`);
  const attested = await client.attestProver();
  say(`Prover attestation verified by the SDK (${Object.keys(attested as object).join(", ")})`);
  const report = await client.checkProverProvingKeys();
  say(`Prover's proving keys match the SDK's (${JSON.stringify(report, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 200)})`);
});

const funded = (await lamportsOf(a.signer.address)) >= 300_000_000n;
if (!funded) {
  console.log(`\nWallet A holds ${(Number(await lamportsOf(a.signer.address)) / 1e9).toFixed(4)} SOL. The on-chain steps need about 0.3 devnet SOL there.`);
  for (const name of ["1. Register", "2. Deposit", "3. Transfer", "4. Withdraw"])
    steps.push({ name, outcome: "not run", evidence: [`Wallet A (${a.signer.address}) has no devnet SOL. Both public faucets refused this machine.`] });
} else {
  let ok = await step("1. Register two wallets in the on-chain registry", async (say) => {
    if ((await lamportsOf(b.signer.address)) < 20_000_000n) {
      // B needs a little SOL for its own fees: a plain transfer from A, public, as any funding is.
      const { getTransferSolInstruction } = await import("@solana-program/system");
      const { appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } =
        await import("@solana/kit");
      const { value: latest } = await client.solanaRpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(a.signer.address, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: a.signer, destination: b.signer.address, amount: 50_000_000n }), m),
      );
      const sent = await submit(compileTransaction(message) as Transaction, [a.signer]);
      say(`Funded B with 0.05 SOL from A: ${link(sent.signature)}`);
    }
    for (const [name, who] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const registration = await buildRegistrationTransaction({ client, owner: who.signer.address, address: who.keypair.shieldedAddress() });
      if (registration === undefined) say(`${name} is already registered with these keys`);
      else {
        const sent = await submit(registration, [who.signer]);
        say(`${name} registered: ${sent.version}, ${sent.bytes} bytes, ${link(sent.signature)}`);
      }
    }
    const records = await client.getUserRecords([a.signer.address, b.signer.address]);
    say(`Registry read back: ${JSON.stringify(records, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 300)}`);
  });

  const DEPOSIT = 100_000_000n;
  const SEND = 30_000_000n;
  const OUT = 10_000_000n;
  ok &&= await step("2. Deposit 0.1 SOL into A's Ring balance", async (say) => {
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a) });
    const before = a.wallet.balance(SOL_MINT).amount;
    const deposit = await buildDepositTransaction({ client, feePayer: a.signer.address, recipient: a.keypair.shieldedAddress(), amount: DEPOSIT });
    const sent = await submit(deposit, [a.signer]);
    say(`Deposit: ${sent.version}, ${sent.bytes} bytes, ${link(sent.signature)}`);
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a), config: { requireSlot: sent.slot } });
    const after = a.wallet.balance(SOL_MINT).amount;
    say(`A's Ring balance, read with A's keys: ${before} -> ${after} lamports`);
    if (after - before !== DEPOSIT) throw new Error(`the Ring balance rose by ${after - before}, not ${DEPOSIT}`);
  });

  ok &&= await step("3. Transfer 0.03 SOL from A's Ring balance to B's", async (say) => {
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b) });
    const [beforeA, beforeB] = [a.wallet.balance(SOL_MINT).amount, b.wallet.balance(SOL_MINT).amount];
    const started = Date.now();
    const transfer = await buildTransferTransaction({ client, wallet: a.wallet, keys: keysOf(a), feePayer: a.signer.address, recipient: b.signer.address, amount: SEND });
    say(`Proof made by the attested prover and the transaction built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const sent = await submit(transfer, [a.signer]);
    say(`Transfer: ${sent.version}, ${sent.bytes} bytes, ${link(sent.signature)}`);
    await syncWallet({ client, wallet: a.wallet, keys: keysOf(a), config: { requireSlot: sent.slot } });
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b), config: { requireSlot: sent.slot } });
    say(`A: ${beforeA} -> ${a.wallet.balance(SOL_MINT).amount}; B: ${beforeB} -> ${b.wallet.balance(SOL_MINT).amount}`);
    if (b.wallet.balance(SOL_MINT).amount - beforeB !== SEND) throw new Error("B did not receive exactly the amount sent");
    // What the chain shows of it: the amount must not appear anywhere in the transaction.
    const onChain = await client.solanaRpc.getTransaction(sent.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" }).send();
    const moved = (onChain?.meta?.postBalances ?? []).map((post, index) => BigInt(post) - BigInt(onChain!.meta!.preBalances[index]!));
    say(`Public SOL movements in the transaction: ${JSON.stringify(moved.map(String))} (the fee only; ${SEND} appears nowhere)`);
    if (moved.some((change) => change === SEND || change === -SEND)) throw new Error("the transferred amount is visible in the public balances");
    say(`B's history, read with B's keys: ${getPrivateTransactions(b.wallet).length} entries`);
  });

  ok &&= await step("4. Withdraw 0.01 SOL from B's Ring balance to a fresh address", async (say) => {
    const before = await lamportsOf(c.signer.address);
    const withdrawal = await buildWithdrawalTransaction({ client, wallet: b.wallet, keys: keysOf(b), feePayer: b.signer.address, recipient: c.signer.address, amount: OUT });
    const sent = await submit(withdrawal, [b.signer]);
    say(`Withdrawal: ${sent.version}, ${sent.bytes} bytes, ${link(sent.signature)}`);
    const after = await lamportsOf(c.signer.address);
    say(`Fresh address C on-chain: ${before} -> ${after} lamports`);
    if (after - before !== OUT) throw new Error(`C received ${after - before}, not ${OUT}`);
    await syncWallet({ client, wallet: b.wallet, keys: keysOf(b), config: { requireSlot: sent.slot } });
    say(`B's Ring balance after: ${b.wallet.balance(SOL_MINT).amount}`);
  });
  void ok;
}

writeFileSync(".data-devnet/ring-prove.json", JSON.stringify({ at: new Date().toISOString(), wallets: [a, b, c].map((who) => who.signer.address), steps }, null, 2));
console.log(`\n${steps.filter((entry) => entry.outcome === "proven").length} of ${steps.length} steps proven. Evidence saved to .data-devnet/ring-prove.json`);
process.exit(steps.some((entry) => entry.outcome === "failed") ? 1 : 0);
