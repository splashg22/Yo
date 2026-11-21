/** Makes sure a local validator with pump.fun and the Rings programs is running before the flow tests. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const URL_ = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899";
async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    return ((await response.json()) as { result?: string }).result === "ok";
  } catch {
    return false;
  }
}

export default async function setup() {
  if (await healthy()) return;
  if (!existsSync("local/accounts")) throw new Error("No local validator, and no copied programs. Run: npm run local:fetch, then npm run local");
  const child = spawn("bash", ["scripts/local-validator.sh"], { stdio: "ignore", detached: true });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await healthy())
      return () => {
        try {
          process.kill(-child.pid!);
        } catch {
          /* already gone */
        }
      };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The local validator did not start. See local/validator.log");
}
