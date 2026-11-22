# Performance: budgets, how each is measured, and the numbers

22 November 2026. Every number here was produced by a command in this repository on that day. Nothing
is estimated unless the line says so.

**Read this first.** These are measurements on one cloud machine, with a headless Chromium and a
made-up chain for anything that needs a fast stream of trades. They show what this code costs. They do
not show what a visitor far from the server, on a real phone, with a real RPC provider behind the site,
will see. What that leaves unverified is listed at the end, and it is not a short list.

## The budgets, and whether each holds

| # | Budget | Measured | Holds | Proven by |
| --- | --- | --- | --- | --- |
| 1 | Click to "sent" under 100 ms | 13 to 27 ms in a browser on the local validator; under 100 ms server side | Yes | `npm run e2e` (terminal step: fails over 100 ms); `test/flows/server.test.ts`, "the fast trade path" |
| 2 | A trade on the chain reaches the screen within 1 s, aiming under 500 ms | Block made to the trade at 1,000 clients: p50 29 ms, p95 52 ms, worst 62 ms. This is the server's share only (see below) | Yes, for the server's share | `npm run load` |
| 3 | API reads under 100 ms at the 95th percentile | p50 2.1 ms, p95 34 ms, during 60 trades a second and 1,000 live connections | Yes | `npm run load` |
| 4 | First candles within 300 ms | 56 to 167 ms from pressing a coin on the board to candles drawn. A coin's page opened cold: 287 ms from the address being entered | Yes | `npm run perf` |
| 5 | 60 frames a second under a fast stream | 59.9 on the trading screen and 60.1 on the board at 50 trades a second, no frame over 50 ms, no long task | Yes on a desktop. Phone: see below | `npm run perf` (fails under 55) |
| 6 | First load under 1.5 s on a mid-range phone on 4G | Largest paint: homepage 420 ms, board 320 ms, a coin's page 296 ms (emulated: processor slowed 4 times, 9 Mbit/s down, 60 ms added per request) | Yes, as emulated | `npm run perf` |
| 7 | Page changes under 200 ms | 13 to 87 ms across four changes, four rounds each, the first round included | Yes | `npm run perf` |
| 8 | No layout shift | 0.000 homepage, 0.003 board, 0.008 a coin's page (budget 0.02) | Yes | `npm run perf` |
| 9 | Long lists are virtualised | The board's columns, the trades list and the holders list draw only the rows on screen | Yes | `components/ui/useVirtual.ts`; the 60 frames a second above is with them |
| 10 | Heavy work off the main thread | The live connection, the wallet's key and password work, and the Ring SDK each run in a worker. No long task was recorded on the main thread during the stream test | Yes | `lib/client/live.worker.ts`, `lib/client/vault.worker.ts`; `npm run perf` counts long tasks |
| 11 | Bundles split by route; the chart loaded on demand | Script sent for a first load, compressed: homepage 192 kB, board 197 kB, a coin's page 211 kB. The chart is its own file, fetched when a coin's page opens. The Ring SDK (several MB) is fetched only when the real Ring is first used | Yes | `npm run perf` (fails if a first load grows past 250, 250 and 290 kB) |
| 12 | Privacy proofs made in a worker, with progress shown | The code path exists: the Ring SDK runs in the wallet's worker and reports each stage ("asking the prover for a proof", "waiting for the chain") to the page. **Never timed: no proof has been made yet**, for want of devnet SOL (RING-RESULTS.md). On the Default Ring the proof is made by Helius's prover, not in the browser | Not measured | Nothing yet |
| 13 | Load: at least 50 trades a second on one coin with 1,000 clients | 60 a second for 20 seconds, 1,000 live connections: every connection received all 1,200 trades, none was dropped, no channel was reset | Yes | `npm run load` |

`npm run load` and `npm run perf` exit with an error when a budget is missed, and both run in CI (the
`speed` job in `.github/workflows/check.yml`). The CI job has not run yet: the repository has no
workflow runs to its name until it is pushed somewhere that runs them.

## Before and after

"Before" is the build before the backend was rebuilt, that is, before commit `1b06fc7` (BACKEND.md, part 1).
Where the old figure was not measured at the time, the table says where it comes from.

