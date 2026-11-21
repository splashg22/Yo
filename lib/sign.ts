/** Signs a transaction the server built. The server never sees a key. */
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { fromBase64, toBase64 } from "./bytes";

export function signTransaction(base64: string, seeds: Uint8Array[]): string {
  const transaction = VersionedTransaction.deserialize(fromBase64(base64));
  transaction.sign(seeds.map((seed) => Keypair.fromSeed(seed)));
  return toBase64(transaction.serialize());
}
