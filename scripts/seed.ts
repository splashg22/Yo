/**
 * Fills a local chain with something to look at: a few coins, and a run of buys and sells from several
 * wallets on the first of them. For looking at the screens by hand and for the screenshots.
 *   CHECK_URL=http://localhost:4711 npx tsx scripts/seed.ts [trades]
 * Local validator only: it uses the local faucet.
 */
import { newActor } from "../lib/keys";
import { RingClient, type Transport } from "../lib/sdk";

const base = process.env.CHECK_URL ?? "http://localhost:4710";
const trades = Number(process.argv[2] ?? 40);
const call: Transport = async (name, input = {}) => {
  const response = await fetch(`${base}/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(`${name}: ${body.error}`);
  return body as never;
};
const SOL = 1_000_000_000n;
const wallets = await Promise.all(
  Array.from({ length: 6 }, async () => {
    const client = new RingClient(call, newActor());
    await call("faucet", { wallet: client.address });
    return client;
  }),
);
const creator = wallets[0]!;
const coins = [];
for (const [name, symbol, firstBuy] of [
  ["Lantern", "LNTRN", SOL / 50n],
  ["Moth", "MOTH", SOL / 100n],
  ["Quill", "QUILL", 0n],
  ["Harbour", "HRBR", SOL / 200n],
] as const) {
  const launched = await creator.launch({ name, symbol, ...(firstBuy > 0n ? { firstBuyLamports: firstBuy } : {}) });
  coins.push({ ...launched, symbol });
  console.log("launched", symbol, launched.mint);
}
const main = coins[0]!;
const held = new Map<string, bigint>();
for (let index = 0; index < trades; index++) {
  const who = wallets[1 + (index % 5)]!;
  const mine = held.get(who.address) ?? 0n;
  // Mostly buys of uneven size; a sell now and then from whoever holds some.
  const sell = mine > 0n && index % 4 === 3;
  try {
    if (sell) {
      const amount = mine / BigInt(2 + (index % 3));
      await who.trade(main.mint, "sell", amount);
      held.set(who.address, mine - amount);
    } else {
      const bought = await who.trade(main.mint, "buy", (SOL * BigInt(2 + ((index * 7) % 9))) / 1000n);
      held.set(who.address, mine + bought.expected);
    }
  } catch (error) {
    console.log("trade skipped:", error instanceof Error ? error.message : String(error));
  }
}
await wallets[2]!.trade(coins[1]!.mint, "buy", SOL / 40n);
await wallets[3]!.trade(coins[3]!.mint, "buy", SOL / 30n);
console.log(JSON.stringify({ main: main.mint, coins: coins.map((coin) => coin.mint) }));
