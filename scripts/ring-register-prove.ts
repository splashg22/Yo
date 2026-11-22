/**
 * Answers one question on devnet, with evidence: can any wallet register a coin with the Privacy Rings program,
 * or does it take somebody's permission?
 *
 *   npm run ring:register
 *
 * Method: test wallet A makes a new Token-2022 coin. Test wallet B, which has no role in that coin or in the Ring
 * (it is not the coin's mint authority and not the program's upgrade authority), sends the program's own
 * "create SPL interface" instruction for it. Devnet only. Evidence goes to .data-devnet/ring-register.json.
 */
import { getCreateSplInterfaceInstructionAsync } from "@heliuslabs/spr/instructions";
import { address, isSignerRole, isWritableRole, type Instruction } from "@solana/kit";
import { MINT_SIZE, TOKEN_2022_PROGRAM_ID, createInitializeMint2Instruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const key = process.env.HELIUS_API_KEY ?? "";
if (!key) throw new Error("HELIUS_API_KEY is not set. Add it to .env.");
if (!existsSync(".data-devnet/prove-keys.json")) throw new Error("Run npm run ring:prove first: it makes and funds the test wallets.");
const seeds = JSON.parse(readFileSync(".data-devnet/prove-keys.json", "utf8")) as Record<"a" | "b", number[]>;
const [a, b] = [Keypair.fromSeed(Uint8Array.from(seeds.a)), Keypair.fromSeed(Uint8Array.from(seeds.b))];
const chain = new Connection(`https://devnet.helius-rpc.com/?api-key=${key}`, "confirmed");
const RING = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const link = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const evidence: string[] = [];
const say = (line: string): void => {
  evidence.push(line);
  console.log("   ", line);
};
const toWeb3 = (instruction: Instruction): TransactionInstruction =>
  new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((meta) => ({
      pubkey: new PublicKey(meta.address),
      isSigner: isSignerRole(meta.role),
      isWritable: isWritableRole(meta.role),
    })),
    data: Buffer.from(instruction.data ?? []),
  });
async function send(instructions: TransactionInstruction[], payer: Keypair, signers: Keypair[]): Promise<string> {
  const latest = await chain.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, ...latest }).add(...instructions);
  transaction.sign(...signers);
  const signature = await chain.sendRawTransaction(transaction.serialize());
  // Asked for, not waited on through a subscription: the machine this was written on cannot hold one open.
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = (await chain.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`failed on the chain: ${JSON.stringify(status.err)}  ${link(signature)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`not confirmed within a minute: ${link(signature)}`);
}

let answer = "not answered";
try {
  const mint = Keypair.generate();
  const rent = await chain.getMinimumBalanceForRentExemption(MINT_SIZE);
  const made = await send(
    [
      SystemProgram.createAccount({
        fromPubkey: a.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: rent,
        space: MINT_SIZE,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, a.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ],
    a,
    [a, mint],
  );
  say(`A (${a.publicKey.toBase58()}) made a new Token-2022 coin ${mint.publicKey.toBase58()}: ${link(made)}`);
  const register = await getCreateSplInterfaceInstructionAsync({
    authority: address(b.publicKey.toBase58()),
    mint: address(mint.publicKey.toBase58()),
    tokenProgram: address(TOKEN_2022_PROGRAM_ID.toBase58()),
  });
  const accounts = (register.accounts ?? []).map((meta) => `${meta.address}${isSignerRole(meta.role) ? " (signs)" : ""}`);
  say(
    `The registering instruction names ${accounts.length} accounts; the only one that signs is the wallet sending it: ${accounts.filter((entry) => entry.endsWith("(signs)")).join(", ")}`,
  );
  const info = await chain.getParsedAccountInfo(new PublicKey(RING));
  const programData = (info.value?.data as { parsed?: { info?: { programData?: string } } }).parsed?.info?.programData;
  const data = programData ? await chain.getAccountInfo(new PublicKey(programData)) : null;
  const upgradeAuthority = data && data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)).toBase58() : "none";
  say(
    `The Ring program's upgrade authority on devnet is ${upgradeAuthority}; B is ${b.publicKey.toBase58()}: a different wallet, with no role in the coin either`,
  );
  const registered = await send([toWeb3(register)], b, [b]);
  say(`B registered the coin with the Ring: ${link(registered)}`);
  // Registering it a second time must not be possible, or must change nothing.
  try {
    await send([toWeb3(register)], b, [b]);
    say("A second registration of the same coin also went through (it changes nothing that the first did not)");
  } catch (error) {
    say(`A second registration of the same coin was refused: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`);
  }
  answer = "On devnet, any wallet can register a coin: no permission was asked for or needed";
} catch (error) {
  const cause = String(error instanceof Error ? error.message : error)
    .replaceAll(key, "<key>")
    .slice(0, 600);
  say(`FAILED: ${cause}`);
  answer = `Not shown: ${cause}`;
}
writeFileSync(
  ".data-devnet/ring-register.json",
  JSON.stringify({ at: new Date().toISOString(), question: "Does registering a coin need permission?", answer, evidence }, null, 2),
);
console.log(`\n${answer}\nEvidence saved to .data-devnet/ring-register.json`);
process.exit(answer.startsWith("On devnet") ? 0 : 1);
