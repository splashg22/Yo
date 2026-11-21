/**
 * A runnable example: two wallets, a launch, a deposit and a Ring transfer, from a script.
 * Needs the local validator and the site running:  npm run local  and  npm run dev
 * Then:  npm run example            (set SITE_URL if the site is not on port 4710)
 * The same function runs inside the flow tests, so it cannot fall out of step with the code.
 */
import { NATIVE } from "../lib/constants";
import { formatCoin, formatSol } from "../lib/format";
import { newActor } from "../lib/keys";
import { RingClient, httpTransport, type Transport } from "../lib/sdk";

export async function launchAndTransfer(transport: Transport, say: (line: string) => void = console.log) {
  const mara = new RingClient(transport, newActor());
  const ilya = new RingClient(transport, newActor());

  // Test SOL from the local faucet. On a real network a wallet is funded like any other.
  await transport("faucet", { wallet: mara.address });
  await transport("faucet", { wallet: ilya.address });
  await ilya.register();

  // One signature: create the coin on the curve, register it with the Ring, and put a first buy into the Ring.
  const coin = await mara.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: 20_000_000n, toRing: true });
  say(`launched ${coin.mint}`);
  say(`first buy: ${formatCoin(coin.mint, coin.firstBuyTokens, 2)} LNTRN, in Mara's Ring balance`);

  // A Ring transfer: both wallets are public, the coin and the amount are not.
  const amount = 250_000_000_000n;
  const sent = await mara.transfer(ilya.address, coin.mint, amount, "for the poster");
  say(`public part of the transfer: ${JSON.stringify(sent.public)}`);
  say(`Ilya's Ring balance: ${formatCoin(coin.mint, await ilya.ringBalance(coin.mint))} LNTRN`);
  say(`Mara's wallet still holds ${formatSol(await mara.publicBalance(NATIVE))} in public`);
  return { mara, ilya, coin, amount, sent };
}

// Run directly: talk to a running site.
if (process.argv[1]?.endsWith("launch-and-transfer.ts")) {
  const site = process.env.SITE_URL ?? "http://localhost:4710";
  const { coin } = await launchAndTransfer(httpTransport(site));
  console.log(`receipt: ${site}/tx/${coin.signature}`);
}
