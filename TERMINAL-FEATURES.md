# Terminal features: what the leading terminals have, what each needs, and a launch plan

22 November 2026. Step 1 of `TERMINAL-BRIEF.md`. **Nothing has been built from this yet.** It is for
you to read and correct before step 2.

## Read this first: how good the evidence is

This session's network settings block the terminals' own sites (`axiom.trade`, `docs.axiom.trade`,
`gmgn.ai`, `docs.gmgn.ai`) and every pricing page I tried. So:

| Product | What was actually read | Trust |
| --- | --- | --- |
| GMGN | Its official API repository on GitHub (`GMGNAI/gmgn-skills`, v1.7.2, 13 Nov 2026), read in full: field names, definitions, order types. Its web docs only as search-result summaries | Good for data and orders, weak for the look of the web app |
| Photon | Its official docs (GitBook), read in full | Good |
| BullX NEO | Its official docs (GitBook), read in full | Good, but see below: trading is suspended |
| Terminal (was Padre) | Landing page, terms and troubleshooting page, read; two third-party reviews. Its docs were taken offline | Middling |
| Axiom | **No page read.** Search-result summaries of its docs, most of them over a year old, plus third-party guides | Weak. Every Axiom cell needs checking |
| Prices | **No pricing page read.** Search-result summaries only | Every price below is unconfirmed |

To fix this, allow these hosts in the session's network settings and I will reread and correct the
table: `docs.axiom.trade`, `axiom.trade`, `docs.gmgn.ai`, `gmgn.ai`, `www.helius.dev`, `shyft.to`,
`docs.birdeye.so`, `docs.x.com`, `pumpportal.fun`.

Marks in the tables: **Y** documented by the product itself · **y** third-party source only ·
**?** could not confirm · **N** documented as absent. Columns: **A** Axiom, **G** GMGN, **P** Photon,
**B** BullX NEO, **T** Terminal (Padre). Effort: **S** days, **M** one to two weeks, **L** several
weeks. "Ours" is the terminal inside RINGPAD as pushed (`6b1f43a`).

## What has changed since the brief was written, and what it missed

1. **BullX has not been a working product since 1 June 2026.** Trading is suspended; wallets and
   withdrawals still work. Its docs remain the clearest written definitions of snipers and insiders, so
   it stays in the table as a reference, not a competitor.
2. **Padre is now pump.fun's own terminal.** Acquired on 24 October 2025, renamed "Terminal", served at
   `terminal.pump.fun`. Its copy trading was removed after the acquisition (third-party report).
   The launchpad most coins start on now owns a terminal.
3. **"Off, reduced, secure" is Axiom's wording.** GMGN has one anti-MEV switch, on by default. Photon
   has "Fast" and "Secure", chosen by the size of the tip. BullX had "MEV only" on or off.
4. **Axiom copy trading is not confirmed.** One source says it has none, another says its tracker can
   copy buys. GMGN's is documented.
5. **Nobody publishes how they detect snipers, insiders or bundles.** The definitions are one line each
   and carry no thresholds (section "Risk figures" below). Ours can publish its rules. That is a real
   difference, and cheap.
6. **Every one of them holds signing power for the user.** Axiom uses Turnkey; GMGN, Photon and BullX
   generate a trading wallet on their side; Terminal says keys are encrypted with the user's password.
   That is how their limit orders, stop losses and copy trades run while the user is asleep. Your rule
   is that keys stay with the user. This is the biggest decision in this file: see "Orders without
   custody".
7. **The going fee is 1% per trade**, less cashback (Axiom: about 0.75% to 0.95% net by tier; Terminal:
   up to 35% of fees back). RINGPAD's proposed 0.5% (DECISIONS.md, row 100) is half the market.

Features they have that the brief does not list:

- **Buy or sell on migration** (Axiom, documented), and orders that do not survive migration (Axiom).
- **Trailing stop** (GMGN, Terminal) and **DCA** (Photon, BullX, Terminal).
- **A sell strategy attached to every buy automatically** (BullX "Auto Sell", GMGN "Cooking": up to
  ten take-profit and stop-loss conditions per buy).
