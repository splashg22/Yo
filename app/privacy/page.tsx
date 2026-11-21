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
            <li>Transactions you sign, which this site submits to the chain for you. They are public anyway.</li>
            <li>
              In this pre-release, everything about your Ring balance. Ring balances are simulated by a stand-in that runs on this site&apos;s server, so the
              server sees each transfer&apos;s coin, amount and memo, and each OTC offer, in readable form. Under the real Ring it would see only encrypted
              data.
            </li>
          </ul>
          <h2>What stays in your browser</h2>
          <p>
            A wallet made here is kept in your browser, encrypted with your password. While a tab is unlocked, the key is also held, unencrypted, in that
            tab&apos;s session storage, and is removed when you press Lock or close the tab. Clearing site data removes the wallet from this browser: keep your
            backup file.
          </p>
          <h2>What is public no matter what</h2>
          <p>Anything written to a public blockchain is permanent and visible to everyone. We cannot remove it.</p>
        </div>
      </div>
    </div>
  );
}
