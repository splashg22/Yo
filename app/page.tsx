import Link from "next/link";
import { CalloutList } from "@/components/Callouts";
import { Sequence, StillStory } from "@/components/Sequence";
import { StatsRow } from "@/components/Stats";
import { VISIBILITY } from "@/lib/visibility";
import { site } from "@/site.config";

const ADDED = [
  [
    "01",
    "Privacy score",
    "Each coin shows the share of its supply held in Ring balances, and how many wallets have deposited it. Both are public facts. The number of holders inside the Ring is not public and cannot be shown.",
    "Works on the local test chain",
  ],
  ["02", "Pay links", "A link or QR code that asks for an amount of a coin and opens a Ring transfer with it filled in.", "Works on the local test chain"],
  [
    "03",
    "No wallet needed",
    "A deposit address made in your browser, funded from any wallet or exchange, with an encrypted backup file you keep.",
    "Works on the local test chain",
  ],
  [
    "04",
    "Creator fees to your Ring",
    "Claiming fees is public. The claim lands in your Ring balance in the same transaction, so what you do next is not on public view.",
    "Works on the local test chain",
  ],
  [
    "05",
    "A privacy panel on every action",
    "Before you sign, one panel lists what this transaction makes public and what it keeps off the public record.",
    "Works on the local test chain",
  ],
  [
    "06",
    "Sealed pre-launch window",
    "A bonding curve cannot be paused, so buys cannot be held back after launch. Instead, buyers commit before the coin exists and all buy in its first transaction, at one price. It holds buyers' funds, so it is built but switched off.",
    "Built, switched off",
  ],
] as const;

const PRODUCTS = [
  ["01", "Launch", "/launch", "Create a coin on a pump.fun curve and register it with a Ring in one signature."],
  ["02", "Ring wallet", "/wallet", "Deposit, transfer without publishing the coin or the amount, withdraw."],
  ["03", "Explore", "/explore", "Every coin launched here, with its market cap and how much of it sits in Rings."],
  ["04", "OTC", "/otc", "Sell a block to a named buyer. The size and the price are not published."],
  ["05", "Pay links", "/pay", "Ask for a payment by link or QR code, paid from one Ring balance to another."],
] as const;

export default function Home() {
  return (
    <>
      <Sequence />
      <div className="how-list wrap">
        <CalloutList />
      </div>
      <StillStory />

      <section className="section" aria-labelledby="stats">
        <div className="wrap">
          <h2 className="label" id="stats">
            Live from the chain
          </h2>
          <StatsRow />
        </div>
      </section>

      <section className="section" aria-labelledby="hidden">
        <div className="wrap">
          <h2 className="h2" id="hidden">
            What is hidden, and what is not
          </h2>
          <p className="body">
            A Ring encrypts the coin and the amount of a transfer between Ring balances. It does not hide who you are or who you deal with: both wallet
            addresses are public on every transfer. This table describes the Privacy Rings design. In this pre-release build the Ring&apos;s balances are
            simulated; see the Docs for exactly what is real today.
          </p>
          <div className="scroll-x">
            <table className="plain">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Public</th>
                  <th>Encrypted</th>
                </tr>
              </thead>
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
          <p className="body">
            <Link href="/docs" className="btn">
              Read the full list
            </Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="added">
        <div className="wrap">
          <h2 className="h2" id="added">
            What {site.name} adds
          </h2>
          <ul className="rows">
            {ADDED.map(([n, title, text, status]) => (
              <li key={n}>
                <span className="label num">{n}</span>
                <h3 className="h3">
                  {title}
                  <br />
                  <span className="status">{status}</span>
                </h3>
                <p className="body">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="products">
        <div className="wrap">
          <h2 className="h2" id="products">
            Five tools
          </h2>
          <ul className="rows">
            {PRODUCTS.map(([n, title, href, text]) => (
              <li key={n}>
                <span className="label num">{n}</span>
                <h3 className="h3">
                  <Link href={href}>{title}</Link>
                </h3>
                <p className="body">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="cta">
        <div className="wrap">
          <h2 className="h1" id="cta">
            Put a coin
            <br />
            on the curve.
          </h2>
          <p className="body">The launch is public. After it, holders can move the coin between Ring balances without publishing the coin or the amount.</p>
          <p>
            <Link className="btn" href="/launch">
              Launch a coin
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
