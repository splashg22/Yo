/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // These load as CommonJS on the server; bundling them breaks the pump SDK.
  serverExternalPackages: ["@pump-fun/pump-sdk", "@coral-xyz/anchor", "@heliuslabs/spr"],
  async headers() {
    return [
      { source: "/(.*)", headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ] },
      { source: "/media/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      { source: "/fonts/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};
export default nextConfig;
