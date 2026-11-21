# Reference study: what the others do, and where RINGPAD is behind

Studied on 21 November 2026 with a headless browser at 1440x900 and 390x844, and with the sites' own
documents. No wallet with funds was connected, nothing was signed, no account was made. Structure and
behaviour only: none of their wording, code or branding is used in RINGPAD.

Every statement below is marked by how it is known:

- **seen**: the page was rendered and looked at, or its network traffic was read.
- **bundle**: read from label text in the site's public JavaScript. The screen itself was behind a signature.
- **docs**: the product's own documentation.
- **third party**: a review or write-up. Weakest.

## What could not be studied, and why

| Thing | Why |
| --- | --- |
| **hushrings.app, all of it** | Its server presents a certificate for `*.up.railway.app`, not for `hushrings.app`, so a browser refuses it. `www.hushrings.app` does not connect. Tried twice, hours apart. Certificate checking was not switched off: a host that fails the name check may not be the real site. **Nothing in this file is about hushrings.app.** It needs a look from your own browser, or a second try when its certificate is fixed. |
| Every rings.run screen behind "Unlock Rings" | Unlocking takes a wallet signature. Seen only as far as "connected but locked". Sell steps 2 to 5, the deal room, the deposit and withdraw forms and live transaction feedback are known from bundle text only. |
| Axiom's app | A bot challenge refused the browser. Known from its docs and third parties only. |
| Padre's app (now "Terminal") | Every route redirects to sign-in. Its public landing page embeds a working demo of the board, which was seen. |
| Toasts and optimistic updates on any terminal | They only appear during a real trade. |

## rings.run

One application on five hosts: a hub, an OTC desk, a launchpad, a swap page and a trading terminal.
46 updates shipped in 12 days, by its own changelog. That pace is its real strength.

### How its privacy really works (by its own account)

| Product | What is private | How |
| --- | --- | --- |
| OTC | Coin, size and price of a settled block | One Ring transaction signed by both sides. Listing and offers are off-chain on its server, encrypted to the parties |
| Launch | Only who the creator is | Its server launches from a single-use key of its own and holds the payment and the first buy for about a minute. Custodial, and it says so |
| Swap, limit orders, DCA | That your wallet made the trade | "Rings trades for you": you pay its server privately, it trades from its own keys. Custodial, and it says so |
| Terminal | Nothing about the trades | A hot "trading key" trades in public. It can be funded from a Ring balance, which hides who funded it |
| Curve buys and sells | Nothing | Public, from your own wallet |

### Pages and flows

**Access (seen).** Connect, then a second step "Unlock": one signature derives the Ring keys in the browser
and lasts seven days. With no wallet extension the connect box is empty. There is no wallet-less way in.

**The "what the world sees" panel (seen).** Beside every action: a sticky side panel with an Outside and an
Inside view. Outside lists each fact with where it lives (chain, or their server) and one of four states: in
the open, sealed, could be inferred, discoverable. Inside shows the person's own draft. It updates as the
form is filled, and it includes what their own server and the user's IP reveal.

**Launch (seen: steps 1 and 2).** Four steps: token, coin, fund, review. Step 1: picture, name with a
counter, ticker forced to upper case, description, links; every missing field is named at once. Step 2: where
it launches (three launchpads), what it trades against (15 pair coins), first buy with presets 0.1 / 0.5 / 1 /
2, fixed facts (supply, decimals, authorities revoked), and sliders for where trading fees go.

**Coin page (seen).** Header with a state chip; six figures (price, market cap, 24h, volume, holders, trades);
its own candlestick chart with 1m to 1d and a price or market cap switch, no volume bars; tabs with counts
(trades, holders, payouts, about); a ring showing how full the curve is; a trade box with buy presets 0.1 /
0.5 / 1 / max, sell presets 25 / 50 / 75 / max, price impact, the fee and where it goes, slippage 1% by
default with 0.5 / 1 / 3 / custom. The quote is worked out in the browser as you type. Updated by polling
every 6 to 7 seconds.

**Deposit and withdraw (bundle).** From a balance page. A deposit says it shows coin, amount and wallet. A
withdrawal opens a panel "what this withdrawal makes public" before signing. A coin the Ring cannot hold is
refused with the reason.

