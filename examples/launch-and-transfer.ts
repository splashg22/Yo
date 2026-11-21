/**
 * A runnable example: two wallets, a launch, a deposit and a Ring transfer, from a script.
 * Needs the local validator and the site running:  npm run local  and  npm run dev
 * Then:  npm run example            (set SITE_URL if the site is not on port 3000)
 */
import { NATIVE } from "../lib/constants";
import { formatCoin, formatSol } from "../lib/format";
import { newActor } from "../lib/keys";
import { RingClient, httpTransport } from "../lib/sdk";

const transport = httpTransport(process.env.SITE_URL ?? "http://localhost:3000");
const mara = new RingClient(transport, newActor());
const ilya = new RingClient(transport, newActor());

// Test SOL from the local faucet. On a real network a wallet is funded like any other.
await transport("faucet", { wallet: mara.address });
await transport("faucet", { wallet: ilya.address });
await ilya.register();

// One signature: create the coin on the curve, register it with the Ring, and put a first buy into the Ring.
const coin = await mara.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: 20_000_000n, toRing: true });
console.log(`launched ${coin.mint}`);
console.log(`first buy: ${formatCoin(coin.mint, coin.firstBuyTokens, 2)} LNTRN, in Mara's Ring balance`);

// A Ring transfer: both wallets are public, the coin and the amount are sealed.
const sent = await mara.transfer(ilya.address, coin.mint, 250_000_000_000n, "for the poster");
console.log("public part of the transfer:", sent.public);
console.log(`Ilya's Ring balance: ${formatCoin(coin.mint, await ilya.ringBalance(coin.mint))} LNTRN`);
console.log(`Mara's wallet still holds ${formatSol(await mara.publicBalance(NATIVE))} in public`);
console.log(`receipt: ${process.env.SITE_URL ?? "http://localhost:3000"}/tx/${coin.signature}`);
