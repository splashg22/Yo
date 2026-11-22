"use client";

/**
 * A coin's trading screen: its figures, a live candle chart, the trades feed and holders, and the buy and
 * sell panel. Everything on it is the chain's own record, kept by the indexer and pushed as it changes.
 *
 * Keys: B buy, S sell, 1 to 4 the amount buttons, / the amount field, ? this list.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { CoinStore } from "@/lib/client/coin-store";
import type { CoinView } from "@/lib/contract";
import { formatChange, formatCompact, formatShare, formatSol, shortAddress } from "@/lib/format";
import { site } from "@/site.config";
import type { ChartView, Mark } from "../chart/CandleChart";
import { useTx } from "../tx/Tx";
import { Address } from "../ui/Address";
import { CoinPicture } from "../ui/CoinPicture";
import { Segments, Tick } from "../ui/controls";
import { CoinPrice, Sol, Time, useSolPrice } from "../ui/Money";
import { useStandinOn } from "../ui/NeedsRing";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { Checks } from "./Checks";
import { Feed } from "./Feed";
import { LiveStrip } from "./LiveStrip";
import { Ticket, type TicketHandle } from "./Ticket";

// The chart is the heaviest thing on the screen and nothing above the fold waits for it.
const CandleChart = dynamic(() => import("../chart/CandleChart").then((module) => module.CandleChart), {
  ssr: false,
  loading: () => <div className="empty">Loading the chart</div>,
});

const TIMEFRAMES = [
  { value: 1, label: "1s" },
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
  { value: 900, label: "15m" },
  { value: 3600, label: "1h" },
  { value: 86400, label: "1d" },
];

export function CoinScreen({ mint }: { mint: string }) {
  const { signer, config } = useWallet();
  const store = useMemo(() => new CoinStore(mint), [mint]);
  useEffect(() => {
    void store.start();
    return () => store.close();
  }, [store]);
  useSyncExternalStore(
    store.listen,
    () => store.version,
    () => 0,
  );
  const coin = store.coin;
  // The tab is named after the coin once it is known, so several coin tabs can be told apart.
  const [symbol, name] = [coin?.symbol, coin?.name];
  useEffect(() => {
    if (symbol && name) document.title = `${symbol} ${name} · ${site.name}`;
  }, [symbol, name]);

  const [tf, setTf] = useState(60);
  const [measure, setMeasure] = useState<ChartView["measure"]>("cap");
  const [unit, setUnit] = useState<ChartView["unit"]>("usd");
  const [help, setHelp] = useState(false);
  const readout = useRef<HTMLSpanElement>(null);
  const ticket = useRef<TicketHandle | null>(null);
  const side = useRef<HTMLDivElement>(null);
  const solPrice = useSolPrice();

  // Keys. They are ignored while the person is typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape") return setHelp(false);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "b" || event.key === "B") ticket.current?.side("buy");
      else if (event.key === "s" || event.key === "S") ticket.current?.side("sell");
      else if (["1", "2", "3", "4"].includes(event.key)) ticket.current?.preset(Number(event.key) - 1);
      else if (event.key === "/") {
        event.preventDefault();
        document.getElementById("t-amount")?.focus();
      } else if (event.key === "?") setHelp((shown) => !shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!coin) {
    return (
      <div className="app">
        <header className="app-head">
          <h1 className="h3">Coin</h1>
        </header>
        {store.problem ? (
          <p className="notice" role="alert">
            This coin could not be shown: {store.problem}.{" "}
            <button className="link" type="button" onClick={() => void store.start()}>
              Try again
            </button>{" "}
            <Link className="link" href="/terminal">
              Back to the board
            </Link>
          </p>
        ) : (
          <p className="body">Reading what the indexer holds for this coin.</p>
        )}
      </div>
    );
  }

  const series = store.candles(tf);
  const me = signer?.address ?? null;
  const marks: Mark[] = store.trades
    .filter((trade) => !trade.early && (trade.w === me || trade.w === coin.creator))
    .map((trade) => ({ at: Math.floor(trade.t / 1000), side: trade.b ? "buy" : "sell", who: trade.w === me ? "me" : "creator", price: trade.p }));
  const view: ChartView = { measure, unit, supplyCoins: Number(BigInt(coin.privacy.supply)) / 1e6, solUsd: solPrice?.usd ?? null };
  // Trading is built for pump.fun's curve and pool only. A coin priced from another program's pool is shown, not traded.
  const tradeable = (!coin.complete || coin.hasPool) && !coin.unsupported && !coin.venue;
  const readOnly = config !== null && config !== "offline" && config.network === "mainnet";

  return (
    <>
      <div className="trade-screen">
        <header className="trade-head">
          <div className="who">
            <CoinPicture image={coin.image} symbol={coin.symbol} size={40} />
            <div>
              <h1 style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <b>{coin.symbol || shortAddress(coin.mint)}</b>
                <span className="quiet wrap-anywhere">{coin.name}</span>
                <span className={`tag${coin.complete ? " hot" : ""}`}>
                  {coin.venue
                    ? "Trades in a Meteora pool"
                    : coin.complete
                      ? coin.hasPool
                        ? "Graduated: trades in its pool"
                        : "Sold out: no pool yet"
                      : "On the curve"}
                </span>
                {!coin.launchedHere && <span className="tag">Not launched here</span>}
                {coin.followedSince !== undefined && (
                  <span
                    className="tag"
                    title="It was already trading when this site first saw it. Nothing earlier is held: the chart, trades and holders start there."
                  >
                    History from when first seen
                  </span>
                )}
              </h1>
              <Address value={coin.mint} short />
            </div>
          </div>
          <div className="figures">
            <Figure label="Price">
              <CoinPrice micro={coin.microLamportsPerCoin} />
            </Figure>
            <Figure label="Market cap">
              <Sol lamports={coin.marketCapLamports} compact />
            </Figure>
            <Figure label="Volume, 24h">
              <Sol lamports={coin.volume24hLamports} compact />
            </Figure>
            <Change label="5m" bps={coin.change.m5} />
            <Change label="1h" bps={coin.change.h1} />
            <Change label="24h" bps={coin.change.h24} />
            <Figure label="Holders">{formatCompact(coin.holders)}</Figure>
            <Figure label="Trades">{formatCompact(coin.trades)}</Figure>
            <Figure label="Age">
              <Time at={coin.createdAt} />
            </Figure>
            {!coin.complete && (
              <Figure label={`Curve sold, ${formatShare(coin.progressBps * 100)}`}>
                <span className="meter" style={{ display: "block", width: 120, marginTop: 8 }}>
                  <i style={{ width: `${coin.progressBps / 100}%` }} />
                </span>
              </Figure>
            )}
          </div>
        </header>

        <div className="trade-main">
          <section className="chart-box" aria-label="Chart">
            <div className="chart-bar">
              <Segments label="Candle length" value={tf} onChange={setTf} options={TIMEFRAMES} />
              <Segments
                label="What the chart measures"
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: "cap", label: "Market cap" },
                  { value: "price", label: "Price" },
                ]}
              />
              <Segments
                label="Unit"
                value={solPrice ? unit : "sol"}
                onChange={setUnit}
                options={[...(solPrice ? [{ value: "usd" as const, label: "USD" }] : []), { value: "sol" as const, label: "SOL" }]}
              />
              <span className="read" ref={readout} data-readout />
            </div>
            <div className="chart-area">
              <CandleChart
                series={series}
                view={view}
                marks={marks}
                onRead={(text) => {
                  if (readout.current && readout.current.textContent !== text) readout.current.textContent = text;
                }}
              />
              {series.rows.length === 0 && (
                <div className="empty">{coin.trades === 0 ? "No trades yet. The first one draws the first candle." : "Reading the candles"}</div>
              )}
            </div>
          </section>
          <Feed store={store} coin={coin} me={me} />
        </div>

        <aside className="trade-side" ref={side} id="trade">
          {coin.unsupported ? (
            <section className="card" data-unsupported>
              <h2 className="px">Not supported yet</h2>
              {coin.unsupported.reason === "quote" ? (
                <p className="body">
                  This coin is priced in something other than SOL (<span className="address">{shortAddress(coin.unsupported.quote)}</span>). This site reads and
                  trades only coins priced in SOL for now, so it shows no price, chart or trades for this one, and cannot trade it. It is listed so that it is
                  not mistaken for a coin with no activity.
                </p>
              ) : (
                <p className="body">
                  This coin trades in a pump.fun pool but is not a pump.fun coin. This site works out market cap, holders&apos; shares and the rest on the
                  assumption of a pump.fun coin, so those figures would be wrong here. They are not shown, and it cannot be traded from here.
                </p>
              )}
            </section>
          ) : coin.venue && !readOnly ? (
            <section className="card" data-other-venue>
              <h2 className="px">Shown, not traded</h2>
              <p className="body">
                This coin is not pump.fun&apos;s. Its price here is read from a Meteora pool. This site can trade only on pump.fun&apos;s curve and pool, so it
                cannot buy or sell this coin.
              </p>
            </section>
          ) : readOnly ? (
            <section className="card" data-read-only>
              <h2 className="px">Trading is switched off</h2>
              <p className="body">
                This build shows Solana mainnet and sends nothing there. Prices, trades and holders on this screen are real and read from the chain; nothing can
                be bought or sold from here.
              </p>
            </section>
          ) : tradeable ? (
            <WalletGate>{signer && <Ticket coin={coin} store={store} signer={signer} bind={(handle) => (ticket.current = handle)} />}</WalletGate>
          ) : (
            <Graduate coin={coin} />
          )}
          {signer?.address === coin.creator && <CreatorFees />}
          <section className="card" aria-label="In the Ring">
            <h2 className="px">In the Ring</h2>
            <dl className="facts">
              <dt>Supply in Ring balances</dt>
              <dd>{formatShare(coin.privacy.shareInRingPartsPerMillion)}</dd>
              <dt>Wallets that have deposited it</dt>
              <dd>{coin.privacy.walletsThatDeposited}</dd>
            </dl>
            <p className="note-line">
              Two public facts. The more wallets hold a coin in the Ring, the less any one withdrawal says.{" "}
              <Link className="link" href="/docs#privacy-score">
                What this measures
              </Link>
            </p>
          </section>
          {!coin.unsupported && <Checks coin={coin} />}
          <section className="card" aria-label="About this coin">
            <h2 className="px">About</h2>
            <dl className="facts">
              <dt>Creator</dt>
              <dd>
                {coin.creator ? (
                  <span className="address" title={coin.creator}>
                    {coin.creator.slice(0, 4)}…{coin.creator.slice(-4)}
                  </span>
                ) : (
                  "Not read yet"
                )}
              </dd>
              <dt>{coin.followedSince === undefined ? "Launched" : "Followed since"}</dt>
              <dd>
                <Time at={coin.createdAt} />
              </dd>
              <dt>Trades on</dt>
              <dd>{coin.venue ? "Meteora DAMM v2 pool" : coin.hasPool ? "pump.fun pool" : "pump.fun curve"}</dd>
              {coin.signature && (
                <>
                  <dt>Launch</dt>
                  <dd>
                    <Link className="link" href={`/tx/${coin.signature}`}>
                      Receipt
                    </Link>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
      {tradeable && !readOnly && (
        <div className="trade-dock">
          <button
            type="button"
            onClick={() => {
              ticket.current?.side("buy");
              side.current?.scrollIntoView({ block: "start" });
            }}
          >
            Buy
          </button>
          <button
            type="button"
            className="sell"
            onClick={() => {
              ticket.current?.side("sell");
              side.current?.scrollIntoView({ block: "start" });
            }}
          >
            Sell
          </button>
        </div>
      )}
      <LiveStrip onHelp={() => setHelp(true)} />
      {help && (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={() => setHelp(false)}>
          <div onClick={(event) => event.stopPropagation()}>
            <h2 className="h3" id="keys-title">
              Keys on this screen
            </h2>
            <dl className="facts">
              <dt>
                <kbd>B</kbd> <kbd>S</kbd>
              </dt>
              <dd>Buy side, sell side</dd>
              <dt>
                <kbd>1</kbd> to <kbd>4</kbd>
              </dt>
              <dd>The four amount buttons</dd>
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>The amount field</dd>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>Send the typed amount</dd>
              <dt>
                <kbd>?</kbd> <kbd>Esc</kbd>
              </dt>
              <dd>This list, and closing it</dd>
            </dl>
            <p className="note-line">With one-click on, an amount key trades at once, as the button does. Keys do nothing while you are typing in a field.</p>
            <button className="btn" type="button" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}
function Change({ label, bps }: { label: string; bps: number | null }) {
  return (
    <Figure label={label}>
      {bps === null ? <span className="quiet">No trades</span> : <span className={bps < 0 ? "down" : "up"}>{formatChange(bps)}</span>}
    </Figure>
  );
}

/** A coin whose curve has sold out and whose pool nobody has made yet: it cannot be traded until someone does. */
function Graduate({ coin }: { coin: CoinView }) {
  const { signer } = useWallet();
  const tx = useTx();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!signer || busy) return;
    setBusy(true);
    const handle = tx.begin(`Making the pool for ${coin.symbol}`);
    try {
      const built = await api("graduate/build", { wallet: signer.address, mint: coin.mint });
      const sent = await signAndSend(signer, built.transaction, undefined, handle.sent);
      handle.confirmed(`${coin.symbol} now trades in its pool`, sent.signature);
    } catch (error) {
      handle.failed(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  };
  return (
    <section className="card" aria-label="Graduation">
      <h2 className="px">Sold out</h2>
      <p className="body">
        This coin&apos;s curve has sold every coin it had. From here it trades in a pool, and its pool has not been made yet. pump.fun&apos;s program lets
        anyone make it: it moves the curve&apos;s coins and SOL into the pool. Whoever does pays the network fee.
      </p>
      <p className="note-line">Public: your wallet, and that you made this pool.</p>
      <WalletGate>
        <button className="btn" type="button" disabled={busy} onClick={() => void make()}>
          {busy ? "Working" : "Make the pool"}
        </button>
      </WalletGate>
    </section>
  );
}

