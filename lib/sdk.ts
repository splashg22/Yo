/**
 * A small client for everything the site can do, usable from a script or a test.
 * It holds a wallet key, asks the server to build transactions, signs them itself and
 * hands them back to be submitted. The server never sees the key.
 */
import { toBase64 } from "./bytes";
import { checkNoteText, noteKeysFor, openNote, sealNote, type NoteKeys, type SealedNote } from "./notes";
import { signRequest } from "./auth";
import type { Api, Offer, OpenOpName, RingEvent, Settlement, SignedOpName, WindowView } from "./contract";
import { newActor, signMessage, type Actor } from "./keys";
import { signTransaction } from "./sign";

/** How a request reaches the server. Over HTTP in a script; called directly in tests. */
export type Transport = <Name extends keyof Api>(name: Name, input?: object) => Promise<Api[Name]["output"]>;

export function httpTransport(baseUrl: string): Transport {
  return async (name, input = {}) => {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `the server answered ${response.status}`;
      throw new Error(message);
    }
    return body as never;
  };
}

export interface Launch {
  mint: string;
  signature: string;
  /** Coins the first buy delivered, in base units. */
  firstBuyTokens: bigint;
}

export class RingClient {
  constructor(
    private readonly transport: Transport,
    readonly wallet: Actor,
  ) {}

  get address(): string {
    return this.wallet.address;
  }
  private open<Name extends OpenOpName>(name: Name, input: Api[Name]["input"]): Promise<Api[Name]["output"]> {
    return this.transport(name, input);
  }
  private async signed<Name extends SignedOpName>(name: Name, input: Api[Name]["input"]): Promise<Api[Name]["output"]> {
    return this.transport(name, await signRequest(name, this.wallet.address, input, (message) => signMessage(this.wallet, message)));
  }
  /** Signs a built transaction and has the server submit and settle it. */
  private send(transaction: string, extraSeeds: Uint8Array[] = []): Promise<{ signature: string } & Settlement> {
    return this.open("tx/send", { transaction: signTransaction(transaction, [this.wallet.seed, ...extraSeeds]) });
  }

  /** Creates a coin on the curve and registers it with the Ring, in one transaction. */
  async launch(coin: { name: string; symbol: string; firstBuyLamports?: bigint; toRing?: boolean; description?: string; picture?: string }): Promise<Launch> {
    const mint = newActor(); // the coin's own key: it signs this one transaction and is then discarded
    const built = await this.open("launch/build", {
      wallet: this.address,
      mint: mint.address,
      name: coin.name,
      symbol: coin.symbol,
      firstBuyLamports: coin.firstBuyLamports?.toString(),
      toRing: coin.toRing,
      description: coin.description,
      picture: coin.picture,
    });
    const sent = await this.send(built.transaction, [mint.seed]);
    return { mint: mint.address, signature: sent.signature, firstBuyTokens: BigInt(built.firstBuyTokens) };
  }
  /** Sealed launch window (only when the feature is switched on). Opens a window that others can commit SOL to. */
  async openWindow(details: { name: string; symbol: string; description?: string; hours: number }): Promise<WindowView> {
    return (await this.signed("window/open", details)).window;
  }
  async commitToWindow(id: string, lamports: bigint): Promise<WindowView> {
    return (await this.signed("window/commit", { id, lamports: lamports.toString() })).window;
  }
  async uncommitFromWindow(id: string): Promise<WindowView> {
    return (await this.signed("window/uncommit", { id })).window;
  }
  async cancelWindow(id: string): Promise<WindowView> {
    return (await this.signed("window/cancel", { id })).window;
  }
  /** Launches a closed window: the coin is created and bought with everything committed, in one transaction. */
  async launchWindow(id: string, picture?: string): Promise<{ mint: string; signature: string }> {
    const mint = newActor();
    const built = await this.signed("window/launch/build", { id, mint: mint.address, picture });
    const sent = await this.send(built.transaction, [mint.seed]);
    return { mint: mint.address, signature: sent.signature };
  }
  /** A public trade on the curve. `amount` is lamports for a buy and coin base units for a sell. */
  async trade(mint: string, side: "buy" | "sell", amount: bigint): Promise<{ signature: string; expected: bigint }> {
    const built = await this.open("trade/build", { wallet: this.address, mint, side, amount: amount.toString() });
    return { signature: (await this.send(built.transaction)).signature, expected: BigInt(built.expected) };
  }
  async claimFees(toRing = true): Promise<{ signature: string; claimed: bigint }> {
    const built = await this.open("fees/build", { wallet: this.address, toRing });
    return { signature: (await this.send(built.transaction)).signature, claimed: BigInt(built.claimable) };
  }

