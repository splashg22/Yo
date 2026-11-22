/**
 * This app's server and built pages on top of the made-up chain, trading one coin at a steady rate.
 * For the performance test (scripts/perf.mjs) and for looking at the trading screen under a fast stream:
 * no real test chain can be made to trade one coin fifty times a second from one machine.
 *
 *   npm run build && tsx scripts/sim-server.ts          then open the address it prints
 *   SIM_TRADES_PER_SECOND=120 SIM_PORT=4720 tsx scripts/sim-server.ts
 *
 * It listens on this machine only. The coin, its trades and its holders are made up and exist only while this runs.
 */
import next from "next";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RATE = Number(process.env.SIM_TRADES_PER_SECOND ?? 50);
const PORT = Number(process.env.SIM_PORT ?? 4720);
const BLOCK_MS = 400;
/** Other coins on the board, traded now and then, so the board has rows that move. */
const OTHER_COINS = 60;

const dataDir = mkdtempSync(join(tmpdir(), "ring-sim-"));
Object.assign(process.env, { APP_DATA_DIR: dataDir, RING_NETWORK: "local", NODE_ENV: "production", LOG_SILENT: "1", LOCAL_SOL_USD: "150" });
const { SimChain } = await import("../lib/server/indexer/sim-source");
const { useSource: takeChainFrom, market } = await import("../lib/server/market");
const { createApp } = await import("../server/app");

const sim = new SimChain();
// History is laid down in the past, a block a second, so the chart opens on a screenful of candles.
const HISTORY_SECONDS = 600;
sim.time = Math.floor(Date.now() / 1000) - HISTORY_SECONDS;
takeChainFrom(() => sim);

const framework = next({ dev: false, dir: ".", hostname: "127.0.0.1", port: PORT });
await framework.prepare();
const app = await createApp({ dev: false, page: framework.getRequestHandler(), upgradePage: framework.getUpgradeHandler() });
const service = await market();

const mint = SimChain.mint("stream");
const wallets = Array.from({ length: 300 }, (_, index) => SimChain.wallet(`trader-${index}`));
const others = Array.from({ length: OTHER_COINS }, (_, index) => SimChain.mint(`other-${index}`));
sim.create(mint, wallets[0]!, "Stream test coin", "STRM");
others.forEach((other, index) => sim.create(other, wallets[index % wallets.length]!, `Made-up coin ${index + 1}`, `SIM${index + 1}`));
sim.produce();
let made = 0;
const trade = (): void => {
  const wallet = wallets[made % wallets.length]!;
  const selling = made % 3 === 2 && sim.holding(mint, wallet) > 2_000_000_000n;
  sim.trade(mint, wallet, selling ? "sell" : "buy", selling ? 2_000_000_000n : 4_000_000n + BigInt((made * 7919) % 11) * 1_000_000n);
  made++;
};
for (let second = 0; second < HISTORY_SECONDS; second++) {
  for (let count = 0; count < 3; count++) trade();
  if (second % 20 === 0) sim.trade(others[(second / 20) % others.length]!, wallets[second % wallets.length]!, "buy", 30_000_000n);
  sim.time += 1;
  sim.produce();
}
await service.indexer.reached(await sim.head());

await new Promise<void>((resolve) => app.server.listen(PORT, "127.0.0.1", resolve));
const started = Date.now();
const before = made;
let lastOther = 0;
const trading = setInterval(() => {
  const due = before + Math.floor(((Date.now() - started) / 1000) * RATE);
  while (made < due) trade();
  if (Date.now() - lastOther > 700) {
    lastOther = Date.now();
    sim.trade(others[made % others.length]!, wallets[made % wallets.length]!, "buy", 25_000_000n);
  }
}, 10);
const blocks = setInterval(() => {
  sim.time = Math.floor(Date.now() / 1000);
  sim.produce();
}, BLOCK_MS);
// One line, read by the performance test.
console.log(JSON.stringify({ ready: true, url: `http://127.0.0.1:${PORT}`, mint, tradesPerSecond: RATE }));

const stop = async (): Promise<void> => {
  clearInterval(trading);
  clearInterval(blocks);
  await app.stop().catch(() => undefined);
  await service.stop().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
