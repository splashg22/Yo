/**
 * The load test: one coin traded faster than the budget asks, a thousand live connections watching it, and the
 * API being read at the same time. It fails (exit 1) if any budget below is missed.
 *
 *   npm run load                      the budgeted run: 60 trades a second for 20 seconds, 1,000 connections
 *   LOAD_TRADES_PER_SECOND=200 LOAD_CLIENTS=3000 LOAD_SECONDS=30 npm run load
 *
 * What is real and what is not. Real: this app's own server code, its indexer, database (the embedded Postgres),
 * live hub, HTTP and websocket layers, and a thousand actual websocket connections from other threads.
 * Made up: the chain. Trades come from the made-up chain in lib/server/indexer/sim-source.ts, a block every
 * 400 ms, because no test chain can be made to produce 60 real trades a second on one coin from this machine.
 * So the time a real RPC takes to hand over a block is NOT in these numbers: they are this server's share.
 * Everything runs on one machine, so there is no network between server and clients either.
 */
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const TRADES_PER_SECOND = Number(process.env.LOAD_TRADES_PER_SECOND ?? 60);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 20);
const CLIENTS = Number(process.env.LOAD_CLIENTS ?? 1000);
const BLOCK_MS = 400;
const CLIENT_THREADS = 4;
/** Clients per thread whose every arrival is timed. The rest are counted. */
const SAMPLED = 25;
const READS_PER_SECOND = 15;

/** The budgets. The first two are the brief's: a trade on the chain reaches the screen within a second (aim: half), reads answer within 100 ms. */
const BUDGET = {
  confirmedP95Ms: 1000,
  confirmedP50AimMs: 500,
  earlyP95Ms: 250,
  apiP95Ms: 100,
};

const dataDir = mkdtempSync(join(tmpdir(), "ring-load-"));
Object.assign(process.env, {
  APP_DATA_DIR: dataDir,
  RING_NETWORK: "local",
  NODE_ENV: "production",
  LOG_SILENT: "1",
  WS_MAX_PER_ADDRESS: String(CLIENTS + 10),
  LOCAL_SOL_USD: "150",
});
// Imported after the settings above, which these modules read as they load.
const { SimChain } = await import("../lib/server/indexer/sim-source");
const { useSource: takeChainFrom, market } = await import("../lib/server/market");
const { createApp } = await import("../server/app");
const { database } = await import("../lib/server/store");

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
const ms = (value: number): string => `${value.toFixed(value < 10 ? 1 : 0)} ms`;

const sim = new SimChain();
sim.time = Math.floor(Date.now() / 1000);
takeChainFrom(() => sim);
const mint = SimChain.mint("load");
const wallets = Array.from({ length: 200 }, (_, index) => SimChain.wallet(`trader-${index}`));
const app = await createApp({
  dev: false,
  page: (_request, response) => {
    response.statusCode = 404;
    response.end();
    return Promise.resolve();
  },
});
const server: Server = app.server;
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const service = await market();
// The indexer follows the chain from the moment it starts, so the coin is made after it has.
sim.create(mint, wallets[0]!, "Load test coin", "LOAD");
sim.produce();
// Some history first, so reads have something to page through and every trader has coins to sell.
for (const wallet of wallets) sim.trade(mint, wallet, "buy", 20_000_000n);
await service.indexer.reached(sim.produce().slot);

interface LiveReport {
  confirmed: number[];
  arrivals: [string, "e" | "t", number][];
  closedEarly: number;
  resets: number;
  frames: number;
}
interface ReadReport {
  took: Record<string, number[]>;
  failed: number;
}
function thread<Report>(data: Record<string, unknown>): { ready: Promise<void>; finish: () => Promise<Report> } {
  const worker = new Worker(new URL("./load-clients.mjs", import.meta.url), { workerData: data });
  let onReady: () => void;
  let onDone: (report: Report) => void;
  const ready = new Promise<void>((resolve) => (onReady = resolve));
  const done = new Promise<Report>((resolve) => (onDone = resolve));
  worker.on("message", (message: { ready?: boolean; done?: boolean } & Report) => {
    if (message.ready) onReady();
    if (message.done) onDone(message);
  });
  worker.on("error", (error) => {
    console.error("a load thread failed:", error);
    process.exit(1);
  });
  return {
    ready,
    finish: async () => {
      worker.postMessage({ stop: true });
      const report = await done;
      await worker.terminate();
      return report;
    },
  };
}

const perThread = Math.ceil(CLIENTS / CLIENT_THREADS);
const live = Array.from({ length: CLIENT_THREADS }, (_, index) =>
  thread<LiveReport>({
    role: "live",
    url: `ws://127.0.0.1:${port}/ws`,
    channel: `coin:${mint}`,
    clients: Math.min(perThread, CLIENTS - index * perThread),
    sampled: SAMPLED,
  }),
);
await Promise.all(live.map((entry) => entry.ready));
const reader = thread<ReadReport>({ role: "read", url: `http://127.0.0.1:${port}`, mint, readsPerSecond: READS_PER_SECOND });
await reader.ready;
console.log(`${CLIENTS} live connections open on one coin. Trading ${TRADES_PER_SECOND} a second for ${SECONDS} seconds, a block every ${BLOCK_MS} ms.`);

