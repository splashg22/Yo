import type { Metadata } from "next";
import { PrivacyPanel } from "@/components/PrivacyPanel";

export const metadata: Metadata = { title: "OTC" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">OTC</span>
        <h1 className="h2">Sell a block to a named buyer</h1>
        <p className="body">Both sides sign one transaction. The coin and the payment change hands together, or nothing moves.</p>
        <p className="notice">Not open yet. This page is being built and tested on devnet. Nothing here moves funds.</p>
        <PrivacyPanel action="otc" />
      </div>
    </div>
  );
}
