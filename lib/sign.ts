/**
 * Signs a Solana transaction the server built, without a Solana library: the browser only
 * needs to find the bytes to sign and the slot each signature goes in.
 *
 * Wire format: a count of signatures, that many 64-byte slots, then the message. The
 * message begins with an optional version byte, a 3-byte header whose first byte is the
 * number of required signatures, and the account list; the first accounts are the signers,
 * in the same order as the signature slots.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { equal, fromBase64, toBase64 } from "./bytes";

/** Solana's "compact-u16": 7 bits per byte, low bits first. */
function readCompact(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  for (let index = 0; index < 3; index++) {
    const byte = bytes[start + index];
    if (byte === undefined) break;
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return { value, next: start + index + 1 };
  }
  throw new Error("the transaction is malformed");
}

export function signTransaction(base64: string, seeds: Uint8Array[]): string {
  const bytes = Uint8Array.from(fromBase64(base64));
  const signatures = readCompact(bytes, 0);
  const messageStart = signatures.next + signatures.value * 64;
  const message = bytes.subarray(messageStart);
  const headerStart = message[0] !== undefined && (message[0] & 0x80) !== 0 ? 1 : 0; // a version byte has its high bit set
  const required = message[headerStart];
  if (required === undefined || required === 0 || required !== signatures.value) throw new Error("the transaction is malformed");
  const accounts = readCompact(message, headerStart + 3);
  if (accounts.value < required || message.length < accounts.next + required * 32) throw new Error("the transaction is malformed");
  for (const seed of seeds) {
    const publicKey = ed25519.getPublicKey(seed);
    let slot = -1;
    for (let index = 0; index < required; index++) {
      if (equal(message.subarray(accounts.next + index * 32, accounts.next + index * 32 + 32), publicKey)) slot = index;
    }
    if (slot < 0) throw new Error("this transaction does not ask for that key's signature");
    bytes.set(ed25519.sign(message, seed), signatures.next + slot * 64);
  }
  return toBase64(bytes);
}

/** True once every signature slot has been filled. */
export function isFullySigned(base64: string): boolean {
  const bytes = fromBase64(base64);
  const signatures = readCompact(bytes, 0);
  for (let slot = 0; slot < signatures.value; slot++) {
    const start = signatures.next + slot * 64;
    if (bytes.subarray(start, start + 64).every((byte) => byte === 0)) return false;
  }
  return true;
}
