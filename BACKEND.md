# Backend: audit and rebuild

Written 21 November 2026. Part one is the audit of the backend as it stood at commit 41 (before the rebuild).
Part two is the design that replaces it. Part three, at the end, says what was fixed and what is still open.

## 1. Audit of the old backend

The old backend was a set of plain functions behind one Next.js route, a single JSON document as its store,
and the chain read afresh on every request. It was correct for one person on a local chain. It was not a
production backend. Findings, most serious first:

| # | Finding | Where | Why it matters |
| --- | --- | --- | --- |
| A1 | There is no indexer. Nothing follows the chain. Coins, prices and activity are read from the RPC inside each request. | `operations/market.ts` (`coinView`, `activityOf`) | Every page view costs one or more RPC calls per coin. `explore` with 200 coins is 200 calls. Nothing can be pushed live, because the server does not know anything happened. |
| A2 | Prices are recorded only when somebody looks. A point is added to the history when a coin page is read and the price differs from the last reading. | `coinView` | A coin nobody is watching has no history. A burst of trades between two readings is one point. A real chart cannot be drawn from it. |
| A3 | No trades are stored. Activity is a list of signatures from `getSignaturesForAddress`: no side, no amount, no price, no wallet. | `activityOf` | No trades feed, no volume, no candles, no positions, no profit and loss, no holders. |
| A4 | No live transport. Pages poll every 3 seconds. | `useCoins(3000)`, `ActivityList` | A trade is seen up to 3 seconds late, and every open tab costs RPC calls for ever. |
| A5 | The store is one JSON document rewritten whole after every change. | `store.ts`, `database.ts` | Each write costs as much as the whole state. Events, credited signatures, nonces and prices grow without bound inside it. In Postgres it is one row. |
| A6 | Money steps are atomic only because the document is written whole. The database enforces nothing: no row per balance, no constraint that a balance cannot go below zero, no unique key on a credited signature. | `ring.ts`, `settle.ts` | One bug in memory becomes the stored truth. A second line of defence in the database is missing. |
| A7 | `credited` and `nonces` are arrays searched with `includes`. | `settle.ts`, `auth.ts` | Linear in everything ever credited. |
| A8 | A trade takes two HTTP round trips and several RPC reads before anything is sent: build (reads the curve, the fee settings and a blockhash from the RPC), sign, send, and `tx/send` waits for confirmation and settlement before it answers. | `transactions.ts`, `tx/send` | Hundreds of milliseconds between the click and the transaction leaving, and the person is told nothing until it is confirmed. |
| A9 | A transaction is sent once, to one RPC, with no priority fee, no resend and no second route. | `sendSigned` | Under load on a real network such a transaction is often dropped. |
| A10 | `wallet/public` reads one balance per coin per request from the RPC. | `operations/market.ts` | Grows with the number of coins; slow and expensive. |
| A11 | No caching. Every answer is `no-store` and computed from scratch. | route | Reads cannot meet a 100 ms budget when each makes RPC calls. |
| A12 | Rate limits count every caller as one unless a proxy count is set, and live in one process's memory. | `limit.ts` | Acceptable for one process. Documented, kept, and extended to websocket connections. |
| A13 | Logs are `console.error` with free text. No request id, no timing, no levels. | `handlers.ts` | Nothing can be searched or measured. |
| A14 | `/health` says only whether the RPC answers. It says nothing about the database, the indexer's lag or the live connections. | `app/health/route.ts` | A host cannot tell a server that is up from one that is three minutes behind the chain. |
| A15 | The API lives inside the Next.js bundle. The framework gives a route handler no way to hold a websocket, and a second copy of the server code in another process would not share its memory. | `app/api/[...op]/route.ts` | Live data needs the API, the indexer and the websockets in one process. |
| A16 | Input validation is by hand and good on the operations that exist, but there is no limit on list sizes because there are no lists. | `validate.ts` | New read endpoints need bounds on every page size and range. |

What was already sound and is kept: transactions are built on the server and signed in the browser; signed
requests with nonces; reads first and one step for each money move; payouts recorded before they are sent;
the single-writer lock; refusing to start on a damaged store; the secret scan.