  private keys?: Promise<NoteKeys>;
  /** This wallet's key pair for sealing and opening notes, derived from its seed. */
  noteKeys(): Promise<NoteKeys> {
    return (this.keys ??= noteKeysFor(this.wallet.seed));
  }
  /** Publishes the wallet's Ring registration and its public note key. */
  async register(): Promise<{ newlyRegistered: boolean }> {
    return this.signed("ring/register", { noteKey: toBase64((await this.noteKeys()).publicKey) });
  }
  /** Public to Ring balance. The deposit is public, with its amount. */
  async deposit(mint: string, amount: bigint): Promise<{ signature: string } & Settlement> {
    const built = await this.open("ring/deposit/build", { wallet: this.address, mint, amount: amount.toString() });
    return this.send(built.transaction);
  }
  /**
   * Ring balance to Ring balance. Both wallets are public; the coin and amount are not published.
   * A note is sealed here, to the recipient's published key, before it is sent: the server cannot read it.
   */
  async transfer(to: string, mint: string, amount: bigint, note?: string): Promise<RingEvent> {
    let sealed: SealedNote | undefined;
    if (note !== undefined && note.trim() !== "") {
      checkNoteText(note);
      const { key } = await this.open("ring/note-key", { wallet: to });
      if (!key) throw new Error("the recipient has not published a note key yet, so a note cannot be sealed to them. Send without a note.");
      sealed = await sealNote(note, key, await this.noteKeys());
    }
    return (await this.signed("ring/transfer", { to, mint, amount: amount.toString(), note: sealed })).event;
  }
  /** The note on a transfer this wallet sent or received, or null if there is none or it cannot be opened. */
  async readNote(event: RingEvent): Promise<string | null> {
    const sealed = event.public.from === this.address ? event.sealed.noteForSender : event.sealed.noteForRecipient;
    return sealed === undefined ? null : openNote(sealed, await this.noteKeys());
  }
  withdraw(mint: string, amount: bigint, destination?: string): Promise<Api["ring/withdraw"]["output"]> {
    return this.signed("ring/withdraw", { mint, amount: amount.toString(), destination });
  }
  async ringBalance(mint: string): Promise<bigint> {
    return BigInt((await this.signed("ring/mine", {})).balances[mint] ?? "0");
  }
  ringHistory = async (): Promise<RingEvent[]> => (await this.signed("ring/mine", {})).history;
  async publicBalance(mint: string): Promise<bigint> {
    return BigInt((await this.open("wallet/public", { wallet: this.address })).balances[mint] ?? "0");
  }

  async offer(terms: { buyer: string; mint: string; amount: bigint; priceLamports: bigint; hours?: number }): Promise<Offer> {
    return (
      await this.signed("otc/offer", {
        buyer: terms.buyer,
        mint: terms.mint,
        amount: terms.amount.toString(),
        priceLamports: terms.priceLamports.toString(),
        hours: terms.hours,
      })
    ).offer;
  }
  offers = async (): Promise<Offer[]> => (await this.signed("otc/mine", {})).offers;
  acceptOffer = (id: string): Promise<Api["otc/accept"]["output"]> => this.signed("otc/accept", { id });
  cancelOffer = (id: string): Promise<Api["otc/cancel"]["output"]> => this.signed("otc/cancel", { id });
}
