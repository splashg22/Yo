/**
 * What a coin's own accounts say of it, read from the chain: its name, ticker and where its picture is described,
 * who made it, and the facts the safety checks rest on (can more be minted, can holdings be frozen, how many decimals).
 *
 * A coin made while this server was listening has its name from the event that made it. A coin that was already
 * trading when it was first seen has none until it is read here. Reads are batched and paced: one call to the chain
 * a second at most, thirty coins a call, the most traded first. That is the whole cost: about one RPC credit a second
 * while there are coins waiting, and nothing when there are none.
 */
import type * as PumpSdk from "@pump-fun/pump-sdk";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getExtensionData, unpackMint } from "@solana/spl-token";
import { unpack as unpackTokenMetadata } from "@solana/spl-token-metadata";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { createRequire } from "node:module";
import type { CoinFacts } from "../contract";
import type { Db } from "./db";
import { PUMP_PROGRAM } from "./indexer/decode";

const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const COINS_A_CALL = 30;
const PACE_MS = 1_000;
const RETRY_AFTER_MS = 300_000;

export interface Described {
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  facts: CoinFacts;
}
type Info = AccountInfo<Buffer> | null;
/** True for a character with no place in a name: a control character, or a mark that reorders or hides text. */
function hidden(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}
const clean = (text: string): string =>
  [...text]
    .filter((character) => !hidden(character.codePointAt(0)!))
    .join("")
    .trim();

/** Name, ticker and address from a Metaplex metadata account. Undefined if the bytes are not one. */
export function metaplexNames(data: Buffer): { name: string; symbol: string; uri: string } | undefined {
  // 1 byte of kind, the authority, the mint, then three texts, each a length and that many bytes.
  let at = 65;
  const next = (most: number): string | undefined => {
    if (at + 4 > data.length) return undefined;
    const length = data.readUInt32LE(at);
    at += 4;
    if (length > most || at + length > data.length) return undefined;
    const text = data.subarray(at, at + length).toString("utf8");
    at += length;
    return clean(text);
  };
  const name = next(64);
  const symbol = next(32);
  const uri = next(400);
  return name === undefined || symbol === undefined || uri === undefined ? undefined : { name, symbol, uri };
}

/** What three of a coin's accounts say: the coin itself, its Metaplex description if it has one, and its pump.fun curve. */
export function describeFrom(mint: string, mintInfo: Info, metaplexInfo: Info, curveInfo: Info, now: number): Described | undefined {
  if (!mintInfo) return undefined;
  const program = mintInfo.owner.equals(TOKEN_PROGRAM_ID) ? "token" : mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : undefined;
  if (!program) return undefined;
  let unpacked: ReturnType<typeof unpackMint>;
  try {
    unpacked = unpackMint(new PublicKey(mint), mintInfo, mintInfo.owner);
  } catch {
    return undefined;
  }
  let names: { name: string; symbol: string; uri: string } | undefined;
  if (program === "token-2022") {
    try {
      const held = getExtensionData(ExtensionType.TokenMetadata, unpacked.tlvData);
      if (held) {
        const read = unpackTokenMetadata(held);
        names = { name: clean(read.name), symbol: clean(read.symbol), uri: clean(read.uri) };
      }
    } catch {
      names = undefined;
    }
  }
  if (!names && metaplexInfo?.owner.equals(METAPLEX)) names = metaplexNames(metaplexInfo.data);
  let creator = "";
  let mayhem = false;
  const pump = curveInfo !== null && curveInfo.owner.toBase58() === PUMP_PROGRAM;
  if (pump) {
    try {
      const curve = sdk.PUMP_SDK.decodeBondingCurve(curveInfo);
      creator = curve.creator.toBase58();
      mayhem = (curve as { isMayhemMode?: boolean }).isMayhemMode === true;
    } catch {
      creator = "";
    }
  }
  return {
    name: (names?.name ?? "").slice(0, 64),
    symbol: (names?.symbol ?? "").slice(0, 16),
    uri: names?.uri ?? "",
    creator,
    facts: {
      program,
      decimals: unpacked.decimals,
      supply: unpacked.supply.toString(),
      mintAuthority: unpacked.mintAuthority?.toBase58() ?? null,
      freezeAuthority: unpacked.freezeAuthority?.toBase58() ?? null,
      pump,
      ...(mayhem ? { mayhem } : {}),
      readAt: now,
    },
  };
}

