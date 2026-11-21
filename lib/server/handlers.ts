/**
 * Every server operation, as plain functions keyed by name, so tests call them without
 * HTTP and the HTTP route is a thin wrapper.
 */
import type { Api, OpName } from "../contract";
import { market } from "./operations/market";
import { otc } from "./operations/otc";
import { ringOperations } from "./operations/ring";
import { system } from "./operations/system";
import { explain } from "./solana";
import { durable, ready } from "./store";
import type { Input } from "./validate";

type Registry = { [Name in OpName]: (input: Input) => Api[Name]["output"] | Promise<Api[Name]["output"]> };
const operations: Registry = { ...system, ...market, ...ringOperations, ...otc };

export const isOperation = (name: string): name is OpName => Object.hasOwn(operations, name);

/** Runs one operation. Any failure comes back as an Error whose message is one plain sentence. */
export async function run<Name extends OpName>(name: Name, input: Input = {}): Promise<Api[Name]["output"]> {
  try {
    await ready();
    const output = await operations[name](input);
    // No answer is given until what the operation changed is safely stored.
    await durable();
    return output;
  } catch (error) {
    // A refused operation may still have changed something before it was refused (and undone it); that is stored too.
    await durable().catch((failure: unknown) => console.error(`[${name}] store`, failure));
    // The caller gets one plain sentence; the operator's log keeps the cause. Inputs are not logged: they can hold signed requests.
    console.error(`[${name}]`, error);
    throw new Error(explain(error));
  }
}
