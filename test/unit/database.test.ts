/**
 * The database layer by itself, with no chain. It always runs against the embedded Postgres, and also
 * against a Postgres server when DATABASE_URL is set (what the CI job does).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../../lib/server/db";

const url = process.env.DATABASE_URL ?? "";
const schema = `t_unit_${Date.now().toString(36)}`;
const places = [
  { name: "embedded", config: { databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-db-")) } },
  ...(url ? [{ name: "Postgres server", config: { databaseUrl: url, databaseSchema: schema, dataDir: "" } }] : []),
];

afterAll(async () => {
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`drop schema if exists ${schema} cascade`);
  await client.end();
});

describe.each(places)("the database ($name)", ({ config }) => {
  it("keeps what a transaction wrote and gives it back to the next process", async () => {
    const first = await openDb(config);
    await first.tx(async (sql) => {
      await sql.query("insert into ring_balances (wallet, mint, amount) values ('w', 'm', '123456789012345678901234567890')");
      await sql.query("insert into credited (signature) values ('s1')");
    });
    await first.close();
    const second = await openDb(config);
    expect(await second.query("select amount::text as amount from ring_balances")).toEqual([{ amount: "123456789012345678901234567890" }]);
    await second.close();
  });

  it("commits a transaction whole or not at all", async () => {
    const db = await openDb(config);
    await expect(
      db.tx(async (sql) => {
        await sql.query("insert into credited (signature) values ('s2')");
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await db.query("select signature from credited order by signature")).toEqual([{ signature: "s1" }]);
    await db.close();
  });

  it("refuses a balance below zero and a signature credited twice, and keeps nothing of the transaction that tried", async () => {
    const db = await openDb(config);
    await expect(db.tx((sql) => sql.query("update ring_balances set amount = -1"))).rejects.toThrow(/check|constraint/i);
    await expect(
      db.tx(async (sql) => {
        await sql.query("insert into ring_balances (wallet, mint, amount) values ('w2', 'm', '5')");
        await sql.query("insert into credited (signature) values ('s1')");
      }),
    ).rejects.toThrow(/duplicate|unique/i);
    expect(await db.query("select wallet from ring_balances order by wallet")).toEqual([{ wallet: "w" }]);
    await db.close();
  });

  it("runs transactions one at a time, in the order they were asked for", async () => {
    const db = await openDb(config);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((turn) =>
        db.tx(async (sql) => {
          await sql.query("select 1");
          order.push(turn);
          await sql.query("select 1");
          order.push(turn);
        }),
      ),
    );
    expect(order).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    await db.close();
  });

  it("lets only one server hold it at a time", async () => {
    const holder = await openDb(config);
    await expect(openDb(config)).rejects.toThrow(/another server is already using this/);
    await holder.close();
    await (await openDb(config)).close();
  });
});

describe.skipIf(!url)("a Postgres server", () => {
  it("refuses a schema name that is not a plain identifier", async () => {
    await expect(openDb({ databaseUrl: url, databaseSchema: 'x"; drop table state; --', dataDir: "" })).rejects.toThrow(/DATABASE_SCHEMA must be/);
  });
});
