/**
 * The database. Postgres everywhere: a Postgres server when DATABASE_URL is set, otherwise an embedded
 * Postgres (PGlite) kept in the data directory, so a fresh clone runs with nothing to install.
 *
 * Rules that hold for both:
 * - One writer. A second server on the same database, or the same data directory, refuses to start.
 * - Writes go through `tx`, one transaction at a time, in the order they were asked for.
 * - A transaction commits whole or not at all.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { SCHEMA } from "./schema";

export interface Sql {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Row[]>;
}
export interface Db extends Sql {
  readonly kind: "postgres" | "embedded";
  /** Runs `work` inside one transaction. Transactions never overlap. */
  tx<Result>(work: (sql: Sql) => Promise<Result>): Promise<Result>;
  /** Answers once the database has answered a trivial query: for health checks. */
  ping(): Promise<number>;
  close(): Promise<void>;
}

const SAFE_NAME = /^[a-z_][a-z0-9_]{0,48}$/;
// Whole numbers that fit a JavaScript number (slots, times, counts) come back as numbers. Amounts are `numeric` and come back as text.
pg.types.setTypeParser(20, (value) => Number(value));

/** One at a time, in order. A failed turn does not block the next. */
class Turns {
  private tail: Promise<unknown> = Promise.resolve();
  take<Result>(work: () => Promise<Result>): Promise<Result> {
    const run = this.tail.then(work, work);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

class Postgres implements Db {
  readonly kind = "postgres" as const;
  private readonly turns = new Turns();
  private constructor(
    private readonly writer: pg.Client,
    private readonly readers: pg.Pool,
  ) {}

  static async open(url: string, schema: string): Promise<Postgres> {
    if (!SAFE_NAME.test(schema)) throw new Error("DATABASE_SCHEMA must be lower-case letters, digits and underscores");
    // The schema name is checked against SAFE_NAME above; identifiers cannot be passed as query parameters.
    const options = `-c search_path=${schema}`;
    const writer = new pg.Client({ connectionString: url, options });
    await writer.connect();
    try {
      const locked = await writer.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [`ring-state:${schema}`]);
      if (!locked.rows[0]?.locked)
        throw new Error("another server is already using this database. Two writers would overwrite each other, so this one will not start.");
      await writer.query(`create schema if not exists ${schema}`);
      await writer.query(SCHEMA);
    } catch (error) {
      await writer.end().catch(() => undefined);
      throw error;
    }
    const readers = new pg.Pool({ connectionString: url, options, max: 6, idleTimeoutMillis: 30_000 });
    readers.on("error", () => undefined); // an idle connection dropping is not a failure of the server
    return new Postgres(writer, readers);
  }

  async query<Row>(text: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.readers.query(text, params)).rows as Row[];
  }
  tx<Result>(work: (sql: Sql) => Promise<Result>): Promise<Result> {
    return this.turns.take(async () => {
      const sql: Sql = { query: async <Row>(text: string, params: unknown[] = []) => (await this.writer.query(text, params)).rows as Row[] };
      await this.writer.query("begin");
      try {
        const result = await work(sql);
        await this.writer.query("commit");
        return result;
      } catch (error) {
        await this.writer.query("rollback").catch(() => undefined);
        throw error;
      }
    });
  }
  async ping(): Promise<number> {
    const started = performance.now();
    await this.readers.query("select 1");
    return performance.now() - started;
  }
  async close(): Promise<void> {
    await this.turns.take(() => Promise.resolve());
    await this.readers.end().catch(() => undefined);
    await this.writer.end().catch(() => undefined);
  }
}

interface Lite {
  waitReady: Promise<void>;
  exec(text: string): Promise<unknown>;
  query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  transaction<Result>(work: (tx: { query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[] }> }) => Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}
/** Embedded databases stay loaded for the life of the process: starting one takes seconds, and a "restart" in a test must find the same data. */
const loaded = new Map<string, Promise<Lite>>();
const held = new Set<string>();

class Embedded implements Db {
  readonly kind = "embedded" as const;
  private readonly turns = new Turns();
  private constructor(
    private readonly lite: Lite,
    private readonly directory: string,
  ) {}

  static async open(directory: string): Promise<Embedded> {
    if (held.has(directory))
      throw new Error("another server is already using this database. Two writers would overwrite each other, so this one will not start.");
    mkdirSync(directory, { recursive: true });
    // Another process on the same folder would corrupt it. The lock file names the process that holds it; a dead holder is ignored.
    const lock = join(directory, "writer.lock");
    if (existsSync(lock)) {
      const owner = Number(readFileSync(lock, "utf8"));
      if (owner !== process.pid && alive(owner))
        throw new Error("another server is already using this data folder. Two writers would overwrite each other, so this one will not start.");
    }
    writeFileSync(lock, String(process.pid));
    held.add(directory);
    try {
      let starting = loaded.get(directory);
      if (!starting) {
        starting = (async () => {
          const { PGlite } = await import("@electric-sql/pglite");
          const lite = new PGlite(join(directory, "pg")) as unknown as Lite;
          await lite.waitReady;
          return lite;
        })();
        loaded.set(directory, starting);
        starting.catch(() => loaded.delete(directory));
      }
      const lite = await starting;
      await lite.exec(SCHEMA);
      return new Embedded(lite, directory);
    } catch (error) {
      held.delete(directory);
      rmSync(lock, { force: true });
      throw error;
    }
  }

  async query<Row>(text: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.lite.query<Row>(text, params)).rows;
  }
  tx<Result>(work: (sql: Sql) => Promise<Result>): Promise<Result> {
    return this.turns.take(() =>
      this.lite.transaction((tx) => work({ query: async <Row>(text: string, params: unknown[] = []) => (await tx.query<Row>(text, params)).rows })),
    );
  }
  async ping(): Promise<number> {
    const started = performance.now();
    await this.lite.query("select 1");
    return performance.now() - started;
  }
  async close(): Promise<void> {
    await this.turns.take(() => Promise.resolve());
    held.delete(this.directory);
    rmSync(join(this.directory, "writer.lock"), { force: true });
  }
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Opens the database named by the settings: a Postgres server if a URL is given, the embedded one in `dataDir` otherwise. */
export const openDb = (config: { databaseUrl: string; databaseSchema: string; dataDir: string }): Promise<Db> =>
  config.databaseUrl ? Postgres.open(config.databaseUrl, config.databaseSchema) : Embedded.open(config.dataDir);
