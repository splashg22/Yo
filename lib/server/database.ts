/**
 * Postgres as the place the server's state is kept, chosen by setting DATABASE_URL.
 *
 * The state stays one document, held in memory by one server process and written whole
 * after each change. Postgres adds what a file cannot: it lives off the server's disk,
 * can be backed up by the provider, and survives the server being replaced.
 *
 * Two rules keep it safe:
 * - One writer. The process takes an advisory lock when it starts and keeps it. A second
 *   server pointed at the same database refuses to start rather than overwrite the first.
 * - No silent loss. Every write names the version it replaces. If a write fails, or the
 *   version is not the one expected, the store stops accepting anything until restarted.
 */
import { Client } from "pg";

const SAFE_NAME = /^[a-z_][a-z0-9_]{0,48}$/;

export class Database {
  private version = 0;
  private tail: Promise<void> = Promise.resolve();
  private failure: Error | undefined;

  private constructor(
    private readonly client: Client,
    private readonly table: string,
  ) {}

  /** Connects, makes the table if it is missing, takes the single-writer lock, and reads the stored document (null if there is none yet). */
  static async open(url: string, schema: string): Promise<{ database: Database; stored: unknown }> {
    if (!SAFE_NAME.test(schema)) throw new Error("DATABASE_SCHEMA must be lower-case letters, digits and underscores");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const locked = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [`ring-state:${schema}`]);
      if (!locked.rows[0]?.locked)
        throw new Error("another server is already using this database. Two writers would overwrite each other, so this one will not start.");
      // The schema name is checked against SAFE_NAME above; identifiers cannot be passed as query parameters.
      await client.query(`create schema if not exists ${schema}`);
      const table = `${schema}.state`;
      await client.query(
        `create table if not exists ${table} (id integer primary key check (id = 1), version bigint not null, body jsonb not null, updated_at timestamptz not null default now())`,
      );
      const database = new Database(client, table);
      const found = await client.query<{ version: string; body: unknown }>(`select version, body from ${table} where id = 1`);
      if (found.rows[0]) {
        database.version = Number(found.rows[0].version);
        return { database, stored: found.rows[0].body };
      }
      await client.query(`insert into ${table} (id, version, body) values (1, 0, '{}'::jsonb)`);
      return { database, stored: null };
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  /** Queues the document to be written. Writes go out one at a time, in the order they were queued. */
  queue(body: string): void {
    this.tail = this.tail.then(async () => {
      if (this.failure) return;
      try {
        const written = await this.client.query(
          `update ${this.table} set body = $1::jsonb, version = version + 1, updated_at = now() where id = 1 and version = $2`,
          [body, this.version],
        );
        if (written.rowCount !== 1) throw new Error("the stored state was changed by something else");
        this.version += 1;
      } catch (error) {
        this.failure = new Error(
          `the database did not accept a change (${error instanceof Error ? error.message : String(error)}). Nothing more is accepted until the server is restarted.`,
        );
      }
    });
  }

  /** Resolves once everything queued so far is in the database. Throws if any write was refused. */
  async flushed(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }

  get broken(): Error | undefined {
    return this.failure;
  }

  /** The document as stored, as text. For checks that look at what was really written. */
  async storedText(): Promise<string> {
    await this.tail;
    return (await this.client.query<{ body: string }>(`select body::text as body from ${this.table} where id = 1`)).rows[0]?.body ?? "";
  }

  /** Lets go of the lock and the connection, after whatever was queued has been written. */
  async close(): Promise<void> {
    await this.tail;
    await this.client.end();
  }
}