**Notes (seen: absent).** There are no private notes or memos, no pay links and no receipts to disclose.

**OTC (seen: board, block page, sell shell).** A board with tabs and counts (open, invited, closed), filters
for discount, expiry and share of supply, four sorts, and a column "versus market" with the price source and
its age in seconds. A block page with the terms, the discount stated plainly, and a designed state for "no
reliable market price". Selling is five steps: token, size, price, visibility, review. Blocks can be sold
whole, in parts, by sealed-bid auction or by invitation. Buy requests are the reverse of a listing. Prices
older than 30 seconds are marked stale and after 2 minutes cannot be traded against.

**Portfolio (seen: shell).** In the terminal only: profit and loss for the trading key over 1d / 7d / 30d /
all, in SOL or USD, and a lookup of any wallet.

**Terminal (seen).** A board of three live columns (new, about to graduate, graduated), each with its own
filters, search, quick-buy amount and one of three saved presets (slippage, priority fee, tip, MEV
protection). A column pauses while the pointer is over it and counts the rows held back. A status bar shows
connection state and latency. The coin page has a candle chart with 1s to 1d, volume, market cap or price,
USD or SOL, markers for the user's own trades and the creator's; tabs for trades, holders, positions and the
creator's other coins; change tiles for 5m / 1h / 6h / 24h; a buy and sell panel with editable presets; a
floating instant-trade panel with keys Q W E R to buy and A S D F to sell. Data arrives over a websocket at
about ten frames a second. `/` focuses search.

**Phone (seen).** Bottom tab bars on Launch and Terminal, a sticky buy and sell bar on coin pages, no
sideways scroll anywhere. The OTC desk has no navigation on a phone at all.

**Manuals (seen).** A table of what each step makes public, to the chain, to Helius and to their own server;
three worked examples of how timing and amounts give a person away, each with what to do instead; cards for
who is trusted with what; an audit page that states what was not audited.

### What feels good there

1. The outside and inside panel beside every action, applied without exception, including to their own server.
2. Timing and amount inference taught with worked examples, and warned about at the moment it matters.
3. Plain statements of custody and trust, and an audit page that says what it did not cover.
4. Every market price carries its source and age, and "no reliable price" is a designed state.
5. Presets on every amount, and an order restated in words before paying.
6. Terminal ergonomics: quick buy per column, saved presets, pause on hover, latency shown, hotkeys.
7. A phone layout that was designed, not shrunk.
8. A public changelog with times.

### Where it is weak

1. The privacy is thinner than the name suggests. Launch, swap and terminal privacy rest on custody by their
   server. Only OTC settles as a Ring transfer.
2. No wallet-less entry, and two signatures before anything works.
3. Test rows ("poc", "e2e-test") in production; wrong page titles; a "Status" link that is not a status page.
4. No live data outside the terminal: a coin page lags up to 7 seconds and re-downloads everything each poll.
5. Listing an OTC block makes the seller's wallet discoverable through a public fee payment.
6. Many fees: listing, offer, settlement, curve.

## The trading terminals: Axiom, GMGN, Padre

GMGN was seen first-hand. Axiom is from its docs. Padre is from its landing demo and third parties.

**What all three share (the bar a terminal is measured against):**

1. A three-column live board: new, about to graduate, graduated.
2. Dense rows that answer "is this safe" at a glance: age in seconds, market cap, volume, trade count with a
   buy and sell bar, and what the top holders and the creator hold.
3. Filters per column with ranges for age, market cap, volume, holders and creator share, and keywords.
4. Quick buy on every row with a preset amount and no confirmation.
5. The board is pushed over a websocket. GMGN's sends field-level changes, not whole rows.
6. Four trade settings, always the same four: slippage, priority fee, tip, MEV protection. Bundled in three
   presets.
7. Quick-amount buttons the user can edit; selling by share of what is held.
8. One-click trading with no wallet prompt, from a key the terminal manages.
9. A candle chart with second-level timeframes, price or market cap, and markers for the user's own trades
   and the creator's.
