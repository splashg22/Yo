/**
 * Guided setup.
 *
 *   npm run setup:wallet   create the treasury wallet (outside this folder)
 *   npm run setup:env      create .env by asking three questions
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

const DCTY = "9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump";
const repo = path.resolve(__dirname, "..");
const defaultKeyPath = path.join(os.homedir(), ".config", "dacity-bot", "treasury.json");

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
  const useNode = args.includes("--node");
  const keyPath = path.resolve(args.find((a) => !a.startsWith("--")) ?? defaultKeyPath);
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
        "or run `npm run setup:wallet -- --node` to create the key file without a seed phrase.",
    );
  }
  fs.chmodSync(keyPath, 0o600);
  console.log(`\nKey file:         ${keyPath}`);
  console.log(`Treasury address: ${publicAddress(keyPath)}`);
  console.log("\nNext: fund that address with SOL, launch your coin on pump.fun FROM this wallet");
  console.log("(TTWO pair, Creator Fee, not Holder Rewards), then run `npm run setup:env`.");
}

async function env(args: string[]) {
  const envPath = path.join(repo, ".env");
  if (fs.existsSync(envPath)) fail(".env already exists. It was left untouched; edit it directly or delete it first.");
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
      insideRepo(a) ? "Keep the key outside this folder." : fs.existsSync(a) ? null : "No file there. Run `npm run setup:wallet` first.",
    defaultKeyPath),
  );
  const rpcUrl = await ask("RPC URL (mainnet): ", (a) => (/^https?:\/\/\S+$/.test(a) ? null : "It should start with https://"));
  const strategyMint = await ask("Your coin's mint address: ", address);
  const minHold = await ask("Minimum hold to earn rewards (whole coins, e.g. 100000): ", (a) =>
    /^\d+(\.\d+)?$/.test(a) ? null : "Enter a plain number.",
  );
  rl.close();

  const values: Record<string, string> = {
    RPC_URL: rpcUrl,
    TREASURY_KEYPAIR_PATH: keyPath,
    STRATEGY_MINT: strategyMint,
    BURN_MINT: args[0] ?? DCTY,
    MIN_HOLD: minHold,
    DRY_RUN: "true",
  };
  const template = fs.readFileSync(path.join(repo, ".env.example"), "utf8");
  const filled = template.replace(/^([A-Z_]+)=.*$/gm, (line, name: string) => (name in values ? `${name}=${values[name]}` : line));
  fs.writeFileSync(envPath, filled, { mode: 0o600, flag: "wx" });
  console.log(`\n.env written (DRY_RUN=true). Treasury address: ${publicAddress(keyPath)}`);
  console.log("Next: `npm run status`, then `npm run cycle` for a dry run.");
}

const [command, ...rest] = process.argv.slice(2);
if (command === "wallet") wallet(rest);
else if (command === "env") void env(rest);
else fail("usage: npm run setup:wallet | npm run setup:env");
