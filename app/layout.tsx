import type { Metadata, Viewport } from "next";
import { Background } from "@/components/Background";
import { Footer, Header } from "@/components/Chrome";
import { site } from "@/site.config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  icons: { icon: "/logo.svg" },
  openGraph: { title: site.name, description: site.description, images: [{ url: "/media/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/media/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/doto.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <Background />
        <div className="shell">
          <Header />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
