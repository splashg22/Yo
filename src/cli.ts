import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { formatUnits, parseUnits } from "./amounts.js";
import { SolanaChain, loadKeypair } from "./chain.js";
import { parseConfig, type Config } from "./config.js";
import {
  BooksMismatchError,
  LowSolError,
  PendingUnresolvedError,
  runDryCycle,
  runLiveCycle,
  type Check,
  type Deps,
  type Limits,
  type LiveReport,
} from "./cycle.js";
import { FileLedger } from "./ledger.js";
import { Notifier, formatCycleMessage } from "./notify.js";
import { parseLedger, renderHtml, summarize, type Units } from "./report.js";
import { allocate, eligibleHolders, splitClaim } from "./split.js";
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
    split: config.split,
    minHold: parseUnits(config.minHold, info.holderDecimals),
    minSol: parseUnits(config.minSolBalance, 9),
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
  const ownCoin = (amount: bigint) => `${formatUnits(amount, info.strategyDecimals)} of the coin`;
  return { chain, info, limits, deps, dataDir, ttwo, burnCoin, ownCoin };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function printBooks(ctx: Ctx, check: Reconciliation) {
  const { ttwo, burnCoin, ownCoin } = ctx;
  say(`  Treasury holds        ${ttwo(check.quoteHeld)}, ${burnCoin(check.coinHeld)}, ${ownCoin(check.selfHeld)}`);
  say(`  Books account for     ${ttwo(check.quoteBooked)}, ${burnCoin(check.coinBooked)} awaiting burn, ${ownCoin(check.selfBooked)} bought back awaiting burn`);
  if (check.ok) {
    say(`  Books check           OK` + (check.quoteDifference > 0n ? ` (${ttwo(check.quoteDifference)} extra in the wallet is not the bot's and is left alone)` : ""));
  } else {
    say(`  Books check           MISMATCH — the bot will not run live:`);
    for (const problem of check.problems) say(`    - ${problem}`);
  }
}

async function status(config: Config) {
  const ctx = await setup(config);
  const { chain, info, deps, ttwo, burnCoin, ownCoin } = ctx;
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
  say(`Split of every claim    ${config.split.burn}% buy+burn the burn coin, ${config.split.buyback}% buy back+burn the coin, ${config.split.holders}% to holders`);
  say(`Rewards go to holders of ${config.holderMint} with at least ${config.minHold}`);
  if (config.siteUrl) say(`Public site             ${config.siteUrl}`);
  say(`Fees waiting to claim   ${ttwo(fees)}`);
  say(`Books (cycle ${state.cycle})`);
  say(`  Waiting to buy+burn   ${ttwo(BigInt(state.burnPool))}`);
  say(`  Waiting to buy back   ${ttwo(BigInt(state.buybackPool))}`);
  say(`  Waiting for holders   ${ttwo(BigInt(state.payoutPool))}`);
  say(`  Queued payouts        ${state.payoutQueue.length} (${ttwo(bookedQuote(state) - BigInt(state.burnPool) - BigInt(state.buybackPool) - BigInt(state.payoutPool))})`);
  say(`  Bought, not burned    ${burnCoin(BigInt(state.coinToBurn))}, ${ownCoin(BigInt(state.selfToBurn))}`);
  say(`  Lifetime              claimed ${ttwo(BigInt(state.totals.claimed))}, swapped ${ttwo(BigInt(state.totals.swapped))}, burned ${burnCoin(BigInt(state.totals.burned))}, bought back ${ttwo(BigInt(state.totals.boughtBack))}, burned ${ownCoin(BigInt(state.totals.selfBurned))}, paid ${ttwo(BigInt(state.totals.paid))}`);
  if (state.pending) say(`  In flight             ${state.pending.kind} ${state.pending.signature}`);
  printBooks(ctx, reconcile(state, held.quote, held.coin, held.self));
}

const mark = (check: Check) => ({ pass: "PASS", fail: "FAIL", not_tested: "NOT TESTED" })[check.result];

