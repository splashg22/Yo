# Progress

Last updated 21 November 2026.

## Summary

### 1. OTC

This folder is the Rings launchpad. Its OTC page is the launchpad's own feature, written
here from scratch. Your separate OTC project is the artifact "Agent OTC Desk: Working
Spec" (a spec, no code). I did not open, edit, republish or delete it, nothing in the
launchpad is connected to it, and it is parked, as is the ShadowTerminal artifact.
Evidence: `OTC-CHECK.md`.

### 2. Where the code lives

`/home/user/ringpad`, its own git repository, **not pushed anywhere**: creating a private
repository is refused for this session. A full copy with history is in `ringpad.bundle`,
sent after each round. An early copy (research and homepage only) is still on the public
`Yo` branch `claude/exciting-gates-vdquz4`; nothing new has gone there.

### 3. What works end to end, and the test count

On a local validator, in a browser, each flow run twice and once after a reload with
balances read back from the chain: no-wallet mode and backup, launch (create + register +
first buy, one signature, with an optional picture), buy and sell, deposit, Ring transfer
with a sealed note, withdraw, OTC, pay links, privacy score, creator fees into the Ring,
receipts, public history, the price record, status.

Built this round and switched by one setting each: state in Postgres, devnet mode, coin
pictures on IPFS, a private-preview password, and the sealed launch window (off).

165 tests (85 unit, 80 flow), 9 more that run only with Postgres. Browser checks: 17 flow
steps, crawler over 14 pages at two widths with 0 findings, 14 break-it checks, 11 motion
checks, 3 sealed-window checks, secrets scan clean. The flow suite and the browser run
also pass with the state in a real local Postgres. Detail: `TEST-REPORT.md`.

### 4. Still a mock or stand-in; not verified

Mock: Ring balances, Ring transfers, OTC settlement, pay-link payment, and the sealed
window's custody: a ledger and an escrow wallet on the server, local validator only.
Stand-in: all ring images and video; coin pictures kept on the server's disk.
Placeholder: who runs the site. Drafts: Terms, Privacy Policy.

Not verified, plainly: anything on real devnet or with Helius; the real Ring; the Pinata
upload; a hosted Postgres; the container image (never built); the CI workflow (never
run); any browser but Chromium; a real phone; a real wallet extension; a screen reader;
load; the `npm audit` advisories inside the Solana and pump.fun SDKs; any review by
someone outside the project.

Privacy today (`PRIVACY-AUDIT.md`): no wallet address is hidden from anyone at any step.
We can read every Ring transfer's wallets, coin and amount. Hidden from us: the note on a
transfer, and what a pay link asks for until it is paid. No zero-knowledge proof is
generated or verified by this code.

### 5. Decisions made for you

All 80 are in `DECISIONS.md` with the reason and how to reverse each. Yours, from 21
November, are row 63. The ones made since that you would most want to know: Postgres
keeps the state as one document with one writer; devnet mode has no Ring balances; a
withdrawal now charges the wallet its network fee and any account rent; new backups use a
stronger password setting; the note-key message names the site.

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

Most visible first: the ring images are stand-ins; Ring features do not exist on devnet;
the price chart is a record of this site's readings, not a full trade history; the sealed
window cannot be tried end to end in a browser without waiting an hour for it to close;
empty space under "How it works" on phones; market cap in SOL only; Explore pages on
screen but the server sends the whole list; Terms and Privacy read as drafts with a
placeholder operator.

### 9. The next three things

1. With the Helius key: the real Default Ring in place of the stand-in, proofs made in the
   browser, then the whole test report repeated on devnet.
2. With the repository: push, and let the CI workflow run for the first time.
3. A relational schema and an indexer, replacing the single state document and the
   recorded price readings.

## Done

Research and plan; homepage, scroll sequence and background; local chain with the real
programs; launch, wallet, explore, coin pages; privacy score, pay links, no-wallet mode;
OTC; creator fees to the Ring; docs, technical page, terms, privacy, status, changelog;
audit passes; own ports; OTC check; proof beside every claim; price record; request
ceiling; privacy stage 1 (sealed notes, pay-link requests kept from the server); link
warnings; feature flags; operator placeholders; private preview; health check; Postgres
store; coin pictures; sealed launch window; devnet mode and set-up script; CI workflow,
container file, go-live guide; an independent review of the money and key code and its
fixes.

## Doing

Nothing in flight. Stopped on 21 November at your request, waiting for the items in
`NEEDS.md`. `RING-PLAN.md` is the plan for the real Ring; `SITE-WORDING.md` lists every
place the site says a feature is simulated or not connected.

## Next

See "The next three things".
