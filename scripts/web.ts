/**
 * Prepares the public proof page in web/ for hosting.
 *
 *   npm run web
 *
 * Writes web/config.json (public addresses and settings only, never a secret)
 * and copies the public ledger next to the page so visitors can check the
 * bot's own books against the chain. The page itself reads the blockchain
 * directly in the visitor's browser.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { loadKeypair, resolvePair } from "../src/chain.js";
import { parseConfig, type Config } from "../src/config.js";
import { DEFAULT_SPLIT, type Split } from "../src/split.js";

export const DEFAULT_PUBLIC_RPC = "https://solana-rpc.publicnode.com";

export interface WebConfig {
  title: string;
  treasury: string;
  strategyMint: string;
  /** Short name of the strategy coin, shown next to buyback amounts. */
  strategySymbol: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string | null;
  split: Split;
  minHold: string;
  holderSymbol: string;
  rpcUrl: string;
  repoUrl: string | null;
}

/** Only public facts go in here: the page is served to everyone. */
export function webConfig(
  config: Pick<Config, "strategyMint" | "burnMint" | "holderMint" | "minHold" | "expectedQuoteMint" | "reportTitle"> & { split?: Split },
  treasury: string,
  extra: { quoteMint?: string | null; publicRpcUrl?: string; holderSymbol?: string; repoUrl?: string | null } = {},
): WebConfig {
  const publicRpcUrl = extra.publicRpcUrl?.trim() || DEFAULT_PUBLIC_RPC;
  if (!/^https:\/\//.test(publicRpcUrl)) throw new Error("PUBLIC_RPC_URL must start with https://");
  const holderSymbol = extra.holderSymbol?.trim() || "";
  return {
    title: config.reportTitle,
    treasury,
    strategyMint: config.strategyMint,
    strategySymbol: (config.holderMint === config.strategyMint && holderSymbol) || config.reportTitle,
    burnMint: config.burnMint,
    holderMint: config.holderMint,
    quoteMint: extra.quoteMint ?? config.expectedQuoteMint ?? null,
    split: config.split ?? DEFAULT_SPLIT,
    minHold: config.minHold,
    holderSymbol: holderSymbol || (config.holderMint === config.strategyMint ? "strategy coin" : "coins"),
    rpcUrl: publicRpcUrl,
    repoUrl: extra.repoUrl?.trim() || null,
  };
}

/** The token the coin is paired with (TTWO): from the books if the bot has run, else read from the chain. */
async function findQuoteMint(config: Config, treasury: string): Promise<string | null> {
  const statePath = path.join(path.resolve(config.dataDir), "state.json");
  if (fs.existsSync(statePath)) {
    const quote = (JSON.parse(fs.readFileSync(statePath, "utf8")) as { quoteMint?: string }).quoteMint;
    if (quote) return quote;
  }
  try {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const pair = await resolvePair(new OnlinePumpSdk(connection), new PublicKey(config.strategyMint), config.expectedQuoteMint);
    return pair.quoteMint.toBase58();
  } catch (error) {
    console.warn(`Could not read the pair token from the chain (${(error as Error).message}); the page will work it out from payouts.`);
    return config.expectedQuoteMint;
  }
}

async function main() {
  const repo = process.cwd();
  const webDir = path.join(repo, "web");
  const config = parseConfig(process.env);
  const treasury = loadKeypair(path.resolve(config.treasuryKeypairPath)).publicKey.toBase58();
  const quoteMint = await findQuoteMint(config, treasury);
  const out = webConfig(config, treasury, {
    quoteMint,
    publicRpcUrl: process.env.PUBLIC_RPC_URL,
    holderSymbol: process.env.HOLDER_SYMBOL,
    repoUrl: process.env.REPO_URL,
  });
  if (out.rpcUrl === process.env.RPC_URL?.trim() && /api-key|apikey|key=|\/[A-Za-z0-9_-]{20,}$/.test(out.rpcUrl)) {
    throw new Error("PUBLIC_RPC_URL looks like it carries an API key. Use a key-free public endpoint for the page.");
  }
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, "config.json"), `${JSON.stringify(out, null, 2)}\n`);
  const ledger = path.join(path.resolve(config.dataDir), "ledger.jsonl");
  const published = path.join(webDir, "ledger.jsonl");
  if (fs.existsSync(ledger)) fs.copyFileSync(ledger, published);
  else fs.rmSync(published, { force: true });
  console.log(`web/config.json written for treasury ${treasury}${out.quoteMint ? "" : " (TTWO mint not known yet: the page will read it from the chain)"}.`);
  console.log(fs.existsSync(ledger) ? "web/ledger.jsonl refreshed from data/ledger.jsonl." : "No ledger yet; the page will show chain data only.");
  console.log("Host the web/ folder anywhere static (see README: Public proof page).");
}

if (process.argv[1] && /web\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
