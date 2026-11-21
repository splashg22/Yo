import type { Metadata } from "next";
import { PrivacyPanel } from "@/components/PrivacyPanel";

export const metadata: Metadata = { title: "Ring wallet" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Ring wallet</span>
        <h1 className="h2">Deposit, transfer, withdraw</h1>
        <p className="body">Your Ring balance is encrypted on-chain. Moving coins in and out of it is public. Moving them between Ring balances encrypts the coin and the amount.</p>
        <p className="notice">Not open yet. This page is being built and tested on devnet. Nothing here moves funds.</p>
        <PrivacyPanel action="deposit" />
        <PrivacyPanel action="transfer" />
        <PrivacyPanel action="withdraw" />
      </div>
    </div>
  );
}
