/**
 * Answers one question on devnet, with evidence: can two Ring transfers, one each way between two wallets,
 * go in ONE transaction, so that an OTC trade settles whole or not at all?
 *
 *   npm run ring:otc
 *
 * It uses the test wallets made by scripts/ring-prove.ts (run that first: A and B must be registered and hold a
 * little in their Ring balances). Devnet only. Evidence is written to .data-devnet/ring-otc.json.
 *
 * The method. The SDK builds one transaction per transfer. Each holds a single instruction to the Ring program
 * and a proof made for that sender. Here the two instructions are taken out of their transactions and put into
 * one version 1 transaction, signed by both wallets:
 *   1. both good: it must go through, and both Ring balances must move by exactly the two amounts;
 *   2. one leg made bad on purpose (its proof spends a note that has since been spent): the whole transaction
 *      must fail, and the good leg's wallet must be exactly where it was.
 */
import { LocalKeys, SOL_MINT, ShieldedKeypair, SigningKey, Wallet, buildTransferTransaction, createSprClient, syncWallet, type Bytes32 } from "@heliuslabs/spr";
import { SignedTeePolicy } from "@heliuslabs/spr/client";
import { compileUnsignedTransaction } from "@heliuslabs/spr/internal";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  decompileTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  signTransactionWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const key = process.env.HELIUS_API_KEY ?? "";
if (!key) throw new Error("HELIUS_API_KEY is not set. Add it to .env.");
// --fresh: the wallets of the latest `ring:prove --fresh` run, which hold Ring balances on both sides.
const keyFile = process.argv.includes("--fresh") ? ".data-devnet/prove-keys-fresh.json" : ".data-devnet/prove-keys.json";
if (!existsSync(keyFile)) throw new Error("Run npm run ring:prove first: it makes and funds the test wallets.");
const hide = (text: string): string => text.replaceAll(key, "<key>");
const seeds = JSON.parse(readFileSync(keyFile, "utf8")) as Record<"a" | "b" | "c", number[]>;
async function person(seed: number[]) {
  const bytes = () => Uint8Array.from(seed) as Bytes32;
  const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes());
  const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(bytes()));
  return { signer, keypair, wallet: new Wallet({ identity: keypair.shieldedAddress() }) };
}
const client = await createSprClient({ solanaRpcUrl: `https://devnet.helius-rpc.com/?api-key=${key}`, proverTee: SignedTeePolicy.forNetwork("devnet") });
const [a, b] = await Promise.all([person(seeds.a), person(seeds.b)]);
const keysOf = (who: typeof a) => LocalKeys.fromKeypair(who.keypair, client.proofService);
const ringSol = (who: typeof a): bigint => who.wallet.balance(SOL_MINT).amount;
const sync = async (slot?: bigint): Promise<void> => {
  for (const who of [a, b])
    await syncWallet({ client, wallet: who.wallet, keys: keysOf(who), ...(slot === undefined ? {} : { config: { requireSlot: slot } }) });
};
const link = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

const evidence: string[] = [];
/** What the chain recorded of a transaction: whether it went through, and what it cost its paying wallet. */
async function chainSays(signature: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await client.solanaRpc
      .getTransaction(signature as Parameters<typeof client.solanaRpc.getTransaction>[0], {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 1,
        encoding: "json",
      })
      .send();
    if (!found?.meta) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    const paid = BigInt(found.meta.preBalances[0]!) - BigInt(found.meta.postBalances[0]!);
    const failed = found.meta.err
      ? `FAILED (${JSON.stringify(found.meta.err, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))})`
      : "went through";
    return `${failed} in slot ${found.slot}, version ${String((found as { version?: unknown }).version)}, fee ${found.meta.fee} lamports, the paying wallet's SOL fell by ${paid} lamports, ${found.meta.computeUnitsConsumed ?? 0} compute units`;
  }
  return "the chain did not return it within 30 seconds";
}
const say = (line: string): void => {
  evidence.push(line);
  console.log("   ", line);
};
/** The instructions of a compiled transaction, as they were before it was compiled. */
function instructionsOf(transaction: Transaction): Instruction[] {
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes));
  return [...message.instructions];
}
/** One transfer's instruction and how much it took to build. */
async function leg(from: typeof a, to: typeof a, amount: bigint): Promise<Instruction[]> {
  const built = await buildTransferTransaction({
    client,
    wallet: from.wallet,
    keys: keysOf(from),
    feePayer: a.signer.address,
    recipient: to.signer.address,
    amount,
  });
  return instructionsOf(built);
}
async function together(instructions: Instruction[], signers: KeyPairSigner[]) {
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  // Each transfer used about 140,000 units by itself; two, with room.
  const compiled = compileUnsignedTransaction({ feePayer: a.signer.address, lifetime, instructions, computeUnitLimit: 600_000 });
  const signed = await signTransactionWithSigners(signers, compiled);
  const wire = getBase64EncodedWireTransaction(signed);
  return { signed, wire, signature: getSignatureFromTransaction(signed), bytes: Buffer.from(wire, "base64").length };
}