async function cycleOnce(config: Config, ctx: Ctx): Promise<LiveReport | null> {
  const { deps, ttwo, burnCoin, ownCoin, limits } = ctx;
  if (config.dryRun) {
    const report = await runDryCycle(deps, Keypair.generate().publicKey.toBase58());
    say("DRY RUN — nothing was sent and no file was changed.");
    say();
    printBooks(ctx, report.reconciliation);
    if (report.pendingStatus) say(`  A transaction from an earlier live run is ${report.pendingStatus}.`);
    if (report.lowSol) say(`  SOL                   LOW — ${formatUnits(report.held.sol, 9)} SOL is below MIN_SOL_BALANCE (${config.minSolBalance}); a live cycle would be skipped`);
    say();
    say(`Fees waiting to claim: ${ttwo(report.fees)}`);
    say(`  Claim                 ${mark(report.claim)} — ${report.claim.detail}`);
    say(`  Split                 ${ttwo(report.wouldSplit.burn)} to buy+burn the burn coin (${limits.split.burn}%), ${ttwo(report.wouldSplit.buyback)} to buy back the coin (${limits.split.buyback}%), ${ttwo(report.wouldSplit.payout)} to holders (${limits.split.holders}%)`);
    say(`  Would swap this cycle ${ttwo(report.burn.amount)} for the burn coin (cap ${ttwo(limits.maxSwapPerCycle)})` + (report.burn.expectedOut !== null ? `, burning about ${burnCoin(report.burn.expectedOut)}` : ""));
    say(`  Would buy back        ${ttwo(report.buyback.amount)} of the coin (cap ${ttwo(limits.maxSwapPerCycle)})` + (report.buyback.expectedOut !== null ? `, burning about ${ownCoin(report.buyback.expectedOut)}` : ""));
    say(`  Would pay             ${ttwo(report.wouldPay.reduce((a, p) => a + p.amount, 0n))} of ${ttwo(report.payoutPool)} to ${report.wouldPay.length} holders`);
    for (const p of report.wouldPay.slice(0, 10)) say(`    ${p.owner}  ${ttwo(p.amount)}`);
    if (report.wouldPay.length > 10) say(`    … and ${report.wouldPay.length - 10} more`);
    say();
    say("Checks");
    say(`  (a) TTWO -> burn coin route   ${mark(report.burn.route)} — ${report.burn.route.detail}`);
    say(`      swap simulation           ${mark(report.burn.swap)} — ${report.burn.swap.detail}`);
    say(`  (a2) TTWO -> own coin route   ${mark(report.buyback.route)} — ${report.buyback.route.detail}`);
    say(`      buyback simulation        ${mark(report.buyback.swap)} — ${report.buyback.swap.detail}`);
    say(`  (b) TTWO payout to a wallet   ${mark(report.payout)} — ${report.payout.detail}`);
    say(`  (c) holder snapshot           ${mark(report.snapshot)} — ${report.snapshot.detail}`);
    return null;
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
    say(`  Claimed ${ttwo(report.claimed)} · swapped ${ttwo(report.swapped)} · burned ${burnCoin(report.burned)} · bought back ${ttwo(report.boughtBack)} · burned ${ownCoin(report.selfBurned)} · paid ${ttwo(report.paid)} to ${report.recipients} holders`);
    for (const tx of report.signatures) say(`  ${tx.kind.padEnd(12)} ${tx.outcome.padEnd(10)} https://solscan.io/tx/${tx.signature}`);
    for (const s of report.skipped) say(`  skipped ${s.owner} (${ttwo(BigInt(s.amount))} returned to the pool): ${s.reason}`);
    for (const note of report.notes) say(`  note: ${note}`);
    return report;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Re-checks every transaction of one cycle (default: the latest) on-chain. */
async function verify(config: Config, cycleArg?: string) {
  const ctx = await setup(config);
  const file = path.join(ctx.dataDir, "ledger.jsonl");
  if (!fs.existsSync(file)) throw new Error("there is no ledger yet: no live cycle has run");
  const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; cycle: number; signature?: string; [key: string]: unknown });
  const cycle = cycleArg ? Number(cycleArg) : Math.max(...entries.map((e) => e.cycle));
  const rows = entries.filter((e) => e.cycle === cycle && e.signature);
  if (rows.length === 0) throw new Error(`cycle ${cycle} has no transactions in the ledger`);
  say(`Cycle ${cycle}: ${rows.length} transaction(s)`);
  let problems = 0;
  for (const row of rows) {
    const signature = row.signature!;
    const { value } = await ctx.chain.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = value[0];
    const expectFailure = row.type === "tx_failed" || row.type === "tx_expired";
    let verdict: string;
    let bad = false;
    if (!status) {
      bad = !expectFailure;
      verdict = expectFailure ? "not on chain (as recorded)" : "NOT FOUND ON CHAIN";
    } else if (status.err) {
      bad = !expectFailure;
      verdict = expectFailure ? "failed on chain (as recorded)" : `FAILED ON CHAIN ${JSON.stringify(status.err)}`;
    }
    else {
      verdict = `${status.confirmationStatus ?? "confirmed"}`;
      // Compare what the ledger says moved with what the chain says moved.
      const moved = await ctx.chain.deltas(signature);
      // [TTWO, burn coin, strategy coin] the ledger says this transaction moved.
      const expected: Record<string, [bigint, bigint, bigint] | undefined> = {
        claim: [BigInt(String(row.claimed ?? 0)), 0n, 0n],
        swap: [-BigInt(String(row.spent ?? 0)), BigInt(String(row.bought ?? 0)), 0n],
        burn: [0n, -BigInt(String(row.burned ?? 0)), 0n],
        buyback: [-BigInt(String(row.spent ?? 0)), 0n, BigInt(String(row.bought ?? 0))],
        buyback_burn: [0n, 0n, -BigInt(String(row.burned ?? 0))],
        payout: [-(row.payouts as { amount: string }[] | undefined ?? []).reduce((a, p) => a + BigInt(p.amount), 0n), 0n, 0n],
      };
      const want = expected[row.type];
      if (want && (want[0] !== moved.quote || want[1] !== moved.coin || want[2] !== moved.self)) {
        bad = true;
        verdict += ` BUT AMOUNTS DIFFER: ledger TTWO ${want[0]} / burn coin ${want[1]} / own coin ${want[2]}, chain ${moved.quote} / ${moved.coin} / ${moved.self}`;
      } else if (want) verdict += ", amounts match the ledger";
    }
    if (bad) problems += 1;
    say(`  ${row.type.padEnd(13)} ${verdict}`);
    say(`             https://solscan.io/tx/${signature}`);
  }
  say(problems === 0 ? "All transactions check out." : `${problems} PROBLEM(S) — do not run another cycle until this is understood.`);
  if (problems > 0) process.exit(2);
}