- **Limit orders set by dragging a line on the chart** (Axiom, Photon, BullX, Terminal).
- **More launchpads than pump.fun.** GMGN lists 24 on Solana (LetsBonk, Bags, Moonshot, Believe,
  Raydium LaunchLab, Meteora and others).
- **More row figures:** bonding progress and time to graduate, fresh-wallet share, bot-user holders,
  "pro trader" or smart-money and KOL counts, DEX-paid flag, dev's count of earlier migrations,
  wash-trading flag, a 0 to 1 rug score (GMGN).
- **Funding source of each wallet**, and a map of connected holders (Axiom "Atlas", BullX bubble maps).
- **A signal feed** (GMGN: 21 kinds, such as "smart money bought", "dev sold", "DEX paid").
- **Trading in USDC** as well as SOL (Photon, 2026).
- **PnL calendar and a streamer overlay** (BullX).

## 1. Discovery

| Feature | A | G | P | B | T | How it works there | Data it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Three live columns: new, about to graduate, graduated | Y | Y | Y | Y | y | Axiom "Pulse": New Pairs, Final Stretch, Migrated. GMGN "Trenches": new creation, near completion, completed. BullX: New Creations, About to Graduate, Graduated | Every create, trade and migration event of each launchpad, as a stream | Have it for our coins; L for all coins (needs a mainnet stream) | **Part.** The board, live, virtualised, pause on hover. But only coins launched here or opened by address: there is no feed of every new pump.fun coin |
| Launchpads covered | ? | Y | Y | Y | y | GMGN: 24 on Solana. Photon: pump.fun and Moonshot. Axiom: pump.fun and others, list unconfirmed | One decoder per launchpad program | M each | pump.fun and its pool only |
| Row: age, market cap, volume, holders | Y | Y | Y | Y | y | Standard | Indexed trades and balances | Have it | **Yes** |
| Row: liquidity, buys and sells count, bonding progress | Y | Y | Y | Y | ? | GMGN also shows net buys and time to graduate | Indexed trades; curve or pool reserves | S | **Part.** Progress yes; liquidity and buy/sell counts are stored but not shown |
| Row: top-10 share, dev holding | Y | Y | Y | Y | y | Share of supply, curve and pool excluded | Holder balances | S | **Part.** On the coin's screen, not on the row |
| Row: snipers, insiders, bundles | Y | Y | ? | Y | y | See "Risk figures" below | Every trade from the coin's first block, with slot and position in the block | M | **No** |
| Row: socials, DEX-paid, smart-money and KOL counts | y | Y | ? | ? | ? | GMGN shows four DexScreener flags, X followers, counts of labelled wallets | Token metadata; DexScreener's API; a list of labelled wallets | S for socials, M for the rest | **No** |
| Filters on every figure | Y | Y | Y | Y | Y | Min and max per figure. Axiom documents 14, GMGN about 30 | The row figures | S once the figures exist | **Part.** Search, a few filters; no min and max per figure |
| Saved filter presets | ? | Y | ? | ? | ? | GMGN: saved filters and layouts per chain since July 2026; API presets "safe", "smart-money", "strict" | None (the browser) | S | **No** |
| Pause the feed on hover | ? | ? | ? | ? | ? | Not documented anywhere I could read; common in use | None | Have it | **Yes** |
| Search by name, ticker, address | Y | Y | Y | Y | ? | | Index of names; lookup by address | Have it | **Yes** (address lookup follows any pump.fun coin) |
| Trending by time window | Y | Y | Y | Y | Y | GMGN: 1m, 5m, 1h, 6h, 24h, sortable by volume, trades, holders, change. Photon: top 100 at 1m, 5m, 30m, 1h | Rolling volume and trade counts per coin | S on our data | **No** list. The 5m, 1h, 24h changes exist per coin |
| Quick buy on every row | y | ? | Y | Y | ? | A preset amount; Axiom switches presets P1 to P3 from the board | The trade path | Have it | **Yes** |

## 2. Token page

