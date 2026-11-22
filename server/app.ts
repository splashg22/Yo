/**
 * The server's own part of every request: the API, health, stored pictures, live connections, and the
 * headers and limits around them. Pages are handed to whatever `page` is given: the framework in the real
 * server, a stand-in in tests.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { ringAvailable, settings } from "../lib/server/env";
import { isOperation, run, within } from "../lib/server/handlers";
import { contentSecurityPolicy, fixedHeaders, newNonce } from "../lib/server/headers";
import { TIMEFRAMES } from "../lib/server/indexer/model";
import { bucketOf, callerOf, overLimit } from "../lib/server/limit";
import type { LiveClient } from "../lib/server/live";
import { failure, log } from "../lib/server/log";
import { market } from "../lib/server/market";
import { storedFile } from "../lib/server/pictures";
import { previewAllows } from "../lib/server/preview";
import { TEE_POLICY_HOST, passOn, ringGateOpen } from "../lib/server/ringgate";
import { onOutcome, sending, submit } from "../lib/server/sender";
import { reconcile } from "../lib/server/settle";
import { explain, rpcCalls } from "../lib/server/solana";
import { database, durable, ready } from "../lib/server/store";
import type { Input } from "../lib/server/validate";
import { CONFIG_HEADER, PRICE_HEADER } from "../lib/price-header";
import { buildConfig } from "../lib/server/operations/system";
import { knownSolPrice } from "../lib/server/usd";
import { keepWarm } from "../lib/server/warm";

export interface AppOptions {
  dev: boolean;
  page: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  upgradePage?: (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> | void;
}
export interface App {
  server: Server;
  stop: () => Promise<void>;
}

/** A picture of 1.5 MB in base64, and room for the rest of the request. */
const MAX_BODY_BYTES = 2_300_000;
const MAX_SUBSCRIPTIONS = 40;
const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_SOCKETS_PER_CALLER = Number(process.env.WS_MAX_PER_ADDRESS ?? 30);
const MAX_MESSAGES_PER_SECOND = 40;
const ADDRESS = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const CHANNEL = new RegExp(`^(board|coin:${ADDRESS}|wallet:${ADDRESS}|k:${ADDRESS}:(${TIMEFRAMES.join("|")}))$`);

let fixed: Record<string, string> = {};
const json = (response: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...fixed,
    ...extra,
  });
  response.end(text);
};
/** Who is calling, for counting: the address the connection came from, or what this operator's own proxies say it was. */
const callerFor = (request: IncomingMessage): string => {
  const forwarded = callerOf(typeof request.headers["x-forwarded-for"] === "string" ? request.headers["x-forwarded-for"] : null);
  return forwarded === "direct" ? (request.socket.remoteAddress ?? "unknown") : forwarded;
};

async function readBody(request: IncomingMessage): Promise<string | null> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

let requests = 0;
async function api(request: IncomingMessage, response: ServerResponse, name: string): Promise<void> {
  const started = performance.now();
  const id = (++requests).toString(36);
  // POST only: an operation can change something, and a GET can be fired by a link or an image on another site.
  if (request.method !== "POST") return json(response, 405, { error: "operations are called with POST" }, { allow: "POST" });
  if (!isOperation(name)) return json(response, 404, { error: "there is no such operation" });
  const caller = callerFor(request);
  const wait = overLimit(caller, bucketOf(name));
  if (wait > 0)
    return json(
      response,
      429,
      { error: `too many requests from this address. Wait ${wait} seconds and try again. Nothing was sent.` },
      { "retry-after": String(wait) },
    );
  const raw = await readBody(request).catch(() => "");
  if (raw === null) return json(response, 413, { error: "the request is too large" });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // answered just below
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return json(response, 400, { error: "the request body must be a JSON object" });
  let status = 200;
  try {
    json(response, 200, await run(name, parsed as Input), { "x-request-id": id });
  } catch (error) {
    // `run` has already turned the failure into one plain sentence.
    const message = error instanceof Error ? error.message : String(error);
    status = message.startsWith("the chain is not answering") ? 503 : 400;
    json(response, status, { error: message }, { "x-request-id": id });
  }
  log("debug", "request", { id, operation: name, status, ms: Math.round((performance.now() - started) * 10) / 10 });
  timings.add(performance.now() - started);
}

