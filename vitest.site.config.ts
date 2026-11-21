import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Tests that need no chain: they run anywhere, straight after `npm install`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Pure logic is tested with the records held in memory only; the database layer has its own test.
  test: { include: ["test/unit/**/*.test.ts"], env: { APP_STORE: "memory" }, testTimeout: 30_000, hookTimeout: 60_000 },
});
