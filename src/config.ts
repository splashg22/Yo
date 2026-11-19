import { PublicKey } from "@solana/web3.js";
import { loadBrand, type Brand } from "./brand.js";

export interface Config {
  /** The coin's public face: name and tickers. Chosen with BRAND=. */
  brand: Brand;
  /** Ticker of the pair token (fees and rewards are paid in it). Display only. */
  quoteSymbol: string;
  /** Ticker of the coin that is bought and burned. Display only. */
  burnSymbol: string;
  /** Ticker of the coin whose holders are paid; empty when unknown. Display only. */
  holderSymbol: string;
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
  swapVenue: "auto" | "pump" | "jupiter";
  jupiterApiUrl: string;
  jupiterApiKey: string | null;
  maxSwapSolCost: string;
  minSolBalance: string;
  discordWebhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  reportTitle: string;
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

/** An amount setting that was renamed: reads the new name, then the old one. */
function renamed(env: Env, name: string, legacy: string, fallback?: string): string {
  return amount(env, env[name]?.trim() ? name : env[legacy]?.trim() ? legacy : name, fallback);
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

function venue(env: Env): Config["swapVenue"] {
  const raw = env.SWAP_VENUE?.trim().toLowerCase() || "auto";
  if (raw === "auto" || raw === "pump" || raw === "jupiter") return raw;
  throw new Error("SWAP_VENUE must be auto, pump or jupiter");
}

export function parseConfig(env: Env, brand: Brand = loadBrand(env.BRAND)): Config {
  const expected = env.EXPECTED_QUOTE_MINT?.trim();
  const strategyMint = address(env, "STRATEGY_MINT");
  // BURN_MINT, else the brand's burn coin, else the coin buys back and burns itself.
  const burnMint = env.BURN_MINT?.trim() ? address(env, "BURN_MINT") : brand.burnMint ? new PublicKey(brand.burnMint).toBase58() : strategyMint;
  const holderMint = env.HOLDER_MINT?.trim() ? address(env, "HOLDER_MINT") : strategyMint;
  const coinSymbol = env.COIN_SYMBOL?.trim() || brand.coinSymbol;
  return {
    brand,
    quoteSymbol: env.QUOTE_SYMBOL?.trim() || brand.quoteSymbol,
    burnSymbol: env.BURN_SYMBOL?.trim() || (burnMint === strategyMint && coinSymbol ? coinSymbol : brand.burnSymbol),
    holderSymbol: env.HOLDER_SYMBOL?.trim() || (holderMint === strategyMint ? coinSymbol : ""),
    rpcUrl: required(env, "RPC_URL"),
    treasuryKeypairPath: required(env, "TREASURY_KEYPAIR_PATH"),
    strategyMint,
    burnMint,
    holderMint,
    expectedQuoteMint: expected ? address(env, "EXPECTED_QUOTE_MINT") : null,
    minHold: amount(env, "MIN_HOLD"),
    excludeWallets: (env.EXCLUDE_WALLETS ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => new PublicKey(w).toBase58()),
    excludeProgramOwned: bool(env, "EXCLUDE_PROGRAM_OWNED", true),
    dryRun: bool(env, "DRY_RUN", true),
    maxSwapPerCycle: renamed(env, "MAX_SWAP_PER_CYCLE", "MAX_SWAP_TTWO_PER_CYCLE"),
    slippageBps: integer(env, "SLIPPAGE_BPS", 300, 0, 5000),
    minClaim: renamed(env, "MIN_CLAIM", "MIN_CLAIM_TTWO", "0"),
    minSwap: renamed(env, "MIN_SWAP", "MIN_SWAP_TTWO", "0"),
    minDistribute: renamed(env, "MIN_DISTRIBUTE", "MIN_DISTRIBUTE_TTWO", "0"),
    minPayout: renamed(env, "MIN_PAYOUT", "MIN_PAYOUT_TTWO", "0"),
    payoutsPerTx: integer(env, "PAYOUTS_PER_TX", 5, 1, 8),
    priorityFeeMicroLamports: integer(env, "PRIORITY_FEE_MICROLAMPORTS", 10000, 0, 5_000_000),
    loopIntervalSeconds: integer(env, "LOOP_INTERVAL_SECONDS", 600, 30, 86_400),
    dataDir: env.DATA_DIR?.trim() || (brand.slug ? `data/${brand.slug}` : "data"),
    swapVenue: venue(env),
    jupiterApiUrl: env.JUPITER_API_URL?.trim() || "https://api.jup.ag/swap/v1",
    jupiterApiKey: env.JUPITER_API_KEY?.trim() || null,
    maxSwapSolCost: amount(env, "MAX_SWAP_SOL_COST", "0.02"),
    minSolBalance: amount(env, "MIN_SOL_BALANCE", "0.05"),
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL?.trim() || null,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    telegramChatId: env.TELEGRAM_CHAT_ID?.trim() || null,
    reportTitle: env.REPORT_TITLE?.trim() || brand.title,
  };
}
