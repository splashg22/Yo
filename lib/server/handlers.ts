/**
 * Every server operation, as plain functions keyed by name, so tests call them without
 * HTTP and the HTTP route is a thin wrapper.
 */
import type { Api, OpName, Settlement } from "../contract";
import { marketOperations } from "./operations/market";
import { otc } from "./operations/otc";
import { ringOperations } from "./operations/ring";
import { system } from "./operations/system";
import { windowOperations } from "./operations/window";
import { READ_ONLY_REFUSAL, settings } from "./env";
import { failure, log } from "./log";
import { market } from "./market";
import { onConfirmed } from "./sender";
import { settle } from "./settle";
import { explain } from "./solana";
import { durable, ready } from "./store";
import type { Input } from "./validate";

type Registry = { [Name in OpName]: (input: Input) => Api[Name]["output"] | Promise<Api[Name]["output"]> };
const operations: Registry = { ...system, ...marketOperations, ...ringOperations, ...otc, ...windowOperations };

export const isOperation = (name: string): name is OpName => Object.hasOwn(operations, name);
/**
 * What may be asked on mainnet: reads of public facts, and nothing that builds, signs, sends, moves or records money.
 * A list of what is allowed, not of what is forbidden, so a new operation is refused there until someone decides otherwise.
 */
export const READS_ALLOWED_ON_MAINNET: ReadonlySet<OpName> = new Set<OpName>([
  "config",
  "status",
  "price/sol",
  "stats",
  "explore",
  "trending",
  "coin",
  "coin/trades",
  "coin/candles",
  "coin/holders",
  "search",
  "coin/traders",
  "coin/checks",
  "position",
  "portfolio",
  "address/seen",
  "wallet/activity",
  "wallet/public",
]);
/** Every operation this server answers, by name. */
export const operationNames = (): OpName[] => Object.keys(operations) as OpName[];

/**
 * Starts what has to be running behind every operation, once per database: the indexer, and what happens
 * when a transaction this server sent is confirmed.
 */
async function engine(): Promise<void> {
  if (process.env.APP_STORE === "memory") return;
  const service = await market();
  onConfirmed(async (signature, slot) => {
    // The chain can say "confirmed" a moment before it will hand the transaction over; that is not a failure.
    let settlement = await settle(signature).catch((error: unknown) => error);
    for (let attempt = 0; settlement instanceof Error && /not confirmed|is not on the chain/.test(settlement.message) && attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      settlement = await settle(signature).catch((error: unknown) => error);
    }
    if (settlement instanceof Error || !settlement || typeof settlement !== "object" || !("credited" in settlement)) throw settlement;
    // The answer is held until the indexer has applied that block, so whoever sent a trade then reads it back.
    await service.indexer.reached(slot);
    await durable();
    return settlement as Settlement;
  });
}

/** Runs a piece of work the way an operation is run: on a ready store, answering only once what it changed is safely stored. */
export async function within<Output>(label: string, work: () => Output | Promise<Output>): Promise<Output> {
  try {
    await ready();
    await engine();
    const output = await work();
    // No answer is given until what the operation changed is safely stored.
    await durable();
    return output;
  } catch (error) {
    // A refused operation may still have changed something before it was refused (and undone it); that is stored too.
    await durable().catch((problem: unknown) => log("error", "store", { operation: label, ...failure(problem) }));
    // The caller gets one plain sentence; the operator's log keeps the cause. Inputs are not logged: they can hold signed requests.
    log("warn", "operation refused", { operation: label, ...failure(error) });
    throw new Error(explain(error));
  }
}

/** Runs one operation. Any failure comes back as an Error whose message is one plain sentence. */
export const run = <Name extends OpName>(name: Name, input: Input = {}): Promise<Api[Name]["output"]> =>
  within(name, () => {
    // On mainnet this server reads and does nothing else. Only the operations named as reads are answered; anything
    // else, and anything added later and not put on that list, is refused here, before it starts.
    if (settings().readOnly && !READS_ALLOWED_ON_MAINNET.has(name)) return Promise.reject(new Error(READ_ONLY_REFUSAL));
    return operations[name](input);
  });
