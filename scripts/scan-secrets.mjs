// Looks for anything secret in what the site serves and in the repository's history:
// the server's local keys, environment values, and anything shaped like a key.
// Needs a build (.next) and, for the served pages, a server on PORT (default 4711). Run: npm run scan
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const base = `http://127.0.0.1:${process.env.PORT ?? 4711}`;
const needles = new Map();
// The server's own local keys: any 12 consecutive bytes of one, as text, would give it away.
for (const file of existsSync(".data") ? readdirSync(".data").filter((name) => name.endsWith(".json") && name !== "state.json") : []) {
  const bytes = JSON.parse(readFileSync(join(".data", file), "utf8"));
  if (Array.isArray(bytes)) {
    needles.set(`${file} as numbers`, bytes.slice(0, 12).join(","));
    needles.set(`${file} as base64`, Buffer.from(bytes).toString("base64").slice(0, 24));
    needles.set(`${file} as hex`, Buffer.from(bytes).toString("hex").slice(0, 32));
  }
}
for (const name of ["HELIUS_API_KEY"]) if (process.env[name]) needles.set(`the value of ${name}`, process.env[name]);
const SHAPES = [
  [/api-key=[A-Za-z0-9-]{8,}/, "an RPC address with a key in it"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key block"],
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/, "a payment key"],
  [/\[(\d{1,3},\s?){63}\d{1,3}\]/, "64 bytes written out, the shape of a Solana secret key"],
  [/HELIUS_API_KEY\s*[:=]\s*["'][^"']+["']/, "a Helius key assigned in code"],
];
const found = [];
function scan(where, text) {
  for (const [name, needle] of needles) if (text.includes(needle)) found.push(`${where}: contains ${name}`);
  for (const [shape, name] of SHAPES) if (shape.test(text)) found.push(`${where}: ${name}`);
}
function walk(directory, visit) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, visit);
    else visit(path);
  }
}

let files = 0;
for (const directory of [".next/static", "public"])
  walk(directory, (path) => /\.(js|css|html|json|txt|map|svg)$/.test(path) && (files++, scan(path, readFileSync(path, "utf8"))));
let pages = 0;
for (const path of [
  "/",
  "/explore",
  "/launch",
  "/wallet",
  "/otc",
  "/pay",
  "/status",
  "/changelog",
  "/docs",
  "/terms",
  "/privacy",
  "/.env",
  "/.env.local",
  "/.data/state.json",
  "/.data/mock-ring-escrow.json",
  "/.git/config",
]) {
  const response = await fetch(base + path).catch(() => null);
  if (!response) throw new Error(`No server on ${base}`);
  const text = await response.text();
  pages++;
  if (/^\/\./.test(path) && response.status !== 404) found.push(`${path} is served (status ${response.status})`);
  scan(`served ${path}`, text);
}
for (const op of ["config", "status", "stats", "explore"]) scan(`api ${op}`, await (await fetch(`${base}/api/${op}`, { method: "POST", body: "{}" })).text());
const history = execSync("git log --all -p --no-color -- . ':!package-lock.json'", { maxBuffer: 1 << 30 }).toString();
scan("git history", history);
const tracked = execSync("git ls-files")
  .toString()
  .split("\n")
  .filter((name) => /(^|\/)\.env($|\.local)|^\.data\/|keypair|\.pem$|id_rsa/.test(name));
for (const name of tracked) found.push(`tracked in git: ${name}`);

console.log(
  `${files} built files, ${pages} served addresses, 4 api answers and ${history.length.toLocaleString("en-US")} characters of git history scanned for ${needles.size + SHAPES.length} patterns.`,
);
for (const line of found) console.log("FOUND", line);
console.log(found.length ? `${found.length} findings.` : "Nothing secret found.");
process.exit(found.length ? 1 : 0);
