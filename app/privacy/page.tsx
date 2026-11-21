import { Operator } from "@/components/Operator";
import type { Metadata } from "next";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Draft. Not yet reviewed by a lawyer.</span>
        <h1 className="h2">Privacy Policy</h1>
        <Operator />
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
            <li>
              Requests your browser makes, with your IP address, as any website receives. This site writes no log of them. To limit abuse it counts requests per
              address in memory for one minute and then forgets them. Whoever hosts the site may keep logs of their own.
            </li>
            <li>Transactions you sign, which this site submits to the chain for you. They are public anyway.</li>
            <li>
              In this pre-release, your Ring balance and what moves in and out of it. Ring balances are simulated by a stand-in that runs on this site&apos;s
              server, so the server sees each transfer&apos;s wallets, coin and amount, and each OTC offer, in readable form. Under the real Ring it would see
              the wallets and encrypted data.
            </li>
            <li>
              Not the note on a transfer. A note is sealed in your browser to the recipient&apos;s key before it is sent; the server stores it and cannot read
              it.
            </li>
            <li>
              Not what a pay link asks for. The request sits after the # of the link, which browsers do not send to servers. When the link is paid, the payment
              itself reaches the server like any other transfer.
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
