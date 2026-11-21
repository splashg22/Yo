/**
 * The server itself, over real HTTP and a real websocket, on the local chain: what it lets in, the headers it
 * sends, live data, the fast trade path, and the budgets it holds itself to.
 */
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { newActor } from "../../lib/keys";
import type { RingClient } from "../../lib/sdk";
import { PER_MINUTE, forgetLimits } from "../../lib/server/limit";
import { openSession } from "../../lib/server/sessions";
import { rpcCallTotal, rpcCalls } from "../../lib/server/solana";
import { signTransaction } from "../../lib/sign";
import { createApp, type App } from "../../server/app";
import { SOL, call, freshServer, fundedClient, onChain } from "./helpers";

freshServer();
let app: App, base: string, creator: RingClient, trader: RingClient, mint: string;
const post = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/${name}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

interface Frame {
  ch?: string;
  seq?: number;
  reset?: boolean;
  d?: [string, ...unknown[]][];
  t?: string;
  [key: string]: unknown;
}
/** A live connection that keeps every frame it is sent, and can wait for one that matches. */
async function live(headers: Record<string, string> = {}) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers });
  const frames: Frame[] = [];
  const waiting: { test: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];
  socket.on("message", (data: Buffer) => {
    const frame = JSON.parse(data.toString()) as Frame;
    frames.push(frame);
    for (const waiter of [...waiting]) {
      if (!waiter.test(frame)) continue;
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => reject(new Error(`refused: ${response.statusCode}`)));
  });
  return {
    socket,
    frames,
    say: (message: unknown) => socket.send(JSON.stringify(message)),
    until: (test: (frame: Frame) => boolean, ms = 15_000) =>
      new Promise<Frame>((resolve, reject) => {
        const found = frames.find(test);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error("no such frame arrived")), ms);
        waiting.push({
          test,
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
        });
      }),
    events: (channel: string) => frames.filter((frame) => frame.ch === channel).flatMap((frame) => frame.d ?? []),
  };
}

beforeAll(async () => {
  app = await createApp({
    dev: false,
    page: (request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(`<p>page ${request.headers["content-security-policy"] as string}</p>`);
      return Promise.resolve();
    },
  });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  [creator, trader] = await Promise.all([fundedClient(), fundedClient()]);
  mint = (await creator.launch({ name: "Server", symbol: "SRV", firstBuyLamports: SOL / 20n })).mint;
});
afterAll(async () => {
  delete process.env.PREVIEW_PASSWORD;
  await app.stop();
});

describe("what the server lets in", () => {
  it("answers an operation, and says plainly what is wrong with a request that is not one", async () => {
    expect((await post("config", {})).status).toBe(200);
    expect((await post("no/such/operation", {})).status).toBe(404);
    expect((await fetch(`${base}/api/config`)).status).toBe(405);
    for (const body of ["", "not json", "[]", "null", "7"]) {
      const refused = await post("config", body);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: "the request body must be a JSON object" });
    }
  });

  it("refuses a request that is too large", async () => {
    const oversized = await post("config", JSON.stringify({ padding: "x".repeat(2_400_000) }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "the request is too large" });
  });

  it("counts each caller by the address it connects from, with nothing to configure", async () => {
    forgetLimits();
    const wallet = newActor().address;
    const answers: number[] = [];
    for (let request = 0; request <= PER_MINUTE.faucet; request++)
      answers.push((await post("faucet", { wallet: request === 0 ? wallet : "not an address" })).status);
    expect(answers.slice(0, PER_MINUTE.faucet).every((status) => status !== 429)).toBe(true);
    expect(answers.at(-1)).toBe(429);
    forgetLimits();
  });

  it("sends only transactions it built itself", async () => {
    const built = await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: "1000000" });
    // The same transaction with one byte of its message changed is not one this server built.
    const bytes = Buffer.from(signTransaction(built.transaction, [trader.wallet.seed]), "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    const refused = await post("tx/send", { transaction: bytes.toString("base64") });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(/did not build that transaction/);
    // Reconciling and crediting are not open to the public at all.
    expect((await post("ring/reconcile", {})).status).toBe(404);
    expect((await post("ring/credit", { signature: "x" })).status).toBe(404);
  });
});

