import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Background } from "@/components/Background";
import { Footer, Header } from "@/components/Chrome";
import { TxProvider } from "@/components/tx/Tx";
import { PriceProvider } from "@/components/ui/Money";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { CONFIG_HEADER, PRICE_HEADER, parseHandedConfig, parseHandedPrice } from "@/lib/price-header";
import { site } from "@/site.config";
import "./globals.css";
import "./app.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:4710"),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  icons: { icon: "/logo.svg" },
  // A pre-release on a test chain has no business in a search index.
  robots: { index: false, follow: false },
  openGraph: { title: site.name, description: site.description, images: [{ url: "/media/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/media/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

// Every page is rendered for its request, so each carries that request's script nonce (see lib/server/headers.ts).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The server puts the price of SOL on the request it hands over, so dollar figures are in the first paint.
  // So is what this build runs on, so the notice under the header is right from the start.
  const handed = await headers();
  const price = parseHandedPrice(handed.get(PRICE_HEADER));
  const config = parseHandedConfig(handed.get(CONFIG_HEADER));
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/doto.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/atkinson-hyperlegible-next.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <Background />
        <WalletProvider initialConfig={config}>
          <PriceProvider initial={price}>
            <TxProvider>
              <div className="shell">
                <Header />
                <main id="main">{children}</main>
                <Footer />
              </div>
            </TxProvider>
          </PriceProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
