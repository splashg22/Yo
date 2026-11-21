import type { Metadata } from "next";
import { PrivacyPanel } from "@/components/PrivacyPanel";

export const metadata: Metadata = { title: "Launch" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Launch</span>
        <h1 className="h2">Create a coin and register it with a Ring</h1>
        <p className="body">One signature creates the coin on a pump.fun bonding curve and registers its mint with the Ring, so holders can move it with encrypted amounts from the first block.</p>
        <p className="notice">Not open yet. This page is being built and tested on devnet. Nothing here moves funds.</p>
        <div className="field"><label className="label" htmlFor="name">Coin name</label><input id="name" disabled placeholder="Not open yet" /></div>
        <div className="field"><label className="label" htmlFor="ticker">Ticker</label><input id="ticker" disabled placeholder="Not open yet" /></div>
        <PrivacyPanel action="launch" />
        <PrivacyPanel action="curve-trade" />
      </div>
    </div>
  );
}