/** The last few hundred request times, for the health page's percentiles. */
const timings = {
  kept: [] as number[],
  add(ms: number): void {
    this.kept.push(ms);
    if (this.kept.length > 500) this.kept.shift();
  },
  percentile(share: number): number | null {
    if (this.kept.length === 0) return null;
    const sorted = [...this.kept].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]! * 10) / 10;
  },
};

/** For a host's health check and for whoever operates this: is each part up, and how far behind the chain is the indexer. */
async function health(response: ServerResponse): Promise<void> {
  const report: Record<string, unknown> = { server: true, at: new Date().toISOString() };
  let ok = true;
  try {
    await ready();
    report.database = { ok: true, ms: Math.round((await database().ping()) * 10) / 10, kind: database().kind };
  } catch (error) {
    ok = false;
    report.database = { ok: false, problem: explain(error) };
  }
  try {
    const service = await market();
    const { indexer, hub } = service;
    const behind = Math.max(0, indexer.head - indexer.cursor);
    // More than about 20 seconds of blocks behind is not "up" for a trading screen.
    const lagging = behind > 50 || indexer.failure !== undefined;
    if (lagging) ok = false;
    report.chain = indexer.failure === undefined;
    report.indexer = {
      ok: !lagging,
      cursor: indexer.cursor,
      head: indexer.head,
      behindSlots: behind,
      lastBlockAppliedMsAgo: indexer.lastAppliedAt === 0 ? null : Date.now() - indexer.lastAppliedAt,
      coins: indexer.markets.size,
      ...(indexer.failure ? { problem: indexer.failure } : {}),
    };
    report.live = { clients: hub.clients, framesSent: hub.sent, clientsDropped: hub.dropped };
  } catch (error) {
    ok = false;
    report.chain = false;
    report.indexer = { ok: false, problem: explain(error) };
  }
  report.sender = { inFlight: sending() };
  report.requests = { p50Ms: timings.percentile(0.5), p95Ms: timings.percentile(0.95), counted: timings.kept.length };
  report.rpcCalls = Object.fromEntries(rpcCalls);
  json(response, ok ? 200 : 503, report);
}

/**
 * For whoever operates the server: run the Ring stand-in's housekeeping now instead of waiting for the timer.
 * It does not exist unless ADMIN_TOKEN is set, and answers only to that token.
 */
async function admin(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const token = process.env.ADMIN_TOKEN ?? "";
  const given = request.headers.authorization ?? "";
  const expected = Buffer.from(`Bearer ${token}`);
  const offered = Buffer.from(given);
  if (!token || request.method !== "POST" || offered.length !== expected.length || !timingSafeEqual(offered, expected))
    return json(response, 404, { error: "there is no such page" });
  try {
    json(response, 200, await within("reconcile", () => reconcile()));
  } catch (error) {
    json(response, 503, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The narrow door to the real Ring's services: see lib/server/ringgate.ts. Counted per caller like any other write. */
async function ringGate(request: IncomingMessage, response: ServerResponse, route: string): Promise<void> {
  const wait = overLimit(callerFor(request), "ring");
  if (wait > 0)
    return json(response, 429, { error: `too many requests from this address. Wait ${wait} seconds and try again.` }, { "retry-after": String(wait) });
  const raw = request.method === "POST" ? await readBody(request).catch(() => null) : "";
  if (raw === null) return json(response, 413, { error: "the request is too large" });
  const query = new URL(request.url ?? "/", "http://local").searchParams;
  const passed = await passOn(route, request.method ?? "GET", query, raw === "" ? null : Buffer.from(raw, "utf8"));
  response.writeHead(passed.status, { "content-type": passed.type, "content-length": passed.body.length, "cache-control": "no-store", ...fixed });
  response.end(passed.body);
}

function served(response: ServerResponse, name: string): void {
  const file = storedFile(name);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...fixed });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": file.type,
    // The name is a hash of the contents, so what it names never changes.
    "cache-control": "public, max-age=31536000, immutable",
    ...fixed,
    "cross-origin-resource-policy": "cross-origin",
    // Shown as an image or read as data, never run: no script, no framing.
    "content-security-policy": "default-src 'none'; sandbox",
  });
  response.end(file.bytes);
}

