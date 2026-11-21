import type { Metadata } from "next";
import { VISIBILITY } from "@/lib/visibility";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Docs" };

export default function Docs() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Docs</span>
        <h1 className="h2">What a Ring hides, what it costs, and what is alpha</h1>
        <div className="prose">
          <p>
            {site.name} uses the permissionless Default Ring of Solana Privacy Rings. That Ring is confidential: it encrypts the
            coin and the amount of a transfer between Ring balances. Both wallet addresses of every transfer stay public.
          </p>
          <h2>Action by action</h2>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead><tr><th>Action</th><th>Public</th><th>Encrypted</th></tr></thead>
            <tbody>
              {VISIBILITY.map((row) => (
                <tr key={row.id}>
                  <td data-label="Action">{row.action}</td>
                  <td data-label="Public">{row.public.join(". ")}.{row.note ? ` ${row.note}` : ""}</td>
                  <td data-label="Encrypted">{row.encrypted.length ? `${row.encrypted.join(". ")}.` : "Nothing."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="prose">
          <h2>What follows from that</h2>
          <ul>
            <li>Anything on the bonding curve is public: creating a coin, every buy and sell, the creator's first buy, claiming fees.</li>
            <li>A balance is only as hidden as its history. One public deposit and nothing else leaves the balance known.</li>
            <li>The total of a coin held in the Ring is public. How it is split between holders is encrypted.</li>
            <li>Each side of a transfer can read that transfer. A sender can disclose a single transfer by sharing its viewing key.</li>
          </ul>
          <h2>Costs</h2>
          <ul>
            <li>The Solana network fee, 5,000 lamports per signature plus any priority fee.</li>
            <li>A Ring tree fee, 5,000 lamports for each state tree an instruction updates.</li>
            <li>Rent, once, to register a coin with the Ring, and once to register a wallet.</li>
            <li>pump.fun's own trading fees, as the program reports them at the time.</li>
          </ul>
          <h2>What is alpha</h2>
          <ul>
            <li>The Privacy Rings SDK is an alpha release and its endpoints are labelled beta by Helius.</li>
            <li>{site.name} itself is unaudited and runs on devnet only.</li>
            <li>Rings that also hide wallet addresses are a separate product that is not open to us.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
