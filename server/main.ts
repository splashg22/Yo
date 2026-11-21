/**
 * The server: one process that answers the API, holds the live connections, follows the chain and
 * serves the pages. Everything that must share memory (the indexer, the hub, the sender) lives here.
 *
 *   development:  npm run dev      (tsx, with the framework's hot reload)
 *   production:   npm run build && npm start
 */
import next from "next";
import { existsSync } from "node:fs";
import { settings } from "../lib/server/env";
import { log } from "../lib/server/log";
import { runningMarket } from "../lib/server/market";
import { connection } from "../lib/server/solana";
import { database } from "../lib/server/store";
import { createApp } from "./app";

if (existsSync(".env")) process.loadEnvFile(".env");
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 4710);
const hostname = process.env.HOST ?? "0.0.0.0";

const framework = next({ dev, dir: ".", hostname, port });
await framework.prepare();
const app = await createApp({ dev, page: framework.getRequestHandler(), upgradePage: framework.getUpgradeHandler() });
app.server.listen(port, hostname, () =>
  log("info", "listening", { port, network: settings().network, database: database().kind, rpc: new URL(connection().rpcEndpoint).host }),
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("info", "stopping", { signal });
  await app.stop();
  await (await runningMarket()?.catch(() => undefined))?.stop().catch(() => undefined);
  await database()
    .close()
    .catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
