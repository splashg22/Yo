import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Tests that run every flow on a local validator. The set-up starts one if none is running. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["test/flows/**/*.test.ts"],
    globalSetup: ["test/flows/global-setup.ts"],
    fileParallelism: false, // the flow tests share one local chain
    env: { LOG_LEVEL: "error" },
    testTimeout: 90_000,
    hookTimeout: 240_000,
  },
});
