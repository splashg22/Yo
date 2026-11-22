import type { Metadata } from "next";
import Link from "next/link";
import { VISIBILITY } from "@/lib/visibility";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Docs" };

const BUILD = [
  ["Creating a coin, buying, selling, creator fees", "The real pump.fun program, copied from devnet to a local test chain."],
  ["Registering a coin with the Ring", "The real Privacy Rings program, copied the same way."],
  [
    "Ring balances: deposit, transfer, withdraw, OTC, pay links",
    "Simulated. A local stand-in keeps the balances and follows the same rules for what is public. It is not encryption: the stand-in's operator can read everything.",
  ],
  ["The wallet made in your browser", "Real. The key is created and encrypted in your browser and never sent anywhere."],
  ["The pictures of the ring", "Placeholders drawn in code."],
] as const;

export default function Docs() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Docs</span>
        <h1 className="h2">What a Ring hides, what this build does, and how to run it</h1>

        <nav aria-label="On this page">
          <ol className="contents">
            <li>
              <a className="link" href="#what-is-real-in-this-build">
                What is real in this build
              </a>
            </li>
            <li>
              <a className="link" href="#what-a-ring-hides">
                What a Ring hides
              </a>
            </li>
            <li>
              <a className="link" href="#what-follows-from-that">
                What follows from that
              </a>
            </li>
            <li>
              <a className="link" href="#a-worked-example">
                A worked example
              </a>
            </li>
            <li>
              <a className="link" href="#the-privacy-score">
                The privacy score
              </a>
            </li>
            <li>
              <a className="link" href="#costs">
                Costs
              </a>
            </li>
            <li>
              <a className="link" href="#run-it-yourself">
                Run it yourself
              </a>
            </li>
            <li>
              <a className="link" href="#what-is-alpha-and-what-is-not-built">
                What is alpha, and what is not built
              </a>
            </li>
          </ol>
        </nav>
        <div className="prose">
          <h2 id="what-is-real-in-this-build">What is real in this build</h2>
          <p>{site.name} is a pre-release. It runs on a local test chain. Nothing here is live and coins have no value.</p>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>Part</th>
                <th>Today</th>
              </tr>
            </thead>
            <tbody>
              {BUILD.map(([part, today]) => (
                <tr key={part}>
                  <td data-label="Part">{part}</td>
                  <td data-label="Today">{today}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2 id="what-a-ring-hides">What a Ring hides</h2>
          <p>
            Solana Privacy Rings is a program by Helius. {site.name} is built for its permissionless Default Ring, which is confidential: it encrypts the coin
            and the amount of a transfer between Ring balances. Both wallet addresses of every transfer stay public. The table below is that design, action by
            action.
          </p>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>Action</th>
                <th>Public</th>
                <th>Encrypted by a Ring</th>
                <th>This site&apos;s server sees</th>
                <th>In this build</th>
              </tr>
            </thead>
            <tbody>
              {VISIBILITY.map((row) => (
                <tr key={row.id}>
                  <td data-label="Action">{row.action}</td>
                  <td data-label="Public">
                    {row.public.join(". ")}.{row.note ? ` ${row.note}` : ""}
                  </td>
                  <td data-label="Encrypted">{row.encrypted.length ? `${row.encrypted.join(". ")}.` : "Nothing."}</td>
                  <td data-label="This site's server sees">{row.server}</td>
                  <td data-label="In this build">
                    {row.proof.today} <span className="address">{row.proof.source}</span>
                    {row.realRing ? (
                      <>
                        {" "}
                        Where the real Privacy Rings program is connected: {row.realRing.today} There, this site&apos;s server sees: {row.realRing.server}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2 id="what-follows-from-that">What follows from that</h2>
          <ul>
            <li>Anything on the bonding curve is public: creating a coin, every buy and sell, the creator&apos;s first buy, claiming fees.</li>
            <li>A balance is only as hidden as its history. One public deposit and nothing else leaves the balance known.</li>
            <li>The total of a coin held in the Ring is public. How it is split between holders is encrypted.</li>
            <li>Each side of a transfer can read that transfer.</li>
          </ul>

          <h2 id="a-worked-example">A worked example</h2>
          <p>Names here are invented. Amounts are the kind you can try on the test chain.</p>
          <ul>
            <li>
              Mara launches a coin, ticker LNTRN, with a first buy of 0.05 SOL sent to her Ring balance. Public: her wallet, the coin, the 0.05 SOL, the coins
              she received, and that they went into the Ring.
            </li>
            <li>Ilya buys LNTRN with 0.1 SOL on the curve and deposits 1,000,000 of it. Public: both, with amounts.</li>
            <li>
              Ilya transfers 250,000 LNTRN to Mara with the note &quot;for the poster&quot;. Public: a transfer from Ilya&apos;s wallet to Mara&apos;s, and the
              time. Encrypted: that it was LNTRN, that it was 250,000, and the note.
            </li>
            <li>
              The coin&apos;s page now reads: the share of supply in Ring balances, and &quot;2 wallets have deposited it&quot;. It cannot say how many wallets
              hold it inside the Ring, because the transfer moved it without showing where it ended up.
            </li>
            <li>
              Mara offers Ilya a block of 500,000 LNTRN for 1.5 SOL. When he accepts, both sides move together. Public: a transfer each way between the two
              wallets. Encrypted: the coin, the size and the price.
            </li>
          </ul>

          <h2 id="the-privacy-score">The privacy score</h2>
          <p>Two numbers, both public facts read from the chain, each named for exactly what it measures:</p>
          <ul>
            <li>Share of supply in Ring balances: the coin&apos;s total held by the Ring, divided by its supply.</li>
            <li>Wallets that have deposited it: wallets that made at least one public deposit of the coin.</li>
          </ul>
          <p>Neither is a count of holders inside the Ring. That number is what the encryption hides.</p>

          <h2 id="costs">Costs</h2>
          <p>These are Solana&apos;s and the Ring&apos;s own costs, as their documentation states them. {site.name} adds no fee.</p>
          <ul>
            <li>The Solana network fee: 5,000 lamports per signature, plus any priority fee.</li>
            <li>A Ring tree fee: 5,000 lamports for each state tree an instruction updates.</li>
            <li>Rent, once, to register a coin with the Ring, and once to register a wallet.</li>
            <li>pump.fun&apos;s own trading fees, as the program reports them at the time.</li>
          </ul>

          <h2 id="run-it-yourself">Run it yourself</h2>
          <p>The README has the full steps. In short, with Node 22 and the Solana tools installed:</p>
        </div>
        <pre className="code">{`npm install
npm run local:fetch   # once: copies the programs from devnet
npm run local         # the local test chain
npm run dev           # this site, on http://localhost:4710
npm run example       # launches a coin and makes a Ring transfer, from a script`}</pre>
        <div className="prose">
          <p>
            <Link className="link" href="/status">
              Status
            </Link>{" "}
            shows what the build is running on right now.{" "}
            <Link className="link" href="/changelog">
              Changelog
            </Link>{" "}
            lists what changed.
          </p>

          <h2 id="what-is-alpha-and-what-is-not-built">What is alpha, and what is not built</h2>
          <ul>
            <li>The Privacy Rings SDK is an alpha release and its endpoints are labelled beta by Helius.</li>
            <li>{site.name} is unaudited.</li>
            <li>Rings that also hide wallet addresses are a separate product that is not open to us.</li>
            <li>
              A sealed launch window is built and switched off. It pools buyers&apos; commitments and buys in the coin&apos;s first transaction. It holds
              buyers&apos; funds, which this build does only on a local test chain.
            </li>
            <li>Proving a balance is above a threshold without showing it is not something Rings supports.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