function writeReport(config: Config, ctx: Ctx): string | null {
  const file = path.join(ctx.dataDir, "ledger.jsonl");
  if (!fs.existsSync(file)) return null;
  const units: Units = {
    quoteDecimals: ctx.info.quoteDecimals, burnDecimals: ctx.info.burnDecimals, quoteSymbol: "TTWO", burnSymbol: "DCTY",
    strategyDecimals: ctx.info.strategyDecimals, strategySymbol: process.env.HOLDER_SYMBOL?.trim() || "of the coin",
  };
  const summary = summarize(parseLedger(fs.readFileSync(file, "utf8")), units);
  const out = path.join(ctx.dataDir, "report.html");
  fs.writeFileSync(out, renderHtml(summary, units, {
    title: config.reportTitle, treasury: ctx.chain.treasury.toBase58(), generated: new Date().toISOString(),
  }));
  fs.writeFileSync(
    path.join(ctx.dataDir, "summary.json"),
    JSON.stringify(summary, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2),
  );
  return out;
}

/** Public stats page + summary.json, built from the ledger. */
async function report(config: Config) {
  const out = writeReport(config, await setup(config));
  say(out ? `Wrote ${out} and summary.json next to it.` : "There is no ledger yet: no live cycle has run.");
}

/** Read-only preview of who would be paid and how much. Writes data/holders.csv. */
async function holders(config: Config) {
  const ctx = await setup(config);
  const { chain, limits, deps, ttwo } = ctx;
  const state = deps.store.load(chain.mints());
  const [snapshot, fees] = await Promise.all([chain.snapshotHolders(), chain.pendingFees()]);
  const qualifying = eligibleHolders(snapshot.balances, limits.minHold, snapshot.excluded);
  const pool = BigInt(state.payoutPool) + splitClaim(fees, limits.split).payout;
  const { payouts } = allocate(pool, qualifying, limits.minPayout);
  const share = new Map(payouts.map((p) => [p.owner, p.amount]));
  const total = qualifying.reduce((a, h) => a + h.amount, 0n);
  say(`${snapshot.balances.size} holders found via ${snapshot.source}; ${qualifying.length} hold at least ${config.minHold}; ${snapshot.excluded.size} excluded.`);
  say(`If a cycle ran now, ${ttwo(pool)} would be shared between ${payouts.length} of them.`);
  for (const h of qualifying.slice(0, 20)) {
    const percent = total > 0n ? Number((h.amount * 10_000n) / total) / 100 : 0;
    say(`  ${h.owner}  ${formatUnits(h.amount, ctx.info.holderDecimals).padStart(18)}  ${percent.toFixed(2).padStart(6)}%  ${ttwo(share.get(h.owner) ?? 0n)}`);
  }
  if (qualifying.length > 20) say(`  … and ${qualifying.length - 20} more`);
  const csv = ["wallet,balance,would_receive_ttwo"]
    .concat(qualifying.map((h) => `${h.owner},${formatUnits(h.amount, ctx.info.holderDecimals)},${formatUnits(share.get(h.owner) ?? 0n, ctx.info.quoteDecimals)}`));
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  const out = path.join(ctx.dataDir, "holders.csv");
  fs.writeFileSync(out, `${csv.join("\n")}\n`);
  say(`Full list written to ${out}`);
}

async function loop(config: Config) {
  const notifier = new Notifier(config, fetch, (message) => console.error(message));
  if (notifier.enabled) say("Alerts are on.");
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
      const ctx = await setup(config);
      const result = await cycleOnce(config, ctx);
      notifier.clearError();
      if (result) {
        writeReport(config, ctx);
        const message = formatCycleMessage(result, ctx.info, config.siteUrl);
        if (message) await notifier.send(message);
      }
    } catch (error) {
      if (error instanceof BooksMismatchError) {
        // Never keep trading on books that do not add up.
        await notifier.send(`STOPPED: ${error.message} The bot will not restart by itself.`);
        console.error(error.message);
        console.error("Stopping the loop. Nothing was sent. Find out why before restarting.");
        process.exit(2);
      }
      console.error(`cycle failed: ${(error as Error).message}`);
      await notifier.error((error as Error).message);
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
  else if (command === "verify") await verify(config, process.argv[3]);
  else if (command === "report") await report(config);
  else if (command === "holders") await holders(config);
  else throw new Error("usage: tsx src/cli.ts status | cycle | loop | verify [cycle] | report | holders");
}

main().catch((error: unknown) => {
  if (error instanceof BooksMismatchError || error instanceof PendingUnresolvedError || error instanceof LowSolError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
