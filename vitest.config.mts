import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pump SDK's ESM build imports named exports from CommonJS packages,
    // which Node's own loader rejects. Let vite load it instead.
    server: { deps: { inline: [/@pump-fun\//] } },
  },
});
