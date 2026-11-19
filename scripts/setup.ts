/**
 * Guided setup. Add a coin's name (a file in brands/) for any coin but the
 * default one, e.g. `npm run setup:wallet llm`.
 *
 *   npm run setup:wallet [coin]   create the treasury wallet (outside this folder)
 *   npm run setup:env [coin]      create the settings file by asking a few questions
 *
 * The private key and seed phrase are never read, printed or copied by this
 * script: solana-keygen writes them itself, straight to your terminal/file.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_BRAND, listBrands, loadBrand, type Brand } from "../src/brand.js";
import { envFileFor } from "../src/env.js";

const repo = path.resolve(__dirname, "..");
/** One treasury per coin: two coins sharing a wallet would mix their fees. */
const keyPathFor = (brand: Brand) =>
  path.join(os.homedir(), ".config", "dacity-bot", brand.name === DEFAULT_BRAND ? "treasury.json" : `treasury-${brand.name}.json`);

/** Takes the coin's name out of the arguments (default: the default brand). */
function takeBrand(args: string[]): Brand {
  const brands = listBrands(repo);
  const index = args.findIndex((a) => brands.includes(a));
  return loadBrand(index >= 0 ? args.splice(index, 1)[0] : DEFAULT_BRAND, repo);
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function insideRepo(file: string): boolean {
  return path.resolve(file).startsWith(repo + path.sep);
}

function publicAddress(keyPath: string): string {
  const bytes = JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
}

function wallet(args: string[]) {
  const brand = takeBrand(args);
  const coin = brand.name === DEFAULT_BRAND ? "" : ` ${brand.name}`;
  const useNode = args.includes("--node");
  const keyPath = path.resolve(args.find((a) => !a.startsWith("--")) ?? keyPathFor(brand));
  if (insideRepo(keyPath)) fail("Choose a path outside this folder so the key can never be committed.");
  if (fs.existsSync(keyPath)) {
    console.log(`A wallet already exists at ${keyPath}. It was left untouched.`);
    console.log(`Treasury address: ${publicAddress(keyPath)}`);
    return;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });

  const hasKeygen = spawnSync("solana-keygen", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasKeygen && !useNode) {
    console.log("solana-keygen will now show a SEED PHRASE. Write it down on paper and keep it offline.");
    console.log("Anyone who has it controls the treasury. Never paste it anywhere.\n");
    const result = spawnSync("solana-keygen", ["new", "--outfile", keyPath], { stdio: "inherit" });
    if (result.status !== 0) fail("solana-keygen did not finish. No wallet was created.");
  } else if (useNode) {
    // No seed phrase in this mode: the file itself is the only copy of the key.
    fs.writeFileSync(keyPath, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600, flag: "wx" });
    console.log("Wallet created without a seed phrase. The key file is the ONLY copy: back it up somewhere safe and offline.");
  } else {
    fail(
      "solana-keygen is not installed.\n" +
        "Install the Solana CLI (https://solana.com/docs/intro/installation) and run this again,\n" +
        `or run \`npm run setup:wallet${coin} -- --node\` to create the key file without a seed phrase.`,
    );
  }
  fs.chmodSync(keyPath, 0o600);
  console.log(`\nKey file:         ${keyPath}`);
  console.log(`Treasury address: ${publicAddress(keyPath)}`);
  console.log(`\nNext: fund that address with SOL, launch ${brand.title} on pump.fun FROM this wallet`);
  console.log(`(${brand.quoteSymbol} pair = ${brand.quoteName}, Creator Fee, not Holder Rewards), then run \`npm run setup:env${coin}\`.`);
}

async function env(args: string[]) {
  const brand = takeBrand(args);
  const coin = brand.name === DEFAULT_BRAND ? "" : ` ${brand.name}`;
  const defaultKeyPath = keyPathFor(brand);
  const envPath = envFileFor(brand.name, repo);
  const envName = path.basename(envPath);
  if (fs.existsSync(envPath)) fail(`${envName} already exists. It was left untouched; edit it directly or delete it first.`);
  console.log(`Settings for ${brand.title} (paired with ${brand.quoteSymbol}, ${brand.quoteName}).\n`);
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, check: (answer: string) => string | null, fallback = "") => {
    for (;;) {
      process.stdout.write(question);
      const next = await lines.next();
      if (next.done) fail("Input ended before all questions were answered. Nothing was written.");
      const answer = next.value.trim() || fallback;
      const problem = check(answer);
      if (!problem) return answer;
      console.log(`  ${problem}`);
    }
  };
  const address = (answer: string) => {
    try {
      new PublicKey(answer);
      return null;
    } catch {
      return "That is not a valid Solana address.";
    }
  };

  const keyPath = path.resolve(
    await ask(`Treasury key file [${defaultKeyPath}]: `, (a) =>
      insideRepo(a) ? "Keep the key outside this folder." : fs.existsSync(a) ? null : `No file there. Run \`npm run setup:wallet${coin}\` first.`,
    defaultKeyPath),
  );
  const rpcUrl = await ask("RPC URL (mainnet): ", (a) => (/^https?:\/\/\S+$/.test(a) ? null : "It should start with https://"));
  const strategyMint = await ask(`${brand.title}'s mint address on pump.fun: `, address);
  const minHold = await ask("Minimum hold to earn rewards (whole coins, e.g. 100000): ", (a) =>
    /^\d+(\.\d+)?$/.test(a) ? null : "Enter a plain number.",
  );
  rl.close();

  const values: Record<string, string> = {
    RPC_URL: rpcUrl,
    TREASURY_KEYPAIR_PATH: keyPath,
    STRATEGY_MINT: strategyMint,
    BRAND: brand.name,
    BURN_MINT: args[0] ?? brand.burnMint ?? "",
    MIN_HOLD: minHold,
    DRY_RUN: "true",
  };
  const template = fs.readFileSync(path.join(repo, ".env.example"), "utf8");
  const filled = template.replace(/^([A-Z_]+)=.*$/gm, (line, name: string) => (name in values ? `${name}=${values[name]}` : line));
  fs.writeFileSync(envPath, filled, { mode: 0o600, flag: "wx" });
  console.log(`\n${envName} written (DRY_RUN=true). Treasury address: ${publicAddress(keyPath)}`);
  console.log(`Next: \`npm run status${coin}\`, then \`npm run cycle${coin}\` for a dry run.`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "wallet") wallet(rest);
else if (command === "env") void env(rest);
else fail("usage: npm run setup:wallet [coin] | npm run setup:env [coin]");