describe("what the server sends back", () => {
  it("puts the security headers on a page, with a fresh nonce each time, and on an API answer", async () => {
    const [first, second] = [await fetch(`${base}/`), await fetch(`${base}/wallet`)];
    const policy = first.headers.get("content-security-policy")!;
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'wasm-unsafe-eval';/);
    expect(policy).not.toContain(" 'unsafe-eval'");
    expect(await first.text()).toContain(policy); // the page is given the same policy, so its scripts carry the nonce
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
    for (const response of [first, await post("config", {})]) {
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("permissions-policy")).toContain("camera=()");
    }
  });

  it("reports the database, the indexer's lag, live clients and request times on /health", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const report = (await health.json()) as {
      database: { ok: boolean };
      indexer: { ok: boolean; behindSlots: number; coins: number };
      live: object;
      requests: object;
    };
    expect(report.database.ok).toBe(true);
    expect(report.indexer).toMatchObject({ ok: true });
    expect(report.indexer.behindSlots).toBeLessThan(10);
    expect(report.indexer.coins).toBeGreaterThan(0);
  });

  it("asks for the preview password everywhere but the health check, once one is set", async () => {
    process.env.PREVIEW_PASSWORD = "let me in";
    const key = { authorization: `Basic ${Buffer.from("x:let me in").toString("base64")}` };
    try {
      for (const path of ["/", "/wallet", "/u/abc.webp"]) expect((await fetch(`${base}${path}`)).status).toBe(401);
      expect((await post("config", {})).status).toBe(401);
      await expect(live()).rejects.toThrow(/401/);
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/`, { headers: key })).status).toBe(200);
      expect((await post("config", {}, key)).status).toBe(200);
      (await live(key)).socket.close();
    } finally {
      delete process.env.PREVIEW_PASSWORD;
    }
  });
});

describe("reads never ask the chain about a coin", () => {
  it("serves the board, a coin, its trades, candles, holders and a portfolio with no call to the chain at all", async () => {
    await trader.trade(mint, "buy", SOL / 50n);
    const before = rpcCallTotal();
    const board = await call("explore");
    expect(board.coins.find((coin) => coin.mint === mint)).toMatchObject({ symbol: "SRV", launchedHere: true, trades: 2, holders: 2 });
    await call("coin", { mint });
    expect((await call("coin/trades", { mint })).trades).toHaveLength(2);
    expect((await call("coin/candles", { mint, tf: 1 })).candles.length).toBeGreaterThan(0);
    const holders = await call("coin/holders", { mint });
    expect(holders.holders.find((holder) => holder.tags.includes("curve"))).toBeTruthy();
    expect(holders.holders.find((holder) => holder.owner === creator.address)!.tags).toEqual(["creator"]);
    const portfolio = await call("portfolio", { wallet: trader.address });
    expect(portfolio.positions).toHaveLength(1);
    expect(rpcCallTotal() - before).toBe(0);

    // The position is the chain's own figures: what is held is what the wallet holds, bought is what the trade moved.
    const position = portfolio.positions[0]!;
    expect(BigInt(position.held)).toBe(await onChain(trader.address, mint));
    expect(position).toMatchObject({ buys: 1, sells: 0, soldLamports: "0", realisedLamports: "0" });
    expect(BigInt(position.boughtTokens)).toBe(BigInt(position.held));
  });

  it("builds a trade with at most two calls to the chain, and reads a wallet's balances in three however many coins it holds", async () => {
    await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: "1000000" }); // warms what is kept warm
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = rpcCallTotal();
    await call("trade/build", { wallet: trader.address, mint, side: "sell", amount: "1000000000" });
    expect(rpcCallTotal() - before).toBeLessThanOrEqual(2);
    rpcCalls.clear();
    await call("wallet/public", { wallet: creator.address });
    expect(rpcCallTotal()).toBeLessThanOrEqual(3);
  });
});

describe("live data", () => {
  it("pushes a trade, its candle, the holder's new balance and the coin's new price to whoever is subscribed", async () => {
    const client = await live();
    const coin = await call("coin", { mint });
    client.say({ t: "sub", ch: `coin:${mint}`, since: coin.seq });
    client.say({ t: "sub", ch: `k:${mint}:60` });
    client.say({ t: "sub", ch: "board" });
    const bought = await trader.trade(mint, "buy", SOL / 100n);
    await client.until(
      (frame) => frame.ch === `coin:${mint}` && (frame.d ?? []).some(([kind, trade]) => kind === "t" && (trade as { s: string }).s === bought.signature),
    );
    await client.until((frame) => frame.ch === `k:${mint}:60`);
    const price = (await call("coin", { mint })).microLamportsPerCoin;
    const priced = ([kind, which, patch]: [string, ...unknown[]]) =>
      kind === "u" && which === mint && (patch as { microLamportsPerCoin?: string }).microLamportsPerCoin === price;
    await client.until((frame) => frame.ch === "board" && (frame.d ?? []).some(priced));
    await client.until((frame) => frame.ch === `coin:${mint}` && (frame.d ?? []).some(([kind]) => kind === "m"));
    const events = client.events(`coin:${mint}`);
    const trade = events.find(([kind, value]) => kind === "t" && (value as { s: string }).s === bought.signature)![1] as { w: string; b: number; tok: number };
    expect(trade).toMatchObject({ w: trader.address, b: 1, tok: Number(bought.expected) });
    expect(events.some(([kind, owner, amount]) => kind === "h" && owner === trader.address && BigInt(amount as string) > 0n)).toBe(true);
    const patch = client.events("board").find(priced)![2] as Record<string, unknown>;
    expect(patch.name).toBeUndefined(); // only what changed is sent
    const candle = client.events(`k:${mint}:60`).at(-1)![1] as number[];
    expect(candle[4]).toBe(Number((await call("coin", { mint })).microLamportsPerCoin));
    client.socket.close();
  });

  it("sends a client that was away what it missed, and tells one that was away too long to start again", async () => {
    const seen = (await call("coin", { mint })).seq;
    const bought = await trader.trade(mint, "buy", SOL / 100n);
    const client = await live();
    client.say({ t: "sub", ch: `coin:${mint}`, since: seen });
    await client.until((frame) => (frame.d ?? []).some(([kind, trade]) => kind === "t" && (trade as { s: string }).s === bought.signature));
    const again = await live();
    again.say({ t: "sub", ch: `coin:${mint}`, since: 999_999 }); // a number from before this server started
    expect(await again.until((frame) => frame.ch === `coin:${mint}` && frame.reset === true)).toBeTruthy();
    client.socket.close();
    again.socket.close();
  });

  it("refuses a channel that does not exist and a page from another site", async () => {
    const client = await live();
    client.say({ t: "sub", ch: "everything" });
    expect(await client.until((frame) => frame.t === "err")).toMatchObject({ error: "there is no such channel" });
    client.socket.close();
    await expect(live({ origin: "https://elsewhere.example" })).rejects.toThrow(/403/);
  });
});

describe("the fast trade path", () => {
  it("builds trades ahead of the click, takes one over the open connection, answers at once and reports the end", async () => {
    const client = await live();
    client.say({ t: "sub", ch: `wallet:${trader.address}` });
    const held = await onChain(trader.address, mint);
    const prepared = await call("trade/prepare", {
      wallet: trader.address,
      mint,
      buys: ["1000000", "2000000"],
      sells: [(held / 2n).toString(), (held * 10n).toString()],
      slippageBps: 500,
      priorityLamports: "10000",
    });
    expect(prepared.buys.every((buy) => buy !== null)).toBe(true);
    expect(prepared.sells.map((sell) => sell !== null)).toEqual([true, false]); // more than is held is simply not ready
    const clicked = performance.now();
    client.say({ t: "send", id: "a1", tx: signTransaction(prepared.buys[1]!.transaction, [trader.wallet.seed]) });
    const sent = await client.until((frame) => frame.t === "sent" && frame.id === "a1");
    const toSent = performance.now() - clicked;
    expect(sent.error).toBeUndefined();
    expect(sent.state).toBe("sent");
    expect(toSent).toBeLessThan(100); // click to handed-to-the-network, on this machine
    const done = await client.until((frame) =>
      (frame.d ?? []).some(([kind, outcome]) => kind === "tx" && (outcome as { signature: string }).signature === sent.signature),
    );
    const outcome = done.d!.find(([kind]) => kind === "tx")![1] as { state: string; landedInMs: number };
    expect(outcome.state).toBe("confirmed");
    expect(await onChain(trader.address, mint)).toBeGreaterThan(held);
    // The trade itself arrives on the same channel, so the page can mark it on the chart.
    await client.until((frame) => (frame.d ?? []).some(([kind, trade]) => kind === "t" && (trade as { s: string }).s === sent.signature));
    // A transaction this server did not build is refused on this path too, and nothing is sent.
    client.say({ t: "send", id: "a2", tx: Buffer.from("not a transaction").toString("base64") });
    expect((await client.until((frame) => frame.t === "sent" && frame.id === "a2")).error).toMatch(/not a signed transaction/);
    client.socket.close();
  });

  it("refuses a slippage, priority fee or tip that is out of range", async () => {
    const base_ = { wallet: trader.address, mint, side: "buy" as const, amount: "1000000" };
    await expect(call("trade/build", { ...base_, slippageBps: 0 })).rejects.toThrow(/slippage must be between/);
    await expect(call("trade/build", { ...base_, slippageBps: 6000 })).rejects.toThrow(/slippage must be between/);
    await expect(call("trade/build", { ...base_, priorityLamports: "200000000" })).rejects.toThrow(/priority fee is out of range/);
    await expect(call("trade/build", { ...base_, tipLamports: "200000000" })).rejects.toThrow(/tip is out of range/);
  });
});

describe("sessions", () => {
  it("open with one wallet signature, read that wallet's own records, and can move nothing", async () => {
    await trader.register();
    await trader.deposit(mint, 1_000n);
    const token = await trader.session();
    const mine = await call("ring/mine", { session: token });
    expect(mine.balances[mint]).toBe("1000");
    expect(await call("otc/mine", { session: token })).toEqual({ offers: [] });
    // A session is not a signature: everything that moves a balance still refuses it.
    for (const attempt of [
      () => call("ring/transfer", { session: token, to: creator.address, mint, amount: "1" }),
      () => call("ring/withdraw", { session: token, mint, amount: "1" }),
      () => call("otc/offer", { session: token, buyer: creator.address, mint, amount: "1", priceLamports: "1" }),
    ])
      await expect(attempt()).rejects.toThrow(/must be signed by a wallet/);
    expect(await trader.ringBalance(mint)).toBe(1_000n);
  });

  it("end when closed or expired, and are refused when made up", async () => {
    const token = await trader.session();
    await expect(call("ring/mine", { session: "x".repeat(43) })).rejects.toThrow(/session has ended/);
    await expect(call("ring/mine", { session: 7 })).rejects.toThrow(/session has ended/);
    await trader.signOut();
    await expect(call("ring/mine", { session: token })).rejects.toThrow(/session has ended/);
    process.env.SESSION_MINUTES = "1";
    try {
      const short = openSession(trader.address, Date.now() - 61_000);
      await expect(call("ring/mine", { session: short.token })).rejects.toThrow(/session has ended/);
    } finally {
      delete process.env.SESSION_MINUTES;
    }
  });

  it("are needed to upload a picture, and only for the wallet that is launching", async () => {
    const picture = (
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 20 } } })
        .png()
        .toBuffer()
    ).toString("base64");
    const launch = { wallet: creator.address, mint: newActor().address, name: "Pictured", symbol: "PIC", picture };
    await expect(call("launch/build", launch)).rejects.toThrow(/session has ended/);
    await expect(call("launch/build", { ...launch, session: await trader.session() })).rejects.toThrow(/different wallet/);
    expect((await call("launch/build", { ...launch, session: await creator.session() })).transaction).toBeTruthy();
    // Without a picture nothing is stored before the launch, so nothing is asked for.
    expect((await call("launch/build", { wallet: creator.address, mint: newActor().address, name: "Plain", symbol: "PLN" })).transaction).toBeTruthy();
  });
});
