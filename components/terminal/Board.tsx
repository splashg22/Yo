"use client";

/**
 * The board: the coins the indexer follows, in three live columns (new, about to graduate, graduated), or ranked by
 * what they traded in the last 5 minutes, hour, 6 hours or day. The search covers every coin followed, not only the
 * rows loaded.
 *
 * It starts from one snapshot and is then kept up to date by the live "board" channel, which sends only what
 * changed about a coin. A column stops reordering while the pointer is over it, and says how many new rows
 * it is holding back, so a row never moves from under a finger.
 *
 * Keys: / search, arrows or H J K L to move, Enter to open, Q to quick-buy the marked coin, ? for this list.
 */
import {
  BUILT_IN_PRESETS,
  FIGURES,
  NEARLY_BPS,
  NO_FILTERS,
  countSet,
  decodeFilters,
  encodeFilters,
  limitsOf,
  matches,
  parsePresets,
  serialisePresets,
  type BoardFilters,
  type Preset,
} from "@/lib/board-filters";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Signer } from "@/lib/client/api";
import { clockNow } from "@/lib/client/clock";
import { subscribe } from "@/lib/client/live";
import { buildTrade, loadSettings, outcomeOf, signAndSubmit } from "@/lib/client/trade";
import { COIN_DECIMALS, SOL_DECIMALS } from "@/lib/constants";
import type { CoinView } from "@/lib/contract";
import { formatAmount, formatChange, formatCompact, formatSol, parseAmount, shortAddress } from "@/lib/format";
import { useTx } from "../tx/Tx";
import { CoinPicture } from "../ui/CoinPicture";
import { Choice, Segments, Tick } from "../ui/controls";
import { Age, UsdOfSol } from "../ui/Money";
import { useVirtual } from "../ui/useVirtual";
import { useWallet } from "../wallet/WalletProvider";
import { LiveStrip } from "./LiveStrip";