export interface DescribeHost {
  /** Up to `most` coins waiting to be read, the most wanted first. */
  waiting(most: number, skip: (mint: string) => boolean): string[];
  accounts(keys: PublicKey[]): Promise<Info[]>;
  /** Called with each coin read. */
  read(mint: string, described: Described): Promise<void>;
  problem(error: unknown): void;
}

export class Describer {
  private readonly known = new Map<string, CoinFacts>();
  private readonly tried = new Map<string, number>();
  private readonly asked = new Map<string, Promise<CoinFacts | undefined>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** Calls made to the chain, for /health and for tests that hold it to a budget. */
  calls = 0;

  constructor(
    private readonly db: Db,
    private readonly host: DescribeHost,
  ) {}

  async start(): Promise<void> {
    const rows = await this.db.query<{ mint: string; facts: CoinFacts }>("select mint, facts from coin_facts");
    for (const row of rows) this.known.set(row.mint, typeof row.facts === "string" ? (JSON.parse(row.facts) as CoinFacts) : row.facts);
    this.timer = setInterval(() => void this.step(), PACE_MS);
  }
  stop(): void {
    clearInterval(this.timer);
  }
  facts(mint: string): CoinFacts | undefined {
    return this.known.get(mint);
  }
  get waitingFor(): number {
    return this.host.waiting(10_000, (mint) => this.skipped(mint)).length;
  }
  private skipped(mint: string): boolean {
    return Date.now() - (this.tried.get(mint) ?? 0) < RETRY_AFTER_MS;
  }
  async forget(mints: string[]): Promise<void> {
    for (const mint of mints) {
      this.known.delete(mint);
      this.tried.delete(mint);
    }
    await this.db.query("delete from coin_facts where mint in (select jsonb_array_elements_text($1::jsonb))", [JSON.stringify(mints)]);
  }

  /** One paced step: the next batch of waiting coins, in one call. Returns how many were read. */
  async step(): Promise<number> {
    if (this.running) return 0;
    const mints = this.host.waiting(COINS_A_CALL, (mint) => this.skipped(mint));
    if (mints.length === 0) return 0;
    this.running = true;
    try {
      return await this.read(mints);
    } catch (error) {
      this.host.problem(error);
      return 0;
    } finally {
      this.running = false;
    }
  }
  /** One coin, now, for somebody who has it open. Answers from what is kept when it has been read before. */
  now(mint: string): Promise<CoinFacts | undefined> {
    const kept = this.known.get(mint);
    if (kept) return Promise.resolve(kept);
    let running = this.asked.get(mint);
    if (!running) {
      running = this.read([mint])
        .then(() => this.known.get(mint))
        .finally(() => this.asked.delete(mint));
      this.asked.set(mint, running);
    }
    return running;
  }

  private async read(mints: string[]): Promise<number> {
    const keys = mints.flatMap((mint) => {
      const key = new PublicKey(mint);
      return [key, PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), key.toBuffer()], METAPLEX)[0], sdk.bondingCurvePda(key)];
    });
    const now = Date.now();
    for (const mint of mints) this.tried.set(mint, now);
    this.calls += 1;
    const infos = await this.host.accounts(keys);
    let read = 0;
    for (const [index, mint] of mints.entries()) {
      const described = describeFrom(mint, infos[index * 3] ?? null, infos[index * 3 + 1] ?? null, infos[index * 3 + 2] ?? null, now);
      if (!described) continue;
      this.known.set(mint, described.facts);
      await this.db.query("insert into coin_facts (mint, facts) values ($1, $2::jsonb) on conflict (mint) do update set facts = excluded.facts", [
        mint,
        JSON.stringify(described.facts),
      ]);
      await this.host.read(mint, described);
      read += 1;
    }
    if (this.tried.size > 50_000) for (const [mint, at] of this.tried) if (now - at > RETRY_AFTER_MS) this.tried.delete(mint);
    return read;
  }
}