| Feature | A | G | P | B | T | How it works there | Data it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Candle chart with timeframes | Y | Y | Y | Y | Y | Photon and BullX use TradingView's library. GMGN: 1m to 1d, 1s on its paid API plan | Trades, or stored candles | Have it | **Yes.** Our own canvas chart, 1s to 1d |
| Market cap and price views | ? | ? | ? | Y | ? | | Supply | Have it | **Yes**, in SOL or dollars |
| Your own buys and sells marked | y | ? | ? | Y | Y | BullX also marks dev trades, tracked wallets and open limit orders | Your trades | Have it | **Yes.** Dev and tracked-wallet marks: no |
| Limit order by dragging a line on the chart | Y | ? | Y | Y | Y | | Limit orders | S after limit orders exist | **No** |
| Live trades feed | Y | Y | Y | Y | ? | | Trade stream | Have it | **Yes** |
| Feed filters: size, wallet type, mine | y | Y | y | ? | ? | GMGN filters by wallet tag | Wallet labels | S | **Part.** Mine and creator; not by size or label |
| Holders with share of supply | Y | Y | y | Y | ? | BullX: top 100 with balance, PnL, last trade | Balances | Have it | **Yes**, top 100 |
| Top traders with profit on this coin | Y | Y | ? | Y | ? | Axiom "Trader Scan": bought, sold, balance, realised PnL per wallet | Every trade of the coin, per wallet | S on our data | **No.** The sums exist per wallet (our position view) but there is no ranking |
| Dev wallet: holding, sold or not | Y | Y | Y | Y | y | | Balances and the dev's trades | S | **Part.** Creator's share and a "creator" label on its trades |
| Dev history: earlier coins and how they ended | y | Y | ? | Y | y | GMGN lists each earlier coin with its peak market cap and whether it migrated | Every coin the wallet ever created: our own index only knows coins since it began, so a history provider or a long backfill | M | **No** |
| Bundle, sniper and insider share | Y | Y | y | Y | y | See below | First-block trades, funding sources | M | **No** |
| Mint authority, freeze authority | ? | Y | Y | Y | ? | GMGN and Photon show both as checks | One account read per coin, kept | S | **No.** (For pump.fun coins both are fixed by the launchpad. It still has to be read, not assumed) |
| Liquidity burned or locked | y | Y | Y | Y | ? | Photon: red under 50% burned | The pool's LP supply and holders | S | **No** |
| Top-10 share as a check | y | Y | Y | Y | ? | Photon and BullX: warning over 15% | Balances | Have it | **Yes** (shown, no threshold colouring) |
| Wallet labels in every list | y | Y | ? | Y | y | GMGN tags: dev, sniper, insider ("rat trader"), bundler, fresh, smart money, KOL, bot user | The risk figures, plus the user's own tracked list | S after the figures | **Part.** Creator, curve, pool, Ring |
| Funding source, connected-holder map | y | Y | ? | Y | ? | Where each wallet's first SOL came from | One history lookup per wallet. Expensive at scale | L | **No** |

### Risk figures: how the others define them, and what ours could publish

| Figure | As documented | A rule ours can compute and publish |
| --- | --- | --- |
| Snipers | Axiom: "early buyers". GMGN: "wallets that bought at token launch"; it reports the top 70. BullX: "bought very early"; its panel covers the first 70 buyers | Bought within the first N slots of the coin's first trade (N stated on the page, proposed 3), other than the creator. Shown as count and share of supply still held |
| Bundles | Axiom: supply held in "bundle wallets". GMGN: "wallets in bot-bundled buys" | Two or more different wallets buying in the same slot as the creation, or back to back in one block, in the coin's first N slots |
| Insiders | Axiom: "private sales, team members". BullX: "received tokens without buying them". GMGN "rat trader": "insider or sneak-trading wallets" | Holds coins it did not buy on the curve or pool (received by transfer), or was funded by the creator's wallet. The first half is cheap; the second needs funding lookups |
| Dev | The creating wallet | The same |

All of it comes from data our indexer already stores per trade (slot, position in the block, wallet),
provided the coin is followed from its first block. Each figure would carry a link to the rule and to
the trades that produced it. No other terminal shows its working.

## 3. Trading

