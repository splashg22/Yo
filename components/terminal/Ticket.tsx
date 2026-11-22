"use client";

/**
 * The buy and sell panel. Amount buttons, a typed amount, slippage and priority fee, and one-click trading.
 *
 * What a trade makes public is stated in the panel itself, above the buttons, at all times: with one-click on
 * there is no second step, so the statement cannot wait for one.
 *
 * The screen answers a press at once: the trade appears in the tray as "signing", then "sent" with its receipt
 * the moment the network has it, then "confirmed" or "failed" when the chain has spoken. The trade also
 * appears in the feed straight away, marked as not yet confirmed, and is taken back if it does not land.
 */
import { Pending } from "../ui/Pending";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Signer } from "@/lib/client/api";
import type { CoinStore } from "@/lib/client/coin-store";
import {
  PREPARED_GOOD_FOR_MS,
  SELL_SHARES,
  buildTrade,
  loadSettings,
  outcomeOf,
  prepareTrades,
  saveSettings,
  signAndSubmit,
  type Prepared,
  type TradeSettings,
} from "@/lib/client/trade";
import { COIN_DECIMALS, NATIVE, SOL_DECIMALS } from "@/lib/constants";
import type { BuiltTradeView, CoinView, PositionView } from "@/lib/contract";
import { formatAmount, formatChange, formatSol, formatTokens, parseAmount, shortAddress } from "@/lib/format";
import { useTx } from "../tx/Tx";
import { Tick } from "../ui/controls";
import { Sol } from "../ui/Money";
import { useWallet } from "../wallet/WalletProvider";

/** Kept back on a buy for the network fee and the rent of the coin's account, so a buy the wallet cannot pay for is never sent. */
const BUY_RESERVE_LAMPORTS = 3_000_000n;
const SLIPPAGE_CHOICES = [50, 100, 200, 500] as const;
const PRIORITY_CHOICES = [
  ["0", "None"],
  ["100000", "0.0001"],
  ["1000000", "0.001"],
  ["5000000", "0.005"],
] as const;

export interface TicketHandle {
  side: (side: "buy" | "sell") => void;
  preset: (index: number) => void;
}