/** Shown to the coin's creator: the fees pump.fun has set aside for them across their coins, and a way to claim them. */
function CreatorFees() {
  const { signer } = useWallet();
  // Claiming straight into a Ring balance is built on the stand-in only. On the real program: claim, then deposit from the wallet page.
  const ringOn = useStandinOn();
  const tx = useTx();
  const [claimable, setClaimable] = useState<string | null>(null);
  const [toRing, setToRing] = useState(true);
  const [busy, setBusy] = useState(false);
  const wallet = signer?.address;
  const read = useCallback(() => {
    if (!wallet) return;
    api("fees/claimable", { wallet }).then(
      (result) => setClaimable(result.lamports),
      () => setClaimable(null),
    );
  }, [wallet]);
  useEffect(() => {
    read();
    const timer = setInterval(() => !document.hidden && read(), 15_000);
    return () => clearInterval(timer);
  }, [read]);
  const intoRing = ringOn && toRing;
  const claim = async () => {
    if (!signer || busy) return;
    setBusy(true);
    const handle = tx.begin("Claiming creator fees");
    try {
      const built = await api("fees/build", { wallet: signer.address, toRing: intoRing });
      const sent = await signAndSend(signer, built.transaction, undefined, handle.sent);
      setClaimable("0");
      handle.confirmed(`Claimed ${formatSol(built.claimable, 6)}${intoRing ? " into your Ring balance" : ""}`, sent.signature);
    } catch (error) {
      handle.failed(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  };
  return (
    <section className="card" aria-label="Creator fees" data-fees>
      <h2 className="px">Creator fees</h2>
      <p className="body" data-claimable>
        {claimable === null ? (
          "Reading what you can claim."
        ) : claimable === "0" ? (
          "Nothing to claim yet. Fees build up as people trade."
        ) : (
          <>{formatSol(claimable, 6)} to claim, across your coins.</>
        )}
      </p>
      {ringOn && (
        <Tick checked={toRing} onChange={setToRing}>
          Send the claim straight to my Ring balance
        </Tick>
      )}
      <p className="note-line">
        Public either way: your wallet, that you claimed, and the amount.
        {intoRing ? " Then a public deposit of the same amount into your Ring balance, in the same transaction." : ""}
      </p>
      <button className="btn" type="button" disabled={busy || claimable === null || claimable === "0"} onClick={() => void claim()}>
        {busy ? "Working" : "Claim"}
      </button>
    </section>
  );
}
