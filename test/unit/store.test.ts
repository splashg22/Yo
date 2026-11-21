/** The store on the embedded database: what is written, what comes back after a restart, and what it refuses. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ring } from "../../lib/server/ring";
import { database, durable, forget, ready, save, state, storedText } from "../../lib/server/store";
import { newActor } from "../../lib/keys";

const COIN = "So11111111111111111111111111111111111111112";
const previous = { store: process.env.APP_STORE, dir: process.env.APP_DATA_DIR };

describe("the store", () => {
  beforeAll(async () => {
    delete process.env.APP_STORE;
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "ring-store-"));
    forget();
    await ready();
  });
  afterAll(() => {
    forget();
    process.env.APP_STORE = previous.store;
    if (previous.dir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous.dir;
  });
  const restart = async () => {
    await durable();
    forget();
    await ready();
  };

  it("refuses to be used before the database has been read", () => {
    forget();
    expect(() => state()).toThrow(/has not been read yet/);
  });

  it("survives a restart exactly, lists in the order they were made", async () => {
    await ready();
    const [ana, ben] = [newActor().address, newActor().address];
    ring.register(ana);
    ring.register(ben);
    ring.credit(ana, COIN, 2n ** 63n, "sig-1");
    ring.transfer(ana, ben, COIN, 20n);
    ring.credit(ben, COIN, 5n, "sig-2");
    const before = JSON.stringify(state());
    await restart();
    expect(JSON.stringify(state())).toBe(before);
    expect(ring.balances(ana)[COIN]).toBe((2n ** 63n - 20n).toString());
    expect(JSON.parse(await storedText())).toEqual(JSON.parse(before));
  });

  it("writes only the rows a step changed, each step as one transaction", async () => {
    const version = async () => Number((await database().query<{ value: string }>("select value from meta where key = 'version'"))[0]!.value);
    const startedAt = await version();
    const wallet = newActor().address;
    ring.register(wallet);
    ring.credit(wallet, COIN, 7n, "sig-3");
    state().credited.push("sig-3"); // what settling a deposit does, in the same step
    save();
    await durable();
    expect((await version()) - startedAt).toBeGreaterThan(0);
    expect(await database().query("select amount::text as amount from ring_balances where wallet = $1", [wallet])).toEqual([{ amount: "7" }]);
    expect(await database().query("select signature from credited where signature = 'sig-3'")).toHaveLength(1);
  });

  it("stops accepting anything when the database refuses a write, and a restart finds what was really stored", async () => {
    const wallet = Object.keys(state().balances)[0]!;
    const stored = state().balances[wallet]![COIN]!;
    // A bug that would take a balance below zero in memory is refused by the database's own rule.
    state().balances[wallet]![COIN] = "-1";
    save();
    await expect(durable()).rejects.toThrow(/did not accept a change/);
    await expect(ready()).rejects.toThrow(/Nothing more is accepted/);
    forget();
    await ready();
    expect(state().balances[wallet]![COIN]).toBe(stored);
  });

  it("refuses to credit one signature twice even if the code tried", async () => {
    state().credited.push("sig-1x");
    save();
    await durable();
    await restart();
    // The memory of it is lost (as a bug would lose it); the database still has the row.
    state().credited = state().credited.filter((signature) => signature !== "sig-1x");
    save();
    await durable();
    state().credited.push("sig-9");
    save();
    await durable();
    await database().tx((sql) => sql.query("insert into credited (signature) values ('sig-10')"));
    state().credited.push("sig-10");
    save();
    await expect(durable()).rejects.toThrow(/did not accept a change/);
    forget();
    await ready();
  });

  it("stops with a clear message on a record it does not know, rather than starting again from empty", async () => {
    await database().tx((sql) => sql.query(`insert into records (collection, key, ord, body) values ('mystery', 'k', 999999, '{}'::jsonb)`));
    forget();
    await expect(ready()).rejects.toThrow(/stored state is damaged .* left untouched/);
  });
});
