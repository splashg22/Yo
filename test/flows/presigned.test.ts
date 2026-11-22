/**
 * Orders signed in advance: a proof of what the design can and cannot do, on the local chain with the real
 * pump.fun program. Nothing in the product uses it. The write-up is SIGNED-IN-ADVANCE.md; each claim there
 * that can be tested is tested here.
 *
 * The idea: the person signs the exact sell now, on a "durable nonce" instead of a recent blockhash, so the
 * signed transaction does not go stale. Whoever holds it (this server) can send it later, when the price
 * reaches the person's trigger. The holder has no key: it can choose when to send, and nothing else.
 */
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, NONCE_ACCOUNT_LENGTH, NonceAccount, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import type { RingClient } from "../../lib/sdk";
import { tradeInstructions } from "../../lib/server/pump";
import { SOL, chain, freshServer, fundedClient, onChain } from "./helpers";

freshServer();
let creator: RingClient, mint: string;
/** The person placing orders. A plain key here, so the test can sign exactly what a wallet would. */
const person = Keypair.generate();
/** The holder of signed orders: this server's role. It has a key of its own only to pay nothing and sign nothing. */
const BLOCKHASH_LIFE_SLOTS = 151;

async function confirmed(signature: string): Promise<void> {
  const latest = await chain.getLatestBlockhash("confirmed");
  const result = await chain.confirmTransaction({ signature, ...latest }, "confirmed");
  if (result.value.err) throw new Error(`failed on the chain: ${JSON.stringify(result.value.err)}`);
}
async function sendNow(instructions: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const transaction = new Transaction({ feePayer: person.publicKey, ...(await chain.getLatestBlockhash("confirmed")) }).add(...instructions);
  transaction.sign(...signers);
  const signature = await chain.sendRawTransaction(transaction.serialize());
  await confirmed(signature);
  return signature;
}
/** Makes a nonce account owned by the person: one per open order. Returns its address. */
async function newNonce(): Promise<PublicKey> {
  const nonce = Keypair.generate();
  const rent = await chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  await sendNow(
    [
      SystemProgram.createAccount({
        fromPubkey: person.publicKey,
        newAccountPubkey: nonce.publicKey,
        lamports: rent,
        space: NONCE_ACCOUNT_LENGTH,
        programId: SystemProgram.programId,
      }),
      SystemProgram.nonceInitialize({ noncePubkey: nonce.publicKey, authorizedPubkey: person.publicKey }),
    ],
    [person, nonce],
  );
  return nonce.publicKey;
}
const nonceValue = async (address: PublicKey): Promise<string> => NonceAccount.fromAccountData((await chain.getAccountInfo(address, "confirmed"))!.data).nonce;
/**
 * The person signs a sell of `tokens` now, to be sent whenever: it will not go through for less than
 * `slippagePercent` below today's price. Returns the signed bytes, which is all the holder ever has.
 */
async function signSellInAdvance(nonce: PublicKey, tokens: bigint, slippagePercent: number): Promise<{ wire: Buffer; expected: bigint }> {
  const plan = await tradeInstructions({ wallet: person.publicKey, mint: new PublicKey(mint), side: "sell", amount: tokens, slippagePercent });
  const transaction = new Transaction({
    feePayer: person.publicKey,
    nonceInfo: { nonce: await nonceValue(nonce), nonceInstruction: SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: person.publicKey }) },
  }).add(...plan.instructions);
  transaction.sign(person);
  return { wire: transaction.serialize(), expected: plan.expected };
}
const held = (): Promise<bigint> => onChain(person.publicKey.toBase58(), mint);
/** Sends what the holder has. Resolves to how it ended: "landed", or why not. */
async function holderSends(wire: Buffer): Promise<string> {
  let signature: string;
  try {
    signature = await chain.sendRawTransaction(wire, { skipPreflight: true });
  } catch (error) {
    return `refused at the door: ${String(error instanceof Error ? error.message : error)}`;
  }
  // A transaction the chain will never take (a spent nonce) is simply dropped: there is nothing to wait out.
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = (await chain.getSignatureStatuses([signature])).value[0];
    if (status?.err) return `failed on the chain: ${JSON.stringify(status.err)}`;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "landed";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "never taken by the chain";
}
async function waitSlots(count: number): Promise<void> {
  const from = await chain.getSlot("confirmed");
  while ((await chain.getSlot("confirmed")) < from + count) await new Promise((resolve) => setTimeout(resolve, 1000));
}

beforeAll(async () => {
  creator = await fundedClient();
  mint = (await creator.launch({ name: "Presigned", symbol: "PRE", firstBuyLamports: SOL / 20n })).mint;
  await confirmed(await chain.requestAirdrop(person.publicKey, Number(5n * SOL)));
  const buy = await tradeInstructions({ wallet: person.publicKey, mint: new PublicKey(mint), side: "buy", amount: SOL / 5n, slippagePercent: 5 });
  await sendNow(buy.instructions, [person]);
  expect(await held()).toBeGreaterThan(0n);
});

