"use client";

/**
 * What can be checked about a coin, each line saying where it comes from: the coin's own account on the chain
 * (can more be minted, can holdings be frozen), who holds it (from the indexer), the creator's other coins, and how
 * far back this site's record of the coin goes. A check that could not be made says so; none is shown as passed
 * without having been made.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ChecksView, CoinView } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
import { Time, UsdOfSol } from "../ui/Money";

function Liquidity({ check }: { check: ChecksView["liquidity"] }) {
  if (check.kind === "curve") return <>No pool yet: on the curve</>;
  if (check.kind === "none") return <>No pool yet</>;
  if (check.kind === "unread") return <>Not read</>;
  const bps = check.kind === "burned" ? check.burnedBps : check.lockedBps;
  const word = check.kind === "burned" ? "burned" : "locked for good";
  // All of it, said only when it is all of it. Anything less is a share somebody could withdraw.
  if (bps >= 10_000) return <>100% {word}</>;
  return (
    <span className="down">
      {(bps / 100).toFixed(bps < 1000 ? 1 : 0)}% {word}
    </span>
  );
}
const share = (bps: number | undefined): string => (bps === undefined ? "Not known" : `${(bps / 100).toFixed(bps < 1000 ? 1 : 0)}%`);

export function Checks({ coin }: { coin: CoinView }) {
  const [checks, setChecks] = useState<ChecksView | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let ended = false;
    const read = () =>
      api("coin/checks", { mint: coin.mint }).then(
        (answer) => !ended && (setChecks(answer), setProblem("")),
        (error: unknown) => !ended && setProblem(error instanceof Error ? error.message : String(error)),
      );
    void read();
    const timer = setInterval(() => !document.hidden && void read(), 60_000);
    return () => {
      ended = true;
      clearInterval(timer);
    };
  }, [coin.mint]);
  const facts = checks?.facts ?? null;
  const partial = coin.followedSince !== undefined;
  return (
    <>
      <section className="card" aria-label="Safety checks" data-checks>
        <h2 className="px">Safety checks</h2>
        {!checks ? (
          <p className="body">{problem ? `The checks could not be read: ${problem}.` : "Reading the coin's account from the chain."}</p>
        ) : (
          <dl className="facts">
            <dt>More can be minted</dt>
            <dd data-check="mint">
              {facts ? facts.mintAuthority === null ? "No" : <span className="down">Yes, by {shortAddress(facts.mintAuthority)}</span> : "Not read"}
            </dd>
            <dt>Holdings can be frozen</dt>
            <dd data-check="freeze">
              {facts ? facts.freezeAuthority === null ? "No" : <span className="down">Yes, by {shortAddress(facts.freezeAuthority)}</span> : "Not read"}
            </dd>
            <dt>A pump.fun coin</dt>
            <dd>{facts ? facts.pump ? "Yes" : <span className="down">No</span> : "Not read"}</dd>
            <dt>Ten largest wallets hold</dt>
            <dd>{partial && coin.risk?.top10Bps !== undefined ? `At least ${share(coin.risk.top10Bps)}` : share(coin.risk?.top10Bps)}</dd>
            <dt>Creator holds</dt>
            <dd>{partial ? "Not known" : share(coin.risk?.devBps)}</dd>
            <dt>Snipers still hold</dt>
            <dd>{share(coin.risk?.snipers?.heldBps)}</dd>
            <dt>Bundled buyers still hold</dt>
            <dd>{share(coin.risk?.bundles?.heldBps)}</dd>
            <dt>Wallets that never bought hold</dt>
            <dd>{share(coin.risk?.insiders?.heldBps)}</dd>
            <dt>Pool liquidity</dt>
            <dd data-check="liquidity">
              <Liquidity check={checks.liquidity} />
            </dd>
          </dl>
        )}
        {checks?.liquidity.kind === "unread" && <p className="note-line">The pool could not be read: {checks.liquidity.problem}.</p>}
        {checks?.liquidity.kind === "burned" && checks.liquidity.burnedBps < 10_000 && (
          <p className="note-line">
            The pool has issued LP coins that still exist. Whoever holds them can hand them back for that share of the liquidity. This check does not look at
            who holds them.
          </p>
        )}
        {checks?.liquidity.kind === "locked" && (
          <p className="note-line">
            A Meteora pool: the share of its liquidity locked for good, from the pool&apos;s own account. Locks that end on a date are not counted, so the rest
            may or may not be withdrawable today.
          </p>
        )}
        {checks && !facts && <p className="note-line">The coin&apos;s account could not be read: {checks.factsProblem ?? "no reason given"}.</p>}
        <p className="note-line">
          The first three, and the pool&apos;s liquidity, are read from the chain: the coin&apos;s own account, and its pool
          {facts ? (
            <>
              , <Time at={facts.readAt} /> ago
            </>
          ) : null}
          . The rest are worked out from the trades and holders this site holds. &quot;Not known&quot; means the coin&apos;s first trades were not seen, so
          nobody here can say.{" "}
          <Link className="link" href="/docs#risk-figures">
            How each is worked out
          </Link>
        </p>
      </section>
      <section className="card" aria-label="The creator's other coins" data-dev>
        <h2 className="px">Creator&apos;s other coins</h2>
        {!checks ? (
          <p className="body">Reading.</p>
        ) : !checks.dev.creator ? (
          <p className="body">This coin&apos;s creator has not been read from the chain yet.</p>
        ) : checks.dev.coins.length === 0 ? (
          <p className="body">None among the coins this site follows.</p>
        ) : (
          <ul className="plain-list">
            {checks.dev.coins.map((other) => (
              <li key={other.mint}>
                <Link className="link" href={`/coin/${other.mint}`}>
                  {other.symbol || shortAddress(other.mint)}
                </Link>{" "}
                <span className="quiet">
                  {other.complete ? "graduated" : "on the curve"}, <UsdOfSol lamports={other.marketCapLamports} />, made <Time at={other.createdAt} /> ago
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="note-line">
          Only coins this site follows are counted
          {checks?.recordFrom ? (
            <>
              , and its record begins <Time at={checks.recordFrom} /> ago
            </>
          ) : null}
          . A creator&apos;s older coins are not listed, so an empty list does not mean a clean history.
        </p>
      </section>
      <section className="card" aria-label="How far back the data goes" data-history>
        <h2 className="px">How far back</h2>
        {!checks ? (
          <p className="body">Reading.</p>
        ) : checks.history.complete ? (
          <p className="body">Complete: every trade since this coin was made is held here.</p>
        ) : checks.history.from === null ? (
          <p className="body">No trade of this coin is held here yet. It is followed from now on.</p>
        ) : (
          <p className="body">
            Trades are held from <Time at={checks.history.from} /> ago. This coin is older than that: its earlier trades, and the chart for them, are not here.
            When a coin is opened by its address, its last {checks.history.limit.toLocaleString("en-US")} trades are read from the chain, and no more.
          </p>
        )}
      </section>
    </>
  );
}
