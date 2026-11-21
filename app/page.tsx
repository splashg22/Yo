import Link from "next/link";
import { Sequence, StillStory } from "@/components/Sequence";
import { StatsRow } from "@/components/Stats";
import { VISIBILITY } from "@/lib/visibility";
import { site } from "@/site.config";

const ADDED = [
  ["01", "Privacy score", "Each coin shows the share of its supply held in Ring balances, and how many wallets have deposited it. Both are public facts. The number of holders inside the Ring is encrypted and cannot be shown.", "Working on the test chain"],
  ["02", "Pay links", "A link or QR code that asks for an amount of a coin and opens a Ring transfer with it filled in.", "Working on the test chain"],
  ["03", "No wallet needed", "A deposit address made in your browser, funded from any wallet or exchange, with an encrypted backup file you keep.", "Working on the test chain"],
  ["04", "Creator fees to your Ring", "Claiming fees is public. The claim lands in your Ring balance in the same transaction, so what you do next is encrypted.", "Working on the test chain"],
  ["05", "A privacy panel on every action", "Before you sign, one panel lists what this transaction makes public and what it encrypts.", "Working on the test chain"],
  ["06", "Sealed pre-launch window", "A bonding curve cannot be paused, so a sealed window after launch is not possible. A pooled first buy before the coin exists is under review.", "Under review"],
] as const;

const PRODUCTS = [
  ["01", "Launch", "/launch", "Create a coin on a pump.fun curve and register it with a Ring in one signature."],
  ["02", "Ring wallet", "/wallet", "Deposit, transfer with encrypted amounts, withdraw."],
  ["03", "Explore", "/explore", "Every coin launched here, with its market cap and how much of it sits in Rings."],
  ["04", "OTC", "/otc", "Sell a block to a named buyer at a size and price only the two of you can read."],
  ["05", "Pay links", "/pay", "Ask for a payment by link or QR code, paid from one Ring balance to another."],
] as const;

export default function Home() {
  return (
    <>
      <Sequence />
      <StillStory />

      <section className="section" aria-labelledby="stats">
        <div className="wrap">
          <h2 className="label" id="stats">Live from the chain</h2>
          <StatsRow />
        </div>
      </section>

      <section className="section" aria-labelledby="hidden">
        <div className="wrap">
          <h2 className="h2" id="hidden">What is hidden, and what is not</h2>
          <p className="body">
            A Ring encrypts the coin and the amount of a transfer between Ring balances. It does not hide who you are or who you
            deal with: both wallet addresses are public on every transfer.
          </p>
          <div className="scroll-x">
            <table className="plain">
              <thead><tr><th>Action</th><th>Public</th><th>Encrypted</th></tr></thead>
              <tbody>
                {VISIBILITY.slice(0, 5).map((row) => (
                  <tr key={row.id}>
                    <td data-label="Action">{row.action}</td>
                    <td data-label="Public">{row.public.join(". ")}.</td>
                    <td data-label="Encrypted">{row.encrypted.length ? `${row.encrypted.join(". ")}.` : "Nothing."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="body"><Link href="/docs" className="btn">Read the full list</Link></p>
        </div>
      </section>

      <section className="section" aria-labelledby="added">
        <div className="wrap">
          <h2 className="h2" id="added">What {site.name} adds</h2>
          <ul className="rows">
            {ADDED.map(([n, title, text, status]) => (
              <li key={n}>
                <span className="label num">{n}</span>
                <h3 className="h3">{title}<br /><span className="status">{status}</span></h3>
                <p className="body">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="products">
        <div className="wrap">
          <h2 className="h2" id="products">Five tools</h2>
          <ul className="rows">
            {PRODUCTS.map(([n, title, href, text]) => (
              <li key={n}>
                <span className="label num">{n}</span>
                <h3 className="h3"><Link href={href}>{title}</Link></h3>
                <p className="body">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="cta">
        <div className="wrap">
          <h2 className="h1" id="cta">Put a coin<br />on the curve.</h2>
          <p className="body">The launch is public. What holders do with it inside the Ring is theirs.</p>
          <p><Link className="btn" href="/launch">Launch a coin</Link></p>
        </div>
      </section>
    </>
  );
}
