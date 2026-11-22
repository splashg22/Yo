# Terminal features: what the leading terminals have, what each needs, and a launch plan

22 November 2026. Step 1 of `TERMINAL-BRIEF.md`, corrected the same day from the providers' own pages and with
your answers (section 9). Step 2, the data layer, has begun: see section 6.

## Read this first: how good the evidence is

**Corrected on 22 November, second pass.** The first version of this file was written when the terminals'
own sites could not be opened from here. They can now be read with a plain request, and two things were
redone from the pages themselves: **Axiom's whole documentation** (all 34 pages) and **every price**.
Where this pass changed a cell it is the pages that speak, not a summary.

| Product | What was actually read | Trust |
| --- | --- | --- |
| Axiom | Its whole docs site, read in full (`docs.axiom.trade/llms-full.txt`, 34 pages). It is thin: much is shown only in screenshots, there is no changelog, and no page carries a date. The app itself (`axiom.trade`) refuses automated readers | Good for what the docs say; much of the product is simply not documented. "?" in Axiom's column now means "not in its docs", not "could not look" |
| GMGN | Its official API repository on GitHub (`GMGNAI/gmgn-skills`, v1.7.2, 13 Nov 2026), read in full. Its web docs only as search summaries; `gmgn.ai` refuses automated readers | Good for data and orders, weak for the look of the web app |
| Photon | Its official docs (GitBook), read in full. The app refuses automated readers | Good |
| BullX NEO | Its official docs (GitBook), read in full | Good, but trading is suspended |
| Terminal (was Padre) | Landing page, terms and troubleshooting page, read; two third-party reviews. Its docs were taken offline | Middling |
| Prices | Each provider's own pricing or billing page, read on 22 November | Good. Exact plans are in section 6 |

Still not read: the three apps themselves (they answer automated readers with a refusal, which is their
choice and not a setting on our side), and GMGN's web docs.

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
4. **Axiom's docs describe no copy trading**, no spot stop loss or take profit by name, no trailing stop
   and no DCA. They describe limit orders ("set a precise buy or sell price", by slider or by dragging
   a line on the chart), buying or selling on migration, and a wallet tracker. Third-party guides credit
   it with more; its own pages do not. GMGN's copy trading is documented.
5. **Almost nobody publishes how they detect snipers, insiders or bundles.** The one rule with a number
   is Axiom's for bundles: "If at least four transactions happen in the same block, they are flagged as
   a potential bundle". Everything else is one line each with no thresholds (section "Risk figures" below). Ours can publish its rules. That is a real
   difference, and cheap.
6. **Every one of them holds signing power for the user.** Axiom uses Turnkey; GMGN, Photon and BullX
   generate a trading wallet on their side; Terminal says keys are encrypted with the user's password.
   That is how their limit orders, stop losses and copy trades run while the user is asleep. Your rule
   is that keys stay with the user. This is the biggest decision in this file: see "Orders without
   custody".
