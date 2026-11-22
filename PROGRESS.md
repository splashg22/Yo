# Progress

Last updated 22 November 2026.

## Summary

### 1. OTC

This folder is the Rings launchpad. Its OTC page is the launchpad's own feature, written
here from scratch. Your separate OTC project is the artifact "Agent OTC Desk: Working
Spec" (a spec, no code). I did not open, edit, republish or delete it, nothing in the
launchpad is connected to it, and it is parked, as is the ShadowTerminal artifact.
Evidence: `OTC-CHECK.md`.

### 2. Where the code lives

`/home/user/ringpad`, its own git repository. On 22 November you asked for it to be pushed to
the branch `ringpad` of `splashg22/Yo`, and it is, after every major piece. **That
repository is public**, so the code is public; no key or secret is in it (`npm run scan`
checks what is served and the whole git history). A private repository is still the right
home for it (`NEEDS.md`, item 1).

### 3. What works end to end, and the test count

On a local validator holding copies of the real pump.fun and Privacy Rings programs, in a
browser, each flow run three times and once after a reload, with balances read back from
the chain: no-wallet mode and backup; launch (create, register and first buy in one
signature, with an optional picture); buying and selling on the curve from a trading
screen with live candles, trades and holders; one-click trading from the keyboard and the
board; graduating a sold-out coin and trading it through its pool; opening any pump.fun
coin by address; deposit, Ring transfer with a sealed note, withdraw; a withdrawal split
into uneven parts to an address made for it; OTC; pay links; creator fees into the Ring;
receipts; portfolio; status.

The server is one process: an indexer that follows the chain block by block, a database
of real tables, a websocket that pushes changes, a sender that returns at once and
resends until the chain takes a trade. `BACKEND.md` is the audit of what was there and
what replaced it. `PERFORMANCE.md` is every speed budget with its measured number.

266 tests (156 unit, 110 flow), 6 more that run only with a real Postgres. Browser checks:
19 flow steps, crawler over 16 pages and 5 error pages at two widths with 0 findings, 14
break-it checks, 11 motion checks, 3 sealed-window checks, secrets scan clean. A load test
(60 trades a second on one coin, 1,000 live connections) and a browser performance test,
both failing the build on a missed budget, both passing. Detail: `TEST-REPORT.md`.

### 4. Still a mock or stand-in; not verified

Mock, on the local chain: Ring balances, Ring transfers, OTC settlement, pay-link payment
and the sealed window's custody are a ledger and an escrow wallet on the server.
Stand-in: all ring images and video. Placeholder: who runs the site. Drafts: Terms,
Privacy Policy.

**The real Privacy Rings program** is wired in for devnet behind the same wallet page, and
is the part most in need of proof. Proven, with the Helius key, on devnet: its RPC,
indexer and attested prover are reachable; in a browser the SDK loads in the wallet's
worker, reads an empty wallet through this server's own door, and offers registration.
**Not run at all: registering, depositing, transferring and withdrawing.** They need 1 to
2 devnet SOL and both faucets refuse this machine. The three open questions (can OTC
settle atomically, does registering a coin need Helius's permission on mainnet, can wallet
extensions sign version 1 transactions) are therefore still unanswered. `RING-RESULTS.md`.

Not verified, plainly: anything with real money or on mainnet; the real Ring beyond the
above; a real RPC provider under load; a real phone; any browser but Chromium; a real
wallet extension; a screen reader; the Pinata upload; a hosted Postgres; the container
image (never built); the CI workflow (never run); reorganisations on a real network; any
review by someone outside the project. `PERFORMANCE.md` ends with its own list.

Privacy today (`PRIVACY-AUDIT.md`): no wallet address is hidden from anyone at any step.
On the stand-in, this server can read every Ring transfer's wallets, coin and amount;
hidden from it are the note on a transfer and what a pay link asks for until it is paid.
Every privacy panel now says what this site's own server sees. No zero-knowledge proof is
generated or verified by this code; on the real Ring the proof is made by Helius's prover.

### 5. Decisions made for you

All 118 are in `DECISIONS.md` with the reason and how to reverse each. The ones from this
round you would most want to know: the site's fee is built and **off**, with proposed
rates of 0.5% on trades, nothing on launches and 0.25% on OTC (row 100) for you to accept
or change; limit orders, stop-loss and "trade for me" are not built because each needs the
server to hold a key that trades for the user, which is custody (row 99); a split
withdrawal is a plan kept in the browser and sent by the page, so nothing is in anyone's
custody and the page has to be open when a part is due (row 107); with the real Ring the
browser reaches Helius only through this server, which adds the key (row 104).