| Feature | A | G | P | B | T | How it works there | Data or service it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Market buy and sell, amount presets | Y | Y | Y | Y | Y | Axiom and Photon: three presets. BullX: five each way | Trade path | Have it | **Yes.** Four amounts each way |
| Percentage sells | ? | Y | Y | Y | Y | | Your balance | Have it | **Yes** |
| Settings per preset: slippage, priority fee, tip | Y | Y | Y | Y | y | Axiom's default tip 0.001 SOL. BullX defaults 0.01 SOL each | None | S | **Part.** One set of settings, not one per preset. Tip is built and has never run (tip accounts exist only on mainnet) |
| A recommended fee from network conditions | Y | ? | Y | ? | ? | Axiom shows the current minimum tip; "auto fee" with a cap. Photon "Auto Speed" | Recent priority fees (RPC) and Jito's tip floor (free API) | S | **No** |
| MEV protection modes | Y | Y | Y | Y | y | Axiom: off, reduced, secure. Photon: Jito below a tip threshold, bloXroute above. All of them route through Jito or a private relay | Jito's block engine (no subscription; a tip per trade) or Helius Sender | M. **Mainnet only: cannot be proven on devnet** | **No** |
| Clear status per trade with reason and link | ? | ? | ? | ? | Y | Poorly documented everywhere | Confirmation stream | Have it | **Yes.** Signing, sent, confirmed or failed with the reason, and a receipt |
| Limit orders (buy dip, buy breakout) | Y | Y | Y | Y | Y | On price or market cap. Photon: expiry 24, 48 or 72 hours | Price stream, **and something that can sign when the price is reached** | L | **No** |
| Take profit and stop loss | Y | Y | Y | Y | Y | As limit-order kinds, or attached to a buy | Same | L | **No** |
| Trailing stop | y | Y | ? | ? | Y | Sells after a set fall from the peak | Same | S after the above | **No** |
| DCA | y | ? | Y | Y | Y | Amount, interval, count, market cap range | Same | S after the above | **No** |
| Buy or sell on migration | Y | ? | ? | ? | ? | Axiom, documented | Migration events, and a signer | S after the above | **No** |
| Sell when the dev sells | y | ? | ? | ? | ? | Third-party report for Axiom | Dev's trades, and a signer | S after the above | **No** |
| Several wallets, trading across them | Y | Y | Y | Y | y | GMGN: up to 100 per request. Photon: up to 5 | None | M | **No** |
| The buy button cannot fire twice | ? | ? | ? | ? | ? | Not documented | None | Have it | **Yes** (tested: a double click sends one transaction) |

### Orders without custody: the decision that shapes the trading tier

A limit order, a stop loss or a copy trade has to be signed at a moment the user is not there. There are
four ways to do it. Only you can pick, because the first is what everyone else does and it bends your rule.

| Way | Who can sign | Works with the tab closed | Works on the bonding curve | Honest summary |
| --- | --- | --- | --- | --- |
| **A. A hosted signer** (Turnkey, Privy): what Axiom and, in effect, all the others do | A provider's enclave, under a policy you set ("only this program, at most this much") | Yes | Yes | Non-custodial in the industry's sense. In plain words: a third party can sign for the user within limits. Costs about $0.05 to $0.10 per signature, or $299 a month and up |
| **B. Signed in advance** | Only the user. They sign the exact sell or buy now, on a durable nonce so it does not expire; our server holds the signed transaction and can only choose **when** to send it. It cannot change the amount, the coin, the destination or the worst acceptable price | Yes | Yes, with care (one signed transaction for the curve and one for the pool, since a migration changes the route) | The server never has a key. It can fail to send, or send at a poor moment, but never for less than the price the user signed. Each open order locks about 0.0015 SOL of rent, returned when the order ends. **This is a design, not yet proven; I would prove it on the local chain first** |
| **C. Jupiter's trigger orders** | An on-chain program | Yes | No: only coins with pool liquidity, and a $10 minimum (to be confirmed) | Fine for graduated coins. Jupiter's fee is 0.1% on top |
| **D. While the terminal is open** | The user's key, in the browser | No | Yes | Simple and truthful, and useless overnight. A fair fallback, labelled as such |

