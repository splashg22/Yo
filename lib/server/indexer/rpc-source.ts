/** The chain, read through the RPC: confirmed blocks in order, and a subscription that hears of trades before their block is read. */
import { PublicKey, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { NEWEST_TRANSACTION_VERSION, rawCall } from "../solana";
import { AMM_PROGRAM, PUMP_PROGRAM, eventsInCalls, eventsInLogs } from "./decode";
import type { ChainBlock, ChainSource, ChainTx, EarlyTx } from "./types";

/**
 * A block as the RPC gives it, read as plain JSON. The library's own reader is not used for blocks: it refuses a
 * whole block that holds a version 1 transaction, and the Privacy Rings program sends those on devnet.
 */
export interface RawBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface RawTx {
  /** Its place in its block, where the block has been cut down to the transactions that matter (a recording). Absent: its place in the list. */
  index?: number;
  transaction: { signatures: string[]; message: { accountKeys: string[] } };
  meta: {
    err: unknown;
    loadedAddresses?: { writable?: string[]; readonly?: string[] };
    innerInstructions?: { instructions: { programIdIndex: number; data: string }[] }[] | null;
    logMessages?: string[] | null;
    preTokenBalances?: RawBalance[] | null;
    postTokenBalances?: RawBalance[] | null;
  } | null;
}
export interface RawBlock {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  blockTime: number | null;
  transactions: RawTx[];
}
const SKIPPED = /-32007|-32009|-32004|was skipped|not available|Block not available/i;

function txOf(entry: RawTx, index: number): ChainTx | null {
  const meta = entry.meta;
  if (!meta || meta.err) return null;
  const keys: string[] = [...entry.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const involved = keys.some((key) => key === PUMP_PROGRAM || key === AMM_PROGRAM);
  // Events: from the programs' calls to themselves, which a cut-short log cannot lose; from the log lines if there are none.
  let events = involved
    ? eventsInCalls(
        (meta.innerInstructions ?? []).flatMap((group) =>
          group.instructions.map((instruction) => ({ program: keys[instruction.programIdIndex] ?? "", data: Buffer.from(bs58.decode(instruction.data)) })),
        ),
      )
    : [];
  if (involved && events.length === 0) events = eventsInLogs(meta.logMessages ?? []);
  const after = new Map<string, { mint: string; owner: string; amount: bigint }>();
  for (const balance of meta.preTokenBalances ?? [])
    if (balance.owner) after.set(`${balance.accountIndex}`, { mint: balance.mint, owner: balance.owner, amount: 0n });
  for (const balance of meta.postTokenBalances ?? [])
    if (balance.owner) after.set(`${balance.accountIndex}`, { mint: balance.mint, owner: balance.owner, amount: BigInt(balance.uiTokenAmount.amount) });
  if (events.length === 0 && after.size === 0) return null;
  // One owner can hold a coin in more than one account; what matters is the owner's total across the accounts this transaction touched.
  const totals = new Map<string, { mint: string; owner: string; amount: bigint }>();
  for (const balance of after.values()) {
    const key = `${balance.mint}:${balance.owner}`;
    const total = totals.get(key);
    if (total) total.amount += balance.amount;
    else totals.set(key, { ...balance });
  }
  return { signature: entry.transaction.signatures[0]!, index, events, balances: [...totals.values()] };
}

/** A block as the indexer takes it, from a block as the RPC gives it. */
export function blockFromRaw(slot: number, found: RawBlock): ChainBlock {
  const txs: ChainTx[] = [];
  found.transactions.forEach((entry, index) => {
    const tx = txOf(entry, entry.index ?? index);
    if (tx) txs.push(tx);
  });
  return {
    slot,
    hash: found.blockhash,
    parentSlot: found.parentSlot,
    parentHash: found.previousBlockhash,
    time: found.blockTime ?? Math.floor(Date.now() / 1000),
    txs,
  };
}

/** pump.fun gives every coin an address ending in these four letters. Used only to decide what a recording keeps. */
const PUMP_MINT_ENDING = "pump";
/**
 * Cuts a block down to what the indexer reads: the transactions that went through and either called pump.fun or
 * its pool program or moved a pump.fun coin, each with only the fields `blockFromRaw` uses. A mainnet block is
 * several megabytes; cut down it is a few tens of kilobytes. For recordings (scripts/record-chain.ts).
 * What is lost: log lines, so an event whose inner call the RPC did not return cannot be recovered from them.
 */
export function trimRawBlock(found: RawBlock): RawBlock {
  const transactions: RawTx[] = [];
  found.transactions.forEach((entry, index) => {
    const meta = entry.meta;
    if (!meta || meta.err) return;
    const keys = [...entry.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
    const ours = (key: string | undefined): boolean => key === PUMP_PROGRAM || key === AMM_PROGRAM;
    const balances = (list: RawBalance[] | null | undefined): RawBalance[] =>
      (list ?? [])
        .filter((balance) => balance.mint.endsWith(PUMP_MINT_ENDING))
        .map((balance) => ({
          accountIndex: balance.accountIndex,
          mint: balance.mint,
          owner: balance.owner,
          uiTokenAmount: { amount: balance.uiTokenAmount.amount },
        }));
    const [before, after] = [balances(meta.preTokenBalances), balances(meta.postTokenBalances)];
    if (!keys.some(ours) && before.length + after.length === 0) return;
    transactions.push({
      index,
      // Only the two programs' own places in the key list are kept: that is all the reader looks up.
      transaction: { signatures: [entry.transaction.signatures[0]!], message: { accountKeys: keys.map((key) => (ours(key) ? key : "")) } },
      meta: {
        err: null,
        innerInstructions: (meta.innerInstructions ?? [])
          .map((group) => ({
            instructions: group.instructions
              .filter((call) => ours(keys[call.programIdIndex]))
              .map((call) => ({ programIdIndex: call.programIdIndex, data: call.data })),
          }))
          .filter((group) => group.instructions.length > 0),
        preTokenBalances: before,
        postTokenBalances: after,
      },
    });
  });
  return { blockhash: found.blockhash, previousBlockhash: found.previousBlockhash, parentSlot: found.parentSlot, blockTime: found.blockTime, transactions };
}

export class RpcSource implements ChainSource {
  constructor(private readonly connection: () => Connection) {}

  head(): Promise<number> {
    return this.connection().getSlot("confirmed");
  }
  slots(from: number, to: number): Promise<number[]> {
    return this.connection().getBlocks(from, to, "confirmed");
  }
  async block(slot: number): Promise<ChainBlock | null> {
    let found: RawBlock | null;
    try {
      found = await rawCall<RawBlock>(this.connection(), "getBlock", [
        slot,
        { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION, transactionDetails: "full", rewards: false },
      ]);
    } catch (error) {
      if (SKIPPED.test(String(error))) return null;
      throw error;
    }
    if (!found) return null;
    return blockFromRaw(slot, found);
  }
  watch(onSlot: () => void, onEarly: (tx: EarlyTx) => void): () => void {
    const chain = this.connection();
    const ids: Promise<number>[] = [];
    const slotId = chain.onSlotChange(() => onSlot());
    for (const program of [PUMP_PROGRAM, AMM_PROGRAM]) {
      const id = chain.onLogs(
        new PublicKey(program),
        (logs, context) => {
          if (logs.err) return;
          const events = eventsInLogs(logs.logs);
          if (events.length > 0) onEarly({ slot: context.slot, signature: logs.signature, events });
        },
        "confirmed",
      );
      ids.push(Promise.resolve(id));
    }
    return () => {
      void chain.removeSlotChangeListener(slotId).catch(() => undefined);
      for (const id of ids) void id.then((value) => chain.removeOnLogsListener(value)).catch(() => undefined);
    };
  }
}