### 6. Blocked, and what to provide

`NEEDS.md`: every item with steps, costs and where it goes. `GO-LIVE.md`: the commands to
run afterwards. `BLOCKED.md`: what could not be done or proven here and what was done
instead.

### 7. How technical is this really

No program of our own is deployed. Feature by feature (also on the site at `/technical`):

| Feature | Someone else's program | Our own off-chain code |
| --- | --- | --- |
| Launch | pump.fun create and buy; Privacy Rings register | One transaction for all of it via a lookup table; listing only after an on-chain creator check; pictures cleaned and stored |
| Buy, sell | pump.fun | Slippage limit, integer prices, plain errors |
| Creator fees to the Ring | pump.fun claim | Claim and deposit in one transaction |
| Ring balances | Meant to be Privacy Rings; not in this build | The whole stand-in: ledger, escrow, crediting from chain receipts once, payouts recorded before sending and never paid twice, reconciliation |
| Sealed launch window | pump.fun create and buy | All of the pooling, locking, sizing and sharing-out. Off by default |
| OTC, pay links, sealed notes | None | All of it. Notes use libsodium's sealed box as provided |
| Privacy score, history, receipts | Chain reads | The figures and what they may claim |
| No-wallet mode | None | Key generation, encrypted backup, signing without a wallet library |
| State | Postgres, optionally | Single-writer lock, versioned writes, durability before any answer |

The engineering is in the money-safety logic, the signing and key code, and the test and
check tooling. The privacy itself is not ours and is not running yet.

### 8. What still looks unfinished

Most visible first: the ring images are stand-ins; the real Ring's money steps have never
run; on the real Ring the OTC desk, fee claims straight into a Ring balance and the sealed
window say "not connected yet" instead of working; the launch, OTC, pay and status pages
are plainer than the trading screens; a coin's worth in dollars is on the portfolio page
and not in the wallet's table; no limit orders; the sealed window cannot be tried end to
end in a browser without waiting an hour for it to close; Terms and Privacy read as drafts
with a placeholder operator.

### 9. The next three things

1. **Devnet SOL** (the one thing blocking the most): 1 to 2 devnet SOL to
   `5bay9nphMrjypM3UQumPEhPdSQFxxLQ8FhfPxwXXehT5`. Then `npm run ring:prove` runs register,
   deposit, transfer and withdraw on the real program and answers the three open questions.
2. A private repository, so the CI workflow (checks, flow tests, load and performance) runs
   for the first time.
3. Rotate the Helius key that was pasted into the chat, and put the new one in `.env`.

## Done

Research and plan; homepage, scroll sequence and background; local chain with the real
programs; launch, wallet, explore, coin pages; privacy score, pay links, no-wallet mode;
OTC; creator fees to the Ring; docs, technical page, terms, privacy, status, changelog;
audit passes; proof beside every claim; request ceiling; sealed notes; feature flags;
private preview; health check; Postgres store; coin pictures; sealed launch window (off);
devnet mode; CI workflow, container file, go-live guide; an independent review of the
money and key code and its fixes.

Since 21 November: the backend rebuilt (indexer, real tables, websocket, non-blocking
sender, sessions, per-caller limits, structured logs, health); the key vault in a worker
with auto-lock and strict security headers; trading screen, board, portfolio, shortcuts,
phone layout; pool trading and any coin by address; the site fee (off); new type, custom
controls, dollar figures, one transaction tray; split withdrawals, fresh destinations and
the server's view in every privacy panel; the real Ring wired in behind one interface;
load and performance tests; the study of rings.run and the trading terminals
(`REFERENCE.md`).

## Doing

Waiting for devnet SOL to prove the real Ring. Everything else asked for on 22 November
is built and green; what could not be closed is listed in `REFERENCE.md` ("Not closed, and
why") and `BACKEND.md` ("Open").

## Next

See "The next three things".

## 22 November: the every-coin board

Built on the recorded mainnet stretch (`npm run replay -- <recording>`, checked by `npm run check:board`, 30 of 30):
three live columns plus trending by 5m, 1h, 6h and 24h; search across every coin followed; rows with image, age,
market cap, liquidity, volume, buys and sells, holders and the five holder shares; coin page with top traders,
safety checks, the creator's other coins and how far back its trades go. Coverage and plan A against plan B are in
TERMINAL-FEATURES.md section 10 and on the docs page under "What the terminal covers".

Still open: the live Helius stream has never been run (no paid key yet); "pool liquidity locked" is not built and is
shown as not checked; other launchpads and Raydium, Meteora and Orca are not covered; USDC-priced coins are listed
as not supported.