My recommendation: **B for take profit, stop loss and limit sells, with D as the fallback and C offered
for graduated coins.** It is the only one that gives overnight orders while keeping your rule to the
letter, and no competitor has it. Limit **buys**, DCA and copy trading are harder under B (the amount
and the coin must be known in advance; copy trading cannot be, by its nature) and are where A would be
needed if you want them. I would not build A without your say-so.

## 4. Tracking

| Feature | A | G | P | B | T | How it works there | Data it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Portfolio: holdings and PnL per coin | Y | Y | Y | Y | Y | BullX: by period, with a calendar; any wallet's address can be viewed | Indexed trades and balances | Have it | **Yes**, for any wallet |
| Trade history, open orders | Y | Y | Y | Y | Y | | Same; orders | S | **Part.** Trades per coin; no single history page, no orders |
| Watchlist | ? | Y | Y | Y | ? | GMGN: with groups. Photon: three coins | None (the browser) | S | **No** |
| Wallet tracker with a live feed | Y | Y | y | Y | Y | Axiom shows tracked buys beside the board and on charts | Every trade by those wallets, across all coins: a stream filtered by wallet | M | **No** |
| Alerts in the terminal | y | ? | y | Y | Y | Price, tracked wallet, new pair | The streams above | S after the tracker | **No** |
| Alerts by Telegram | ? | Y | ? | ? | ? | GMGN's alert bot and channel | A Telegram bot (free). **The server must know which wallets and coins the user watches**, which cuts against the privacy aim | M | **No** |
| Copy trading | ? | Y | ? | ? | N | GMGN: fixed amount or a cap per buy, per-target limits, copies sells or uses your own take profit and stop loss | Tracker, and a signer that acts unattended (way A above) | L | **No** |
| Wallet rankings | ? | Y | ? | Y | ? | GMGN: smart money, KOL lists; PnL over 1, 7, 30 days, win rate | Every trade on the chain per wallet, for months: a data provider, or a large index of our own | L | **No** |
| Shareable profit card | ? | ? | ? | Y | Y | An image of one position's result | Your trades | S | **No** |

## 5. Extras

| Feature | A | G | P | B | T | How it works there | Data it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X monitor | Y | y | y | ? | y | Axiom: posts from chosen accounts in a panel | X's API, pay per post read (about $0.005 each), or a third-party reader | M | **No** |
| Telegram bots | ? | Y | ? | ? | ? | GMGN: sniper bot, alerts | Telegram's bot API (free) | M | **No** |
| Fee per trade | Y | Y | Y | Y | y | 1% everywhere; cashback or tiers at Axiom and Terminal | None | Have it | **Built, off.** Proposed 0.5% |
| Referrals and cashback | Y | Y | ? | ? | Y | Axiom: 30%, 3%, 2% over three levels. GMGN: 10 to 30%. Terminal: up to 40% | A ledger of who referred whom, and payouts: handling money owed to users | M | **No** |
| Mobile | y | Y | Y | ? | Y | Mostly the web app on a phone; GMGN has an app | None | Have it | **Yes**, the web app at phone width |
| Speed claims | y | ? | Y | Y | ? | Axiom: "land in one block or less". Photon: sends every block | Their own measurements | | We publish measured numbers and what they do not show (`PERFORMANCE.md`) |
| Several charts on one screen | ? | ? | ? | ? | ? | Not found in any docs read | None | M | **No** |
| Perpetuals, staking, more chains, public API | Y | Y | Y | Y | Y | Axiom: Hyperliquid perps, staking. All: several chains. GMGN: a public API | Much | L each | **No** |

## 6. What data the terminal needs, and what it would cost each month

**Every price here is from a search summary of the provider's page and is unconfirmed.** I would
confirm each on its page before you pay for anything.

The need that decides the bill is the first row of the first table: **a feed of every new coin and
every trade on the launchpads**, not only the coins we already follow. Our indexer today reads whole
blocks through the RPC, which is right for a local chain and cannot keep up with mainnet.

