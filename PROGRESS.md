# Progress

Last updated 21 November 2026.

## Summary for when you are back

### 1. OTC

This folder is the Rings launchpad. Its OTC page is the launchpad's own feature, written
here from scratch. Your separate OTC project is the artifact "Agent OTC Desk: Working
Spec" (a spec, no code). I did not open, edit, republish or delete it; nothing in the
launchpad is connected to it; it is parked, as is the ShadowTerminal artifact. Nothing
needed reversing. The launchpad uses ports of its own. Evidence: `OTC-CHECK.md`.

### 2. Where the code lives

`/home/user/ringpad`, its own git repository, 29 commits, **not pushed anywhere**. I could
not create a private GitHub repository (refused, 403). A full copy with history is in
`ringpad.bundle`, sent to you. An early copy (research and homepage only) is still on the
public `Yo` branch `claude/exciting-gates-vdquz4`; nothing new has gone there. Steps for
both: `BLOCKED.md`.

### 3. What works end to end, and the test count

On a local validator, in a browser, each flow run twice and once after a reload with
balances read back from the chain: no-wallet mode and backup, launch (create + register +
first buy, one signature), buy and sell, deposit, Ring transfer, withdraw, OTC, pay links,
privacy score, creator fees into the Ring, receipts, public history, the price record,
status. A reload or shared link opens on the same tab; two tabs on one wallet stay in step.

122 tests (65 unit, 57 flow). Browser checks: 17 flow steps, crawler over 14 pages at two
widths with 0 findings, 14 break-it checks, 11 motion checks, secrets scan clean. All pass
from a fresh clone on a just-started validator. Full detail: `TEST-REPORT.md`.

### 4. Still a mock or stand-in; not verified

Mock: Ring balances, Ring transfers, OTC settlement, pay-link payment (a ledger and escrow
wallet on the server, local validator only). OTC offers are readable by the server.
Stand-in: all ring images and video. Drafts: Terms, Privacy Policy.

Not verified: anything on devnet or mainnet; a real Ring deposit, transfer or withdrawal;
any browser but Chromium; a real phone; a real wallet extension signing; a screen reader;
load; the 17 `npm audit` advisories inside the Solana and pump.fun SDKs; any outside review.

Privacy today, exactly (`PRIVACY-AUDIT.md`): no wallet address is hidden from anyone at
any step. We, the operator, can read every Ring transfer's wallets, coin and amount,
because Ring balances are a stand-in on our server. Hidden from us as of stage 1: the note
on a transfer, and what a pay link asks for until it is paid. No zero-knowledge proof is
generated or verified by this code.

### 5. Decisions made for you

All 61 are in `DECISIONS.md` with the reason and how to reverse each. The ones you would
most want to know: Ring balances are a mock locked to the local validator; the server
settles deposits itself and never refunds a withdrawal on a guess; copy says "not
published" instead of "encrypted" for anything the mock does; the unlocked browser key is
kept in the tab's session storage; search engines are asked not to index the site; the
launchpad uses ports 4710 to 4712 and 8799; requests are capped per address and the
server answers POST only; each privacy claim names what carries it out in this build.

### 6. Blocked, and what to provide

`BLOCKED.md` has the exact steps. In short: a private repository name; `HELIUS_API_KEY` in
`.env.local`; the real media in `brand/`; a decision on the sealed launch window; a lawyer;
other browsers and devices.

### 7. How technical is this really

No program of our own is deployed. Honest split, feature by feature (also on the site at
`/technical`):

| Feature | Someone else's program | Our own off-chain code |
| --- | --- | --- |
| Launch | pump.fun create and buy; Privacy Rings register | One transaction for all of it via a lookup table; listing only after an on-chain creator check |
| Buy, sell | pump.fun | Slippage limit, integer prices, plain errors |
| Creator fees to the Ring | pump.fun claim | Claim and deposit in one transaction |
| Ring balances | Meant to be Privacy Rings; not in this build | The whole stand-in: ledger, escrow, crediting from chain receipts once, withdrawals never paid twice, reconciliation |
| OTC | None | All of it |
| Pay links | None | All of it |
| Privacy score | Chain reads | The two figures and what they may claim |
| No-wallet mode | None | All of it: key generation, encrypted backup, signing without a wallet library |
| History, receipts | Chain reads | Spent and received, from the chain's before-and-after balances |

The real engineering is in the money-safety logic, the signing and backup code, and the
test and check tooling. The privacy itself is not ours and is not running yet.

### 8. What still looks unfinished

Most visible first: the ring images are stand-ins; the price chart is a record of this
site's readings, not a full trade history; empty space under "How it works" on phones
before the callout list; market cap in SOL only; Explore pages on screen but the server
still sends the whole list; no password strength hint; Terms and Privacy read as drafts.
The full list with what was fixed: `TEST-REPORT.md`, section 7.

### 9. The next three things

1. Privacy stage 2, which is the devnet pass: the real Default Ring with proofs made in the browser, so that we stop seeing coin and amount. Then repeat the whole test report there.
2. Move the code to a private repository, as soon as you name one.
3. A small indexer that rebuilds each coin's trades from the chain, for a true price history and a paged Explore.

## Done

Research and plan; homepage, scroll sequence and background; local chain with the real
programs; launch, wallet, explore, coin pages; privacy score, pay links, no-wallet mode;
OTC; creator fees to the Ring; docs, technical page, terms, privacy, status, changelog;
two audit passes; own ports; OTC check; proof beside every claim; price record; request ceiling.

## Doing

Nothing in flight.

## Next

See "The next three things".
