"use client";

/**
 * The board: every coin the indexer follows, in three live columns. New, about to graduate, graduated.
 *
 * It starts from one snapshot and is then kept up to date by the live "board" channel, which sends only what
 * changed about a coin. A column stops reordering while the pointer is over it, and says how many new rows
 * it is holding back, so a row never moves from under a finger.
 *
 * Keys: / search, arrows or H J K L to move, Enter to open, Q to quick-buy the marked coin, ? for this list.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Signer } from "@/lib/client/api";
import { subscribe } from "@/lib/client/live";
import { buildTrade, loadSettings, outcomeOf, signAndSubmit } from "@/lib/client/trade";
import { COIN_DECIMALS, SOL_DECIMALS } from "@/lib/constants";
import type { CoinView } from "@/lib/contract";
import { formatAmount, formatChange, formatCompact, formatSol, parseAmount } from "@/lib/format";
import { useTx } from "../tx/Tx";
import { CoinPicture } from "../ui/CoinPicture";
import { Segments, Tick } from "../ui/controls";
import { Age, UsdOfSol } from "../ui/Money";
import { useVirtual } from "../ui/useVirtual";
import { useWallet } from "../wallet/WalletProvider";
import { LiveStrip } from "./LiveStrip";

/** A coin is "about to graduate" once its curve has sold this share, in hundredths of a percent. */
const NEARLY_BPS = 6_000;
const ROW = 68;
const COLUMNS = [
  { key: "new", title: "New", empty: "No new coins match." },
  { key: "nearly", title: "About to graduate", empty: "No coin is close to selling out its curve." },
  { key: "graduated", title: "Graduated", empty: "No coin has graduated yet." },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

interface Filters {
  text: string;
  minCap: string;
  maxCap: string;
  minVolume: string;
  minHolders: string;
  maxAgeMinutes: string;
  hereOnly: boolean;
}
const NO_FILTERS: Filters = { text: "", minCap: "", maxCap: "", minVolume: "", minHolders: "", maxAgeMinutes: "", hereOnly: false };
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const lamportsOf = (text: string): bigint | null => {
  try {
    return text.trim() === "" ? null : parseAmount(text, SOL_DECIMALS);
  } catch {
    return null;
  }
};

function columnOf(coin: CoinView): ColumnKey {
  if (coin.complete) return "graduated";
  return coin.progressBps >= NEARLY_BPS ? "nearly" : "new";
}
const ORDER: Record<ColumnKey, (a: CoinView, b: CoinView) => number> = {
  new: (a, b) => b.createdAt - a.createdAt,
  nearly: (a, b) => b.progressBps - a.progressBps || b.createdAt - a.createdAt,
  graduated: (a, b) => (b.lastTradeAt ?? b.createdAt) - (a.lastTradeAt ?? a.createdAt),
};

export function Board() {
  const { signer } = useWallet();
  const router = useRouter();
  const tx = useTx();
  // Replaced, never changed in place, so everything worked out from it knows when to work it out again.
  const [coins, setCoins] = useState<ReadonlyMap<string, CoinView>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [quick, setQuick] = useState("0.05");
  const [oneClick, setOneClick] = useState(false);
  const [tab, setTab] = useState<ColumnKey>("new");
  const [cursor, setCursor] = useState<{ column: ColumnKey; index: number }>({ column: "new", index: 0 });
  const [help, setHelp] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => setOneClick(loadSettings().oneClick), []);

  const load = useCallback(async () => {
    try {
      const answer = await api("explore");
      setCoins(new Map(answer.coins.map((coin) => [coin.mint, coin])));
      setProblem("");
      setLoaded(true);
      return answer.seq;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, []);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let ended = false;
    void load().then((seq) => {
      if (ended) return;
      stop = subscribe("board", seq, {
        events: (events) =>
          setCoins((current) => {
            const next = new Map(current);
            for (const event of events) {
              if (event[0] === "n") {
                const coin = event[1] as CoinView;
                next.set(coin.mint, coin);
              } else if (event[0] === "u") {
                const [, mint, patch] = event as [string, string, Partial<CoinView>];
                const known = next.get(mint);
                if (known) next.set(mint, { ...known, ...patch });
              }
            }
            return next;
          }),
        reset: () => void load(),
      });
    });
    return () => {
      ended = true;
      stop?.();
    };
  }, [load]);

  const columns = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    const [minCap, maxCap, minVolume] = [lamportsOf(filters.minCap), lamportsOf(filters.maxCap), lamportsOf(filters.minVolume)];
    const minHolders = Number(filters.minHolders) || 0;
    const maxAge = Number(filters.maxAgeMinutes) > 0 ? Number(filters.maxAgeMinutes) * 60_000 : null;
    const now = Date.now();
    const lists: Record<ColumnKey, CoinView[]> = { new: [], nearly: [], graduated: [] };
    for (const coin of coins.values()) {
      if (text && !coin.symbol.toLowerCase().includes(text) && !coin.name.toLowerCase().includes(text) && coin.mint.toLowerCase() !== text) continue;
      if (minCap !== null && BigInt(coin.marketCapLamports) < minCap) continue;
      if (maxCap !== null && BigInt(coin.marketCapLamports) > maxCap) continue;
      if (minVolume !== null && BigInt(coin.volume24hLamports) < minVolume) continue;
      if (coin.holders < minHolders) continue;
      if (maxAge !== null && now - coin.createdAt > maxAge) continue;
      if (filters.hereOnly && !coin.launchedHere) continue;
      lists[columnOf(coin)].push(coin);
    }
    for (const key of Object.keys(lists) as ColumnKey[]) lists[key].sort(ORDER[key]);
    return lists;
  }, [filters, coins]);

  const quickBuy = useCallback(
    async (coin: CoinView, who: Signer) => {
      let lamports: bigint;
      try {
        lamports = parseAmount(quick, SOL_DECIMALS);
      } catch (error) {
        return setProblem(`Quick buy: ${error instanceof Error ? error.message : String(error)}`);
      }
      const handle = tx.begin(`Buying ${coin.symbol} for ${formatSol(lamports)}`);
      try {
        const settings = loadSettings();
        const built = await buildTrade({ wallet: who.address, mint: coin.mint, side: "buy", amount: lamports, settings });
        const signature = await signAndSubmit(who, built, who.kind === "browser");
        handle.sent(signature);
        const outcome = await outcomeOf(who.address, signature);
        if (outcome.state === "confirmed") handle.confirmed(`Bought about ${formatAmount(built.expected, COIN_DECIMALS, 2)} ${coin.symbol}`);
        else handle.failed(outcome.problem ?? "the trade did not go through", outcome.state === "expired");
      } catch (error) {
        handle.failed(error instanceof Error ? error.message : String(error));
      }
    },
    [quick, tx],
  );

  // Keys. Ignored while typing, except Escape, which leaves the search field.
  useEffect(() => {
    const order: ColumnKey[] = ["new", "nearly", "graduated"];
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "Escape") {
        setHelp(false);
        if (typing) target.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        search.current?.focus();
      } else if (key === "?") setHelp((shown) => !shown);
      else if (key === "j" || key === "arrowdown" || key === "k" || key === "arrowup") {
        event.preventDefault();
        const step = key === "j" || key === "arrowdown" ? 1 : -1;
        setCursor((current) => ({ ...current, index: Math.max(0, Math.min(columns[current.column].length - 1, current.index + step)) }));
      } else if (key === "h" || key === "arrowleft" || key === "l" || key === "arrowright") {
        const step = key === "l" || key === "arrowright" ? 1 : -1;
        setCursor((current) => {
          const column = order[Math.max(0, Math.min(2, order.indexOf(current.column) + step))]!;
          setTab(column);
          return { column, index: Math.min(current.index, Math.max(0, columns[column].length - 1)) };
        });
      } else if (key === "enter") {
        const coin = columns[cursor.column][cursor.index];
        if (coin) router.push(`/coin/${coin.mint}`);
      } else if (key === "q") {
        const coin = columns[cursor.column][cursor.index];
        if (coin && signer && oneClick && !(coin.complete && !coin.hasPool)) void quickBuy(coin, signer);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columns, cursor, router, signer, oneClick, quickBuy]);

  const typed = filters.text.trim();
  const unknownAddress = ADDRESS.test(typed) && !coins.has(typed);
  const active = Object.entries(filters).filter(([key, value]) => key !== "text" && value !== "" && value !== false).length;

  return (
    <>
      <div className="app" style={{ maxWidth: "none", padding: "12px 0 0", gap: 12 }}>
        <header className="app-head" style={{ margin: "0 16px" }}>
          <h1 className="h3">Terminal</h1>
          <p>Every coin the indexer follows, live. Trades here are public pump.fun trades.</p>
        </header>
        <div className="toolbar">
          <div className="field-row search">
            <input
              ref={search}
              id="board-search"
              type="search"
              aria-label="Search by name, ticker or address"
              placeholder="Name, ticker, or paste any pump.fun coin's address"
              value={filters.text}
              onChange={(event) => setFilters({ ...filters, text: event.target.value })}
            />
            <span className="unit">
              <kbd>/</kbd>
            </span>
          </div>
          <button className="btn" type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Filters{active > 0 ? ` (${active})` : ""}
          </button>
          <label className="field-row" style={{ width: 250 }}>
            <span className="unit" style={{ borderLeft: 0, borderRight: "1px solid var(--rule)" }}>
              Quick buy
            </span>
            <input aria-label="Quick buy amount, in SOL" inputMode="decimal" value={quick} onChange={(event) => setQuick(event.target.value)} />
            <span className="unit">SOL</span>
          </label>
          <span className="phone-only">
            <Segments
              label="Column"
              value={tab}
              onChange={(next) => {
                setTab(next);
                setCursor({ column: next, index: 0 });
              }}
              options={COLUMNS.map((column) => ({ value: column.key, label: `${column.title} ${columns[column.key].length}` }))}
            />
          </span>
        </div>
        {showFilters && (
          <div className="filters" role="group" aria-label="Filters">
            {(
              [
                ["minCap", "Market cap at least, SOL"],
                ["maxCap", "Market cap at most, SOL"],
                ["minVolume", "Volume in 24h at least, SOL"],
                ["minHolders", "Holders at least"],
                ["maxAgeMinutes", "Age at most, minutes"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <span className="field-row">
                  <input inputMode="decimal" value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} />
                </span>
              </label>
            ))}
            <Tick checked={filters.hereOnly} onChange={(hereOnly) => setFilters({ ...filters, hereOnly })}>
              Launched here only
            </Tick>
            <button className="link" type="button" onClick={() => setFilters({ ...NO_FILTERS, text: filters.text })}>
              Clear the filters
            </button>
          </div>
        )}
        {problem && (
          <p className="notice" role="alert" style={{ margin: "0 16px" }}>
            {problem}{" "}
            <button className="link" type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}
        {unknownAddress && (
          <p className="notice" style={{ margin: "0 16px" }}>
            That address is not on the board.{" "}
            <Link className="link" href={`/coin/${typed}`}>
              Open it
            </Link>
            : if it is a pump.fun coin, its trades are read from the chain and it is followed from then on.
          </p>
        )}
        <div className="board3">
          {COLUMNS.map((column) => (
            <Column
              key={column.key}
              title={column.title}
              empty={loaded ? column.empty : "Reading what the indexer holds."}
              coins={columns[column.key]}
              shown={tab === column.key}
              cursor={cursor.column === column.key ? cursor.index : -1}
              quick={quick}
              canQuick={signer !== null && oneClick}
              onQuick={(coin) => signer && void quickBuy(coin, signer)}
            />
          ))}
        </div>
      </div>
      <LiveStrip onHelp={() => setHelp(true)} />
      {help && (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="board-keys" onClick={() => setHelp(false)}>
          <div onClick={(event) => event.stopPropagation()}>
            <h2 className="h3" id="board-keys">
              Keys on the board
            </h2>
            <dl className="facts">
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>Search</dd>
              <dt>
                <kbd>J</kbd> <kbd>K</kbd> or arrows
              </dt>
              <dd>Down and up the column</dd>
              <dt>
                <kbd>H</kbd> <kbd>L</kbd> or arrows
              </dt>
              <dd>The column to the left or right</dd>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>Open the marked coin</dd>
              <dt>
                <kbd>Q</kbd>
              </dt>
              <dd>Quick-buy the marked coin</dd>
              <dt>
                <kbd>?</kbd> <kbd>Esc</kbd>
              </dt>
              <dd>This list, and closing it</dd>
            </dl>
            <p className="note-line">
              Quick buy sends a real, public trade at once, for the amount in the quick buy field. It works only with one-click trading turned on, which is done
              on any coin&apos;s trading screen.
            </p>
            <button className="btn" type="button" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Column({
  title,
  empty,
  coins,
  shown,
  cursor,
  quick,
  canQuick,
  onQuick,
}: {
  title: string;
  empty: string;
  coins: CoinView[];
  shown: boolean;
  cursor: number;
  quick: string;
  canQuick: boolean;
  onQuick: (coin: CoinView) => void;
}) {
  // While the pointer is over the column, the rows keep the order they had when it arrived.
  const [held, setHeld] = useState<string[] | null>(null);
  const byMint = useMemo(() => new Map(coins.map((coin) => [coin.mint, coin])), [coins]);
  const rows = useMemo(() => (held ? held.flatMap((mint) => byMint.get(mint) ?? []) : coins), [held, byMint, coins]);
  const waiting = held ? coins.filter((coin) => !held.includes(coin.mint)).length : 0;
  const list = useVirtual(rows.length, ROW, 4);
  const cursorRow = cursor >= 0 ? rows[cursor] : undefined;

  const drawn = [];
  for (let index = list.first; index <= list.last; index++) {
    const coin = rows[index]!;
    drawn.push(
      <Row key={coin.mint} coin={coin} style={list.place(index)} marked={coin.mint === cursorRow?.mint} quick={quick} canQuick={canQuick} onQuick={onQuick} />,
    );
  }
  return (
    <section className={`board-col${shown ? " shown" : ""}`} aria-label={title} data-column={title}>
      <header>
        <h2 className="px" style={{ fontSize: 13, letterSpacing: "0.14em" }}>
          {title} <span className="quiet mono">{coins.length}</span>
        </h2>
        {held && <span className="tag hot">Paused{waiting > 0 ? ` +${waiting}` : ""}</span>}
      </header>
      <div className="list" ref={list.scroller} onPointerEnter={() => setHeld(coins.map((coin) => coin.mint))} onPointerLeave={() => setHeld(null)}>
        {rows.length === 0 ? (
          <p className="body" style={{ padding: 16 }}>
            {empty}
          </p>
        ) : (
          <div style={{ height: list.total, position: "relative" }}>{drawn}</div>
        )}
      </div>
    </section>
  );
}

function Row({
  coin,
  style,
  marked,
  quick,
  canQuick,
  onQuick,
}: {
  coin: CoinView;
  style: { top: number; height: number };
  marked: boolean;
  quick: string;
  canQuick: boolean;
  onQuick: (coin: CoinView) => void;
}) {
  const tradeable = !coin.complete || coin.hasPool;
  const change = coin.change.m5 ?? coin.change.h1 ?? coin.change.h24;
  return (
    <div className={`coin-row${marked ? " cursor" : ""}`} style={style} data-coin={coin.mint}>
      <Link href={`/coin/${coin.mint}`} aria-label={`${coin.symbol}, ${coin.name}`} style={{ display: "contents" }}>
        <CoinPicture image={coin.image} symbol={coin.symbol} size={40} />
        <span className="name">
          <b>{coin.symbol}</b>
          <span className="sub">
            {coin.name} · <Age at={coin.createdAt} /> · {formatCompact(coin.holders)} holder{coin.holders === 1 ? "" : "s"} · {formatCompact(coin.trades)} trade
            {coin.trades === 1 ? "" : "s"}
          </span>
          {!coin.complete && (
            <span className="meter" title={`${(coin.progressBps / 100).toFixed(1)}% of the curve sold`}>
              <i style={{ width: `${coin.progressBps / 100}%` }} />
            </span>
          )}
        </span>
        <span className="nums">
          <span title="Market cap">
            <UsdOfSol lamports={coin.marketCapLamports} />
          </span>
          <span className="quiet" title="Volume in 24 hours">
            V <UsdOfSol lamports={coin.volume24hLamports} />
          </span>
          <span className={change !== null && change < 0 ? "down" : "up"}>{change === null ? "" : formatChange(change)}</span>
        </span>
      </Link>
      {canQuick && tradeable ? (
        <button className="quick" type="button" onClick={() => onQuick(coin)} aria-label={`Buy ${coin.symbol} for ${quick} SOL now`}>
          {quick}
        </button>
      ) : (
        <Link className="quick" href={`/coin/${coin.mint}#trade`} style={{ display: "grid", placeItems: "center" }}>
          {tradeable ? "Trade" : "View"}
        </Link>
      )}
    </div>
  );
}
