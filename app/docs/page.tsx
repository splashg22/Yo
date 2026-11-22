import { BUNDLE_WALLETS, SNIPE_SLOTS } from "@/lib/risk-rules";
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
              <a className="link" href="#risk-figures">
                The risk figures on the board
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

          <h2 id="coverage">What the terminal covers</h2>
          <p>Said exactly, because a board that quietly leaves coins out is worse than one that says which.</p>
          <p>Covered:</p>
          <ul>
            <li>pump.fun coins priced in SOL, while they trade on the bonding curve, from the block they are made in.</li>
            <li>The same coins after graduation, in their pump.fun pool (PumpSwap), SOL pools only.</li>
            <li>
              pump.fun coins that were already trading when this site first saw them: followed from their first trade seen, marked &quot;followed&quot;, with
              their name, picture and creator read from the chain afterwards.
            </li>
          </ul>
          <p>Listed, and marked &quot;not supported yet&quot;, with no price shown:</p>
          <ul>
            <li>pump.fun coins priced in USDC or anything else that is not SOL.</li>
            <li>Coins that trade in a pump.fun pool but were not made on pump.fun.</li>
          </ul>
          <p>Not covered at all, and not on the board:</p>
          <ul>
            <li>Other launchpads: LetsBonk, Moonshot, Believe, Boop, Jupiter Studio and the rest.</li>
            <li>Raydium, Meteora and Orca pools, including pools of pump.fun coins made there by hand.</li>
            <li>Any coin that has not traded since this site began to listen, until somebody opens it by its address.</li>
          </ul>
          <p>How far back the record goes:</p>
          <ul>
            <li>
              For a coin seen being made: every trade. For a coin first seen part-way: from that trade on. Its holders are then only the wallets seen since,
              which the board shows as &quot;at least&quot;.
            </li>
            <li>
              Opening any pump.fun coin by its address reads its last 5,000 trades and its twenty largest holders from the chain, once. An older coin&apos;s
              earlier trades are not read, and its page says where its history starts.
            </li>
            <li>
              A coin nobody has traded or opened for a while stops being followed, so the board stays quick. Its address still opens it, and reads it again.
            </li>
            <li>
              Volume &quot;in 24 hours&quot; and the trending lists count only what this site has seen. Until it has been listening for a day, the board says
              when its record begins.
            </li>
          </ul>
          <p>
            Where the data comes from: Solana itself, through an RPC provider, decoded by this site with pump.fun&apos;s published SDK. No figure is bought from
            or copied from another terminal. A coin&apos;s picture is fetched by this server from where the coin&apos;s creator points, drawn again small, and
            served from here, so your browser never calls a stranger&apos;s host.
          </p>

          <h2 id="risk-figures">The risk figures on the board</h2>
          <p>
            Every figure is worked out from this site&apos;s own record of the chain, by the rule given here. Shares are of the coin&apos;s whole supply and
            count what a wallet holds now. The bonding curve and the pool hold coins but are not holders, and are left out of every figure.
          </p>
          <ul>
            <li>Top ten: the ten largest holders, together.</li>
            <li>Dev: the wallet that created the coin. What it holds, and how many times it has sold.</li>
            <li>
              Snipers: wallets other than the creator that bought within {SNIPE_SLOTS} slots of the coin&apos;s creation, the creation slot included. That is a
              little over a second.
            </li>
            <li>
              Bundles: among those early buyers, the ones who bought in a slot in which {BUNDLE_WALLETS} or more different wallets bought. Several wallets
              buying in one slot at a launch are usually one person&apos;s wallets sent together.
            </li>
            <li>Insiders: wallets, other than the creator, that hold the coin and have never bought it on the curve or in its pool. They were sent it.</li>
          </ul>
          <p>What these rules cannot see:</p>
          <ul>
            <li>
              They need the coin&apos;s record from its first block. For a coin that was already trading when this site first saw it, snipers, bundles and
              insiders are shown as not known. Not known is not the same as none, and such a coin fails any filter set on those figures.
            </li>
            <li>
              &quot;Never bought&quot; means no buy recorded in that wallet&apos;s name. Coins bought through another program that trades for the wallet, or
              moved between one person&apos;s own wallets, look the same as coins handed to an insider.
            </li>
            <li>
              Two wallets are not known to be one person. A bundle is a guess from timing, and a launcher who spreads buys over several slots is not caught by
              it.
            </li>
            <li>None of these figures makes a coin safe. They describe who holds it and how they came to.</li>
          </ul>

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
