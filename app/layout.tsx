import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Background } from "@/components/Background";
import { Footer, Header } from "@/components/Chrome";
import { TxProvider } from "@/components/tx/Tx";
import { PriceProvider } from "@/components/ui/Money";
import { RecordingBar } from "@/components/RecordingBar";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { CONFIG_HEADER, PRICE_HEADER, parseHandedConfig, parseHandedPrice } from "@/lib/price-header";
import { site } from "@/site.config";
import "./globals.css";
import "./app.css";
import "./work-theme.css";
import { SurfaceSync } from "@/components/Surface";
import { DENSITY_COOKIE, PATH_HEADER, PREVIEW_COOKIE, STYLE_COOKIE, THEME_COOKIE, densityOf, isWorkPath, styleOf, themeOf } from "@/lib/surface";

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
  // Working screens have a theme of their own, and two settings a person may have chosen. All three are on <html>
  // before the first paint, so nothing flashes from one look to the other.
  const kept = await cookies();
  const work = kept.get(PREVIEW_COOKIE)?.value === "preview" && isWorkPath(handed.get(PATH_HEADER) ?? "");
  const style = styleOf(kept.get(STYLE_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={themeOf(kept.get(THEME_COOKIE)?.value)}
      data-density={densityOf(kept.get(DENSITY_COOKIE)?.value)}
      {...(work ? { "data-surface": "work" } : {})}
      {...(work && style ? { "data-style": style } : {})}
    >
      <head>
        <link rel="preload" href="/fonts/doto.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/atkinson-hyperlegible-next.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <Background />
        <SurfaceSync />
        <WalletProvider initialConfig={config}>
          <PriceProvider initial={price}>
            <TxProvider>
              <div className="shell">
                <RecordingBar />
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
