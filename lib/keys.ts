/** Wallet keys. Pure JavaScript, so the same code runs in Node and in a browser. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { randomBytes, utf8 } from "./bytes";
export interface Actor {
  address: string;
  seed: Uint8Array;
}

export function actorFromSeed(seed: Uint8Array): Actor {
  if (seed.length !== 32) throw new Error("a wallet seed is 32 bytes");
  return { address: bs58.encode(ed25519.getPublicKey(seed)), seed: Uint8Array.from(seed) };
}

export function newActor(): Actor {
  return actorFromSeed(randomBytes(32));
}

export function signMessage(actor: Actor, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, actor.seed);
}

export function verifyMessage(address: string, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = bs58.decode(address);
    return key.length === 32 && ed25519.verify(signature, message, key);
  } catch {
    return false;
  }
}

/** A 32-byte key for one purpose, derived from a secret (a wallet seed, or a wallet signature). */
export function deriveKey(secret: Uint8Array, purpose: string): Uint8Array {
  return hkdf(sha256, secret, new Uint8Array(0), utf8(`shadowterminal/${purpose}`), 32);
}
