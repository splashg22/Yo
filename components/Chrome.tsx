"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { nav, site } from "@/site.config";
import { Logo } from "./Logo";

export function Header() {
  const pathname = usePathname();
  const links = nav.map((item) => (
    <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} aria-label={item.label}>
      <span className="only-wide">{item.label}</span>
      <span className="only-narrow">{item.label.replace("Ring ", "")}</span>
    </Link>
  ));
  return (
    <>
      <header className="top">
        <Link href="/" className="brand" aria-label={`${site.name} home`}><Logo />{site.name}</Link>
        <nav aria-label="Main">{links}</nav>
      </header>
      <nav className="mobile-nav" aria-label="Main, small screens">{links}</nav>
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <nav aria-label="Legal">
          <Link href="/docs">Docs</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>
        <p>
          {site.name} is an independent project. It is not affiliated with, endorsed by or operated by Helius, pump.fun, or any
          other site built on Privacy Rings.
        </p>
        <p>
          Runs on {site.network} only. Privacy Rings and their SDK are alpha software. Nothing here is financial advice. Coins
          launched on a bonding curve are speculative and can go to zero.
        </p>
      </div>
    </footer>
  );
}
