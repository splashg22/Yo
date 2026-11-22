/**
 * The real Privacy Rings program, from the browser. This runs inside the vault worker, beside the wallet key,
 * so the key and the Ring keys made from it never reach the page.
 *
 * Everything the Ring does for a balance happens here, with the Ring's own SDK:
 * - reading a balance and its history: the SDK asks the Ring's indexer for encrypted records and opens the
 *   ones this wallet's keys can open. Nobody else, including this site's server, can read them;
 * - registering, depositing, transferring, withdrawing: the SDK builds the transaction. For a transfer or a
 *   withdrawal it has the proof made by Helius's prover, to which it sends its request encrypted after
 *   checking the prover's enclave attestation. This worker signs the transaction and sends it.
 *
 * The SDK reaches Helius through this site's own server (lib/server/ringgate.ts), which adds the API key.
 *
 * STATUS, 22 November 2026: reaching the services, attestation, reading a registry record and syncing an
 * empty wallet are proven on devnet (RING-RESULTS.md). Registering, depositing, transferring and
 * withdrawing are written against the SDK's documented interface and have NOT been run: they need devnet
 * SOL, which could not be had. Until RING-RESULTS.md says otherwise, treat them as unverified.
 */
import {
  LocalKeys,
  SOL_MINT,
  SPL_TOKEN_2022_PROGRAM_ID,
  ShieldedKeypair,
  SigningKey,
  Wallet,
  buildDepositTransaction,
  buildRegistrationTransaction,
  buildTransferTransaction,
  buildWithdrawalTransaction,
  createSprClient,
  getPrivateTokenBalances,
  getPrivateTransactions,
  loadPersistedWallet,
  syncPersistedWallet,
  walletSnapshotCipher,
  type Bytes32,
  type WalletStateStore,
} from "@heliuslabs/spr";
import { SignedTeePolicy } from "@heliuslabs/spr/client";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionWithSigners,
  type Address,
  type Transaction,
} from "@solana/kit";
import { NATIVE } from "../constants";

/** What a step is doing, so the page can say so while a proof is made. */
export type RingStage =
  "reading your Ring balance" | "asking the prover for a proof" | "signing" | "sending" | "waiting for the chain" | "reading the new balance";
export interface RingRow {
  id: string;
  signature: string;
  slot: number;
  kind: "deposit" | "transfer" | "withdraw" | "other";
  direction: "in" | "out" | "self";
  mint: string;
  amount: string;
}
export interface RingState {
  registered: boolean;
  balances: Record<string, string>;
  history: RingRow[];
}

type Session = Awaited<ReturnType<typeof open>>;
let session: { address: string; opened: Promise<Session> } | undefined;

/** One small IndexedDB store for the wallet's synced state. What is kept there is sealed with a key made from the wallet's own keys. */
function snapshotStore(address: string): WalletStateStore {
  const request = <Result>(run: (store: IDBObjectStore) => IDBRequest<Result>, mode: IDBTransactionMode): Promise<Result> =>
    new Promise((resolve, reject) => {
      const opening = indexedDB.open("ring-wallet-state", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("snapshots");
      opening.onerror = () => reject(new Error("this browser would not open the Ring wallet's store"));
      opening.onsuccess = () => {
        const asked = run(opening.result.transaction("snapshots", mode).objectStore("snapshots"));
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => reject(new Error("the Ring wallet's store did not answer"));
      };
    });
  return {
    load: async () => (await request((store) => store.get(address) as IDBRequest<string | undefined>, "readonly")) ?? undefined,
    save: async (snapshot) => {
      await request((store) => store.put(snapshot, address), "readwrite");
    },
  };
}

async function open(seed: Uint8Array, origin: string) {
  const bytes = (): Bytes32 => Uint8Array.from(seed) as Bytes32;
  const client = await createSprClient({
    solanaRpcUrl: `${origin}/ring/rpc`,
    indexerUrl: `${origin}/ring/v1/spr`,
    proverUrl: `${origin}/ring/v1/spr`,
    // The SDK checks the prover's enclave against this signed policy before it sends the prover anything.
    proverTee: SignedTeePolicy.forNetwork("devnet"),
  });
  const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes());
  const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(bytes()));
  const store = snapshotStore(signer.address);
  const cipher = walletSnapshotCipher(keypair);
  // A reload resumes from the sealed snapshot instead of scanning the wallet's whole history again.
  const wallet = (await loadPersistedWallet({ store, cipher }).catch(() => undefined)) ?? new Wallet({ identity: keypair.shieldedAddress() });
  const keys = LocalKeys.fromKeypair(keypair, client.proofService);
  return { client, signer, keypair, wallet, keys, store, cipher };
}
function sessionFor(seed: Uint8Array, address: string, origin: string): Promise<Session> {
  if (session?.address !== address) {
    const opened = open(seed, origin);
    const mine = { address, opened };
    session = mine;
    opened.catch(() => {
      if (session === mine) session = undefined;
    });
  }
  return session.opened;
}
/** Forgets the open Ring session: called when the vault locks. */
export function closeRing(): void {
  session = undefined;
}

