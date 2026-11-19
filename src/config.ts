import { PublicKey } from "@solana/web3.js";

export interface Config {
  rpcUrl: string;
  treasuryKeypairPath: string;
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  expectedQuoteMint: string | null;
  /** Whole tokens, as typed. Converted to base units once decimals are known. */
  minHold: string;
  excludeWallets: string[];
  excludeProgramOwned: boolean;
  dryRun: boolean;
  maxSwapPerCycle: string;
  slippageBps: number;
  minClaim: string;
  minSwap: string;
  minDistribute: string;
  minPayout: string;
  payoutsPerTx: number;
  priorityFeeMicroLamports: number;
  loopIntervalSeconds: number;
  dataDir: string;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

function address(env: Env, name: string): string {
  const value = required(env, name);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${name} is not a valid Solana address`);
  }
}

function amount(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`${name} is not set in .env`);
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`${name} must be a plain number, got "${value}"`);
  return value;
}

function integer(env: Env, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}`);
  }
  return value;
}

/** DRY_RUN is live only for the exact word "false". Anything else is a dry run. */
function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function parseConfig(env: Env): Config {
  const expected = env.EXPECTED_QUOTE_MINT?.trim();
  return {
    rpcUrl: required(env, "RPC_URL"),
    treasuryKeypairPath: required(env, "TREASURY_KEYPAIR_PATH"),
    strategyMint: address(env, "STRATEGY_MINT"),
    burnMint: address(env, "BURN_MINT"),
    holderMint: address(env, "HOLDER_MINT"),
    expectedQuoteMint: expected ? address(env, "EXPECTED_QUOTE_MINT") : null,
    minHold: amount(env, "MIN_HOLD"),
    excludeWallets: (env.EXCLUDE_WALLETS ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => new PublicKey(w).toBase58()),
    excludeProgramOwned: bool(env, "EXCLUDE_PROGRAM_OWNED", true),
    dryRun: bool(env, "DRY_RUN", true),
    maxSwapPerCycle: amount(env, "MAX_SWAP_TTWO_PER_CYCLE"),
    slippageBps: integer(env, "SLIPPAGE_BPS", 300, 0, 5000),
    minClaim: amount(env, "MIN_CLAIM_TTWO", "0"),
    minSwap: amount(env, "MIN_SWAP_TTWO", "0"),
    minDistribute: amount(env, "MIN_DISTRIBUTE_TTWO", "0"),
    minPayout: amount(env, "MIN_PAYOUT_TTWO", "0"),
    payoutsPerTx: integer(env, "PAYOUTS_PER_TX", 5, 1, 8),
    priorityFeeMicroLamports: integer(env, "PRIORITY_FEE_MICROLAMPORTS", 10000, 0, 5_000_000),
    loopIntervalSeconds: integer(env, "LOOP_INTERVAL_SECONDS", 600, 30, 86_400),
    dataDir: env.DATA_DIR?.trim() || "data",
  };
}
