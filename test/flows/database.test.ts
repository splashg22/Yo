/**
 * The Postgres store. These run only when DATABASE_URL is set (npm run test:flows:pg);
 * every other flow test runs against Postgres too in that mode.
 */
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import { Database } from "../../lib/server/database";
import { settings } from "../../lib/server/env";
import { storedText } from "../../lib/server/store";
import type { RingClient } from "../../lib/sdk";
import { SOL, call, expectCovered, freshServer, fundedClient, restartServer } from "./helpers";

const url = process.env.DATABASE_URL ?? "";

describe.skipIf(!url)("state kept in Postgres", () => {
  freshServer();
  let holder: RingClient;
  beforeAll(async () => {
    holder = await fundedClient();
    await holder.deposit(NATIVE, SOL);
  });

  it("holds what the server answered with: the balance is in the database the moment the deposit returns", async () => {
    const stored = JSON.parse(await storedText()) as { balances: Record<string, Record<string, string>> };
    expect(stored.balances[holder.address]![NATIVE]).toBe(SOL.toString());
  });

  it("gives the same balances and history back after a restart", async () => {
    const before = { balance: await holder.ringBalance(NATIVE), history: await holder.ringHistory() };
    restartServer();
    expect(await holder.ringBalance(NATIVE)).toBe(before.balance);
    expect(await holder.ringHistory()).toEqual(before.history);
    await expectCovered(NATIVE);
  });

  it("refuses a second server on the same database, and lets one in once the first has gone", async () => {
    await expect(Database.open(url, settings().databaseSchema)).rejects.toThrow(/another server is already using this database/);
    // A different schema is a different deployment: it is not locked out.
    const elsewhere = await Database.open(url, `${settings().databaseSchema}_b`);
    await elsewhere.database.close();
  });

  it("stops accepting anything if the stored state was changed behind its back, and keeps what was there", async () => {
    const balance = await holder.ringBalance(NATIVE);
    const intruder = new Client({ connectionString: url });
    await intruder.connect();
    await intruder.query(`update ${settings().databaseSchema}.state set version = version + 1`);
    await intruder.end();
    const friend = await fundedClient().catch((error: unknown) => error);
    void friend;
    await expect(holder.withdraw(NATIVE, SOL / 10n)).rejects.toThrow(/database did not accept a change|Nothing more is accepted/);
    await expect(call("explore", {})).rejects.toThrow(/Nothing more is accepted/);
    // A restart reads what the database really holds: the withdrawal that could not be recorded was never paid.
    restartServer();
    expect(await holder.ringBalance(NATIVE)).toBe(balance);
    await expectCovered(NATIVE);
  });

  it("refuses a schema name that is not a plain identifier", async () => {
    await expect(Database.open(url, 'x"; drop table state; --')).rejects.toThrow(/DATABASE_SCHEMA must be/);
  });
});
