/** The Ring wallet: deposit, transfer, withdraw. Reading or moving a Ring balance takes a wallet-signed request. */
import { verifyRequest, type Signed } from "../../auth";
import { payFromEscrow } from "../escrow";
import { ring } from "../ring";
import { reconcile, settle } from "../settle";
import { save, state } from "../store";
import { buildDeposit } from "../transactions";
import { addressOf, amountOf, noteKeyOf, sealedNoteOf, signatureOf, type Input } from "../validate";
import type { Handlers } from "./types";

/** Checks the wallet's signature and remembers the request so it cannot be replayed, even across a restart. */
export function signedBody(op: string, input: Input): Input & { wallet: string } {
  const body = verifyRequest<Input>(op, input as unknown as Signed<Input>, state().nonces);
  save();
  return body;
}

export const ringOperations: Handlers<
  "ring/deposit/build" | "ring/credit" | "ring/reconcile" | "ring/public" | "ring/register" | "ring/note-key" | "ring/transfer" | "ring/withdraw" | "ring/mine"
> = {
  "ring/deposit/build": (input) =>
    buildDeposit({ wallet: addressOf(input.wallet, "wallet address"), mint: addressOf(input.mint, "coin address"), amount: amountOf(input.amount, "amount") }),

  "ring/credit": (input) => settle(signatureOf(input.signature)),

  "ring/reconcile": () => reconcile(),

  "ring/public": (input) => ({ events: ring.publicView(input.wallet === undefined ? undefined : addressOf(input.wallet, "wallet address")) }),

  "ring/register": (input) => {
    const body = signedBody("ring/register", input);
    return { newlyRegistered: ring.register(body.wallet, body.noteKey === undefined ? undefined : noteKeyOf(body.noteKey)) !== null };
  },

  "ring/note-key": (input) => ({ key: ring.noteKey(addressOf(input.wallet, "wallet address")) }),

  "ring/transfer": (input) => {
    const body = signedBody("ring/transfer", input);
    // A readable note is refused outright, so no client can hand this server one by mistake.
    if (body.memo !== undefined) throw new Error("a note must be sealed in the browser before it is sent");
    const note = body.note === undefined ? undefined : sealedNoteOf(body.note);
    return {
      event: ring.transfer(body.wallet, addressOf(body.to, "recipient's address"), addressOf(body.mint, "coin address"), amountOf(body.amount, "amount"), note),
    };
  },

  "ring/withdraw": async (input) => {
    const body = signedBody("ring/withdraw", input);
    const mint = addressOf(body.mint, "coin address");
    const amount = amountOf(body.amount, "amount");
    const destination = body.destination === undefined || body.destination === "" ? body.wallet : addressOf(body.destination, "destination address");
    const event = ring.debitForWithdrawal(body.wallet, mint, amount, destination);
    const outcome = await payFromEscrow(destination, mint, amount);
    if (outcome.status === "landed") {
      ring.completeWithdrawal(event.id, outcome.signature);
      return { event, signature: outcome.signature, pending: false };
    }
    if (outcome.status === "not-sent") {
      ring.undoWithdrawal(event.id);
      throw new Error(`nothing left your Ring balance: ${outcome.reason}`);
    }
    // Sent, but the chain cannot confirm it right now. The coins stay out of the balance until it can.
    state().pendingPayouts.push({ eventId: event.id, signature: outcome.signature, lastValidBlockHeight: outcome.lastValidBlockHeight });
    save();
    return { event, signature: outcome.signature, pending: true };
  },

  "ring/mine": (input) => {
    const { wallet } = signedBody("ring/mine", input);
    return { registered: ring.isRegistered(wallet), balances: ring.balances(wallet), history: ring.history(wallet) };
  },
};
