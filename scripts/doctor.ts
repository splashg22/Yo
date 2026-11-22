/**
 * Says, in one screen, whether this copy is ready to run where it is pointed, and what is
 * still missing. It reads settings and asks the chain and the database; it changes nothing.
 * It prints the NAMES of settings, never their values.          Run: npm run doctor
 */
import { existsSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { openDb } from "../lib/server/db";
import { settings } from "../lib/server/env";
import { connection } from "../lib/server/solana";
import { site } from "../site.config";

type Level = "ok" | "todo" | "FAIL";
const lines: [Level, string][] = [];
const say = (level: Level, text: string) => lines.push([level, text]);
const has = (name: string) => (process.env[name] ?? "") !== "";

const PROGRAMS: [string, string][] = [
  ["pump.fun", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
  ["Privacy Rings", "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW"],
];

const major = Number(process.versions.node.split(".")[0]);
say(major >= 22 ? "ok" : "FAIL", `Node ${process.versions.node} (22.12 or newer is needed)`);

let config: ReturnType<typeof settings> | undefined;
try {
  config = settings();
  const ringNow =
    config.network === "local"
      ? "a stand-in, on this machine only"
      : config.network === "devnet"
        ? "the real Privacy Rings program (alpha software), through its SDK in the browser"
        : "not offered: mainnet is read only";
  say("ok", `Network: ${config.network}. Ring balances: ${ringNow}.`);
  say(
    "ok",
    `Switched on: ${
      Object.entries(config.features)
        .filter(([, on]) => on)
        .map(([name]) => name)
        .join(", ") || "none of OTC, pay links, sealed window"
    }.`,
  );
} catch (error) {
  say("FAIL", `Settings: ${error instanceof Error ? error.message : String(error)}`);
}

if (config) {
  try {
    const chain = connection();
    const [slot, accounts] = await Promise.all([chain.getSlot(), chain.getMultipleAccountsInfo(PROGRAMS.map(([, id]) => new PublicKey(id)))]);
    say("ok", `Chain answers at ${new URL(config.rpcUrl).host}, slot ${slot}`);
    PROGRAMS.forEach(([name], index) =>
      say(accounts[index]?.executable ? "ok" : "FAIL", `${name} program ${accounts[index]?.executable ? "is present" : "is missing on this chain"}`),
    );
  } catch {
    say("FAIL", `The chain at ${new URL(config.rpcUrl).host} does not answer. Local: run "npm run local" in another terminal.`);
  }

  if (config.databaseUrl) {
    try {
      await (await openDb(config)).close();
      say("ok", `Database answers; tables ready in schema "${config.databaseSchema}"`);
    } catch (error) {
      say("FAIL", `Database: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    say("todo", `DATABASE_URL is not set: the embedded database under ${config.dataDir}/ is used. Fine on one machine, not for a deployment.`);
  }
  say(has("HELIUS_API_KEY") ? "ok" : "todo", `HELIUS_API_KEY is ${has("HELIUS_API_KEY") ? "set" : "not set: needed for devnet and the real Ring"}`);
  say(
    has("PREVIEW_PASSWORD") ? "ok" : "todo",
    `PREVIEW_PASSWORD is ${has("PREVIEW_PASSWORD") ? "set: the site asks for it" : "not set: anyone who can reach this server can open the site"}`,
  );
  say("ok", `Sealed launch window: ${config.features.sealedWindow ? "ON (holds buyers' funds)" : "off"}`);
}

const placeholders = Object.values(site.operator).filter((value) => value.startsWith("[")).length;
say(
  placeholders === 0 ? "ok" : "todo",
  placeholders === 0 ? "Operator details are filled in" : `${placeholders} operator details are placeholders (site.config.ts, "operator")`,
);
const standIns = existsSync("brand/README.md") && /Every media file here today is a stand-in/.test(readFileSync("brand/README.md", "utf8"));
say(standIns ? "todo" : "ok", standIns ? "Brand media are stand-ins (brand/README.md)" : "Brand media are marked as real");
say(existsSync(".next/BUILD_ID") ? "ok" : "todo", existsSync(".next/BUILD_ID") ? "The site is built" : 'The site is not built: run "npm run build"');

for (const [level, text] of lines) console.log(`${level.padEnd(5)} ${text}`);
const failed = lines.filter(([level]) => level === "FAIL").length;
const todo = lines.filter(([level]) => level === "todo").length;
console.log(`\n${failed} failing, ${todo} still to do, ${lines.length - failed - todo} ready.`);
process.exit(failed ? 1 : 0);