## 2. The rebuilt backend

One Node process (`server/main.ts`) holds everything that must share memory:

```
            ┌────────────────────────── one process ───────────────────────────┐
 chain ───► │ sources ─► indexer ─► database (trades, candles, holders, cursor) │
 (RPC, ws)  │   blocks      │                                                   │
            │   logs        └─► live hub ─► websocket clients (/ws)             │
            │                                                                   │
 browser ─► │ HTTP: /api/* (operations) · /health · /u/* · everything else → Next│
            │ sender: blockhash cache, routes in parallel, resend until settled │
            └───────────────────────────────────────────────────────────────────┘
```

### Database

Postgres everywhere. With `DATABASE_URL` it is a Postgres server (a pool for reads, one connection holding
the single-writer lock for writes). Without it, an embedded Postgres (PGlite) kept in `DATA_DIR`, so a fresh
clone still runs with no database to install. One dialect, one schema (`server/schema.ts`), real tables.

### Indexer

- **Ordered.** The block follower walks confirmed slots in order. Each block's trades, balance changes,
  candles and the cursor are written in one database transaction, so a block is applied whole or not at all.
- **No double counting.** A trade's key is its signature and its position in the transaction. A block is
  applied only if it is the next one after the cursor. Applying the same block twice changes nothing.
- **Restarts.** The cursor is in the database. On start the follower resumes from it and backfills.
- **Reorgs.** The follower keeps the hash of each recent block. A block whose parent hash is not the one
  stored means the chain was reorganised: everything above the common ancestor is rolled back (trades
  deleted, holders restored, candles rebuilt from the trades that remain) and the new branch is applied.
- **Fast path.** A subscription to the program's logs delivers a trade before its block has been fetched.
  It is shown at once, marked provisional, and replaced by the block follower's ordered copy. A provisional
  trade whose slot the follower has passed without finding it is withdrawn.

### Candles

1s, 1m, 5m, 15m, 1h and 1d, stored per coin, updated in the same transaction as the trades that move them,
and rebuilt from trades for any bucket touched by a reorg or an out-of-order arrival. The newest candles of
each coin and timeframe are also held in memory, so the first screen of a chart is served without a query.

### Live data

One websocket endpoint. A client subscribes to channels (`board`, `coin:<mint>`, `wallet:<address>`).
Messages are batched (one frame per channel per 40 ms at most), carry only what changed, and are serialised
once however many clients receive them. Each channel numbers its messages; a client that reconnects says
the last number it saw and is sent what it missed, or is told to take a fresh snapshot if it was away too long.
A client that cannot keep up is disconnected and resynchronises rather than slowing the others.

### Money steps

The Ring stand-in's logic (reads first, one synchronous step, payout recorded before it is sent) is
unchanged: it was reviewed twice and is covered by the flow tests. What changed is where it is kept.
Every step is now written as **one database transaction** into real tables: a row per balance with a
constraint that it cannot be negative, a row per credited signature with a primary key (a second credit of
the same signature is refused by the database, not only by the code), a row per event, offer, window and
pending payout. Only the rows a step changed are written. No answer is given until that transaction has
committed. A refused write stops the server from accepting more, as before.

### Trading path

- A blockhash is kept fresh in memory from the chain's slot notifications. The program's fee settings and
  each coin's curve reserves are held by the indexer. Building a trade reads no RPC.
- The terminal asks for its preset trades ahead of time. A click signs a transaction that already exists
  and hands it to the server over the websocket that is already open.
- The server answers as soon as the transaction has been handed to the network, then sends it down every
  configured route in parallel and keeps resending until it is confirmed or its blockhash expires.
- Priority fee and slippage are per trade. A Jito tip is added when a tip account is configured.

### Around it

Structured JSON logs with a request id and timing; `/health` reports the database, the chain, the indexer's
lag, websocket clients and the sender's queue; rate limits on HTTP and on websocket connections and
messages; every list endpoint has a bounded page size; cacheable reads carry short `cache-control` and are
served from memory.

## 3. What was fixed, and what is open

