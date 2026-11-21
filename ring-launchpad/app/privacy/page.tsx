import type { Metadata } from "next";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Draft. Not yet reviewed by a lawyer.</span>
        <h1 className="h2">Privacy Policy</h1>
        <div className="prose">
          <p>This page is about what {site.name} itself collects. What a blockchain shows the world is a different matter, covered on the Docs page.</p>
          <h2>What we do not collect</h2>
          <ul>
            <li>No account, no email address, no name.</li>
            <li>No private keys. They are created and kept in your browser or your wallet.</li>
            <li>No advertising or cross-site tracking.</li>
          </ul>
          <h2>What reaches our server</h2>
          <ul>
            <li>Requests your browser makes to load the site, with your IP address, as any website receives.</li>
            <li>Requests relayed to the Solana network and to Helius. They contain wallet addresses and encrypted data. They do not contain coins or amounts of Ring transfers in readable form.</li>
          </ul>
          <h2>What stays in your browser</h2>
          <p>Wallet state and settings are kept in your browser storage, encrypted where they are sensitive. Clearing site data removes them.</p>
          <h2>What is public no matter what</h2>
          <p>Anything written to a public blockchain is permanent and visible to everyone. We cannot remove it.</p>
        </div>
      </div>
    </div>
  );
}
