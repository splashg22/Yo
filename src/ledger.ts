/** Public, append-only record of everything the bot did (data/ledger.jsonl). */
import fs from "node:fs";
import path from "node:path";

export interface LedgerEntry {
  type:
    | "claim"
    | "swap"
    | "burn"
    | "buyback"
    | "buyback_burn"
    | "distribution"
    | "payout"
    | "payout_skipped"
    | "tx_failed"
    | "tx_expired";
  cycle: number;
  signature?: string;
  [key: string]: unknown;
}

export interface Ledger {
  append(entry: LedgerEntry): void;
  /** True when an entry of this type for this signature is already recorded. */
  has(type: LedgerEntry["type"], signature: string): boolean;
}

export class FileLedger implements Ledger {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "ledger.jsonl");
  }

  append(entry: LedgerEntry): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
  }

  has(type: LedgerEntry["type"], signature: string): boolean {
    if (!fs.existsSync(this.file)) return false;
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .some((line) => line.includes(signature) && line.includes(`"type":"${type}"`));
  }
}