/** When each trade was made (for the early notice) and when its block was made (for the confirmed one). */
const madeAt = new Map<string, number>();
const blockAt = new Map<string, number>();
let inBlock: string[] = [];
let traded = 0;
const total = TRADES_PER_SECOND * SECONDS;
const started = Date.now();
const lagSamples: number[] = [];
let lastTick = performance.now();
await new Promise<void>((resolve) => {
  const tick = setInterval(() => {
    // How late this timer fires is how long the server's one thread was busy with something else.
    const now = performance.now();
    lagSamples.push(Math.max(0, now - lastTick - 10));
    lastTick = now;
    const due = Math.min(total, Math.floor(((Date.now() - started) / 1000) * TRADES_PER_SECOND));
    while (traded < due) {
      const wallet = wallets[traded % wallets.length]!;
      const selling = traded % 3 === 2 && sim.holding(mint, wallet) > 1_000_000_000n;
      const { signature } = sim.trade(mint, wallet, selling ? "sell" : "buy", selling ? 1_000_000_000n : 5_000_000n + BigInt(traded % 7) * 1_000_000n);
      madeAt.set(signature, Date.now());
      inBlock.push(signature);
      traded++;
    }
    if (traded >= total) {
      clearInterval(tick);
      clearInterval(blocks);
      seal();
      resolve();
    }
  }, 10);
  const seal = (): void => {
    if (inBlock.length === 0) return;
    sim.time = Math.floor(Date.now() / 1000);
    sim.produce();
    const at = Date.now();
    for (const signature of inBlock) blockAt.set(signature, at);
    inBlock = [];
  };
  const blocks = setInterval(seal, BLOCK_MS);
});
const head = await sim.head();
await service.indexer.reached(head);
// Time for the last frames to cross to the clients.
await new Promise((resolve) => setTimeout(resolve, 1500));

const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
  live: { clients: number; framesSent: number; clientsDropped: number };
  requests: { p50Ms: number; p95Ms: number; counted: number };
};
const reports = await Promise.all(live.map((entry) => entry.finish()));
const reads = await reader.finish();
await app.stop();
await service.stop().catch(() => undefined);
await database()
  .close()
  .catch(() => undefined);
rmSync(dataDir, { recursive: true, force: true });

const confirmedLatency: number[] = [];
const earlyLatency: number[] = [];
for (const report of reports)
  for (const [signature, kind, at] of report.arrivals) {
    if (kind === "t" && blockAt.has(signature)) confirmedLatency.push(at - blockAt.get(signature)!);
    if (kind === "e" && madeAt.has(signature)) earlyLatency.push(at - madeAt.get(signature)!);
  }
const counts = reports.flatMap((report) => report.confirmed);
const short = counts.filter((count) => count !== total).length;
const closedEarly = reports.reduce((sum, report) => sum + report.closedEarly, 0);
const resets = reports.reduce((sum, report) => sum + report.resets, 0);
const allReads = Object.values(reads.took).flat();

const lines: [string, string, boolean | null][] = [
  ["Trades made", `${total} in ${SECONDS} s (${TRADES_PER_SECOND}/s) on one coin`, null],
  ["Live connections", `${counts.length}`, counts.length === CLIENTS],
  ["Connections that received every confirmed trade", `${counts.length - short} of ${counts.length}`, short === 0],
  [
    "Connections dropped or closed by the server",
    `${health.live.clientsDropped} dropped, ${closedEarly} closed`,
    health.live.clientsDropped === 0 && closedEarly === 0,
  ],
  ["Channel resets sent", `${resets}`, resets === 0],
  [
    "Block made to confirmed trade at the client",
    `p50 ${ms(quantile(confirmedLatency, 0.5))}, p95 ${ms(quantile(confirmedLatency, 0.95))}, worst ${ms(quantile(confirmedLatency, 1))} (budget p95 ${BUDGET.confirmedP95Ms} ms, aim p50 under ${BUDGET.confirmedP50AimMs})`,
    quantile(confirmedLatency, 0.95) < BUDGET.confirmedP95Ms,
  ],
  [
    "Trade announced to early notice at the client",
    `p50 ${ms(quantile(earlyLatency, 0.5))}, p95 ${ms(quantile(earlyLatency, 0.95))} (budget p95 ${BUDGET.earlyP95Ms} ms)`,
    quantile(earlyLatency, 0.95) < BUDGET.earlyP95Ms,
  ],
  [
    "API reads during the run, timed by the caller",
    `${allReads.length} reads, p50 ${ms(quantile(allReads, 0.5))}, p95 ${ms(quantile(allReads, 0.95))}, ${reads.failed} failed (budget p95 ${BUDGET.apiP95Ms} ms)`,
    quantile(allReads, 0.95) < BUDGET.apiP95Ms && reads.failed === 0,
  ],
  ...Object.entries(reads.took).map(([name, took]): [string, string, null] => [
    `  ${name}`,
    `p50 ${ms(quantile(took, 0.5))}, p95 ${ms(quantile(took, 0.95))} over ${took.length}`,
    null,
  ]),
  ["API reads, timed by the server", `p50 ${ms(health.requests.p50Ms)}, p95 ${ms(health.requests.p95Ms)} over ${health.requests.counted}`, null],
  ["Frames sent by the hub", `${health.live.framesSent}`, null],
  [
    "Server thread held up (timer lateness)",
    `p50 ${ms(quantile(lagSamples, 0.5))}, p95 ${ms(quantile(lagSamples, 0.95))}, worst ${ms(quantile(lagSamples, 1))}`,
    null,
  ],
];
let failed = 0;
for (const [label, value, passed] of lines) {
  if (passed === false) failed++;
  console.log(`${passed === null ? "    " : passed ? "ok  " : "FAIL"} ${label}: ${value}`);
}
console.log(failed === 0 ? "Every load budget held." : `${failed} load budget(s) missed.`);
process.exit(failed === 0 ? 0 : 1);
