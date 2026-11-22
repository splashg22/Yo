/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // These load as CommonJS on the server; bundling them breaks the pump SDK. web3.js is listed so the
  // server has one copy of it: a bundled second copy made the SDK's keys fail class checks in our code.
  serverExternalPackages: ["@pump-fun/pump-sdk", "@coral-xyz/anchor", "@heliuslabs/spr", "@solana/web3.js", "@solana/spl-token", "bn.js"],
  // The Ring SDK's hashing library carries its WebAssembly inside its own script, and also names two files beside
  // itself as a fallback it never uses. They are not where it says; this points the bundler at where they are.
  turbopack: {
    resolveAlias: {
      "hasher_wasm_simd_bg.wasm": "./node_modules/@lightprotocol/hasher.rs/dist/hasher_wasm_simd_bg.wasm",
      "light_wasm_hasher_bg.wasm": "./node_modules/@lightprotocol/hasher.rs/dist/light_wasm_hasher_bg.wasm",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No address of this site is passed on when a link leaves it: a coin page or a receipt says what someone was looking at.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      { source: "/media/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      { source: "/fonts/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};
export default nextConfig;
