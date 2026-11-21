import type { Api } from "../../contract";
import type { Input } from "../validate";

/** A set of operations. Each takes the raw request and answers at once or after waiting on the chain. */
export type Handlers<Names extends keyof Api> = { [Name in Names]: (input: Input) => Api[Name]["output"] | Promise<Api[Name]["output"]> };