| Need | Used for | Options | Monthly cost |
| --- | --- | --- | --- |
| RPC | Sending trades, reading accounts | Helius Developer | $49 |
| A mainnet stream of launchpad transactions | The board, charts, feeds, risk figures, tracker | Helius LaserStream (Business plan) · Shyft gRPC (Build) · Chainstack Geyser add-on · PumpPortal's websocket (third party; new coins and migrations free, trades possibly metered) | $499 · $199 · $49 plus a plan of unknown price · about $0 |
| History we do not have | Dev's earlier coins, wallet rankings, charts older than our index | Birdeye · Solana Tracker · Moralis (its holder endpoints were due to be switched off in July 2026) | $99 to $250 · €50 to €397 · unclear |
| Landing and MEV protection | Tip and "secure" modes | Jito (no subscription) · Helius Sender (included) | $0; the user pays a tip per trade |
| A hosted signer, only if you choose way A | Offline orders, copy trading | Turnkey · Privy | About $0.05 to $0.10 per signature · $0 to $299 |
| X posts | X monitor | X's API at about $0.005 per post read · third-party readers | About $150 for 50 accounts posting 20 times a day · $5 to $30 |
| Telegram | Alerts | Bot API | $0 |
| Server and database | Everything | Railway and Neon | $20 to $35 |

Three totals:

| Set-up | What it gives | About, per month |
| --- | --- | --- |
| **Cheapest that is real** | Mainnet, read-only. Helius Developer, PumpPortal for new coins and migrations, our own indexer for the coins people open, small hosting | **$55 to $85** |
| **Comfortable** | Our own stream of every launchpad trade (Shyft), Helius Developer, Birdeye Starter for history, hosting | **About $380** |
| **One vendor, most headroom** | Helius Business with LaserStream, Birdeye Premium, hosting | **About $730** |
| Add the X monitor | | **+ $5 to $150** |

On devnet, as now, the cost is the Helius key you already have. But pump.fun on devnet has almost no
activity, so the board would be honest and nearly empty. A terminal can only be judged on mainnet data.
Reading mainnet is not trading on it: no keys, no money.

## 7. Launch plan in three tiers

### Must have at launch

| # | Feature | Why here | Needs |
| --- | --- | --- | --- |
| 1 | A stream of every new pump.fun coin, trade and migration, into the board | Without it there is no discovery, only a list of coins someone already found | A mainnet stream (your choice of cost above) |
| 2 | Row figures: liquidity, buys and sells, top-10, dev holding, snipers, bundles, insiders, with published rules | It is what the columns are read for | Item 1 |
| 3 | Min and max filters on every figure, saved presets, trending by window | Table stakes, and cheap once item 2 exists | The browser |
| 4 | Safety panel: mint and freeze authority, liquidity burned, top-10, dev holding and dev's trades, the three shares | Table stakes | A few account reads per coin |
| 5 | Top traders on a coin; trade history; watchlist; labels in every list | Our data already holds it | The browser, our index |
| 6 | Settings per preset, a recommended fee, tip, MEV modes | Without a tip and a private route, trades on mainnet lose to everyone else's | Jito; mainnet to prove it |
| 7 | Take profit, stop loss and limit sells, signed in advance (way B), with "while open" as the fallback | The one trading feature no serious user will do without | Proof on the local chain first |
| 8 | Every state designed: stale, disconnected, wrong network, no balance | In the brief; mostly there | None |

Already there and kept: the three columns, the chart, feed, holders, quick buy, one-click with a
measured 13 to 27 ms to "sent", the status tray, portfolio, keyboard use, phone layout, a wallet whose
key never leaves the device.

### Should have next

Dev history (earlier coins and how they ended) · wallet tracker and in-terminal alerts · limit buys,
trailing stop, DCA, buy or sell on migration, sell when the dev sells · limit orders by dragging on the
chart · several wallets · other launchpads, one at a time · shareable profit card · X monitor · alerts
by Telegram · several charts on one screen · referrals and cashback.

### Later

Copy trading and wallet rankings (both need either a hosted signer or a far larger index than a small
site should run) · perpetuals · staking · other chains · a native app · a public API.