7. **The going fee is 1% per trade**, less cashback. Axiom, from its fee page: 1% base, and seven tiers
   from Wood (0.95% net) through Bronze 0.90%, Silver 0.875%, Gold 0.85%, Platinum 0.825%, Diamond 0.80%
   to Champion (0.75% net); referred users get 10% off; referrers earn 30%, 3% and 2% over three levels.
   Terminal: up to 35% of fees back. RINGPAD's proposed 0.5% (DECISIONS.md, row 100) is half the market.

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
| Launchpads covered | Y | Y | Y | Y | y | GMGN: 24 on Solana. Photon: pump.fun and Moonshot. Axiom's docs name pump.fun and one other whose name is blanked out in the page, with Raydium as the place coins migrate to | One decoder per launchpad program | M each | pump.fun and its pool only |
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
| Candle chart with timeframes | Y | Y | Y | Y | Y | Axiom, Photon and BullX use TradingView's library. GMGN: 1m to 1d, 1s on its paid API plan | Trades, or stored candles | Have it | **Yes.** Our own canvas chart, 1s to 1d |
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
| Snipers | Axiom: "the percentage of early buyers (snipers)". GMGN: "wallets that bought at token launch"; it reports the top 70. BullX: "bought very early"; its panel covers the first 70 buyers | Bought within the first N slots of the coin's first trade (N stated on the page, proposed 3), other than the creator. Shown as count and share of supply still held |
| Bundles | Axiom: supply held in "bundle wallets"; "at least four transactions ... in the same block" are flagged, and a wallet whose next transaction is not bundled is disregarded. GMGN: "wallets in bot-bundled buys" | Two or more different wallets buying in the same slot as the creation, or back to back in one block, in the coin's first N slots |
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
| Settings per preset: slippage, priority fee, tip | Y | Y | Y | Y | y | Axiom: priority fee and tip both default to 0.001 SOL; how many presets it has is not in its docs. BullX defaults 0.01 SOL each | None | S | **Part.** One set of settings, not one per preset. Tip is built and has never run (tip accounts exist only on mainnet) |
| A recommended fee from network conditions | Y | ? | Y | ? | ? | Axiom shows the current minimum tip; "auto fee" with a cap. Photon "Auto Speed" | Recent priority fees (RPC) and Jito's tip floor (free API) | S | **No** |
| MEV protection modes | Y | Y | Y | Y | y | Axiom: off, reduced, secure. Photon: Jito below a tip threshold, bloXroute above. All of them route through Jito or a private relay | Jito's block engine (no subscription; a tip per trade) or Helius Sender | M. **Mainnet only: cannot be proven on devnet** | **No** |
| Clear status per trade with reason and link | ? | ? | ? | ? | Y | Poorly documented everywhere | Confirmation stream | Have it | **Yes.** Signing, sent, confirmed or failed with the reason, and a receipt |
| Limit orders (buy dip, buy breakout) | Y | Y | Y | Y | Y | On price or market cap. Photon: expiry 24, 48 or 72 hours | Price stream, **and something that can sign when the price is reached** | L | **No** |
| Take profit and stop loss | ? | Y | Y | Y | Y | As limit-order kinds, or attached to a buy. Axiom's docs name them only for perpetuals | Same | L | **No** |
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

**Decided on 22 November: D for now.** Orders run only while the terminal is open, and the screen says
so plainly. No hosted signer. B is to be proven on the local chain and written up
(`SIGNED-IN-ADVANCE.md`) before you decide on it. What I had recommended, for the record: **B for take
profit, stop loss and limit sells, with D as the fallback and C offered for graduated coins.** It is the only one that gives overnight orders while keeping your rule to the
letter, and no competitor has it. Limit **buys**, DCA and copy trading are harder under B (the amount
and the coin must be known in advance; copy trading cannot be, by its nature) and are where A would be
needed if you want them. I would not build A without your say-so.

## 4. Tracking

| Feature | A | G | P | B | T | How it works there | Data it needs | Effort | Ours today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Portfolio: holdings and PnL per coin | Y | Y | Y | Y | Y | BullX: by period, with a calendar; any wallet's address can be viewed | Indexed trades and balances | Have it | **Yes**, for any wallet |
| Trade history, open orders | Y | Y | Y | Y | Y | | Same; orders | S | **Part.** Trades per coin; no single history page, no orders |
| Watchlist | Y | Y | Y | Y | ? | Axiom: a star beside each coin. GMGN: with groups. Photon: three coins | None (the browser) | S | **No** |
| Wallet tracker with a live feed | Y | Y | y | Y | Y | Axiom shows tracked buys beside the board and on charts | Every trade by those wallets, across all coins: a stream filtered by wallet | M | **No** |
| Alerts in the terminal | y | ? | y | Y | Y | Price, tracked wallet, new pair | The streams above | S after the tracker | **No** |
| Alerts by Telegram | ? | Y | ? | ? | ? | GMGN's alert bot and channel | A Telegram bot (free). **The server must know which wallets and coins the user watches**, which cuts against the privacy aim | M | **No** |
| Copy trading | ? | Y | ? | ? | N | Not in Axiom's docs. GMGN: fixed amount or a cap per buy, per-target limits, copies sells or uses your own take profit and stop loss | Tracker, and a signer that acts unattended (way A above) | L | **No** |
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

## 6. What data the terminal needs, and what it costs each month

**Prices confirmed on 22 November 2026 from each provider's own pricing or billing page.** Plans change;
check the page again on the day you pay.

### How much data there is (measured, not estimated)