10. A trades feed with ages as bare "3s", filters for own and creator trades.
11. A holders view with share of supply and labels for the creator and other notable wallets.
12. Position and profit per coin on the coin page, and a portfolio page.
13. Keyboard buying (GMGN documents a full scheme; Axiom "space plus key").
14. A phone layout where columns become tabs and a sticky bar carries buy and sell.

GMGN's coin page at 1440 pixels, as a measure of density: a 258 px left rail, a centre of about 860 px
(header, a resizable chart of about 290 px, a tabbed table), a 320 px right column (figures, the buy and sell
panel, a safety grid, pool and creator facts), and a status bar.

What they have that RINGPAD does not aim for in this pass, with the reason: limit orders, take-profit and
stop-loss, and orders triggered by graduation or by the creator selling. Each needs a server that holds a
key able to trade for the user, which is custody. Wallet trackers and social feeds are a product of their
own. These are listed under "not closed" below, not forgotten.

## Where RINGPAD stood, gap by gap

"Before" is the build at commit 42 (21 November 2026). "Now" is kept up to date as gaps are closed.

| # | Gap | Before | Now |
| --- | --- | --- | --- |
| 1 | Live data | Pages polled every 3 seconds; each poll cost RPC calls per coin | **Closed.** Indexer, websocket, changes only. See BACKEND.md |
| 2 | A real chart | A line drawn from readings taken when somebody looked | In progress: candles 1s to 1d are stored and served; the chart itself is next |
| 3 | Trades feed with side, size, price, wallet | A list of signatures | Stored and pushed live; the table is next |
| 4 | Holders view | None | Stored and pushed live, with the curve, creator and Ring stand-in labelled; the table is next |
| 5 | Position and profit per coin, portfolio | None | Served from stored trades; the pages are next |
| 6 | Three-column board with filters and search | One list, sorted two ways | Next |
| 7 | Buy presets, sell by share, slippage, priority fee | One amount field, slippage fixed at 2%, no priority fee | Server side done (slippage, priority fee, tip, presets built ahead of the click); the panel is next |
| 8 | One-click trading and instant feedback | Two requests, then a wait for confirmation with no word meanwhile | Server side done: click to sent measured under 100 ms locally; the panel is next |
| 9 | Transaction feedback: pending, confirmed, failed, with a receipt | One status line after the fact | Server pushes each stage; the interface is next |
| 10 | Keyboard shortcuts | None | Next |
| 11 | A designed phone layout: tabs and a sticky trade bar | Stacked sections | Next |
| 12 | Price source and age on every figure; USD beside SOL | SOL only, no age | Next |
| 13 | Counters, forced upper case and all errors at once on forms | Partly | Next |
| 14 | What your own server sees, in the panel | In the docs only | Next |
| 15 | Worked examples of timing and amount inference; warnings at the moment | Warnings on withdrawal only | Next (priority item 9: split withdrawals, delays, fresh destinations) |
| 16 | A wallet session instead of a signature per refresh | Every refresh of a Ring balance was signed | **Closed.** One signature opens a session; nothing on a timer prompts a wallet |
| 17 | Trading graduated coins, and any pump.fun coin by address | Coins launched here, on the curve only | Indexer reads pool trades; building pool trades and adding a coin by address are next |

Where RINGPAD was already ahead, and stays so: a wallet-less way in; no custody of trades or launches (the
person's own wallet signs everything on the curve); sealed notes, pay links and receipts; a real status
page and docs; test coverage that is published with the code.

## Not closed, and why

| Thing | Why not |
| --- | --- |
| Limit orders, take-profit, stop-loss, DCA, orders on graduation | Each needs the server to hold a key that can trade for the user. That is custody of user funds, which is outside what this project may do without your say-so |
| "Trade for me from the site's own keys" privacy for swaps and launches | The same: custody, and trust in the server not to link payer and trade |
| Sealed-bid auctions and selling a block in parts | OTC on the real Ring is not yet proven to settle in one transaction (RING-RESULTS.md). Extending it comes after that answer |
| Wallet tracker, social feed, sniper and bundler labels | A product of their own, needing data sources this project does not have. Creator labels and top-holder share are built; the rest is not claimed |
| Three launchpads and fifteen pair coins | pump.fun on SOL only. Adding a launchpad is a build of its own |
| Anything about hushrings.app | Could not be reached. See the top of this file |
