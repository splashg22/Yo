/**
 * The Postgres store by itself, with no chain: what the CI job runs against a real Postgres.
 * Skipped unless DATABASE_URL is set. The full flow suite against Postgres is `npm run test:flows:pg`.
 */
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "../../lib/server/database";

const url = process.env.DATABASE_URL ?? "";
const schema = `t_unit_${Date.now().toString(36)}`;

describe.skipIf(!url)("the Postgres store", () => {
  afterAll(async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`drop schema if exists ${schema} cascade`);
    await client.end();
  });

  it("starts empty, keeps what is written in order, and gives it back to the next process", async () => {
    const first = await Database.open(url, schema);
    expect(first.stored).toBeNull();
    for (let version = 1; version <= 25; version++) first.database.queue(JSON.stringify({ version }));
    await first.database.flushed();
    expect(JSON.parse(await first.database.storedText())).toEqual({ version: 25 });
    await first.database.close();
    const second = await Database.open(url, schema);
    expect(second.stored).toEqual({ version: 25 });
    await second.database.close();
  });

  it("lets only one process hold a database at a time", async () => {
    const holder = await Database.open(url, schema);
    await expect(Database.open(url, schema)).rejects.toThrow(/another server is already using this database/);
    await holder.database.close();
    await (await Database.open(url, schema)).database.close();
  });

  it("stops for good at the first write that does not replace the version it expected", async () => {
    const { database } = await Database.open(url, schema);
    const intruder = new Client({ connectionString: url });
    await intruder.connect();
    await intruder.query(`update ${schema}.state set version = version + 7`);
    await intruder.end();
    database.queue(JSON.stringify({ lost: true }));
    await expect(database.flushed()).rejects.toThrow(/did not accept a change/);
    database.queue(JSON.stringify({ alsoLost: true }));
    await expect(database.flushed()).rejects.toThrow(/Nothing more is accepted/);
    expect(database.broken).toBeInstanceOf(Error);
    expect(await database.storedText()).not.toContain("ost");
    await database.close();
  });

  it("refuses a connection it cannot make and a schema name that is not a plain identifier", async () => {
    await expect(Database.open("postgresql://postgres@127.0.0.1:1/postgres", schema)).rejects.toThrow();
    await expect(Database.open(url, "Bad-Name")).rejects.toThrow(/DATABASE_SCHEMA must be/);
  });
});
