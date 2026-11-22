/**
 * Records a stretch of a real chain for playing back in tests: consecutive confirmed blocks, each cut down to the
 * pump.fun and pool transactions the indexer reads (lib/server/indexer/rpc-source.ts: trimRawBlock).
 *
 *   npm run record -- 50                       50 blocks of mainnet, into test/fixtures/
 *   npm run record -- 1500 .data-recorded      ten minutes, into a folder git ignores
 *
 * READ ONLY. It calls three methods: getSlot, getBlocks and getBlock. It sends no transaction, holds no key
 * other than the RPC's API key, and nothing it does can move anything on any chain.
 * The RPC address comes from MAINNET_RPC_URL, or is made from HELIUS_API_KEY. Each block is one getBlock call.
 */
import { Connection } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { trimRawBlock, type RawBlock } from "../lib/server/indexer/rpc-source";
import { NEWEST_TRANSACTION_VERSION, rawCall } from "../lib/server/solana";

const count = Number(process.argv[2] ?? 50);
const folder = process.argv[3] ?? "test/fixtures";
if (!Number.isInteger(count) || count < 1 || count > 20_000) throw new Error("say how many blocks to record, from 1 to 20000");
const url = process.env.MAINNET_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : "");
if (!url) throw new Error("set MAINNET_RPC_URL or HELIUS_API_KEY: there is no chain to record from");
const chain = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });

// A little behind the tip, so every block asked for is already confirmed everywhere the RPC might read it from.
const from = (await chain.getSlot("confirmed")) - count - 40;
const slots = (await chain.getBlocks(from, from + count - 1, "confirmed")).slice(0, count);
const lines: string[] = [];
let rawBytes = 0;
let kept = 0;
/** One block, asked for again after a pause when the RPC says it is being asked too fast. */
async function read(slot: number): Promise<RawBlock | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawCall<RawBlock>(chain, "getBlock", [
        slot,
        { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION, transactionDetails: "full", rewards: false },
      ]);
    } catch (error) {
      if (attempt >= 8 || !/429|Too Many/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
for (let at = 0; at < slots.length; at += 2) {
  // Two at a time: a free plan allows few of these large reads a second.
  const batch = slots.slice(at, at + 2);
  const blocks = await Promise.all(batch.map(read));
  blocks.forEach((block, index) => {
    if (!block) return;
    rawBytes += JSON.stringify(block).length;
    const trimmed = trimRawBlock(block);
    kept += trimmed.transactions.length;
    lines.push(JSON.stringify({ slot: batch[index], ...trimmed }));
  });
  process.stdout.write(`\r${Math.min(at + 2, slots.length)} of ${slots.length} blocks`);
}
mkdirSync(folder, { recursive: true });
const path = join(folder, `mainnet-${slots[0]}-${lines.length}.jsonl.gz`);
const packed = gzipSync(lines.join("\n"), { level: 9 });
writeFileSync(path, packed);
console.log(
  `\n${lines.length} blocks from slot ${slots[0]}, ${kept} transactions kept. ${(rawBytes / 1e6).toFixed(0)} MB as read, ${(packed.length / 1e6).toFixed(2)} MB as kept: ${path}`,
);
