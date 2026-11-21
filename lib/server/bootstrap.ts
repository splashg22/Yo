/**
 * One-off set-up of a fresh LOCAL chain. Two things a real network already has:
 * pump.fun's fee wallets hold SOL (an empty wallet cannot receive a fee smaller than the
 * rent minimum), and a lookup table of the accounts every launch shares exists (a launch
 * with a first buy only fits in one transaction through one).
 */
import { AddressLookupTableProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { assertLocalOnly, settings } from "./env";
import { depositInstructions, escrow, localKey } from "./escrow";
import { feeWallets, launchInstructions } from "./pump";
import { connection } from "./solana";
import { save, state } from "./store";

/**
 * Two airdrops of the same amount to the same wallet in the same moment are the same
 * transaction to the chain: it lands once and reports success to both. So airdrops run one
 * at a time, and one whose signature was already handed out is asked for again a moment later.
 */
const handedOut = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

export function airdrop(to: PublicKey, sol: number): Promise<string> {
  assertLocalOnly("The faucet");
  const next = queue.then(() => airdropOnce(to, sol));
  queue = next.catch(() => undefined);
  return next;
}

async function airdropOnce(to: PublicKey, sol: number): Promise<string> {
  const chain = connection();
  // About fifteen seconds of tries: enough for the slowest case, a chain that has only just started.
  for (let attempt = 0; attempt < 60; attempt++) {
    const signature = await requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    if (handedOut.has(signature)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    if (handedOut.size > 1_000) handedOut.clear(); // long past: a signature can only repeat within one blockhash
    handedOut.add(signature);
    await chain.confirmTransaction(signature, "confirmed");
    return signature;
  }
  throw new Error("the faucet is busy. Try again in a moment.");
}

/**
 * Asks the validator's faucet directly, so the request can name the newest blockhash. Left
 * to its default the faucet uses the last finalised one, which does not change for the first
 * seconds of a new chain, and every airdrop in that time would be the same transaction.
 */
async function requestAirdrop(to: PublicKey, lamports: number): Promise<string> {
  const { rpcUrl, rpcTimeoutMs } = settings();
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [to.toBase58(), lamports, { commitment: "processed" }] }),
    signal: AbortSignal.timeout(rpcTimeoutMs),
  });
  const answer = (await response.json()) as { result?: string; error?: { message: string } };
  if (typeof answer.result !== "string") throw new Error(`the faucet refused: ${answer.error?.message ?? "no reason given"}`);
  return answer.result;
}

let running: Promise<void> | undefined;

/** Safe to call before every launch: it does its work once, and concurrent callers share that one run. */
export function bootstrap(): Promise<void> {
  running ??= setUp().finally(() => {
    running = undefined;
  });
  return running;
}

async function setUp(): Promise<void> {
  assertLocalOnly("Local set-up");
  const chain = connection();
  const known = state().lookupTable;
  if (known && (await chain.getAccountInfo(new PublicKey(known)))) return;

  for (const wallet of await feeWallets()) {
    if ((await chain.getBalance(wallet)) < LAMPORTS_PER_SOL / 100) await airdrop(wallet, 1);
  }
  const payer = localKey("local-ops");
  if ((await chain.getBalance(payer.publicKey)) < LAMPORTS_PER_SOL) await airdrop(payer.publicKey, 5);
  // Escrow pays network fees and token-account rent for withdrawals out of its own float, not out of deposits.
  if ((await chain.getBalance(escrow().publicKey)) < LAMPORTS_PER_SOL) {
    // This is the escrow's own working money, not anyone's deposit: mark it so it is never credited to a Ring balance.
    state().credited.push(await airdrop(escrow().publicKey, 5));
    save();
  }

  await makeLookupTable(payer, true);
}

/**
 * Makes the table of accounts every launch shares, paid for by `payer`, and records its address.
 * A launch with a first buy only fits in one transaction through it. On a network without the
 * stand-in Ring the escrow's accounts are left out.
 */
export async function makeLookupTable(payer: Keypair, withEscrow: boolean): Promise<string> {
  const chain = connection();
  // The accounts a launch touches, minus the two that differ every time.
  const sample = { wallet: Keypair.generate().publicKey, mint: Keypair.generate().publicKey };
  const plan = await launchInstructions({ ...sample, name: "sample", symbol: "SAMPLE", uri: "", firstBuyLamports: 1_000_000n });
  const instructions = [...plan.instructions, ...(withEscrow ? depositInstructions(sample.wallet, sample.mint.toBase58(), 1n) : [])];
  const unique = new Set(
    instructions.flatMap((instruction) => [instruction.programId, ...instruction.keys.map((key) => key.pubkey)]).map((key) => key.toBase58()),
  );
  unique.delete(sample.wallet.toBase58());
  unique.delete(sample.mint.toBase58());
  const shared = [...unique].map((key) => new PublicKey(key));

  const [create, table] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: await chain.getSlot("finalized"),
  });
  await sendAndConfirmTransaction(chain, new Transaction().add(create), [payer]);
  for (let start = 0; start < shared.length; start += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({
      lookupTable: table,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: shared.slice(start, start + 20),
    });
    await sendAndConfirmTransaction(chain, new Transaction().add(extend), [payer]);
  }
  // A lookup table can be used one slot after it was last extended.
  for (let attempt = 0; attempt < 40; attempt++) {
    const info = (await chain.getAddressLookupTable(table)).value;
    if (info && info.state.addresses.length === shared.length && (await chain.getSlot()) > info.state.lastExtendedSlot + 1) {
      state().lookupTable = table.toBase58();
      save();
      return table.toBase58();
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("the launch lookup table did not become usable in time");
}
