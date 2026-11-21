import type { Metadata } from "next";
import { PrivacyPanel } from "@/components/PrivacyPanel";

export const metadata: Metadata = { title: "Explore" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Explore</span>
        <h1 className="h2">Every coin launched here</h1>
        <p className="body">Market cap from the curve, the change over 24 hours, and a Ring badge showing how much of the supply sits in Ring balances. Numbers are read from the chain.</p>
        <p className="notice">Not open yet. This page is being built and tested on devnet. Nothing here moves funds.</p>
        <p className="body">No coin has been launched here yet.</p>
      </div>
    </div>
  );
}
