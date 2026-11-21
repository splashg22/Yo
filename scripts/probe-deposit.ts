/** Proof attempt on the local validator: a real deposit of SOL into the real Privacy Rings program. */
import { ShieldedKeypair, SigningKey, buildDepositTransaction, createSprClient, type Bytes32 } from "@heliuslabs/spr";
import { address, createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, signTransactionWithSigners } from "@solana/kit";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const url = "http://127.0.0.1:8899";
const connection = new Connection(url, "confirmed");
const user = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL));
const seed = () => Uint8Array.from(user.secretKey.slice(0, 32)) as Bytes32;
const signer = await createKeyPairSignerFromPrivateKeyBytes(seed());
const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed()));
const step = async <T>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
  try { const value = await run(); console.log("OK  ", label); return value; }
  catch (error) { console.log("FAIL", label, "::", String((error as Error).message ?? error).split("\n")[0]!.slice(0, 220)); return undefined; }
};
const client = await step("connect a Rings client to the local validator", () => createSprClient({ solanaRpcUrl: url, tree: address("777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor") }));
if (client) {
  const tx = await step("build a deposit of 1 SOL", () => buildDepositTransaction({ client, feePayer: signer.address, recipient: keypair.shieldedAddress(), amount: 1_000_000_000n }));
  if (tx) {
    const signed = await step("sign it", () => signTransactionWithSigners([signer], tx));
    if (signed) {
      await step("send it (the validator must accept the version 1 transaction format)", async () => {
        const wire = getBase64EncodedWireTransaction(signed as never);
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [wire, { encoding: "base64", preflightCommitment: "confirmed" }] }) });
        const body = await response.json() as { result?: string; error?: { message: string; data?: { logs?: string[] } } };
        if (body.error) throw new Error(`${body.error.message} ${(body.error.data?.logs ?? []).slice(-3).join(" | ")}`);
        await connection.confirmTransaction(body.result!, "confirmed");
        console.log("     signature", body.result);
      });
    }
  }
}
process.exit(0);