Status on 21 November 2026. "Proven by" names the test that fails if it stops being true.

| # | Finding | Now | Proven by |
| --- | --- | --- | --- |
| A1 | No indexer; coins read from the RPC per request | The indexer follows the chain; the board, a coin, its trades, candles, holders and a portfolio are served with **no chain call at all** | `test/flows/server.test.ts`, "reads never ask the chain about a coin" (counts calls: 0) |
| A2 | Prices recorded only when somebody looked | Every trade is stored with the price before and after it | `test/unit/indexer.test.ts` |
| A3 | No trades stored | A row per trade, keyed by transaction and place in it | same |
| A4 | Polling | One websocket; batched, numbered, changes only; replay after a reconnect | `test/unit/live.test.ts`; `server.test.ts`, "live data" |
| A5, A6, A7 | One JSON document; no database constraints; arrays searched linearly | Real tables, one transaction per step, a balance cannot go below zero, a signature cannot be credited twice | `test/unit/store.test.ts`, `test/unit/database.test.ts` |
| A8 | A trade took two round trips and several RPC reads | Trades are built ahead of the click with one chain call each; the click signs and sends over the open websocket | `server.test.ts`, "the fast trade path" (under 100 ms) and "at most two calls" |
| A9 | Sent once, to one RPC, no fee, no resend | Parallel routes, resend until confirmed or expired, priority fee and optional tip | `server.test.ts`; `test/flows/resilience.test.ts` |
| A10 | One balance read per coin | Three calls however many coins, kept for a moment, dropped when the indexer sees a change | `server.test.ts` |
| A11 | No caching | Hot reads come from memory; balances and activity are kept briefly | same |
| A12 | Every caller counted as one | Counted by connection address by default; websocket connections and messages are limited too | `server.test.ts`, "counts each caller" |
| A13 | Free-text logs | One JSON object per line, with levels; keys in URLs are removed | `lib/server/log.ts` |
| A14 | Health said only "RPC answers" | Database, indexer lag in slots, live clients, sender queue, request percentiles, RPC calls by method; 503 when the indexer is behind | `server.test.ts` |
| A15 | API inside the page framework | One server process (`server/`) | the whole flow suite runs on it |
| A16 | No list endpoints to bound | Every list has a largest page size and refuses anything else | `test/flows/launch-and-market.test.ts` |

The indexer's guarantees, each with its test in `test/unit/indexer.test.ts`:

- order, and the curve, holders and candles equal to the chain's ("applies blocks in order");
- candles for all six timeframes joining up across bucket boundaries;
- a restart carries on from the cursor, picks up what it missed, and ends in the same state as an indexer
  that never stopped;
- the same block cannot be applied twice: the database refuses the second;
- a reorganisation is undone and the new branch applied, ending in **exactly** the state a clean run over
  the final chain reaches (trades, candles, holders, markets compared row by row);
- a trade heard early is announced once and stored once;
- while the chain cannot be read the indexer keeps trying, loses nothing, and says so on `/health`.

### Open

| Thing | Why it is open |
| --- | --- |
| The block follower reads every confirmed block through the RPC | Right for a local chain and workable on devnet. On mainnet a block is megabytes and the follower would need a streaming source (Helius LaserStream or a Geyser feed). The source is an interface (`ChainSource`) so one can be added. **Not built, not measured** |
| Reorganisations on a real network | Proven on a made-up chain that forks on demand. A confirmed block being dropped on a real network is too rare to wait for. **Unverified against a real one** |
| A Jito tip, and several send routes | The tip instruction and the parallel routes are built and unit-tested. Tip accounts exist only on mainnet, and a second route needs a second provider. **Unverified** |
| Pool (graduated coin) trades | The indexer decodes pool events; the made-up chain has no pool, and the local validator does not hold the pool program yet. **Unverified until item 7 of the priority list** |
| One server process | By design: the single-writer lock, the hub and the sender live in one process. Scaling out needs a shared message bus for the hub; nothing here needs it yet |
| The stand-in ledger is held in memory in full | It is the stand-in. The real Ring replaces it (RING-PLAN.md) |