const outcome: { question: string; answer: string; evidence: string[] } = {
  question: "Can OTC settle atomically on the real Ring?",
  answer: "not answered",
  evidence,
};
try {
  await sync();
  say(`Before: A holds ${ringSol(a)} lamports in its Ring balance, B holds ${ringSol(b)}`);
  const A_GIVES = 4_000_000n;
  const B_GIVES = 3_000_000n;
  if (ringSol(a) < A_GIVES * 3n || ringSol(b) < B_GIVES * 3n)
    throw new Error("the test wallets hold too little in their Ring balances: run npm run ring:prove again");

  // ---- 1. Both legs good -------------------------------------------------------------------
  const [legA, legB] = [await leg(a, b, A_GIVES), await leg(b, a, B_GIVES)];
  say(`Each leg is ${legA.length} and ${legB.length} instruction(s) to the Ring program`);
  const both = await together([...legA, ...legB], [a.signer, b.signer]);
  say(`One version 1 transaction holding both, signed by both wallets: ${both.bytes} bytes`);
  const [beforeA, beforeB] = [ringSol(a), ringSol(b)];
  await client.solanaRpc.sendTransaction(both.wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }).send();
  const slot = await client.confirmTransaction(both.signature);
  say(`Signature: ${both.signature}`);
  say(`Read back from the chain: ${await chainSays(both.signature)}`);
  await sync(slot);
  say(`A: ${beforeA} -> ${ringSol(a)} (gave ${A_GIVES}, got ${B_GIVES}); B: ${beforeB} -> ${ringSol(b)} (got ${A_GIVES}, gave ${B_GIVES})`);
  if (ringSol(a) - beforeA !== B_GIVES - A_GIVES || ringSol(b) - beforeB !== A_GIVES - B_GIVES)
    throw new Error("the Ring balances did not move by exactly the two amounts");

  // ---- 2. One leg bad: the whole must fail ---------------------------------------------------
  // B's leg is built, and then B spends the same notes another way, so that leg's proof is stale.
  const goodA = await leg(a, b, A_GIVES);
  const staleB = await leg(b, a, B_GIVES);
  // The SDK sets aside the notes of a transfer it has built, so the competing spend is built from a second copy of
  // B's wallet, as a second device or tab of B's would have.
  const other = await person(seeds.b);
  await syncWallet({ client, wallet: other.wallet, keys: keysOf(other) });
  const spend = await buildTransferTransaction({
    client,
    wallet: other.wallet,
    keys: keysOf(other),
    feePayer: b.signer.address,
    recipient: a.signer.address,
    amount: other.wallet.balance(SOL_MINT).amount,
  });
  const spent = await signTransactionWithSigners([b.signer], spend);
  await client.solanaRpc
    .sendTransaction(getBase64EncodedWireTransaction(spent), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" })
    .send();
  const spentSlot = await client.confirmTransaction(getSignatureFromTransaction(spent));
  await sync(spentSlot);
  say(`B then moved everything it held to A by itself, which makes its prepared leg stale. A: ${ringSol(a)}, B: ${ringSol(b)}`);
  const [holdA, holdB] = [ringSol(a), ringSol(b)];
  const broken = await together([...goodA, ...staleB], [a.signer, b.signer]);
  let refused = "";
  try {
    // Sent without the dry run a wallet would do first, so that it is the chain itself that answers.
    await client.solanaRpc.sendTransaction(broken.wire, { encoding: "base64", skipPreflight: true }).send();
    await client.confirmTransaction(broken.signature);
  } catch (error) {
    refused = hide(error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
  }
  const status = (await client.solanaRpc.getSignatureStatuses([broken.signature]).send()).value[0];
  say(
    `One good leg and one stale leg in one transaction: ${status?.err ? `failed on the chain (${JSON.stringify(status.err, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))})` : refused ? `not taken (${refused})` : "WENT THROUGH"}  ${link(broken.signature)}`,
  );
  say(`Signature: ${broken.signature}`);
  say(`Read back from the chain: ${await chainSays(broken.signature)}`);
  await sync();
  say(`After it: A ${holdA} -> ${ringSol(a)}; B ${holdB} -> ${ringSol(b)}`);
  if (ringSol(a) !== holdA || ringSol(b) !== holdB) throw new Error("a leg went through by itself: the two did not settle together");
  outcome.answer = "Yes: two transfers in one version 1 transaction settle together, and a transaction with one bad leg moves nothing";
} catch (error) {
  const cause = hide(error instanceof Error ? `${error.name}: ${error.message}${"code" in error ? ` [${String(error.code)}]` : ""}` : String(error)).slice(
    0,
    700,
  );
  say(`FAILED: ${cause}`);
  outcome.answer = `Not shown: ${cause}`;
}
writeFileSync(".data-devnet/ring-otc.json", JSON.stringify({ at: new Date().toISOString(), ...outcome }, null, 2));
console.log(`\n${outcome.answer}\nEvidence saved to .data-devnet/ring-otc.json`);
process.exit(outcome.answer.startsWith("Yes") ? 0 : 1);
