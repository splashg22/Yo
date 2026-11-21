import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Tests that need no chain: they run anywhere, straight after `npm install`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["test/unit/**/*.test.ts"] },
});
