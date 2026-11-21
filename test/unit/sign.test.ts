import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../../lib/bytes";
import { actorFromSeed, newActor, signMessage, verifyMessage } from "../../lib/keys";
import { isFullySigned, signTransaction } from "../../lib/sign";

const BLOCKHASH = "11111111111111111111111111111111";
const toKeypair = (seed: Uint8Array) => Keypair.fromSeed(seed);

function versioned(payer: PublicKey, extraSigner?: PublicKey): string {
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  if (extraSigner) instructions.push(SystemProgram.transfer({ fromPubkey: extraSigner, toPubkey: payer, lamports: 1 }));
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message();
  return toBase64(new VersionedTransaction(message).serialize());
}

describe("keys", () => {
  it("derive the same address Solana does, and sign what Solana verifies", () => {
    const actor = newActor();
    expect(actor.address).toBe(toKeypair(actor.seed).publicKey.toBase58());
    const message = new TextEncoder().encode("hello");
    const signature = signMessage(actor, message);
    expect(verifyMessage(actor.address, message, signature)).toBe(true);
    expect(verifyMessage(actor.address, new TextEncoder().encode("hellp"), signature)).toBe(false);
    expect(verifyMessage(newActor().address, message, signature)).toBe(false);
    expect(verifyMessage("not an address", message, signature)).toBe(false);
    expect(() => actorFromSeed(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("signing a transaction without a Solana library", () => {
  it("produces byte for byte what the Solana library produces", () => {
    const actor = newActor();
    const unsigned = versioned(new PublicKey(actor.address));
    const reference = VersionedTransaction.deserialize(fromBase64(unsigned));
    reference.sign([toKeypair(actor.seed)]);
    expect(signTransaction(unsigned, [actor.seed])).toBe(toBase64(reference.serialize()));
  });

  it("fills each signer's own slot, in any order, and reports when all are filled", () => {
    const payer = newActor(),
      coin = newActor();
    const unsigned = versioned(new PublicKey(payer.address), new PublicKey(coin.address));
    expect(isFullySigned(unsigned)).toBe(false);
    const half = signTransaction(unsigned, [coin.seed]);
    expect(isFullySigned(half)).toBe(false);
    const full = signTransaction(half, [payer.seed]);
    expect(isFullySigned(full)).toBe(true);
    expect(full).toBe(signTransaction(unsigned, [payer.seed, coin.seed]));
    const parsed = VersionedTransaction.deserialize(fromBase64(full));
    const signers = parsed.message.staticAccountKeys.slice(0, 2);
    parsed.signatures.forEach((signature, index) => expect(verifyMessage(signers[index]!.toBase58(), parsed.message.serialize(), signature)).toBe(true));
  });

  it("signs a legacy transaction too", () => {
    const actor = newActor();
    const legacy = new Transaction({ feePayer: new PublicKey(actor.address), recentBlockhash: BLOCKHASH }).add(
      SystemProgram.transfer({ fromPubkey: new PublicKey(actor.address), toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    const unsigned = toBase64(legacy.serialize({ requireAllSignatures: false, verifySignatures: false }));
    const signed = Transaction.from(fromBase64(signTransaction(unsigned, [actor.seed])));
    expect(signed.verifySignatures()).toBe(true);
  });

  it("refuses a key the transaction does not ask for, and bytes that are not a transaction", () => {
    const unsigned = versioned(new PublicKey(newActor().address));
    expect(() => signTransaction(unsigned, [newActor().seed])).toThrow(/does not ask for that key's signature/);
    expect(() => signTransaction(toBase64(new Uint8Array(10)), [newActor().seed])).toThrow(/malformed/);
    expect(() => signTransaction(toBase64(Uint8Array.from([1, ...new Array<number>(64).fill(0), 0x80, 3, 0, 0, 0xff, 0xff, 0xff])), [newActor().seed])).toThrow(
      /malformed/,
    );
  });
});