export function Ticket({ coin, store, signer, bind }: { coin: CoinView; store: CoinStore; signer: Signer; bind?: (handle: TicketHandle | null) => void }) {
  const { config } = useWallet();
  const tx = useTx();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [settings, setSettings] = useState<TradeSettings | null>(null);
  const [balances, setBalances] = useState<Record<string, string> | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState({ slippage: "", priority: "" });
  const prepared = useRef<Prepared | null>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => setSettings(loadSettings()), []);
  const change = useCallback((patch: Partial<TradeSettings>) => {
    setSettings((current) => {
      const next = { ...(current ?? loadSettings()), ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [held, mine] = await Promise.all([api("wallet/public", { wallet: signer.address }), api("position", { wallet: signer.address, mint: coin.mint })]);
      setBalances(held.balances);
      setPosition(mine.position);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [signer.address, coin.mint]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sol = BigInt(balances?.[NATIVE] ?? "0");
  const held = BigInt(balances?.[coin.mint] ?? "0");
  const priority = BigInt(settings?.priorityLamports ?? "0");
  const known = balances !== null;
  // Until the balance has been read nobody can say the wallet is short: a buy pressed in that first moment goes ahead, and
  // the chain, which checks every transaction before taking it, is the judge. Saying "too little SOL" then would be a guess.
  const affords = useCallback((lamports: bigint): boolean => !known || sol >= lamports + BUY_RESERVE_LAMPORTS + priority, [known, sol, priority]);
  const buyAmounts = useMemo(
    () =>
      (settings?.buys ?? []).map((text) => {
        try {
          return parseAmount(text, SOL_DECIMALS);
        } catch {
          return 0n;
        }
      }),
    [settings?.buys],
  );
  const sellAmounts = useMemo(() => SELL_SHARES.map((share) => (held * BigInt(share)) / 100n), [held]);
  const fast = settings?.oneClick === true && signer.kind === "browser";

  // With one-click on, the trades behind the amount buttons are built ahead of the press, and built again when anything they depend on moves.
  const key = `${signer.address}|${coin.mint}|${settings?.slippageBps}|${settings?.priorityLamports}|${buyAmounts.join()}|${sellAmounts.join()}`;
  const price = coin.microLamportsPerCoin;
  useEffect(() => {
    prepared.current = null;
    setReady(0);
    if (!settings?.oneClick || coin.complete !== coin.hasPool || !known) return;
    let stopped = false;
    const prepare = () =>
      void prepareTrades(
        signer.address,
        coin.mint,
        settings,
        buyAmounts.filter((lamports) => lamports > 0n),
        sellAmounts,
        key,
      ).then(
        (built) => {
          if (stopped) return;
          prepared.current = built;
          setReady(built.buys.size + built.sells.size);
        },
        () => undefined, // a trade that could not be built ahead is built at the press instead
      );
    const soon = setTimeout(prepare, 250);
    const again = setInterval(prepare, 20_000);
    return () => {
      stopped = true;
      clearTimeout(soon);
      clearInterval(again);
    };
    // The price is a dependency on purpose: a prepared trade is bound to the price it was built at.
  }, [key, price, settings, signer.address, coin.mint, coin.complete, coin.hasPool, known, buyAmounts, sellAmounts]);

  const trade = useCallback(
    async (tradeSide: "buy" | "sell", baseUnits: bigint) => {
      if (!settings || baseUnits <= 0n) return;
      const label = tradeSide === "buy" ? `Buying ${coin.symbol} for ${formatSol(baseUnits)}` : `Selling ${formatTokens(baseUnits)} ${coin.symbol}`;
      const handle = tx.begin(label);
      const pressed = performance.now();
      let signature = "";
      try {
        const kept = prepared.current;
        const ahead =
          kept && kept.key === key && Date.now() - kept.at < PREPARED_GOOD_FOR_MS
            ? (tradeSide === "buy" ? kept.buys : kept.sells).get(baseUnits.toString())
            : undefined;
        const built: BuiltTradeView = ahead ?? (await buildTrade({ wallet: signer.address, mint: coin.mint, side: tradeSide, amount: baseUnits, settings }));
        // A prepared trade can be used once: the next press needs a new one.
        if (ahead) prepared.current = null;
        signature = await signAndSubmit(signer, built, fast);
        (window as unknown as { __clickToSentMs?: number }).__clickToSentMs = performance.now() - pressed;
        handle.sent(signature);
        setAmount("");
        store.optimistic({
          s: signature,
          i: 0,
          t: Date.now(),
          w: signer.address,
          b: tradeSide === "buy" ? 1 : 0,
          x: -1,
          sol: Number(tradeSide === "buy" ? baseUnits : BigInt(built.expected)),
          tok: Number(tradeSide === "buy" ? BigInt(built.expected) : baseUnits),
          p: Number(coin.microLamportsPerCoin),
          v: coin.hasPool ? "a" : "c",
          slot: 0,
          early: 1,
        });
        const outcome = await outcomeOf(signer.address, signature);
        if (outcome.state === "confirmed") {
          handle.confirmed(
            tradeSide === "buy"
              ? `Bought about ${formatAmount(built.expected, COIN_DECIMALS, 2)} ${coin.symbol}`
              : `Sold ${formatTokens(baseUnits)} ${coin.symbol} for about ${formatSol(built.expected)}`,
          );
        } else {
          store.withdraw(signature);
          handle.failed(outcome.problem ?? "the trade did not go through", outcome.state === "expired");
        }
      } catch (error) {
        if (signature) store.withdraw(signature);
        handle.failed(error instanceof Error ? error.message : String(error));
      }
      void refresh();
    },
    [settings, coin.symbol, coin.mint, coin.microLamportsPerCoin, coin.hasPool, tx, key, signer, fast, store, refresh],
  );

  // What was typed, against what the wallet holds. Empty until the balances have been read, and for anything that is not an amount.
  const tooMuch = useMemo(() => {
    if (!balances || amount.trim() === "") return "";
    try {
      const typed = parseAmount(amount, side === "buy" ? SOL_DECIMALS : COIN_DECIMALS);
      if (side === "sell" && typed > held) return `You hold ${formatTokens(held)} ${coin.symbol}. That is the most you can sell.`;
      if (side === "buy" && typed > sol) return `Your wallet holds ${formatSol(sol)}. A buy and its fees have to fit in that.`;
    } catch {
      return "";
    }
    return "";
  }, [amount, balances, coin.symbol, held, side, sol]);

  /** A press of an amount button: with one-click it trades; without, it fills in the amount to be confirmed. */
  const press = useCallback(
    (index: number) => {
      const baseUnits = side === "buy" ? buyAmounts[index] : sellAmounts[index];
      if (baseUnits === undefined || baseUnits <= 0n) return;
      if (side === "buy" && !affords(baseUnits)) return setProblem("Your wallet holds too little SOL for that buy and its fees.");
      setProblem("");
      if (settings?.oneClick) return void trade(side, baseUnits);
      setAmount(formatAmount(baseUnits, side === "buy" ? SOL_DECIMALS : COIN_DECIMALS).replace(/,/g, ""));
    },
    [side, buyAmounts, sellAmounts, settings?.oneClick, trade, affords],
  );
  useEffect(() => {
    bind?.({ side: setSide, preset: press });
    return () => bind?.(null);
  }, [bind, press]);

  const submit = () => {
    try {
      const baseUnits = parseAmount(amount, side === "buy" ? SOL_DECIMALS : COIN_DECIMALS);
      if (side === "buy" && !affords(baseUnits)) throw new Error("Your wallet holds too little SOL for that buy and its fees.");
      if (side === "sell" && baseUnits > held) throw new Error(`Your wallet holds less ${coin.symbol} than that.`);
      setProblem("");
      void trade(side, baseUnits);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  if (!settings) return <div className="ticket" aria-busy="true" style={{ minHeight: 420 }} />;
  const fees = config && config !== "offline" ? config.fees : null;
  const typed = (() => {
    try {
      return parseAmount(amount, side === "buy" ? SOL_DECIMALS : COIN_DECIMALS);
    } catch {
      return 0n;
    }
  })();
  // A rough figure for what the typed amount fetches, from the price now. The exact figure is worked out when the trade is built.
  const estimate =
    typed > 0n && BigInt(price) > 0n ? (side === "buy" ? (typed * 10n ** 15n) / BigInt(price) / 1000n : (typed * BigInt(price)) / 10n ** 12n) : 0n;

  return (
    <div className="ticket">
      <div className="sides" role="group" aria-label="Buy or sell">
        <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button type="button" className="sell" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>

      <dl>
        <dt>Your SOL</dt>
        <dd>{balances ? <Sol lamports={sol} /> : <Pending />}</dd>
        <dt>Your {coin.symbol}</dt>
        <dd title={formatAmount(held, COIN_DECIMALS)}>{balances ? formatTokens(held) : <Pending />}</dd>
      </dl>

      <div className="presets" role="group" aria-label={side === "buy" ? "Buy a set amount of SOL" : "Sell a share of what you hold"}>
        {side === "buy"
          ? settings.buys.map((text, index) => (
              <button
                key={index}
                type="button"
                disabled={(buyAmounts[index] ?? 0n) <= 0n || !affords(buyAmounts[index] ?? 0n)}
                onClick={() => press(index)}
                data-preset={index}
              >
                {text}
                <span className="k">SOL · {index + 1}</span>
              </button>
            ))
          : SELL_SHARES.map((share, index) => (
              <button key={share} type="button" disabled={held === 0n} onClick={() => press(index)} data-preset={index}>
                {share}%<span className="k">{index + 1}</span>
              </button>
            ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <label className="label" htmlFor="t-amount">
          {side === "buy" ? "Amount in SOL" : `Amount in ${coin.symbol}`}
        </label>
        <div className="field-row">
          <input id="t-amount" inputMode="decimal" autoComplete="off" placeholder="0.0" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <span className="unit">{side === "buy" ? "SOL" : coin.symbol}</span>
        </div>
        <dl>
          <dt>You get, about</dt>
          <dd>{estimate > 0n ? (side === "buy" ? `${formatTokens(estimate)} ${coin.symbol}` : formatSol(estimate)) : "0"}</dd>
          <dt>Slippage limit</dt>
          <dd>{formatChange(settings.slippageBps).replace("+", "")}</dd>
          <dt>Priority fee</dt>
          <dd>{priority === 0n ? "None" : formatSol(priority, 6)}</dd>
          <dt>This site&apos;s fee</dt>
          <dd>{fees && fees.tradeBps > 0 ? `${formatChange(fees.tradeBps).replace("+", "")}, to ${shortAddress(fees.wallet)}` : "None"}</dd>
        </dl>
        {/* More than the wallet holds: said here, as it is typed, and the button waits. Nothing is sent to find it out. */}
        <button className={`go ${side === "sell" ? "sell" : ""}`} type="submit" disabled={tooMuch !== ""} aria-describedby={tooMuch ? "t-too-much" : undefined}>
          {side === "buy" ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`}
        </button>
        {tooMuch && (
          <p className="note-line" id="t-too-much" role="status" data-too-much>
            {tooMuch}
          </p>
        )}
      </form>

      <p className="note-line" data-public>
        Public: your wallet, the coin, the amount and the price. A Ring cannot hide a trade on the {coin.hasPool ? "pool" : "curve"}.{" "}
        <Link className="link" href="/docs#what-is-public">
          What each action shows
        </Link>
      </p>
      {problem && (
        <p className="note-line warn" role="alert">
          {problem}
        </p>
      )}

      <div className="settings">
        <Tick
          checked={settings.oneClick}
          onChange={(on) => {
            if (on) setAsking(true);
            else change({ oneClick: false });
          }}
        >
          One-click: an amount button trades at once
        </Tick>
        {settings.oneClick && (
          <p className="note-line" data-oneclick>
            {signer.kind === "browser"
              ? ready > 0
                ? `${ready} trades are built and ready. A press signs and sends.`
                : "Getting the buttons ready."
              : `${signer.label} will still ask you to approve each trade.`}
          </p>
        )}
        <div className="line">
          <span className="label">Slippage</span>
          <div className="opts" role="group" aria-label="Slippage limit">
            {SLIPPAGE_CHOICES.map((bps) => (
              <button key={bps} type="button" aria-pressed={settings.slippageBps === bps} onClick={() => change({ slippageBps: bps })}>
                {bps / 100}%
              </button>
            ))}
            <input
              aria-label="Slippage limit in percent"
              inputMode="decimal"
              placeholder="%"
              value={custom.slippage}
              onChange={(event) => {
                setCustom({ ...custom, slippage: event.target.value });
                const bps = Math.round(Number(event.target.value) * 100);
                if (Number.isInteger(bps) && bps >= 1 && bps <= 5000) change({ slippageBps: bps });
              }}
            />
          </div>
        </div>
        <div className="line">
          <span className="label">Priority</span>
          <div className="opts" role="group" aria-label="Priority fee in SOL">
            {PRIORITY_CHOICES.map(([lamports, text]) => (
              <button key={lamports} type="button" aria-pressed={settings.priorityLamports === lamports} onClick={() => change({ priorityLamports: lamports })}>
                {text}
              </button>
            ))}
            <input
              aria-label="Priority fee in SOL"
              inputMode="decimal"
              placeholder="SOL"
              value={custom.priority}
              onChange={(event) => {
                setCustom({ ...custom, priority: event.target.value });
                try {
                  const lamports = event.target.value.trim() === "0" ? 0n : parseAmount(event.target.value, SOL_DECIMALS);
                  if (lamports <= 100_000_000n) change({ priorityLamports: lamports.toString() });
                } catch {
                  /* not a number yet */
                }
              }}
            />
          </div>
        </div>
        <button className="link" type="button" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? "Done" : "Change the buy amounts"}
        </button>
        {editing && (
          <div className="presets" role="group" aria-label="The four buy amounts, in SOL">
            {settings.buys.map((text, index) => (
              <input
                key={index}
                className="chip"
                aria-label={`Buy amount ${index + 1}, in SOL`}
                inputMode="decimal"
                value={text}
                onChange={(event) => {
                  if (!/^\d*\.?\d*$/.test(event.target.value)) return;
                  const buys = [...settings.buys] as TradeSettings["buys"];
                  buys[index] = event.target.value;
                  setSettings({ ...settings, buys });
                  if (/^\d*\.?\d+$/.test(event.target.value)) saveSettings({ ...settings, buys });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {position && (BigInt(position.boughtLamports) > 0n || BigInt(position.held) > 0n) && <Position position={position} symbol={coin.symbol} />}
      <p className="note-line">
        <Link className="link" href={`/wallet#deposit`}>
          Move {coin.symbol} into your Ring balance
        </Link>
      </p>

      {asking && (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="oneclick-title">
          <div>
            <h2 className="h3" id="oneclick-title">
              Turn on one-click trading?
            </h2>
            <p className="body">
              With it on, pressing an amount button sends a real trade at once. There is no second step and nothing to confirm. To be quick, the trade skips the
              dry run the network would otherwise do first, so a trade that would fail is still sent, fails on the chain and costs its network fee.
            </p>
            <p className="body">Every trade here is public: your wallet, the coin, the amount and the price.</p>
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  change({ oneClick: true });
                  setAsking(false);
                }}
              >
                Turn on one-click
              </button>
              <button className="link" type="button" onClick={() => setAsking(false)}>
                Leave it off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What this wallet has done in this coin, from the trades the indexer holds. */
export function Position({ position, symbol }: { position: PositionView; symbol: string }) {
  const [realised, unrealised] = [BigInt(position.realisedLamports), BigInt(position.unrealisedLamports)];
  const total = realised + unrealised;
  const cost = BigInt(position.boughtLamports);
  const signed = (lamports: bigint) => (
    <span className={lamports < 0n ? "down" : "up"}>
      {lamports > 0n ? "+" : ""}
      <Sol lamports={lamports} />
    </span>
  );
  return (
    <div className="settings" data-position>
      <span className="label">Your position in {symbol}</span>
      <dl>
        <dt>
          Bought, {position.buys} trade{position.buys === 1 ? "" : "s"}
        </dt>
        <dd>
          <Sol lamports={position.boughtLamports} />
        </dd>
        <dt>
          Sold, {position.sells} trade{position.sells === 1 ? "" : "s"}
        </dt>
        <dd>
          <Sol lamports={position.soldLamports} />
        </dd>
        <dt>Worth now</dt>
        <dd>
          <Sol lamports={position.valueLamports} />
        </dd>
        <dt>Profit so far</dt>
        <dd>
          {signed(total)}
          {cost > 0n && <span className="quiet"> {formatChange(Number((total * 10_000n) / cost))}</span>}
        </dd>
      </dl>
      <p className="note-line">
        Profit is worked out from your trades here, at your average buy price, before network fees. Coins that arrived another way have no cost.
      </p>
    </div>
  );
}