Two items in your "next" list are placed lower than you put them, and why: **copy trading** cannot be
done under way B at all, since nobody can sign in advance for a trade they do not yet know; and
**wallet rankings** need months of every wallet's trades across the whole chain, which is a data
purchase or a large build.

## 8. Where ours can be better

**Privacy, said exactly:**

| Claim | What it hides, from whom | What it does not hide | State |
| --- | --- | --- | --- |
| Trade from a wallet not linked to your main one | The link between your main wallet and your trading wallet, from anyone reading the chain: funds go main wallet, into a Ring balance, out to an address made for it | The trading wallet's own trades are fully public. Amounts and timing can still link the two (the page warns, and can split the withdrawal). This server sees your IP address at both ends unless you take care | Built on the stand-in. **On the real Privacy Rings program it has never run**: it is waiting on devnet SOL (`RING-RESULTS.md`) |
| Your tracked wallets, watchlists and filters are hidden from us | What you watch, from this site's server | If you want alerts while the tab is closed, something must watch for you, and then it knows. In-terminal alerts can be matched in your browser against the public stream, so the server learns nothing | Not built. Stored encrypted on the device; synced, if at all, as ciphertext |
| No account, no email | Who you are | Your IP address and the transactions you send through us are seen by this server and by the RPC provider, as with any site | True today |
| No hosted key | Nobody but you can sign | A browser wallet is only as safe as the device | True today, and unlike all five |

**Beyond privacy:**

- **Rules shown for every risk figure**, with the trades behind each. The others give a number and a
  one-line definition.
- **Honest state.** "Live data paused" when the server is behind the chain; stand-ins never shown as
  live; measured speed with what it does not prove. None of the five publishes anything like it.
- **Half the fee**, if you keep 0.5%.
- **Orders signed in advance**, if it proves out: overnight stop losses without handing anyone a key.

**Where ours will be worse, plainly:** no hosted wallet means no copy trading and no "log in with
email and trade in ten seconds"; one launchpad at first; no years of wallet history; one server, not a
network of them near the validators, so on mainnet our trades will land later than Axiom's or
Photon's. How much later is unknown until it is measured on mainnet.

## 9. What I need you to decide before step 2

1. **Which terminal this is.** I have taken "the terminal" to be the one inside RINGPAD, which is the
   only terminal code there is, and have not opened the parked ShadowTerminal artifact. Say if you
   meant that one, or want the terminal split out under that name.
2. **Mainnet data, read-only: yes or no, and at which budget** (about $55 to $85, $380 or $730 a month).
   Without it the board stays on devnet and nearly empty.
3. **Offline orders: way B** (signed in advance, mine to prove first), or way A (a hosted signer, as
   the others do), or neither for now.
4. **The tiers above:** move anything up or down.
5. **Network access** for the hosts listed at the top, so the Axiom column and every price can be
   checked against the pages themselves.

## Sources

Read in full: `github.com/GMGNAI/gmgn-skills` (README and the market, token, swap, track and portfolio
skill files) · `pies-organization.gitbook.io/photon-trading` · `bullx.gitbook.io/bullx-neo-docs` ·
`trade.padre.gg` (landing, terms, troubleshooting) · `terminal.pump.fun` ·
`crypto.news/bullx-pauses-meme-trading-tool-but-keeps-wallet-access-open`.

Search summaries only, pages not opened: `docs.axiom.trade` (Pulse, explore, market, limit orders,
migration actions, Solana fees, Axiom fees, referral, wallet tracking, tweet monitor, trader scan,
portfolio, perpetuals, staking, FAQ) · `turnkey.com/case-studies/axiom-global-defi-trading-platform` ·
`docs.gmgn.ai` (fees, copy trade, sniper bot, referral, agent API) · the pricing and docs pages of
Helius, QuickNode, Shyft, Chainstack, Birdeye, DexScreener, CoinGecko, Moralis, Solana Tracker,
Bitquery, Jito, bloXroute, Nozomi, Jupiter, Turnkey, Privy, X, Telegram, Railway and Neon.

Third-party guides, used only where marked **y**: axiompedia.com, axiompro.app, madeonsol.com,
solanatradingbots.com, rootdata.com, cointelegraph.com, theblock.co.
