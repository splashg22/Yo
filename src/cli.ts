import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { formatUnits, parseUnits } from "./amounts.js";
import { SolanaChain, loadKeypair } from "./chain.js";
import { parseConfig, type Config } from "./config.js";
import {
  BooksMismatchError,
  PendingUnresolvedError,
  runDryCycle,
  runLiveCycle,
  type Check,
  type Deps,
  type Limits,
} from "./cycle.js";
import { FileLedger } from "./ledger.js";
import { FileStateStore, bookedQuote, reconcile, type Reconciliation } from "./state.js";

const say = (line = "") => console.log(line);

async function setup(config: Config) {
  const dataDir = path.resolve(config.dataDir);
  const keyPath = path.resolve(config.treasuryKeypairPath);
  if (keyPath.startsWith(path.resolve(".") + path.sep)) {
    throw new Error("TREASURY_KEYPAIR_PATH points inside this folder. Keep the key file outside it.");
  }
  const chain = new SolanaChain(config, loadKeypair(keyPath));
  const info = await chain.init();
  const limits: Limits = {
    dryRun: config.dryRun,
    minHold: parseUnits(config.minHold, info.holderDecimals),
    maxSwapPerCycle: parseUnits(config.maxSwapPerCycle, info.quoteDecimals),
    minClaim: parseUnits(config.minClaim, info.quoteDecimals),
    minSwap: parseUnits(config.minSwap, info.quoteDecimals),
    minDistribute: parseUnits(config.minDistribute, info.quoteDecimals),
    minPayout: parseUnits(config.minPayout, info.quoteDecimals),
    payoutsPerTx: config.payoutsPerTx,
  };
  const deps: Deps = {
    chain,
    store: new FileStateStore(dataDir),
    ledger: new FileLedger(dataDir),
    limits,
    log: (message) => say(`  · ${message}`),
  };
  const ttwo = (amount: bigint) => `${formatUnits(amount, info.quoteDecimals)} TTWO`;
  const burnCoin = (amount: bigint) => `${formatUnits(amount, info.burnDecimals)} burn coin`;
  return { chain, info, limits, deps, dataDir, ttwo, burnCoin };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function printBooks(ctx: Ctx, check: Reconciliation) {
  const { ttwo, burnCoin } = ctx;
  say(`  Treasury holds        ${ttwo(check.quoteHeld)}, ${burnCoin(check.coinHeld)}`);
  say(`  Books account for     ${ttwo(check.quoteBooked)}, ${burnCoin(check.coinBooked)} awaiting burn`);
  if (check.ok) {
    say(`  Books check           OK` + (check.quoteDifference > 0n ? ` (${ttwo(check.quoteDifference)} extra in the wallet is not the bot's and is left alone)` : ""));
  } else {
    say(`  Books check           MISMATCH — the bot will not run live:`);
    for (const problem of check.problems) say(`    - ${problem}`);
  }
}

async function status(config: Config) {
  const ctx = await setup(config);
  const { chain, info, deps, ttwo, burnCoin } = ctx;
  const state = deps.store.load(chain.mints());
  const [held, fees] = await Promise.all([chain.balances(), chain.pendingFees()]);
  say(`Mode                    ${config.dryRun ? "DRY RUN (nothing is sent)" : "LIVE"}`);
  say(`Treasury                ${chain.treasury.toBase58()}`);
  say(`  SOL                   ${formatUnits(held.sol, 9)}`);
  say(`Strategy coin           ${config.strategyMint}`);
  say(`  Paired with (TTWO)    ${info.quoteMint.toBase58()}`);
  say(`  Stage                 ${info.curve.complete ? "graduated to the pump pool" : "on the bonding curve"}`);
  const creatorOk = info.curve.creator.equals(chain.treasury);
  say(`  Fees go to treasury   ${creatorOk ? "yes" : `NO — the coin's fee recipient is ${info.curve.creator.toBase58()}`}`);
  if (info.curve.isHolderReward) say(`  WARNING               this coin was created with Holder Rewards, not Creator Fee`);
  say(`Burn coin               ${config.burnMint}`);
  say(`Rewards go to holders of ${config.holderMint} with at least ${config.minHold}`);
  say(`Fees waiting to claim   ${ttwo(fees)}`);
  say(`Books (cycle ${state.cycle})`);
  say(`  Waiting to buy+burn   ${ttwo(BigInt(state.burnPool))}`);
  say(`  Waiting for holders   ${ttwo(BigInt(state.payoutPool))}`);
  say(`  Queued payouts        ${state.payoutQueue.length} (${ttwo(bookedQuote(state) - BigInt(state.burnPool) - BigInt(state.payoutPool))})`);
  say(`  Bought, not burned    ${burnCoin(BigInt(state.coinToBurn))}`);
  say(`  Lifetime              claimed ${ttwo(BigInt(state.totals.claimed))}, swapped ${ttwo(BigInt(state.totals.swapped))}, burned ${burnCoin(BigInt(state.totals.burned))}, paid ${ttwo(BigInt(state.totals.paid))}`);
  if (state.pending) say(`  In flight             ${state.pending.kind} ${state.pending.signature}`);
  printBooks(ctx, reconcile(state, held.quote, held.coin));
}

const mark = (check: Check) => ({ pass: "PASS", fail: "FAIL", not_tested: "NOT TESTED" })[check.result];

async function cycleOnce(config: Config, ctx: Ctx) {
  const { deps, ttwo, burnCoin, limits } = ctx;
  if (config.dryRun) {
    const report = await runDryCycle(deps, Keypair.generate().publicKey.toBase58());
    say("DRY RUN — nothing was sent and no file was changed.");
    say();
    printBooks(ctx, report.reconciliation);
    if (report.pendingStatus) say(`  A transaction from an earlier live run is ${report.pendingStatus}.`);
    say();
    say(`Fees waiting to claim: ${ttwo(report.fees)}`);
    say(`  Claim                 ${mark(report.claim)} — ${report.claim.detail}`);
    say(`  Split                 ${ttwo(report.wouldSplit.burn)} to buy+burn, ${ttwo(report.wouldSplit.payout)} to holders`);
    say(`  Would swap this cycle ${ttwo(report.wouldSwap)} (cap ${ttwo(limits.maxSwapPerCycle)})` + (report.expectedBurn !== null ? `, burning about ${burnCoin(report.expectedBurn)}` : ""));
    say(`  Would pay             ${ttwo(report.wouldPay.reduce((a, p) => a + p.amount, 0n))} of ${ttwo(report.payoutPool)} to ${report.wouldPay.length} holders`);
    for (const p of report.wouldPay.slice(0, 10)) say(`    ${p.owner}  ${ttwo(p.amount)}`);
    if (report.wouldPay.length > 10) say(`    … and ${report.wouldPay.length - 10} more`);
    say();
    say("Checks");
    say(`  (a) TTWO -> burn coin route   ${mark(report.route)} — ${report.route.detail}`);
    say(`      swap simulation           ${mark(report.swap)} — ${report.swap.detail}`);
    say(`  (b) TTWO payout to a wallet   ${mark(report.payout)} — ${report.payout.detail}`);
    say(`  (c) holder snapshot           ${mark(report.snapshot)} — ${report.snapshot.detail}`);
    return;
  }

  const lock = path.join(ctx.dataDir, ".lock");
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error(`another run seems to be in progress (${lock} exists). Delete that file only if no bot process is running.`);
  }
  try {
    const report = await runLiveCycle(deps);
    say(`LIVE cycle ${report.cycle}`);
    say(`  Claimed ${ttwo(report.claimed)} · swapped ${ttwo(report.swapped)} · burned ${burnCoin(report.burned)} · paid ${ttwo(report.paid)} to ${report.recipients} holders`);
    for (const tx of report.signatures) say(`  ${tx.kind.padEnd(7)} ${tx.outcome.padEnd(10)} https://solscan.io/tx/${tx.signature}`);
    for (const s of report.skipped) say(`  skipped ${s.owner} (${ttwo(BigInt(s.amount))} returned to the pool): ${s.reason}`);
    for (const note of report.notes) say(`  note: ${note}`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

async function loop(config: Config) {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      say(`${signal} received: stopping after the current step`);
      stopping = true;
    });
  }
  while (!stopping) {
    say(`--- ${new Date().toISOString()} ---`);
    try {
      await cycleOnce(config, await setup(config));
    } catch (error) {
      if (error instanceof BooksMismatchError) {
        // Never keep trading on books that do not add up.
        console.error(error.message);
        console.error("Stopping the loop. Nothing was sent. Find out why before restarting.");
        process.exit(2);
      }
      console.error(`cycle failed: ${(error as Error).message}`);
    }
    for (let waited = 0; waited < config.loopIntervalSeconds && !stopping; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  const command = process.argv[2];
  const config = parseConfig(process.env);
  if (command === "status") await status(config);
  else if (command === "cycle") await cycleOnce(config, await setup(config));
  else if (command === "loop") await loop(config);
  else throw new Error("usage: tsx src/cli.ts status | cycle | loop");
}

main().catch((error: unknown) => {
  if (error instanceof BooksMismatchError || error instanceof PendingUnresolvedError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