describe("an order signed in advance", () => {
  it("goes through long after an ordinary signed transaction would have gone stale, and sells exactly what was signed", async () => {
    const nonce = await newNonce();
    const before = await held();
    const selling = before / 10n;
    const { wire } = await signSellInAdvance(nonce, selling, 30);
    // An ordinary transaction signed at the same moment, for comparison.
    const ordinary = new Transaction({ feePayer: person.publicKey, ...(await chain.getLatestBlockhash("confirmed")) }).add(
      SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: person.publicKey, lamports: 1 }),
    );
    ordinary.sign(person);
    await waitSlots(BLOCKHASH_LIFE_SLOTS + 10);
    await expect(chain.sendRawTransaction(ordinary.serialize())).rejects.toThrow(/Blockhash not found|expired|block height exceeded/i);
    const solBefore = await onChain(person.publicKey.toBase58(), NATIVE);
    expect(await holderSends(wire)).toBe("landed");
    expect(before - (await held())).toBe(selling);
    expect(await onChain(person.publicKey.toBase58(), NATIVE)).toBeGreaterThan(solBefore);
  }, 180_000);

  it("cannot be sent twice, and cannot be changed by whoever holds it", async () => {
    const nonce = await newNonce();
    const before = await held();
    const { wire } = await signSellInAdvance(nonce, before / 10n, 30);
    // Any change to the signed bytes breaks the signature: checked the way every validator checks it, without sending.
    // (Sending the altered copy would also be refused; it is not sent here because it carries the same signature as
    // the true one, and a node that has just thrown a signature out may ignore it for a while.)
    expect(Transaction.from(wire).verifySignatures()).toBe(true);
    for (const at of [wire.length - 12, wire.length - 40, 80]) {
      const altered = Buffer.from(wire);
      altered[at] = altered[at]! ^ 0xff;
      let stillValid: boolean;
      try {
        stillValid = Transaction.from(altered).verifySignatures();
      } catch {
        stillValid = false; // so broken it no longer reads as a transaction
      }
      expect(stillValid, `byte ${at}`).toBe(false);
    }
    expect(await holderSends(wire)).toBe("landed");
    const after = await held();
    expect(before - after).toBe(before / 10n);
    // The nonce moved on when the order went through: the same bytes are now worthless. Sent again, and again,
    // nothing more is sold. (The chain reports the first sale under that signature; the balance is the proof.)
    await holderSends(wire);
    await chain.sendRawTransaction(wire, { skipPreflight: true }).catch(() => undefined);
    await waitSlots(8);
    expect(await held()).toBe(after);
  }, 120_000);

  it("is cancelled by the person alone, without the holder's help: moving the nonce on kills the signed order", async () => {
    const nonce = await newNonce();
    const before = await held();
    const { wire } = await signSellInAdvance(nonce, before / 10n, 30);
    await sendNow([SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: person.publicKey })], [person]);
    expect(await holderSends(wire)).not.toBe("landed");
    expect(await held()).toBe(before);
    // Closing the nonce account returns its rent to the person.
    const rent = await chain.getBalance(nonce, "confirmed");
    const solBefore = await onChain(person.publicKey.toBase58(), NATIVE);
    await sendNow(
      [SystemProgram.nonceWithdraw({ noncePubkey: nonce, authorizedPubkey: person.publicKey, toPubkey: person.publicKey, lamports: rent })],
      [person],
    );
    expect((await onChain(person.publicKey.toBase58(), NATIVE)) - solBefore).toBeGreaterThan(BigInt(rent) - 20_000n);
  }, 120_000);

  it("never sells below the price that was signed; but an attempt that fails on the chain uses the order up", async () => {
    const nonce = await newNonce();
    const before = await held();
    // Signed with a floor 1% under today's price.
    const { wire } = await signSellInAdvance(nonce, before / 10n, 1);
    // The price falls well below that floor: somebody else sells a lot.
    const dump = await creator.trade(mint, "sell", (await onChain(creator.address, mint)) / 2n);
    expect(dump.expected).toBeGreaterThan(0n);
    const solBefore = await onChain(person.publicKey.toBase58(), NATIVE);
    const nonceBefore = await nonceValue(nonce);
    // The holder sends anyway (a careless or a hostile one). The chain refuses the sale: no coin leaves.
    expect(await holderSends(wire)).toMatch(/failed on the chain/);
    expect(await held()).toBe(before);
    // What it cost the person: the network fee, and the order itself. A transaction on a durable nonce that fails
    // on the chain still moves the nonce on, so these signed bytes can never be sent again.
    expect(solBefore - (await onChain(person.publicKey.toBase58(), NATIVE))).toBeLessThan(20_000n);
    expect(await nonceValue(nonce)).not.toBe(nonceBefore);
    expect(await holderSends(wire)).not.toBe("landed");
    expect(await held()).toBe(before);
  }, 120_000);

  it("holds only what the person still has: an order for coins since sold elsewhere fails and sells nothing", async () => {
    const nonce = await newNonce();
    const all = await held();
    const { wire } = await signSellInAdvance(nonce, all, 50);
    // The person sells most of the coins by hand in the meantime.
    const byHand = await tradeInstructions({
      wallet: person.publicKey,
      mint: new PublicKey(mint),
      side: "sell",
      amount: (all * 9n) / 10n,
      slippagePercent: 50,
    });
    await sendNow(byHand.instructions, [person]);
    const left = await held();
    expect(await holderSends(wire)).not.toBe("landed");
    expect(await held()).toBe(left);
    // The coin account is the person's own throughout: the holder was never given any authority over it.
    const account = await chain.getParsedAccountInfo(
      getAssociatedTokenAddressSync(new PublicKey(mint), person.publicKey, true, TOKEN_2022_PROGRAM_ID),
      "confirmed",
    );
    const info = (account.value?.data as { parsed?: { info?: { delegate?: string; owner?: string } } }).parsed?.info;
    expect(info?.owner).toBe(person.publicKey.toBase58());
    expect(info?.delegate).toBeUndefined();
  }, 120_000);
});
