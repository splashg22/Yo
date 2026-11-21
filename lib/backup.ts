/**
 * No-wallet mode: a key made in the browser, and a password-encrypted backup of it.
 * The backup is a small JSON file. Without the password it reveals only the address.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { fromBase64, randomBytes, toBase64, utf8 } from "./bytes";
import { actorFromSeed, type Actor } from "./keys";

export interface Backup {
  kind: "ring-wallet-backup";
  version: 1;
  address: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  nonce: string;
  ciphertext: string;
}
/** scrypt with 128 MB of memory: about a second in a browser, and that much per guess for anyone who gets hold of the file. */
const COST = { N: 2 ** 17, r: 8, p: 1 };

/** `onProgress` is called with a share from 0 to 1 while the key is derived from the password. */
export function encryptBackup(actor: Actor, password: string, cost = COST, onProgress?: (share: number) => void): Backup {
  if (password.length < 8) throw new Error("the password must be at least 8 characters");
  const salt = randomBytes(16),
    nonce = randomBytes(12);
  const key = scrypt(utf8(password), salt, { ...cost, dkLen: 32, ...(onProgress ? { onProgress } : {}) });
  return {
    kind: "ring-wallet-backup",
    version: 1,
    address: actor.address,
    kdf: { name: "scrypt", ...cost, salt: toBase64(salt) },
    nonce: toBase64(nonce),
    ciphertext: toBase64(gcm(key, nonce, utf8(actor.address)).encrypt(actor.seed)),
  };
}

export function decryptBackup(input: unknown, password: string, onProgress?: (share: number) => void): Actor {
  const backup = input as Backup;
  if (!backup || backup.kind !== "ring-wallet-backup" || backup.version !== 1 || backup.kdf?.name !== "scrypt")
    throw new Error("this is not a wallet backup file");
  const { N, r, p } = backup.kdf;
  if (!Number.isInteger(N) || N < 2 ** 15 || N > 2 ** 20 || r !== 8 || p !== 1) throw new Error("the backup file has unexpected settings");
  const key = scrypt(utf8(password), fromBase64(backup.kdf.salt), { N, r, p, dkLen: 32, ...(onProgress ? { onProgress } : {}) });
  let seed: Uint8Array;
  try {
    seed = gcm(key, fromBase64(backup.nonce), utf8(backup.address)).decrypt(fromBase64(backup.ciphertext));
  } catch {
    throw new Error("wrong password, or the backup file was altered");
  }
  const actor = actorFromSeed(seed);
  if (actor.address !== backup.address) throw new Error("the backup does not match its address");
  return actor;
}
