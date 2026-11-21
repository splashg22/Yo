/**
 * Notes on a transfer, sealed in the sender's browser so that this site's server stores
 * them without being able to read them.
 *
 * Nothing here is our own cryptography. A note is a libsodium "sealed box"
 * (crypto_box_seal: X25519, XSalsa20-Poly1305), the library's standard construction for
 * encrypting to a public key. Each wallet's note key pair comes from libsodium's
 * crypto_box_seed_keypair, seeded with a key derived from the wallet's seed by HKDF-SHA256.
 *
 * What it does not do: hide that a note exists, hide its rough length, or hide who sent
 * what to whom. It has not been reviewed by anyone outside the project.
 */
import sodium from "libsodium-wrappers";
import { fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";
import { deriveKey } from "./keys";
import { isPrintable } from "./text";

export const NOTE_MAX_CHARACTERS = 140;
/**
 * What a wallet extension is asked to sign, once, when it connects. The signature never leaves the
 * browser; it seeds the note key. The text says what it is for, because the wallet shows it to its owner.
 */
export const NOTE_KEY_MESSAGE =
  "Sign to create your note key.\n\nThis lets you read and send sealed notes on transfers. It moves nothing and costs nothing. Only sign this on a site you trust: the signature is the key to your notes.";
/** A sealed box adds 48 bytes; a character is at most 4 bytes. In base64. */
export const SEALED_NOTE_MAX_LENGTH = Math.ceil(((48 + NOTE_MAX_CHARACTERS * 4) * 4) / 3) + 4;

export interface NoteKeys {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}
/** A note as the server stores it: one copy only the recipient can open, one only the sender can. */
export interface SealedNote {
  forRecipient: string;
  forSender: string;
}

/**
 * A wallet's note key pair, from a secret only that wallet has: its seed, or for a wallet extension its
 * signature of NOTE_KEY_MESSAGE. The same secret always gives the same pair, so a restored backup can read old notes.
 */
export async function noteKeysFor(walletSeed: Uint8Array): Promise<NoteKeys> {
  await sodium.ready;
  const pair = sodium.crypto_box_seed_keypair(deriveKey(walletSeed, "note-key"));
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export function checkNoteText(text: string): string {
  const note = text.trim();
  if ([...note].length > NOTE_MAX_CHARACTERS) throw new Error(`the note is longer than ${NOTE_MAX_CHARACTERS} characters`);
  if (!isPrintable(note)) throw new Error("the note contains characters that cannot be shown");
  return note;
}

/** Seals a note to the recipient's published note key, and a second copy to the sender's own, so both can read it later. */
export async function sealNote(text: string, recipientKey: string, sender: NoteKeys): Promise<SealedNote> {
  await sodium.ready;
  const message = utf8(checkNoteText(text));
  const recipient = fromBase64(recipientKey);
  if (recipient.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error("the recipient's note key is not valid");
  return { forRecipient: toBase64(sodium.crypto_box_seal(message, recipient)), forSender: toBase64(sodium.crypto_box_seal(message, sender.publicKey)) };
}

/** Opens a sealed note with a wallet's own keys. Null if it was not sealed to this wallet, or was altered. */
export async function openNote(sealed: string, keys: NoteKeys): Promise<string | null> {
  await sodium.ready;
  try {
    return fromUtf8(sodium.crypto_box_seal_open(fromBase64(sealed), keys.publicKey, keys.privateKey));
  } catch {
    return null; // wrong key or tampered: libsodium refuses, and there is nothing to show
  }
}
