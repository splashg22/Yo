/** What a coin's own accounts say of it, and the pace at which they are read. */
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { COINS_A_CALL, Describer, describeFrom, metaplexNames, type Described } from "../../lib/server/describe";

const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const account = (owner: PublicKey, data: Buffer): AccountInfo<Buffer> => ({ owner, data, lamports: 1, executable: false });
function mintAccount(options: { mintAuthority?: PublicKey; freezeAuthority?: PublicKey; decimals?: number; supply?: bigint } = {}): AccountInfo<Buffer> {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: options.mintAuthority ? 1 : 0,
      mintAuthority: options.mintAuthority ?? PublicKey.default,
      supply: options.supply ?? 1_000_000_000_000_000n,
      decimals: options.decimals ?? 6,
      isInitialized: true,
      freezeAuthorityOption: options.freezeAuthority ? 1 : 0,
      freezeAuthority: options.freezeAuthority ?? PublicKey.default,
    },
    data,
  );
  return account(TOKEN_PROGRAM_ID, data);
}
/** A Metaplex metadata account, as the chain holds one: texts padded with zero bytes to their full length. */
function metaplexAccount(name: string, symbol: string, uri: string): AccountInfo<Buffer> {
  const text = (value: string, size: number): Buffer => {
    const out = Buffer.alloc(4 + size);
    out.writeUInt32LE(size, 0);
    out.write(value, 4, "utf8");
    return out;
  };
  return account(METAPLEX, Buffer.concat([Buffer.alloc(65, 1), text(name, 32), text(symbol, 10), text(uri, 200), Buffer.alloc(40)]));
}

const open: Db[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});
const newDb = async (): Promise<Db> => {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-describe-")) });
  open.push(db);
  return db;
};

describe("what a coin's own accounts say of it", () => {
  it("reads name, ticker and address from a Metaplex account, without the padding", () => {
    expect(metaplexNames(metaplexAccount("Made-up coin", "MADE", "https://example-host.com/c.json").data)).toEqual({
      name: "Made-up coin",
      symbol: "MADE",
      uri: "https://example-host.com/c.json",
    });
    expect(metaplexNames(Buffer.alloc(40))).toBeUndefined();
    // A length that runs past the end of the account is not believed.
    const lying = metaplexAccount("x", "y", "z").data;
    lying.writeUInt32LE(9_999, 65);
    expect(metaplexNames(lying)).toBeUndefined();
  });

  it("takes out characters that hide or reorder a name", () => {
    const read = metaplexNames(metaplexAccount("Safe‮evil​", "A\u0007B", "https://example-host.com/").data)!;
    expect(read.name).toBe("Safeevil");
    expect(read.symbol).toBe("AB");
  });

  it("says whether more can be minted and whether holdings can be frozen, from the coin's own account", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const plain = describeFrom(mint, mintAccount(), metaplexAccount("Made-up", "MADE", ""), null, 5)!;
    expect(plain.facts).toEqual({
      program: "token",
      decimals: 6,
      supply: "1000000000000000",
      mintAuthority: null,
      freezeAuthority: null,
      pump: false,
      readAt: 5,
    });
    expect([plain.name, plain.symbol, plain.creator]).toEqual(["Made-up", "MADE", ""]);
    const [minter, freezer] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const risky = describeFrom(mint, mintAccount({ mintAuthority: minter, freezeAuthority: freezer, decimals: 9 }), null, null, 5)!;
    expect(risky.facts.mintAuthority).toBe(minter.toBase58());
    expect(risky.facts.freezeAuthority).toBe(freezer.toBase58());
    expect(risky.facts.decimals).toBe(9);
    expect(risky.name).toBe("");
  });

  it("does not take an account for a coin when it is not one", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    expect(describeFrom(mint, null, null, null, 0)).toBeUndefined();
    expect(describeFrom(mint, account(Keypair.generate().publicKey, Buffer.alloc(MINT_SIZE)), null, null, 0)).toBeUndefined();
    expect(describeFrom(mint, account(TOKEN_PROGRAM_ID, Buffer.alloc(10)), null, null, 0)).toBeUndefined();
    // A description held by some other program is not read as Metaplex's.
    const impostor = { ...metaplexAccount("Fake", "FAKE", ""), owner: Keypair.generate().publicKey };
    expect(describeFrom(mint, mintAccount(), impostor, null, 0)!.name).toBe("");
  });

  it("reads waiting coins thirty to a call, most wanted first, and each coin once", async () => {
    const db = await newDb();
    const waiting = Array.from({ length: 70 }, () => Keypair.generate().publicKey.toBase58());
    const read: [string, Described][] = [];
    const asked: number[] = [];
    const describer: Describer = new Describer(db, {
      waiting: (most, skip): string[] => waiting.filter((mint) => !skip(mint) && !describer.facts(mint)).slice(0, most),
      accounts: (keys) => {
        asked.push(keys.length);
        return Promise.resolve(keys.map((_key, index) => (index % 3 === 0 ? mintAccount() : index % 3 === 1 ? metaplexAccount("Made-up", "MADE", "") : null)));
      },
      read: (mint, described) => {
        read.push([mint, described]);
        return Promise.resolve();
      },
      problem: (error) => {
        throw error;
      },
    });
    expect(await describer.step()).toBe(COINS_A_CALL);
    expect(await describer.step()).toBe(COINS_A_CALL);
    expect(await describer.step()).toBe(10);
    expect(await describer.step()).toBe(0);
    // Three accounts a coin, three calls for seventy coins, and nothing asked twice.
    expect(asked).toEqual([90, 90, 30]);
    expect(describer.calls).toBe(3);
    expect(read.map(([mint]) => mint)).toEqual(waiting);
    expect(describer.facts(waiting[0]!)?.mintAuthority).toBeNull();

    // What was read is kept: a new server on the same database knows it without asking the chain.
    const again = new Describer(db, {
      waiting: () => [],
      accounts: () => Promise.reject(new Error("not asked")),
      read: () => Promise.resolve(),
      problem: () => undefined,
    });
    await again.start();
    again.stop();
    expect(again.facts(waiting[69]!)?.decimals).toBe(6);
    expect(await again.now(waiting[3]!)).toMatchObject({ program: "token" });
    await again.forget([waiting[3]!]);
    expect(again.facts(waiting[3]!)).toBeUndefined();
  });

  it("does not ask again at once for a coin the chain had nothing for", async () => {
    const db = await newDb();
    const ghost = Keypair.generate().publicKey.toBase58();
    let calls = 0;
    const describer = new Describer(db, {
      waiting: (most, skip) => [ghost].filter((mint) => !skip(mint)).slice(0, most),
      accounts: (keys) => {
        calls += 1;
        return Promise.resolve(keys.map(() => null));
      },
      read: () => Promise.resolve(),
      problem: () => undefined,
    });
    expect(await describer.step()).toBe(0);
    expect(await describer.step()).toBe(0);
    expect(calls).toBe(1);
  });
});
