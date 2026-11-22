/**
 * Transactions from Helius's enhanced websocket (`transactionSubscribe`), as a TxStream.
 *
 * STATUS, 22 November 2026: WRITTEN, NEVER RUN AGAINST HELIUS. It is written from Helius's documentation of the
 * method (helius.dev/docs/enhanced-websockets/transaction-subscribe). The subscription needs the Developer plan,
 * which has not been bought, and the machine this was built on cannot open outbound websockets at all. What is
 * tested is the part that needs no socket: turning a notification into a transaction (test/unit/helius-stream.test.ts).
 * The first thing to do with a paid key is run it and compare what it stores with a recording of the same slots.
 *
 * READ ONLY. It subscribes and it reads. It has no method that sends a transaction, and is given no key but the
 * RPC's own API key.
 *
 * What it asks for is decided by the accounts it is given:
 *   - always: accounts named by every transaction of a kind that must never be missed (a new coin being made),
 *     or the two programs themselves for a full stream;
 *   - followed: one account per coin being followed trade by trade (its bonding curve or its pool).
 */
import type { Connection } from "@solana/web3.js";
import { WebSocket } from "ws";
import { NEWEST_TRANSACTION_VERSION, rawCall } from "../solana";
import type { RawBalance, RawTx } from "./rpc-source";
import type { StreamHandlers, StreamTx, TxStream } from "./stream-source";

/** pump.fun's mint authority: named by every transaction that makes a coin, and by no trade. From the program's own interface description. */
export const PUMP_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const PING_EVERY_MS = 30_000;
const RETRY_FIRST_MS = 1_000;
const RETRY_MOST_MS = 30_000;
/** The most signatures read back for one account after a drop, and the most accounts read back for. */
const BACKFILL_PER_ACCOUNT = 1_000;
const BACKFILL_ACCOUNTS = 200;

interface ParsedKey {
  pubkey: string;
}
interface Notification {
  slot: number;
  signature: string;
  transaction: {
    transaction: { signatures?: string[]; message: { accountKeys: (string | ParsedKey)[] } };
    meta: {
      err: unknown;
      loadedAddresses?: { writable?: string[]; readonly?: string[] };
      innerInstructions?: { instructions: { programIdIndex?: number; programId?: string; data?: string }[] }[] | null;
      logMessages?: string[] | null;
      preTokenBalances?: RawBalance[] | null;
      postTokenBalances?: RawBalance[] | null;
    } | null;
  };
}
/**
 * A notification as the reader of blocks expects a transaction. With "jsonParsed" encoding the account keys are
 * objects and already include the addresses loaded from lookup tables, and an inner call names its program by
 * address instead of by its place in the key list; both are put back the way a block has them.
 */
export function rawFromNotification(result: Notification): StreamTx | null {
  const meta = result.transaction.meta;
  if (!meta || meta.err) return null;
  const keys = result.transaction.transaction.message.accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey));
  const parsed = result.transaction.transaction.message.accountKeys.some((key) => typeof key !== "string");
  const place = new Map(keys.map((key, index) => [key, index]));
  const raw: RawTx = {
    transaction: { signatures: [result.signature], message: { accountKeys: keys } },
    meta: {
      err: null,
      // Parsed keys already hold the loaded addresses; adding them again would shift nothing but would repeat them.
      ...(parsed ? {} : { loadedAddresses: meta.loadedAddresses }),
      innerInstructions: (meta.innerInstructions ?? []).map((group) => ({
        instructions: group.instructions
          .filter((call) => typeof call.data === "string")
          .map((call) => ({ programIdIndex: call.programIdIndex ?? place.get(call.programId ?? "") ?? -1, data: call.data! })),
      })),
      logMessages: meta.logMessages ?? null,
      preTokenBalances: meta.preTokenBalances ?? null,
      postTokenBalances: meta.postTokenBalances ?? null,
    },
  };
  return { slot: result.slot, raw };
}

export class HeliusTxStream implements TxStream {
  private socket: WebSocket | undefined;
  private handlers: StreamHandlers | undefined;
  private followed: string[] = [];
  private subscription: number | undefined;
  private nextId = 1;
  private readonly waiting = new Map<number, "tx" | "slot" | "other">();
  private retryMs = RETRY_FIRST_MS;
  private closed = false;
  private pinging: ReturnType<typeof setInterval> | undefined;
  /** The newest signature seen for each account asked for, so a backfill knows where to stop. */
  private readonly lastSeen = new Map<string, string>();

  constructor(
    private readonly options: {
      /** wss://mainnet.helius-rpc.com/?api-key=... */
      socketUrl: string;
      /** For reading back what was missed: getSignaturesForAddress and getTransaction only. */
      rpc: () => Connection;
      /** Accounts whose transactions are always wanted. */
      always: string[];
    },
  ) {}