| | Before | After |
| --- | --- | --- |
| A trade reaches other people's screens | Up to 3,000 ms: pages asked again every 3 seconds. From the old code, not measured | p95 52 ms from the block to 1,000 clients, measured |
| Click to "sent" | The click waited for the chain to confirm before any word came back: two requests, several chain reads, then confirmation. Not measured | 13 to 27 ms, measured in a browser |
| Chain calls for one view of the board | One or more per coin per request (200 coins: 200 calls). From the old code | None. Counted by `server.test.ts`: 0 |
| Chain calls to build a trade | Several: the curve, the fee settings, a blockhash | At most two; one when the blockhash is warm. Counted by `server.test.ts` |
| Page weight, app pages | 185 to 197 kB of script (measured on 21 November, `TEST-REPORT.md`) | 192 to 211 kB. It grew by a trading screen, a board and live data; the chart is not in it |
| Layout shift, a coin's page on a phone | 0.217, measured on 22 November before the fix below | 0.008 |
| Frames a second on a coin's page, phone with the processor slowed 4 times, 50 trades a second | 41 to 46, measured on 22 November before the fix below | 57 |

## What the performance test found, and what was changed

The first run of `npm run perf` failed, usefully:

- **Layout shift of 0.217 on a coin's page on a phone.** Dollar figures and the build's notice arrived a
  moment after the first paint and pushed everything below them. Now the server hands both the price of
  SOL and the build's settings to the page as it renders it (`lib/price-header.ts`), so they are in the
  first HTML. The chart toolbar's rows are fixed on a phone, so font loading cannot rewrap them.
- **The chart toolbar ran off the right edge of a phone**, hiding the "Price" switch. The column it sits
  in could grow past the screen. It cannot now.
- **The header took a quarter of a phone's screen**: eight links on two rows. They are one row now,
  scrolled sideways, with the current page brought into view.
- **41 to 46 frames a second on the slowed phone.** Every frame of live data redrew every word on the
  screen. Words and figures are now redrawn at most ten times a second; the chart still draws every
  frame, straight from the candles. Result: 57 frames a second.

## How each is measured

**`npm run load`** (`scripts/load.ts`, `scripts/load-clients.mjs`). This app's own server code: HTTP,
websocket, indexer, embedded Postgres and the live hub, with 1,000 real websocket connections held by four
other threads, and a fifth thread reading the API fifteen times a second. The chain is made up
(`lib/server/indexer/sim-source.ts`): a block every 400 ms carrying the trades made since the last.
Timings are taken with the machine's clock on both sides: when the block was made, and when a client
was handed the trade.

Full output of the budgeted run:

```
1000 live connections open on one coin. Trading 60 a second for 20 seconds, a block every 400 ms.
     Trades made: 1200 in 20 s (60/s) on one coin
ok   Live connections: 1000
ok   Connections that received every confirmed trade: 1000 of 1000
ok   Connections dropped or closed by the server: 0 dropped, 0 closed
ok   Channel resets sent: 0
ok   Block made to confirmed trade at the client: p50 29 ms, p95 52 ms, worst 62 ms (budget p95 1000 ms, aim p50 under 500)
ok   Trade announced to early notice at the client: p50 32 ms, p95 49 ms (budget p95 250 ms)
ok   API reads during the run, timed by the caller: 328 reads, p50 2.1 ms, p95 34 ms, 0 failed (budget p95 100 ms)
       explore: p50 1.9 ms, p95 11 ms over 66
       coin: p50 2.2 ms, p95 10 ms over 66
       coin/trades: p50 2.0 ms, p95 13 ms over 66
       coin/candles: p50 1.8 ms, p95 5.6 ms over 65
       coin/holders: p50 27 ms, p95 43 ms over 65
     API reads, timed by the server: p50 0.5 ms, p95 28 ms over 324
     Frames sent by the hub: 382000
     Server thread held up (timer lateness): p50 0.3 ms, p95 13 ms, worst 86 ms
Every load budget held.
```

And beyond the budget, to see where it bends (`LOAD_TRADES_PER_SECOND=200 LOAD_CLIENTS=3000 npm run load`):

```
     Trades made: 4000 in 20 s (200/s) on one coin
ok   Connections that received every confirmed trade: 3000 of 3000
ok   Connections dropped or closed by the server: 0 dropped, 0 closed
ok   Block made to confirmed trade at the client: p50 41 ms, p95 54 ms, worst 66 ms
ok   Trade announced to early notice at the client: p50 43 ms, p95 72 ms
ok   API reads during the run, timed by the caller: 330 reads, p50 11 ms, p95 62 ms, 0 failed
     Server thread held up (timer lateness): p50 0.4 ms, p95 52 ms, worst 143 ms
```

It holds, with less room: the server's one thread is now late by 52 ms at the 95th percentile, because it
writes every frame to every socket. The same heavy run made while a browser test was using the machine
gave API reads a p95 of 148 ms, over budget. So the ceiling of one process is somewhere above this, and
not far above. The next step, if it is ever needed, is a second process for the live hub.

