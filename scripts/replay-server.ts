/**
 * This app's server and built pages on a RECORDED stretch of mainnet, played back at the pace it happened.
 * For looking at the terminal under mainnet's real volume before a live stream is paid for.
 *
 *   npm run build && npm run replay -- .data-recorded/mainnet-<slot>-600.jsonl.gz
 *   REPLAY_LEAD=300   blocks played at once at the start, so the board opens full (default: half the recording)
 *   REPLAY_PORT=4730
 *
 * What it is and is not:
 *   - The trades, coins and holders are real: they happened on mainnet when the recording was made (npm run record).
 *   - It is not live. Every page says so in a bar, and "now" on the board is the recording's clock, not today's.
 *   - The server runs in mainnet mode, which is read-only: it refuses to build or send any transaction.
 *   - Names, pictures and safety facts of coins older than the recording are read from mainnet as it is today,
 *     through the RPC in .env (read-only calls). Without one, those coins show their address and say so.
 *
 * It listens on this machine only, and keeps its data in a temporary folder that is removed when it stops.
 */
import next from "next";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
const file = process.argv[2];
if (!file || !existsSync(file)) throw new Error("say which recording to play: npm run replay -- <file made by npm run record>");
const PORT = Number(process.env.REPLAY_PORT ?? 4730);

const dataDir = process.env.REPLAY_DATA_DIR ?? mkdtempSync(join(tmpdir(), "ring-replay-"));
Object.assign(process.env, {
  APP_DATA_DIR: dataDir,
  RING_NETWORK: "mainnet",
  FEED_SCOPE: "all",
  FEED_VENUES: process.env.FEED_VENUES ?? "pump,meteora-damm2",
  FEED_PROVIDER: "rpc",
  NODE_ENV: "production",
});
const { RecordedSource } = await import("../lib/server/indexer/recorded-source");
const { useSource: takeChainFrom, market } = await import("../lib/server/market");
const { setPlayback } = await import("../lib/server/playback");
const { createApp } = await import("../server/app");

const recording = new RecordedSource(file);
const times = recording.times();
const first = times[0]!;
const last = times[times.length - 1]!;
const lead = Math.min(recording.length, Number(process.env.REPLAY_LEAD ?? Math.floor(recording.length / 2)));
let played = 0;
const clock = (): number => times[Math.max(0, played - 1)]! * 1000;
setPlayback(() => ({ from: first * 1000, to: last * 1000, now: clock() }));
takeChainFrom(() => recording);

const framework = next({ dev: false, dir: ".", hostname: "127.0.0.1", port: PORT });
await framework.prepare();
// The first blocks are out before the indexer starts, so it begins at the recording's beginning.
recording.release(1);
played = 1;
const app = await createApp({ dev: false, page: framework.getRequestHandler(), upgradePage: framework.getUpgradeHandler() });
const service = await market();
service.clock = clock;
// The lead: played as fast as the indexer takes it, a few blocks at a time so the clock moves with it.
while (played < lead) {
  const step = Math.min(5, lead - played);
  played += step;
  await service.indexer.reached(recording.release(step));
}
await new Promise<void>((resolve) => app.server.listen(PORT, "127.0.0.1", resolve));

// The rest, each block when it is due: as far after the lead's last block as it was on the chain.
const began = Date.now();
const leadTime = times[played - 1]!;
const playing = setInterval(() => {
  while (played < recording.length && (times[played]! - leadTime) * 1000 <= Date.now() - began) {
    recording.release(1);
    played += 1;
  }
  if (played >= recording.length) clearInterval(playing);
}, 100);
console.log(
  JSON.stringify({
    ready: true,
    url: `http://127.0.0.1:${PORT}`,
    blocks: recording.length,
    playedAtOnce: lead,
    recordedFrom: new Date(first * 1000).toISOString(),
    recordedTo: new Date(last * 1000).toISOString(),
    secondsLeftToPlay: last - leadTime,
  }),
);

const stop = async (): Promise<void> => {
  clearInterval(playing);
  await app.stop().catch(() => undefined);
  await service.stop().catch(() => undefined);
  if (!process.env.REPLAY_DATA_DIR) rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