/** Builds the server, starts the indexer and the housekeeping, and returns it ready to listen. */
export async function createApp(options: AppOptions): Promise<App> {
  const { dev, page } = options;
  const upgradePage = options.upgradePage ?? ((_request: IncomingMessage, socket: Duplex) => void socket.destroy());
  fixed = fixedHeaders(settings().siteUrl.startsWith("https://"));
  const imageHosts = settings().pinataJwt ? ["https://gateway.pinata.cloud"] : [];
  // With the real Ring, the SDK in the browser fetches Helius's signed policy for the prover's enclave from Helius's own
  // address, and checks its signatures itself. It is public, carries no key, and is the one thing the page fetches from elsewhere.
  const connectHosts = ringGateOpen() ? [TEE_POLICY_HOST] : [];

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? "/").split("?")[0]!;
      if (path === "/health") return health(response);
      if (!previewAllows(request.headers.authorization)) {
        response.writeHead(401, {
          "www-authenticate": 'Basic realm="Private preview", charset="UTF-8"',
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          ...fixed,
        });
        response.end("This preview is private.");
        return;
      }
      if (path.startsWith("/api/")) return api(request, response, path.slice(5));
      if (path === "/admin/reconcile") return admin(request, response);
      if (path === "/ring/rpc" || path.startsWith("/ring/v1/spr/"))
        return ringGate(request, response, path === "/ring/rpc" ? "rpc" : path.slice("/ring/v1/spr/".length));
      if (path.startsWith("/u/")) return served(response, decodeURIComponent(path.slice(3)));
      // A page. The framework reads the nonce from the policy on the request and puts it on every script it writes.
      const policy = contentSecurityPolicy(newNonce(), { dev, imageHosts, host: request.headers.host, connectHosts });
      request.headers["content-security-policy"] = policy;
      response.setHeader("content-security-policy", policy);
      for (const [name, value] of Object.entries(fixed)) response.setHeader(name, value);
      // The page is rendered with the price of SOL already in it. The header is this server's own: whatever a caller sent under that name is replaced.
      const price = knownSolPrice();
      if (price) request.headers[PRICE_HEADER] = JSON.stringify(price);
      else delete request.headers[PRICE_HEADER];
      request.headers[CONFIG_HEADER] = JSON.stringify(buildConfig());
      await page(request, response);
    })().catch((error: unknown) => {
      log("error", "request failed", failure(error));
      if (!response.headersSent) json(response, 500, { error: "the server could not answer" });
      else response.end();
    });
  });

  // ---- live connections ---------------------------------------------------------------------
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });
  const perCaller = new Map<string, number>();
  server.on("upgrade", (request, socket, head) => {
    const path = (request.url ?? "/").split("?")[0];
    if (path !== "/ws") {
      void upgradePage(request, socket, head);
      return;
    }
    const refuse = (status: string): void => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!previewAllows(request.headers.authorization)) return refuse("401 Unauthorized");
    // A page on another site must not be able to open a connection with this visitor's browser.
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host && origin !== settings().siteUrl) return refuse("403 Forbidden");
    const caller = callerFor(request);
    if ((perCaller.get(caller) ?? 0) >= MAX_SOCKETS_PER_CALLER) return refuse("429 Too Many Requests");
    sockets.handleUpgrade(request, socket, head, (ws) => void connect(ws, caller));
  });

  async function connect(ws: WebSocket, caller: string): Promise<void> {
    perCaller.set(caller, (perCaller.get(caller) ?? 0) + 1);
    const { hub, indexer } = await market();
    /** How stale the figures being pushed are, in milliseconds: 0 while the indexer keeps up with the chain. */
    const staleMs = (): number => {
      const keepingUp = indexer.failure === undefined && indexer.head - indexer.cursor <= 5;
      return keepingUp || indexer.lastAppliedAt === 0 ? 0 : Date.now() - indexer.lastAppliedAt;
    };
    const client: LiveClient = {
      send(text) {
        if (ws.readyState !== WebSocket.OPEN) return true; // closing: its "close" handler tidies up
        // A client this far behind is not reading. It is let go, and catches up from a snapshot when it comes back.
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
        ws.send(text);
        return true;
      },
      close: () => ws.close(4000, "too far behind"),
    };
    let alive = true;
    let budget = { second: 0, used: 0 };
    ws.on("pong", () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on("close", () => {
      clearInterval(heartbeat);
      hub.leave(client);
      const left = (perCaller.get(caller) ?? 1) - 1;
      if (left <= 0) perCaller.delete(caller);
      else perCaller.set(caller, left);
    });
    ws.on("error", () => ws.terminate());
    ws.on("message", (data) => {
      const second = Math.floor(Date.now() / 1000);
      if (budget.second !== second) budget = { second, used: 0 };
      if (++budget.used > MAX_MESSAGES_PER_SECOND) return ws.close(4001, "too many messages");
      let message: { t?: unknown; ch?: unknown; since?: unknown; id?: unknown; tx?: unknown; at?: unknown };
      try {
        message = JSON.parse((data as Buffer).toString("utf8")) as typeof message;
      } catch {
        return ws.close(4002, "not JSON");
      }
      if (message.t === "ping") return hub.tell(client, { t: "pong", at: message.at, now: Date.now(), stale: staleMs() });
      if (message.t === "sub" || message.t === "unsub") {
        if (typeof message.ch !== "string" || !CHANNEL.test(message.ch)) return hub.tell(client, { t: "err", error: "there is no such channel" });
        if (message.t === "unsub") return hub.unsubscribe(client, message.ch);
        if (hub.subscriptionsOf(client) >= MAX_SUBSCRIPTIONS) return hub.tell(client, { t: "err", error: "too many subscriptions on one connection" });
        return hub.subscribe(client, message.ch, typeof message.since === "number" && Number.isInteger(message.since) ? message.since : undefined);
      }
      if (message.t === "send") {
        // A signed trade, handed over on the connection that is already open. Answered as soon as the network has it.
        const id = typeof message.id === "string" ? message.id.slice(0, 40) : "";
        if (overLimit(caller, "write") > 0) return hub.tell(client, { t: "sent", id, error: "too many requests from this address. Nothing was sent." });
        if (typeof message.tx !== "string" || message.tx.length > 4_000) return hub.tell(client, { t: "sent", id, error: "that is not a signed transaction" });
        void within("tx/send", () => submit(message.tx as string, { fast: true })).then(
          (outcome) => hub.tell(client, { t: "sent", id, signature: outcome.signature, state: outcome.state }),
          (error: unknown) => hub.tell(client, { t: "sent", id, error: error instanceof Error ? error.message : String(error) }),
        );
        return;
      }
      hub.tell(client, { t: "err", error: "that is not a message this server understands" });
    });
  }

  await ready();
  const service = await market();
  // Every transaction's end is told to the wallet that paid for it, on its own channel.
  const unlisten = onOutcome((outcome) => service.hub.publish(`wallet:${outcome.payer}`, ["tx", { ...outcome, payer: undefined }]));
  const stopWarm = keepWarm();
  // The stand-in Ring's own housekeeping: deposits that arrived with no one telling the server, payouts still in flight.
  const housekeeping = ringAvailable() ? setInterval(() => void within("reconcile", () => reconcile()).catch(() => undefined), 60_000) : undefined;
  return {
    server,
    async stop() {
      clearInterval(housekeeping);
      stopWarm();
      unlisten();
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await durable().catch(() => undefined);
    },
  };
}
