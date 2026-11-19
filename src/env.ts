/**
 * Picks and loads the settings file. One file per coin:
 *
 *   npm run status            -> .env          (the default coin)
 *   npm run status llm        -> .env.llm      (any brand in brands/)
 *   npm run status -- --env=/some/file
 *
 * ENV_FILE=<file> works too, for services.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { DEFAULT_BRAND, brandsDir } from "./brand.js";

export interface EnvChoice {
  /** Absolute path of the settings file. */
  file: string;
  /** The brand named on the command line, if one was. */
  brand: string | null;
  /** The arguments that are left for the command itself. */
  rest: string[];
}

export function envFileFor(brand: string, root = process.cwd()): string {
  return path.join(root, brand === DEFAULT_BRAND ? ".env" : `.env.${brand}`);
}

export function pickEnvFile(args: readonly string[], env: Record<string, string | undefined> = {}, root = process.cwd()): EnvChoice {
  const rest = [...args];
  const flag = rest.findIndex((arg) => arg.startsWith("--env="));
  if (flag >= 0) {
    const file = rest.splice(flag, 1)[0]!.slice("--env=".length);
    if (!file) throw new Error("--env= needs a file, e.g. --env=.env.llm");
    return { file: path.resolve(root, file), brand: null, rest };
  }
  const named = rest.findIndex((arg) => /^[a-z0-9][a-z0-9-]*$/.test(arg) && !/^\d+$/.test(arg) && fs.existsSync(path.join(brandsDir(root), `${arg}.json`)));
  if (named >= 0) {
    const brand = rest.splice(named, 1)[0]!;
    return { file: envFileFor(brand, root), brand, rest };
  }
  const fromEnv = env.ENV_FILE?.trim();
  return { file: path.resolve(root, fromEnv || ".env"), brand: null, rest };
}

/** Loads the chosen file into process.env (values already set in the environment win). */
export function loadEnv(args: readonly string[] = process.argv.slice(2)): EnvChoice {
  const choice = pickEnvFile(args, process.env);
  if (!fs.existsSync(choice.file)) {
    const hint = choice.brand ? `Create it with \`npm run setup:env ${choice.brand}\`.` : "Create it with `npm run setup:env`.";
    throw new Error(`settings file ${path.relative(".", choice.file) || choice.file} does not exist. ${hint}`);
  }
  dotenv.config({ path: choice.file, quiet: true });
  const brand = process.env.BRAND?.trim() || DEFAULT_BRAND;
  if (choice.brand && brand !== choice.brand) {
    throw new Error(`${path.basename(choice.file)} is for BRAND=${brand}, not ${choice.brand}. Nothing was run.`);
  }
  return choice;
}