On 22 November I recorded 50 consecutive mainnet blocks, about 20 seconds (`npm run record`, read-only:
three RPC methods, no key but the RPC's own). In them:

- 151 MB of blocks as the RPC sends them: **about 3 MB a block, 7.5 MB a second.**
- 3,409 successful transactions touching pump.fun, its pool program or a pump.fun coin: **about 170 a second.**
- **2,047 trades, about 100 a second** (418 on bonding curves, 1,592 in pools), across 203 coins.
- **6 new coins**, about one every 3 seconds, which is roughly 25,000 a day.
- Found on the way: **some pump.fun coins are now priced in USDC, not SOL** (37 trades and one new coin in the
  sample). Devnet never showed one. Ours reads only SOL-priced coins for now and leaves the others out
  rather than show them at a wrong price.

That is the firehose. It decides what each plan can carry.

### The plans

| Need | Provider and plan | Monthly price | What it gives, from its page |
| --- | --- | --- | --- |
| RPC and websockets | **Helius Developer** | **$49** | 10M credits, 50 requests a second, standard and enhanced websockets (150 connections). An ordinary read is 1 credit. Streams are billed by size: 2 credits per 0.1 MB. Extra credits $5 per million; automatic top-up is **off** by default, so at the limit requests are refused until credits are added |
| | Helius Free | $0 | 1M credits, 10 requests a second, standard websockets only, a hard stop at the limit. Helius's own page calls it "suitable for development and testing" |
| | Helius Business | $499 | 100M credits; the first plan with LaserStream (gRPC) on mainnet |
| A full stream of every trade | **Chainstack Growth + Geyser add-on** | **$49 + $49 = $98** | Yellowstone gRPC, 2 streams, **unlimited events**, mainnet, filtered by program |
| | Shyft Build | $199 | gRPC, 10 connections, "No Credits. No Bandwidth Limits. No Overages." |
| | Solana Tracker gRPC | €200 | 25 connections, no overages |
| New coins and migrations only | PumpPortal | $0 | Those two streams are free. Trades per coin are metered (0.01 SOL per 10,000 events) and need an API key **and a funded mainnet wallet**. Its terms grant a "single, personal" licence and forbid publishing its contents unless authorised |
| History we do not have | Birdeye Lite · Premium | $39 · $199 | 2.5M · 20M compute units; websockets from Premium |
| | DexScreener API | $0 | Commercial use allowed; 300 requests a minute on pair and token endpoints; may not be used to build a product that competes with DexScreener |
| Landing and MEV protection | Jito | $0 | No subscription; minimum tip 1,000 lamports per bundle; 1 request a second per address by default |
| X posts | X API | $0.005 per post read | Pay per use. 50 accounts posting 20 times a day is about $150 a month |
| Telegram | Bot API | $0 | |
| Server and database | Railway Hobby · Neon | $5 · $0 to pay-for-use | |

### What the cheapest tier can and cannot do

You asked for the cheapest tier only. There are two honest candidates, and they differ in what the board can show.

| | **A. Helius Developer: $49, plus $5 hosting = $54 a month** | **B. A + Chainstack's stream: $152 a month** |
| --- | --- | --- |
| Every new pump.fun coin, the moment it is made | Yes | Yes |
| Every migration | Yes | Yes |
| Live trades, chart and holders for a coin someone has open, or on a watchlist | Yes | Yes |
| Live market cap, volume and buy/sell counts for **every** coin on the board | **No.** Only for coins being followed trade by trade. The rest show their figures as of when they were last read, marked with their age | Yes |
| Snipers, bundles and insiders for every new coin | **Only for coins followed from their first block**, which this plan can afford for a bounded number at a time | Yes |
| Trending by volume across all coins | No: it needs every trade | Yes |

Why A cannot carry everything: the full stream measured above is about 2 MB a second of pump.fun
transactions, which at Helius's rate of 2 credits per 0.1 MB is about 40 credits a second, some
**100 million credits a month against a plan of 10 million**. Carried on Helius alone it would cost about
$500 a month in extra credits. New coins and migrations by themselves are tiny (a few thousand credits a
day), and a followed coin costs in proportion to its own trading.

I do not recommend PumpPortal: its terms do not allow publishing its data, and its trade streams need a
funded mainnet wallet, which your rule forbids.

**My recommendation: start on A, exactly "Helius Developer, $49 a month", with automatic top-up left
off so the bill cannot grow.** Build the board so that every figure it cannot keep live is shown with its
age, never as live. Move to B when you want the full board; because the data layer sits behind one
interface (below), that is a change of provider, not a rebuild. **Nothing is bought until you say so; until
then everything is built and tested on the recording.**

### One interface, so the provider can be swapped

Everything above the data layer reads from one interface, `ChainSource`
(`lib/server/indexer/types.ts`): the newest slot, the slots in a range, one block's decoded
transactions, and a subscription. Behind it today:

| Source | What it is | State |
| --- | --- | --- |
| `RpcSource` | Whole blocks through an RPC | Built. Right for the local chain and devnet; too heavy for mainnet |
| `RecordedSource` | A recorded stretch of mainnet, played back | **Built this round**, with its tests (`test/unit/recorded.test.ts`) |
| `SimChain` | A made-up chain, for load tests and reorganisations | Built |
| `StreamSource` | Any stream of single transactions, gathered into what the indexer reads | **Built**, and tested on recorded mainnet against whole-block reading, repeats, late arrivals, a drop and reconnect, and a drop too long to read back (`test/unit/stream-source.test.ts`) |
| `HeliusTxStream` (plan A) | Helius's `transactionSubscribe`: new coins always, plus the coins chosen to be followed trade by trade | **Written from Helius's documentation, never run.** It needs the Developer plan's key, and this machine cannot open outbound websockets. Only its message handling is tested. Switched on with `FEED_PROVIDER=helius-ws` |
| A gRPC stream (Chainstack or Shyft, plan B) | Every pump.fun and pool transaction | Not built. It would be a second small adapter beside `HeliusTxStream`; nothing above it changes. With Helius alone, plan B is already a setting: `FEED_SCOPE=all` |

Nothing in any source can send a transaction: the interface has no method for it. And on mainnet the server
itself refuses: `RING_NETWORK=mainnet` answers a fixed list of reads and nothing else (`test/unit/read-only.test.ts`).

**What "switch the key on" will mean, exactly:** subscribe to Helius Developer, put the key in `.env`, set
`RING_NETWORK=mainnet`, `FEED_PROVIDER=helius-ws`, `FEED_SCOPE=coins`. The first run is a test, not a launch: I
compare what the stream stores against a recording of the same slots and fix what differs, because that adapter
has only ever met Helius's documentation. Two things I already know are missing on plan A: migrations of coins
that are not being followed (a coin that graduates while nobody has it open is noticed only when it is next
opened), and names for coins first seen through a trade.

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
| 7 | Limit orders, take profit and stop loss that run **only while the terminal is open**, and say so on the screen | Your decision of 22 November: no hosted signer, and nothing signed in advance until its proof has been read | The price stream; the browser |
| 7a | A sell strategy attached to every buy: take-profit and stop-loss levels set once and applied to each new position, under the same "while open" rule | Added to the launch set on 22 November | Item 7 |
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

## 9. Decisions, as answered on 22 November

1. **Which terminal:** the one inside RINGPAD. ShadowTerminal stays parked and untouched.
2. **Mainnet data:** yes, read-only, cheapest tier, behind one interface so the provider can be swapped.
   Nothing on mainnet may send a transaction or hold a key. Built and tested on recorded mainnet data until a
   plan is confirmed. **Waiting on you:** confirm "Helius Developer, $49 a month" (section 6), or choose the
   $152 set-up for the full board.
3. **Offline orders:** neither for now. Limit, take profit and stop loss run only while the terminal is open.
   The signed-in-advance design is proven and written up separately before any decision.
4. **Tiers:** agreed. Copy trading and wallet rankings are "later". Added to launch: a sell strategy on every
   buy, and the feed of all new pump.fun coins. Trailing stop, DCA, limits dragged on the chart and other
   launchpads are "next".
5. **Fee:** stays a setting, 0.5% proposed, off by default.

## 10. The every-coin board: what is built, what it covers, and plan A against plan B

Built on 22 November against a recorded stretch of mainnet (600 consecutive blocks, about two minutes,
42,906 pump.fun transactions). It goes live when the Helius key is in `.env` and `FEED_PROVIDER=helius-ws`
is set; nothing else changes.

### Coverage, exactly

| Source | Status | What is shown |
| --- | --- | --- |
| pump.fun bonding curve, coins priced in SOL | **Covered**, from the coin's first block | Everything |
| PumpSwap (pump.fun's pool program), SOL pools of pump.fun coins | **Covered** | Everything |
| pump.fun coins already trading before we listened | **Covered from the first trade seen**; name, picture, creator and safety facts read from the chain afterwards | Marked "followed"; holders and top-ten shown as "at least"; snipers, bundles, insiders "not known" |
| pump.fun coins priced in USDC or another coin | **Listed, not supported** | Name and "not priced in SOL: not supported yet". No price, never a zero |
| Coins in PumpSwap pools that were not made on pump.fun | **Listed, not supported** once their account is read | "Not a pump.fun coin: not supported yet". No price |
| pump.fun Mayhem-mode coins | Covered. The Mayhem vault's extra thousand million coins are left out of holder figures, as the curve is | Market cap uses the supply the creation event states |
| LetsBonk, Moonshot, Believe, Boop, Jupiter Studio and other launchpads | **Not covered** | Not on the board |
| Raydium, Meteora, Orca pools (including of pump.fun coins) | **Not covered** | Not on the board |
| PumpSwap pools priced in anything other than SOL | **Not covered** | Not on the board |

Adding a launchpad or a DEX is one decoder each (its trade and pool events) behind the same `ChainSource`
interface. None is built. Each adds stream volume, which matters on plan A.

### How far back

- A coin seen being made: every trade.
- A coin first seen part-way: from that trade. The coin page says from when.
- A coin opened or searched by address that is not followed: its last 5,000 trades and twenty largest holders
  are read from the chain once (about 5,000 RPC credits for a busy coin), and it is followed from then on.
  If the event that made it is within those trades, its history is complete and says so.
- Dead coins: the drop rule (`lib/server/indexer/retention.ts`) stops following a coin nobody trades or needs.
  It stays findable by address, which reads it again.
- "24 hours" on any figure reaches back only as far as the server has been listening. The board says when its
  record begins until that is more than a day ago.

### What each plan gives

| | **Plan A: Helius Developer, $49** (`FEED_SCOPE=coins`) | **Plan B: A + a full stream, $152** (`FEED_SCOPE=all`) |
| --- | --- | --- |
| New pairs column | Live: every coin, from its first block | Same |
| Graduations | Live for coins followed trade by trade. A coin that graduates while not followed is caught when it is next read | Live for every coin |
| A coin somebody has open | Live | Live |
| Market cap, volume, buys and sells on board rows | Live for the newest 300 coins (a setting) and any coin open. **Every other row shows "as of" and its age** | Live for every row |
| Trending 5m / 1h / 6h / 24h | **Ranks only the coins followed trade by trade.** The board says how many that is. It is not "trending across pump.fun" | Ranks every coin that trades |
| Coins older than the server | **Only when somebody opens one by address** | Found by themselves the first time they trade |
| Search by name or ticker | Among coins followed | Among every coin that has traded since the server began |
| Search by address | Any pump.fun coin, either plan | Same |
| Snipers, bundles, insiders | For coins followed from their first block | Same rule, more coins |

The move from A to B is two settings (`FEED_SCOPE=all`, and the stream provider if it is not Helius). The
replay behind the screenshots runs with `FEED_SCOPE=all`, because the recording holds every trade: **it shows
what plan B looks like.** On plan A the same screen has the "as of" labels and the note about the ranking.

### What each feature costs in data

| Feature | Source | Cost |
| --- | --- | --- |
| Board, trending, search, top traders, dev history | This server's own record | Nothing beyond the stream |
| Names and creators of coins first seen part-way | `getMultipleAccounts`, 30 coins a call, one call a second at most | 1 credit a call: under 90,000 a day at the very most, a few thousand in practice |
| Safety checks (mint and freeze authority) | The same read, once per coin opened | 1 credit |
| Pictures | The coin's own description and image, by https from where its creator points (IPFS gateways mostly) | No paid service. Public gateways rate-limit; a refused picture is retried later and the row shows the ticker's first letter meanwhile |
| Opening an old coin by address | `getSignaturesForAddress` and `getTransaction` | Up to about 5,000 credits, once per coin |

### Not done, said plainly

- "Pool liquidity locked" is shown as **not checked**. No check is passed off as passed.
- The creator's other coins lists only coins this server follows. An empty list is not a clean history, and the card says so.
- Top traders are worked out from the trades held for the coin, which for a coin first seen part-way is not all of them.
- The live Helius stream (`HeliusTxStream`) has still never been run: there is no paid key yet. Everything above is proven on recorded blocks.
- Quick buy is off on mainnet, and the field is not shown there.

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