const ROW = 98;
const WINDOWS = [
  { value: "m5", label: "5m" },
  { value: "h1", label: "1h" },
  { value: "h6", label: "6h" },
  { value: "h24", label: "24h" },
] as const;
type WindowKey = (typeof WINDOWS)[number]["value"];
const isWindow = (value: unknown): value is WindowKey => WINDOWS.some((window) => window.value === value);
const volumeIn = (coin: CoinView, window: WindowKey): number => Number(coin.volumeLamports[window]);
const COLUMNS = [
  { key: "new", title: "New", empty: "No new coins match." },
  { key: "nearly", title: "About to graduate", empty: "No coin is close to selling out its curve." },
  { key: "graduated", title: "Graduated", empty: "No coin has graduated yet." },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRESETS_KEY = "ring.board.presets";
/** A share of supply for a row: "12%", or a dash where it is not known. */
const share = (bps: number | undefined): string => (bps === undefined ? "?" : `${(bps / 100).toFixed(bps < 1000 ? 1 : 0)}%`);

function columnOf(coin: CoinView): ColumnKey {
  if (coin.complete) return "graduated";
  return coin.progressBps >= NEARLY_BPS ? "nearly" : "new";
}
const ORDER: Record<ColumnKey, (a: CoinView, b: CoinView) => number> = {
  new: (a, b) => b.createdAt - a.createdAt,
  nearly: (a, b) => b.progressBps - a.progressBps || b.createdAt - a.createdAt,
  // The graduations this site saw, newest first; then coins that had graduated before it was looking, the most traded first.
  graduated: (a, b) => (b.graduatedAt ?? 0) - (a.graduatedAt ?? 0) || volumeIn(b, "h1") - volumeIn(a, "h1"),
};

export function Board() {
  const { signer, config } = useWallet();
  const readOnly = config !== null && config !== "offline" && config.network === "mainnet";
  const router = useRouter();
  const tx = useTx();
  // Replaced, never changed in place, so everything worked out from it knows when to work it out again.
  const [coins, setCoins] = useState<ReadonlyMap<string, CoinView>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [recordFrom, setRecordFrom] = useState<number | null>(null);
  const [feed, setFeed] = useState<{ scope: "all" | "coins"; live: number; followed: number } | null>(null);
  const [problem, setProblem] = useState("");
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [saved, setSaved] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const presets = useMemo(() => [...BUILT_IN_PRESETS, ...saved], [saved]);
  const applied = useMemo(() => presets.find((preset) => encodeFilters(preset.filters) === encodeFilters(filters))?.name ?? "", [presets, filters]);

  // The filters live in the address, so a filtered board can be linked to, and a reload or a new tab opens on the same one.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search);
    setFilters(decodeFilters(asked.get("f")));
    const wanted = asked.get("v");
    if (isWindow(wanted)) setView(wanted);
    try {
      setSaved(parsePresets(localStorage.getItem(PRESETS_KEY)));
    } catch {
      /* no storage: the built-in presets are still there */
    }
  }, []);
  const changeFilters = useCallback((next: BoardFilters) => {
    setFilters(next);
    const url = new URL(window.location.href);
    const code = encodeFilters(next);
    if (code) url.searchParams.set("f", code);
    else url.searchParams.delete("f");
    window.history.replaceState(null, "", url);
  }, []);
  const keepPresets = useCallback((next: Preset[]) => {
    setSaved(next);
    try {
      localStorage.setItem(PRESETS_KEY, serialisePresets(next));
    } catch {
      /* kept for this visit only */
    }
  }, []);
  const [quick, setQuick] = useState("0.05");
  const [oneClick, setOneClick] = useState(false);
  const [tab, setTab] = useState<ColumnKey>("new");
  // "board": the three columns. Otherwise the ranking by what was traded in that window.
  const [view, setView] = useState<"board" | WindowKey>("board");
  const [trend, setTrend] = useState<string[] | null>(null);
  const [cursor, setCursor] = useState<{ column: ColumnKey; index: number }>({ column: "new", index: 0 });
  const [help, setHelp] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => setOneClick(loadSettings().oneClick), []);

  const load = useCallback(async () => {
    try {
      const answer = await api("explore");
      setCoins(new Map(answer.coins.map((coin) => [coin.mint, coin])));
      setRecordFrom(answer.recordFrom);
      setFeed(answer.feed);
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
              } else if (event[0] === "x") {
                // The server has stopped following this coin: nobody was trading it.
                next.delete(event[1] as string);
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

  const changeView = useCallback((next: "board" | WindowKey) => {
    setView(next);
    setTrend(null);
    const url = new URL(window.location.href);
    if (next === "board") url.searchParams.delete("v");
    else url.searchParams.set("v", next);
    window.history.replaceState(null, "", url);
  }, []);
  /** Adds coins the server answered with to the ones held, without disturbing what the live channel has since said of a coin already held. */
  const learn = useCallback((found: CoinView[]) => {
    setCoins((current) => {
      if (found.every((coin) => current.has(coin.mint))) return current;
      const next = new Map(current);
      for (const coin of found) if (!next.has(coin.mint)) next.set(coin.mint, coin);
      return next;
    });
  }, []);
  // The ranking is the server's: it counts every coin it follows, not only the rows this page holds. Asked again every few seconds.
  useEffect(() => {
    if (view === "board") return;
    let ended = false;
    const read = () =>
      api("trending", { window: view }).then(
        (answer) => {
          if (ended) return;
          learn(answer.coins);
          setTrend(answer.coins.map((coin) => coin.mint));
        },
        (error: unknown) => !ended && setProblem(error instanceof Error ? error.message : String(error)),
      );
    void read();
    const timer = setInterval(() => !document.hidden && void read(), 3_000);
    return () => {
      ended = true;
      clearInterval(timer);
    };
  }, [view, learn]);
  // The search asks the server too, a moment after the typing stops: it knows coins this page has not loaded.
  const [searched, setSearched] = useState<{ text: string; found: number } | null>(null);
  useEffect(() => {
    const wanted = text.trim();
    if (wanted.length < 2) return setSearched(null);
    let ended = false;
    const timer = setTimeout(() => {
      api("search", { q: wanted }).then(
        (answer) => {
          if (ended) return;
          learn(answer.coins);
          setSearched({ text: wanted, found: answer.coins.length });
        },
        () => undefined,
      );
    }, 250);
    return () => {
      ended = true;
      clearTimeout(timer);
    };
  }, [text, learn]);

  const shownCoins = useMemo(() => {
    const wanted = text.trim().toLowerCase();
    const limits = limitsOf(filters);
    const now = clockNow();
    const kept: CoinView[] = [];
    for (const coin of coins.values()) {
      if (wanted && !coin.symbol.toLowerCase().includes(wanted) && !coin.name.toLowerCase().includes(wanted) && coin.mint.toLowerCase() !== wanted) continue;
      if (!matches(coin, filters, now, limits)) continue;
      kept.push(coin);
    }
    return kept;
  }, [filters, text, coins]);
  const columns = useMemo(() => {
    const lists: Record<ColumnKey, CoinView[]> = { new: [], nearly: [], graduated: [] };
    for (const coin of shownCoins) {
      const column = columnOf(coin);
      // "New" is for coins seen being made. One that was already trading when first seen has no known age: it is in the ranking and the search.
      if (column === "new" && coin.followedSince !== undefined && text.trim() === "") continue;
      lists[column].push(coin);
    }
    for (const key of Object.keys(lists) as ColumnKey[]) lists[key].sort(ORDER[key]);
    return lists;
  }, [shownCoins, text]);
  const ranked = useMemo(() => {
    if (view === "board") return [];
    // With something typed: every match, the most traded first. Otherwise the server's ranking, in its order.
    if (text.trim() !== "") return [...shownCoins].sort((a, b) => volumeIn(b, view) - volumeIn(a, view));
    const allowed = new Map(shownCoins.map((coin) => [coin.mint, coin]));
    return (trend ?? []).flatMap((mint) => allowed.get(mint) ?? []);
  }, [view, trend, shownCoins, text]);

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

  const typed = text.trim();
  const unknownAddress = ADDRESS.test(typed) && !coins.has(typed);
  const active = countSet(filters);

  return (
    <>
      <div className="app" style={{ maxWidth: "none", padding: "12px 0 0", gap: 12 }}>
        <header className="app-head" style={{ margin: "0 16px" }}>
          <h1 className="h3">Terminal</h1>
          <p>Every coin this server follows. Trades here are public pump.fun trades.</p>
        </header>
        <div className="toolbar">
          <div className="field-row search">
            <input
              ref={search}
              id="board-search"
              type="search"
              aria-label="Search by name, ticker or address"
              placeholder="Name, ticker, or paste any pump.fun coin's address"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="unit">
              <kbd>/</kbd>
            </span>
          </div>
          <button className="btn" type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Filters{active > 0 ? ` (${active})` : ""}
          </button>
          <Segments
            label="View"
            value={view === "board" ? "board" : "trending"}
            onChange={(next) => changeView(next === "board" ? "board" : "h1")}
            options={[
              { value: "board", label: "Columns" },
              { value: "trending", label: "Trending" },
            ]}
          />
          {view !== "board" && <Segments label="Trending over" value={view} onChange={changeView} options={[...WINDOWS]} />}
          {/* Quick buy belongs to trading. On mainnet this build is read-only, so the field is not shown at all. */}
          {!readOnly && (
            <label className="field-row" style={{ width: 250 }}>
              <span className="unit" style={{ borderLeft: 0, borderRight: "1px solid var(--rule)" }}>
                Quick buy
              </span>
              <input aria-label="Quick buy amount, in SOL" inputMode="decimal" value={quick} onChange={(event) => setQuick(event.target.value)} />
              <span className="unit">SOL</span>
            </label>
          )}
          <span className="phone-only" hidden={view !== "board"}>
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
            <div className="presets-row">
              <Choice
                id="board-preset"
                label="Preset"
                value={applied}
                onChange={(name) => changeFilters(presets.find((preset) => preset.name === name)?.filters ?? NO_FILTERS)}
                options={[
                  { value: "", label: applied === "" && active > 0 ? "Your own filters" : "No preset" },
                  ...presets.map((preset) => ({ value: preset.name, label: preset.name })),
                ]}
              />
              <span className="field-row" style={{ width: 220 }}>
                <input
                  aria-label="Name for these filters"
                  placeholder="Name these filters"
                  maxLength={40}
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
              </span>
              <button
                className="btn"
                type="button"
                disabled={active === 0 || presetName.trim() === "" || BUILT_IN_PRESETS.some((preset) => preset.name === presetName.trim())}
                onClick={() => {
                  keepPresets([...saved.filter((preset) => preset.name !== presetName.trim()), { name: presetName.trim(), filters }]);
                  setPresetName("");
                }}
              >
                Save
              </button>
              {saved.some((preset) => preset.name === applied) && (
                <button className="link" type="button" onClick={() => keepPresets(saved.filter((preset) => preset.name !== applied))}>
                  Remove &quot;{applied}&quot;
                </button>
              )}
              <button className="link" type="button" onClick={() => changeFilters(NO_FILTERS)}>
                Clear the filters
              </button>
            </div>
            <div className="ranges">
              {FIGURES.map((figure) => (
                <div key={figure.key} className="range" data-figure={figure.key}>
                  <span className="label">
                    {figure.label}
                    {figure.unit ? `, ${figure.unit}` : ""}
                  </span>
                  <span className="field-row">
                    <input
                      aria-label={`${figure.label} at least`}
                      placeholder="from"
                      inputMode="decimal"
                      value={filters.ranges[figure.key]?.min ?? ""}
                      onChange={(event) =>
                        changeFilters({ ...filters, ranges: { ...filters.ranges, [figure.key]: { ...filters.ranges[figure.key], min: event.target.value } } })
                      }
                    />
                    <input
                      aria-label={`${figure.label} at most`}
                      placeholder="to"
                      inputMode="decimal"
                      value={filters.ranges[figure.key]?.max ?? ""}
                      onChange={(event) =>
                        changeFilters({ ...filters, ranges: { ...filters.ranges, [figure.key]: { ...filters.ranges[figure.key], max: event.target.value } } })
                      }
                    />
                  </span>
                </div>
              ))}
            </div>
            <Tick checked={filters.hereOnly} onChange={(hereOnly) => changeFilters({ ...filters, hereOnly })}>
              Launched here only
            </Tick>
            <p className="note-line">
              A coin fails a filter on a figure that is not known for it. Snipers, bundles and insiders are known only for coins followed from their first
              block.{" "}
              <Link className="link" href="/docs#risk-figures">
                How each figure is worked out
              </Link>
            </p>
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
        {searched && searched.text === typed && !unknownAddress && (
          <p className="note-line" style={{ margin: "0 16px" }} data-searched>
            Searched every coin this server follows: {searched.found === 0 ? "none" : searched.found === 30 ? "the best 30" : searched.found} matched by name or
            ticker. A coin it does not follow yet is found by its address.
          </p>
        )}
        {view === "board" ? (
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
                canQuick={signer !== null && oneClick && !readOnly}
                readOnly={readOnly}
                onQuick={(coin) => signer && void quickBuy(coin, signer)}
                window="h24"
              />
            ))}
          </div>
        ) : (
          <div className="board3 one">
            <Column
              title={`Most traded, last ${WINDOWS.find((window) => window.value === view)!.label}`}
              empty={trend === null ? "Reading the ranking." : "Nothing this server follows traded in that time."}
              coins={ranked}
              shown
              cursor={-1}
              quick={quick}
              canQuick={signer !== null && oneClick && !readOnly}
              readOnly={readOnly}
              onQuick={(coin) => signer && void quickBuy(coin, signer)}
              window={view}
              numbered
            />
          </div>
        )}
        <p className="note-line" style={{ margin: "0 16px" }} data-coverage>
          {recordFrom !== null && clockNow() - recordFrom < 86_400_000 && (
            <>
              This server&apos;s record begins <Age at={recordFrom} /> ago: volume, buys and sells &quot;in 24 hours&quot; count only since then, and a coin
              marked &quot;followed&quot; shows only the holders seen since.{" "}
            </>
          )}
          {feed?.scope === "coins" && (
            <span data-partial-feed>
              This server receives every new coin, and every trade of {feed.live.toLocaleString("en-US")} of the {feed.followed.toLocaleString("en-US")} coins
              it follows: the newest, and any somebody has open. The rest show their figures with their age, and the trending lists rank only the coins received
              trade by trade.{" "}
            </span>
          )}
          Covered: pump.fun coins priced in SOL, on the curve and in their pump.fun pool after graduation.{" "}
          <Link className="link" href="/docs#coverage">
            What is covered, what is not, and how far back
          </Link>
        </p>
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
  window,
  readOnly,
  numbered = false,
}: {
  title: string;
  empty: string;
  coins: CoinView[];
  shown: boolean;
  cursor: number;
  quick: string;
  canQuick: boolean;
  onQuick: (coin: CoinView) => void;
  /** Which window's volume the rows show. */
  window: WindowKey;
  /** True where nothing can be traded: a row then offers to open the coin, not to trade it. */
  readOnly: boolean;
  /** True for a ranking: each row carries its place. */
  numbered?: boolean;
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
      <Row
        key={coin.mint}
        coin={coin}
        style={list.place(index)}
        marked={coin.mint === cursorRow?.mint}
        quick={quick}
        canQuick={canQuick}
        onQuick={onQuick}
        window={window}
        readOnly={readOnly}
        place={numbered ? index + 1 : undefined}
      />,
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
  window,
  readOnly,
  place,
}: {
  coin: CoinView;
  style: { top: number; height: number };
  marked: boolean;
  quick: string;
  canQuick: boolean;
  onQuick: (coin: CoinView) => void;
  window: WindowKey;
  readOnly: boolean;
  place: number | undefined;
}) {
  const tradeable = (!coin.complete || coin.hasPool) && !coin.unsupported && !coin.venue;
  const change = coin.change.m5 ?? coin.change.h1 ?? coin.change.h24;
  return (
    <div className={`coin-row${marked ? " cursor" : ""}`} style={style} data-coin={coin.mint}>
      <Link
        href={`/coin/${coin.mint}`}
        aria-label={`${coin.symbol || shortAddress(coin.mint)}, ${coin.name || "name not read yet"}`}
        style={{ display: "contents" }}
      >
        <CoinPicture image={coin.image} symbol={coin.symbol} size={40} />
        <span className="name">
          <span className="line1">
            {place !== undefined && <span className="quiet mono">{place}</span>}
            <b>{coin.symbol || shortAddress(coin.mint)}</b>
            <span className="full" title={coin.name || "This coin's name has not been read from the chain yet"}>
              {coin.name || "Name not read yet"}
            </span>
            {coin.venue && (
              <span
                className="tag"
                title="Not a pump.fun coin. Its price is read from a Meteora DAMM v2 pool against SOL. It can be looked at here, not traded."
              >
                Meteora
              </span>
            )}
            {coin.mayhem && (
              <span
                className="tag"
                title="A pump.fun Mayhem mode coin. Its supply is two thousand million: half was minted to pump.fun's own trading agent. Market cap counts all of it, as pump.fun does; holder shares leave the agent's vault out."
              >
                Mayhem
              </span>
            )}
          </span>
          <span className="sub">
            {coin.unsupported ? (
              coin.unsupported.reason === "quote" ? (
                <span className="tag" title="This coin is priced in something other than SOL. This site cannot chart or trade those yet.">
                  Not priced in SOL: not supported yet
                </span>
              ) : (
                <span className="tag" title="It trades in a pump.fun pool but is not a pump.fun coin. The figures this site works out would be wrong for it.">
                  Not a pump.fun coin: not supported yet
                </span>
              )
            ) : (
              <>
                {/* A coin that was already trading when it was first seen has no known age: what is known is since when it has been followed. */}
                {coin.followedSince !== undefined && (
                  <span title="It was already trading when this site first saw it. Nothing earlier is held.">followed </span>
                )}
                <Age at={coin.createdAt} /> ·{" "}
                {coin.followedSince === undefined ? (
                  <>
                    {formatCompact(coin.holders)} holder{coin.holders === 1 ? "" : "s"}
                  </>
                ) : (
                  <span title="Only the wallets whose holdings changed since this coin was first seen. It has at least this many holders.">
                    {formatCompact(coin.holders)}+ holders
                  </span>
                )}
              </>
            )}
            {!coin.unsupported && (
              <span className="roomy">
                {" "}
                · {formatCompact(coin.trades)} trade{coin.trades === 1 ? "" : "s"}
              </span>
            )}
          </span>
          {!coin.complete && (
            <span className="meter" title={`${(coin.progressBps / 100).toFixed(1)}% of the curve sold`}>
              <i style={{ width: `${coin.progressBps / 100}%` }} />
            </span>
          )}
        </span>
        {/* A coin this site cannot price is shown with no price at all, never with a zero or a guess. */}
        {coin.unsupported ? (
          <span className="nums" />
        ) : (
          <span className="nums">
            <span title="Market cap">
              MC <UsdOfSol lamports={coin.marketCapLamports} />
            </span>
            {coin.notLiveSince !== undefined ? (
              // Not passed off as live: this coin's trades are not being received, and its figures are as old as this says.
              <span
                className="quiet"
                title="This coin's trades are not being received as they happen. Its figures are from the time shown. Opening it makes it live."
              >
                as of <Age at={coin.notLiveSince} />
              </span>
            ) : (
              <span className={change !== null && change < 0 ? "down" : "up"}>{change === null ? "" : formatChange(change)}</span>
            )}
          </span>
        )}
        {!coin.unsupported && (
          <span className="figs" data-figs>
            <span title={`Volume traded in the last ${WINDOWS.find((entry) => entry.value === window)!.label}`}>
              V <UsdOfSol lamports={coin.volumeLamports[window]} />
            </span>
            <span title={coin.complete ? "SOL in the coin's pool" : "SOL in the coin's curve"}>
              Liq <UsdOfSol lamports={coin.liquidityLamports} />
            </span>
            <span title="Buys and sells in the last 24 hours">
              <span className="up">{formatCompact(coin.buys24h)}</span>/<span className="down">{formatCompact(coin.sells24h)}</span>
            </span>
          </span>
        )}
        {coin.risk && !coin.unsupported && (
          <span className="risk" data-risk>
            {coin.followedSince === undefined ? (
              <span title="Share of supply held by the ten largest holders">T10 {share(coin.risk.top10Bps)}</span>
            ) : (
              <span title="At least this share is held by ten wallets. Only wallets seen since this coin was first followed are counted, so the real figure may be higher.">
                T10 {coin.risk.top10Bps === undefined ? "?" : `≥${share(coin.risk.top10Bps)}`}
              </span>
            )}
            <span title="Share held by the wallet that created the coin">Dev {coin.followedSince === undefined ? share(coin.risk.devBps) : "?"}</span>
            <span title="Share still held by wallets that bought in the coin's first three slots">Snp {share(coin.risk.snipers?.heldBps)}</span>
            <span title="Share still held by early buyers who bought three or more to a slot">Bnd {share(coin.risk.bundles?.heldBps)}</span>
            <span title="Share held by wallets that hold the coin and never bought it">Ins {share(coin.risk.insiders?.heldBps)}</span>
          </span>
        )}
      </Link>
      {canQuick && tradeable ? (
        <button className="quick" type="button" onClick={() => onQuick(coin)} aria-label={`Buy ${coin.symbol} for ${quick} SOL now`}>
          {quick}
        </button>
      ) : (
        <Link
          className="quick"
          href={tradeable && !readOnly ? `/coin/${coin.mint}#trade` : `/coin/${coin.mint}`}
          style={{ display: "grid", placeItems: "center" }}
        >
          {tradeable && !readOnly ? "Trade" : "View"}
        </Link>
      )}
    </div>
  );
}