**`npm run perf`** (`scripts/perf.mjs`, `scripts/sim-server.ts`). The built site on the made-up chain, one
coin trading 50 times a second, sixty other coins on the board, and a real headless Chromium. The phone
is the browser's emulation: a 390 by 844 screen, the processor slowed four times, 9 Mbit/s down, 1.5 up,
60 ms added to every request. Page changes and the chart are timed inside the page, from the press to the
frame after the new content is there. Frames are counted with the browser's own frame callback for ten
seconds.

Full output:

```
ok   First load of /, phone on 4G: largest paint 420 ms (median of 3; worst 512), first paint 420 ms (budget 1500 ms)
ok     layout shift: 0.000
ok     script sent, compressed: 192 kB (budget 250 kB)
ok   First load of /terminal, phone on 4G: largest paint 320 ms (median of 3; worst 324), first paint 320 ms (budget 1500 ms)
ok     layout shift: 0.003
ok     script sent, compressed: 197 kB (budget 250 kB)
ok   First load of a coin's page, phone on 4G: largest paint 296 ms (median of 3; worst 308), first paint 296 ms (budget 1500 ms)
ok     layout shift: 0.008
ok     script sent, compressed: 211 kB (budget 290 kB)
ok   Page change, board to a coin: first 87 ms, then 43, 43, 70 ms (budget 200 ms)
ok   Page change, coin to the board: first 27 ms, then 31, 43, 32 ms (budget 200 ms)
ok   Page change, board to all coins: first 64 ms, then 43, 47, 57 ms (budget 200 ms)
ok   Page change, all coins to the portfolio: first 15 ms, then 16, 13, 13 ms (budget 200 ms)
ok   Opening a coin from the board: candles drawn: first 167 ms, then 56, 56, 70 ms after the press (budget 300 ms)
     A coin's page opened cold: candles drawn: 287 ms after the address was entered (no budget: it includes loading the page)
ok   50 trades a second on the trading screen, desktop: 59.9 frames a second, 0.0% of frames over 50 ms, 95th frame 16.7 ms, worst 17 ms, 0 long tasks (budget 55 a second, 1% slow)
ok   50 trades a second on the board, desktop: 60.1 frames a second, 0.0% of frames over 50 ms, 95th frame 16.8 ms, worst 17 ms, 0 long tasks (budget 55 a second, 1% slow)
     50 trades a second on the trading screen, phone with the processor slowed four times: 57.3 frames a second, 0.2% of frames over 50 ms, 95th frame 16.8 ms, worst 50 ms, 0 long tasks (measured, not a budget)
Every performance budget held.
```

**Click to sent, and confirmation.** `npm run e2e` presses the buy button in a real browser against the
local validator, with a real pump.fun trade behind it, and reads the time from the press to the
transaction having left for the network: 13 to 27 ms over the run, with one-click trading on. It fails
over 100 ms. Confirmation then took 0.2 to 0.5 s on the local validator, which is the validator's own
pace and says nothing about a real network.

**Chain calls.** `test/flows/server.test.ts` counts every call the server makes to the chain: none for
the board, a coin, its trades, candles, holders or a portfolio; at most two to build a trade; three to
read a wallet's balances however many coins it holds.

## Unverified, plainly

None of the following has been measured. Each is a way the numbers above could be wrong for a real visitor.

1. **A real RPC provider.** Budget 2 is the server's share: from a block arriving to the trade at the
   client. How long Helius takes to hand over a confirmed block on devnet or mainnet is not in it, and
   that is usually the larger part. On the local validator the whole path, press to confirmed on screen,
   was 0.2 to 0.5 s.
2. **A real network between visitor and server.** Everything ran on one machine. A visitor 150 ms away
   adds 150 ms to every figure that crosses the network.
3. **A real phone.** The phone is Chromium's emulation on a server processor. A real mid-range phone has
   a slower graphics path and less memory. The 57 frames a second is the least trustworthy number here.
4. **Any browser but Chromium.** Safari and Firefox were not run.
5. **A mainnet-sized chain.** The indexer reads every confirmed block through the RPC. On mainnet a
   block is megabytes and that would not keep up; it needs a streaming source (BACKEND.md, "Open").
6. **Many coins.** The board was measured with 61 coins. Reads are from memory and lists are virtualised,
   so thousands should be fine, and that sentence is a belief, not a measurement.
7. **A hosted Postgres.** The load test used the embedded Postgres in the same process. A database across
   a network adds a round trip to every block applied, though not to reads, which come from memory.
8. **Proof time for a Ring transfer or withdrawal.** No proof has been made. See budget 12.
9. **CI.** The `speed` job is written and has never run. A shared CI runner is slower and noisier than
   this machine; the budgets may need room there, and that will be known after its first runs.
10. **Long runs.** The load test is 20 seconds. Nothing here shows the server's memory after a day.