  open(handlers: StreamHandlers): void {
    this.handlers = handlers;
    this.connect();
  }
  private accounts(): string[] {
    return [...new Set([...this.options.always, ...this.followed])];
  }
  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(this.options.socketUrl);
    this.socket = socket;
    socket.on("open", () => {
      this.retryMs = RETRY_FIRST_MS;
      this.subscribe();
      this.say("slotSubscribe", [], "slot");
      this.pinging = setInterval(() => socket.readyState === WebSocket.OPEN && socket.ping(), PING_EVERY_MS);
      this.handlers?.up();
    });
    socket.on("message", (data: Buffer) => this.heard(data));
    const lost = (reason: string): void => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.subscription = undefined;
      clearInterval(this.pinging);
      this.handlers?.down(reason);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(RETRY_MOST_MS, this.retryMs * 2);
    };
    socket.on("close", () => lost("the connection closed"));
    socket.on("error", (error: Error) => {
      lost(`the connection failed: ${error.message}`);
      socket.terminate();
    });
  }
  private say(method: string, params: unknown[], kind: "tx" | "slot" | "other"): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const id = this.nextId++;
    this.waiting.set(id, kind);
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  }
  private subscribe(): void {
    if (this.subscription !== undefined) this.say("transactionUnsubscribe", [this.subscription], "other");
    this.subscription = undefined;
    this.say(
      "transactionSubscribe",
      [
        { accountInclude: this.accounts(), failed: false, vote: false },
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          showRewards: false,
          maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION,
        },
      ],
      "tx",
    );
  }
  private heard(data: Buffer): void {
    let message: { id?: number; result?: unknown; method?: string; params?: { result?: unknown } };
    try {
      message = JSON.parse(data.toString("utf8")) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      if (this.waiting.get(message.id) === "tx" && typeof message.result === "number") this.subscription = message.result;
      this.waiting.delete(message.id);
      return;
    }
    if (message.method === "slotNotification") {
      const slot = (message.params?.result as { slot?: number } | undefined)?.slot;
      if (typeof slot === "number") this.handlers?.slot(slot);
    } else if (message.method === "transactionNotification") {
      const result = message.params?.result as Notification | undefined;
      const tx = result ? rawFromNotification(result) : null;
      if (!tx) return;
      this.note(tx);
      this.handlers?.tx(tx);
    }
  }
  /** Remembers, for each account asked for, the newest transaction seen that names it. */
  private note(tx: StreamTx): void {
    const signature = tx.raw.transaction.signatures[0]!;
    const wanted = new Set(this.accounts());
    for (const key of tx.raw.transaction.message.accountKeys) if (wanted.has(key)) this.lastSeen.set(key, signature);
  }

  follow(accounts: string[]): void {
    const next = [...new Set(accounts)].sort();
    if (next.join() === [...this.followed].sort().join()) return;
    this.followed = next;
    this.subscribe();
  }

  async catchUp(): Promise<{ txs: StreamTx[]; complete: boolean }> {
    const rpc = this.options.rpc();
    // The accounts that are always wanted first; then the followed coins seen most recently.
    const accounts = [...this.options.always, ...[...this.lastSeen.keys()].filter((account) => !this.options.always.includes(account)).reverse()];
    let complete = accounts.length <= BACKFILL_ACCOUNTS;
    const found = new Map<string, number>();
    for (const account of accounts.slice(0, BACKFILL_ACCOUNTS)) {
      const until = this.lastSeen.get(account);
      // Nothing was ever seen for it: there is no point to read back to, and the present is where it starts.
      if (!until) continue;
      const list = await rawCall<{ signature: string; slot: number; err: unknown }[]>(rpc, "getSignaturesForAddress", [
        account,
        { until, limit: BACKFILL_PER_ACCOUNT, commitment: "confirmed" },
      ]);
      if ((list?.length ?? 0) >= BACKFILL_PER_ACCOUNT) complete = false;
      for (const entry of list ?? []) if (!entry.err) found.set(entry.signature, entry.slot);
    }
    const oldestFirst = [...found].sort((a, b) => a[1] - b[1]);
    const txs: StreamTx[] = [];
    for (let start = 0; start < oldestFirst.length; start += 8) {
      const batch = oldestFirst.slice(start, start + 8);
      const read = await Promise.all(
        batch.map(([signature]) =>
          rawCall<{ slot: number; blockTime: number | null; meta: RawTx["meta"]; transaction: RawTx["transaction"] }>(rpc, "getTransaction", [
            signature,
            { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION },
          ]),
        ),
      );
      read.forEach((entry, index) => {
        if (!entry?.meta || entry.meta.err) return;
        const tx: StreamTx = {
          slot: entry.slot,
          ...(entry.blockTime === null ? {} : { time: entry.blockTime }),
          raw: { transaction: { signatures: [batch[index]![0]], message: entry.transaction.message }, meta: entry.meta },
        };
        this.note(tx);
        txs.push(tx);
      });
    }
    return { txs, complete };
  }

  close(): void {
    this.closed = true;
    clearInterval(this.pinging);
    this.socket?.close();
  }
}
