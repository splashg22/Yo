"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { footerLinks, nav, site } from "@/site.config";
import { Logo } from "./Logo";
import { useWallet } from "./wallet/WalletProvider";

const SIMULATED = "Ring balances are simulated here. Coins have no value.";
const LOCAL = "Runs on a local test chain.";

/** One line, on every page, saying plainly what this build is. Nothing here is live. */
function BuildNotice() {
  const { config } = useWallet();
  const where =
    config === null
      ? "Checking where this build runs."
      : config === "offline"
        ? "This site's server is not answering."
        : config.network === "local"
          ? LOCAL
          : config.network === "mainnet"
            ? "Shows Solana mainnet, read only. This build sends nothing there: trading is switched off. Not audited."
            : config.ring === "real"
              ? "Runs on Solana devnet, with the real Privacy Rings program, which is alpha software. Coins have no value."
              : "Runs on Solana devnet. Ring balances are not connected yet. Coins have no value.";
  const simulated = config !== null && config !== "offline" && config.ring === "mock";
  return (
    <p className="strip">
      {/* The longest wording this line can take, unseen, holds the height, so the line does not jump when the real one arrives. */}
      <span className="strip-size" aria-hidden="true">
        Pre-release. {LOCAL} {SIMULATED} Status
      </span>
      <span>
        Pre-release. {where} {simulated ? SIMULATED : ""}{" "}
        <Link className="link" href="/status">
          Status
        </Link>
      </span>
    </p>
  );
}

export function Header() {
  const pathname = usePathname();
  const { config } = useWallet();
  // What is switched off in this build is not in the menu. Until the build's settings are known, neither is anything that may be.
  const features = config !== null && config !== "offline" ? config.features : null;
  const shown = nav.filter((item) => (item.href === "/otc" ? features?.otc === true : item.href === "/pay" ? features?.payLinks === true : true));
  const links = shown.map((item) => (
    <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} aria-label={item.label}>
      <span className="only-wide">{item.label}</span>
      <span className="only-narrow">{item.label === "Ring wallet" ? "Wallet" : item.label}</span>
    </Link>
  ));
  // On a phone the links are one row scrolled sideways: the page being read is brought into view in it.
  const narrow = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = narrow.current;
    const here = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && here) row.scrollLeft = Math.max(0, here.offsetLeft - (row.clientWidth - here.offsetWidth) / 2);
  }, [pathname]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <div className="masthead">
        <header className="top">
          <Link href="/" className="brand" aria-label={`${site.name} home`}>
            <Logo />
            {site.name}
          </Link>
          <nav aria-label="Main">{links}</nav>
        </header>
        <nav className="mobile-nav scroll-x" aria-label="Main, small screens" ref={narrow}>
          {links}
        </nav>
        <BuildNotice />
      </div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <nav aria-label="More">
          {footerLinks.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          {/* A way to reach a person, on every page, once the operator has given one. Until then nothing is shown: no made-up address. */}
          {/^[^\s@[\]]+@[^\s@[\]]+\.[^\s@[\]]+$/.test(site.operator.contact) && <a href={`mailto:${site.operator.contact}`}>Help: {site.operator.contact}</a>}
        </nav>
        <p>
          {site.name} is an independent project. It is not affiliated with, endorsed by or operated by Helius, pump.fun, or any other site built on Privacy
          Rings.
        </p>
        <p>
          This is a pre-release build and is unaudited. Privacy Rings and their SDK are alpha software. Nothing here is financial advice. Coins launched on a
          bonding curve are speculative and can go to zero.
        </p>
      </div>
    </footer>
  );
}
