/** Checks on what a request carries, with messages a person can act on. */
import bs58 from "bs58";
import { U64_MAX } from "../constants";
import { SEALED_NOTE_MAX_LENGTH, type SealedNote } from "../notes";
import { isUnprintable } from "../text";

export type Input = Record<string, unknown>;

export function text(value: unknown, name: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`"${name}" is missing`);
  if (value.length > maxLength) throw new Error(`"${name}" is too long`);
  return value;
}

/** A wallet or coin address: base58, 32 bytes. */
export function addressOf(value: unknown, name: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) throw new Error(`the ${name} is missing`);
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(candidate);
  } catch {
    throw new Error(`the ${name} is not a valid Solana address`);
  }
  if (bytes.length !== 32) throw new Error(`the ${name} is not a valid Solana address`);
  return candidate;
}

/** A transaction signature: base58, 64 bytes. */
export function signatureOf(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(candidate);
  } catch {
    throw new Error("that is not a transaction signature");
  }
  if (bytes.length !== 64) throw new Error("that is not a transaction signature");
  return candidate;
}

/** A whole number of base units, above zero and small enough for the chain to hold. */
export function amountOf(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) throw new Error(`the ${name} must be a whole number of base units`);
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error(`the ${name} must be above zero`);
  if (amount > U64_MAX) throw new Error(`the ${name} is larger than the chain can hold`);
  return amount;
}

/** A name or memo: printable text only, so nothing odd reaches a page or a transaction. */
export function plainText(value: unknown, name: string, maxLength: number): string {
  const candidate = text(value, name, maxLength).trim();
  for (const character of candidate) {
    if (isUnprintable(character.codePointAt(0)!)) throw new Error(`the ${name} contains characters that cannot be shown`);
  }
  return candidate;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A wallet's public note key: 32 bytes in base64. */
export function noteKeyOf(value: unknown): string {
  const key = text(value, "note key", 64);
  if (!BASE64.test(key) || Buffer.from(key, "base64").length !== 32) throw new Error("the note key is not valid");
  return key;
}

/**
 * A note arrives already sealed in the sender's browser. The server checks its shape and
 * size and stores it; it holds no key that opens it. A note sent as readable text is refused.
 */
export function sealedNoteOf(value: unknown): SealedNote {
  if (value === null || typeof value !== "object") throw new Error("a note must be sealed in the browser before it is sent");
  const { forRecipient, forSender } = value as Record<string, unknown>;
  const part = (candidate: unknown): string => {
    const sealed = text(candidate, "note", SEALED_NOTE_MAX_LENGTH);
    // 48 bytes of sealed-box overhead and at least one byte of note.
    if (!BASE64.test(sealed) || Buffer.from(sealed, "base64").length < 49) throw new Error("the sealed note is not valid");
    return sealed;
  };
  return { forRecipient: part(forRecipient), forSender: part(forSender) };
}