const mintOf = (asset: string): string => (asset === (SOL_MINT as string) ? NATIVE : asset);
const assetOf = (mint: string): Address => (mint === NATIVE ? SOL_MINT : (mint as Address));
const explain = (error: unknown): Error => {
  const code = (error as { code?: unknown } | null)?.code;
  const known: Record<string, string> = {
    WALLET_RECIPIENT_NOT_REGISTERED: "that wallet has not registered with the Ring, so nothing can be sent to its Ring balance",
    WALLET_TOO_MANY_INPUTS: "your Ring balance is in too many small pieces to send in one go. Tidy it up first.",
    WALLET_INSUFFICIENT_BALANCE: "the Ring balance is too low",
    CLIENT_PROVER_TEE_ATTESTATION: "the prover could not be verified, so nothing was sent to it. Try again in a moment.",
    CLIENT_INDEXER: "the Ring's indexer is not answering. Nothing was sent. Try again in a moment.",
  };
  if (typeof code === "string" && known[code]) return new Error(known[code]);
  return error instanceof Error ? error : new Error(String(error));
};

async function sync(current: Session, slot?: bigint): Promise<void> {
  await syncPersistedWallet({
    client: current.client,
    wallet: current.wallet,
    keys: current.keys,
    store: current.store,
    cipher: current.cipher,
    ...(slot === undefined ? {} : { config: { requireSlot: slot } }),
  });
}
async function stateOf(current: Session): Promise<RingState> {
  const records = await current.client.getUserRecords([current.signer.address]);
  const balances: Record<string, string> = {};
  for (const balance of getPrivateTokenBalances(current.wallet)) if (balance.amount > 0n) balances[mintOf(balance.mint)] = balance.amount.toString();
  const history: RingRow[] = getPrivateTransactions(current.wallet).map((row) => ({
    id: `${row.id.signature}:${row.id.index}`,
    signature: row.id.signature,
    slot: Number(row.id.slot),
    kind: row.kind === "deposit" ? "deposit" : row.kind === "privateTransfer" ? "transfer" : row.kind === "publicWithdrawal" ? "withdraw" : "other",
    direction: row.direction === "inbound" ? "in" : row.direction === "outbound" ? "out" : "self",
    mint: mintOf(row.asset),
    amount: row.amount.toString(),
  }));
  return { registered: (records as unknown as { records: unknown[] }).records[0] !== null, balances, history: history.reverse() };
}
/** Signs, sends, waits for the chain and for the indexer to have it, then reads the wallet again. */
async function submit(current: Session, transaction: Transaction, say: (stage: RingStage) => void): Promise<string> {
  say("signing");
  const signed = await signTransactionWithSigners([current.signer], transaction);
  const signature = getSignatureFromTransaction(signed);
  say("sending");
  await current.client.solanaRpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  say("waiting for the chain");
  const slot = await current.client.confirmTransaction(signature);
  say("reading the new balance");
  await sync(current, slot);
  return signature;
}

export type RingRequest =
  | { op: "ring:state" }
  | { op: "ring:register" }
  | { op: "ring:deposit"; mint: string; amount: string }
  | { op: "ring:transfer"; to: string; mint: string; amount: string }
  | { op: "ring:withdraw"; mint: string; amount: string; destination: string };

/** Carries out one Ring request for the unlocked wallet. `say` reports each stage as it starts. */
export async function ringRequest(
  seed: Uint8Array,
  address: string,
  origin: string,
  request: RingRequest,
  say: (stage: RingStage) => void,
): Promise<RingState & { signature?: string }> {
  try {
    const current = await sessionFor(seed, address, origin);
    say("reading your Ring balance");
    await sync(current);
    let signature: string | undefined;
    if (request.op === "ring:register") {
      const built = await buildRegistrationTransaction({ client: current.client, owner: current.signer.address, address: current.keypair.shieldedAddress() });
      // Undefined: this wallet is already registered with these keys, and there is nothing to send.
      if (built !== undefined) signature = await submit(current, built, say);
    } else if (request.op === "ring:deposit") {
      const built = await buildDepositTransaction({
        client: current.client,
        feePayer: current.signer.address,
        depositor: current.signer.address,
        recipient: current.keypair.shieldedAddress(),
        amount: BigInt(request.amount),
        // A pump.fun coin is a Token-2022 coin; the SDK finds the depositor's own account for it.
        ...(request.mint === NATIVE ? {} : { asset: assetOf(request.mint), splTokenProgram: SPL_TOKEN_2022_PROGRAM_ID }),
      });
      signature = await submit(current, built, say);
    } else if (request.op === "ring:transfer") {
      say("asking the prover for a proof");
      const built = await buildTransferTransaction({
        client: current.client,
        wallet: current.wallet,
        keys: current.keys,
        feePayer: current.signer.address,
        recipient: request.to as Address,
        amount: BigInt(request.amount),
        ...(request.mint === NATIVE ? {} : { asset: assetOf(request.mint) }),
      });
      signature = await submit(current, built, say);
    } else if (request.op === "ring:withdraw") {
      say("asking the prover for a proof");
      const built = await buildWithdrawalTransaction({
        client: current.client,
        wallet: current.wallet,
        keys: current.keys,
        feePayer: current.signer.address,
        recipient: request.destination as Address,
        amount: BigInt(request.amount),
        ...(request.mint === NATIVE ? {} : { asset: assetOf(request.mint), splTokenProgram: SPL_TOKEN_2022_PROGRAM_ID }),
      });
      signature = await submit(current, built, say);
    }
    return { ...(await stateOf(current)), ...(signature ? { signature } : {}) };
  } catch (error) {
    throw explain(error);
  }
}
