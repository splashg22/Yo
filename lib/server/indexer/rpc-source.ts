/** The chain, read through the RPC: confirmed blocks in order, and a subscription that hears of trades before their block is read. */
import { PublicKey, type CompiledInstruction, type Connection, type MessageCompiledInstruction, type VersionedBlockResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { AMM_PROGRAM, PUMP_PROGRAM, eventsInCalls, eventsInLogs } from "./decode";
import type { ChainBlock, ChainSource, ChainTx, EarlyTx } from "./types";

type BlockTx = VersionedBlockResponse["transactions"][number];
const SKIPPED = /-32007|-32009|-32004|was skipped|not available|Block not available/i;

function txOf(entry: BlockTx, index: number): ChainTx | null {
  const meta = entry.meta;
  if (!meta || meta.err) return null;
  const message = entry.transaction.message;
  const keys: PublicKey[] = [...message.staticAccountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const involved = keys.some((key) => {
    const text = key.toBase58();
    return text === PUMP_PROGRAM || text === AMM_PROGRAM;
  });
  // Events: from the programs' calls to themselves, which a cut-short log cannot lose; from the log lines if there are none.
  let events = involved
    ? eventsInCalls(
        (meta.innerInstructions ?? []).flatMap((group) =>
          group.instructions.map((instruction: CompiledInstruction | MessageCompiledInstruction) => ({
            program: keys[instruction.programIdIndex]?.toBase58() ?? "",
            data: "accounts" in instruction ? Buffer.from(bs58.decode(instruction.data)) : Buffer.from(instruction.data),
          })),
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

export class RpcSource implements ChainSource {
  constructor(private readonly connection: () => Connection) {}

  head(): Promise<number> {
    return this.connection().getSlot("confirmed");
  }
  slots(from: number, to: number): Promise<number[]> {
    return this.connection().getBlocks(from, to, "confirmed");
  }
  async block(slot: number): Promise<ChainBlock | null> {
    let found: VersionedBlockResponse | null;
    try {
      found = await this.connection().getBlock(slot, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      });
    } catch (error) {
      if (SKIPPED.test(String(error))) return null;
      throw error;
    }
    if (!found) return null;
    const txs: ChainTx[] = [];
    found.transactions.forEach((entry, index) => {
      const tx = txOf(entry, index);
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
