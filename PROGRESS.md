# Progress

Last updated 21 November 2026.

## Summary for when you are back

### 1. OTC

This folder is the Rings launchpad. Its OTC page is the launchpad's own feature, written
here from scratch. **I found no separate OTC project** on this machine or in your GitHub
repositories (every "otc" hit was inside another word), so nothing was touched and nothing
needed reversing. Unsure: whether such a project exists somewhere I cannot see. To be safe
the launchpad now uses ports of its own. Details and evidence: `OTC-CHECK.md`.

### 2. Where the code lives

`/home/user/ringpad`, its own git repository, 20 commits, **not pushed anywhere**. I could
not create a private GitHub repository (refused, 403). A full copy with history is in
`ringpad.bundle`, sent to you. An early copy (research and homepage only) is still on the
public `Yo` branch `claude/exciting-gates-vdquz4`; nothing new has gone there. Steps for
both: `BLOCKED.md`.

### 3. What works end to end, and the test count

On a local validator, in a browser, each flow run twice and once after a reload with
balances read back from the chain: no-wallet mode and backup, launch (create + register +
first buy, one signature), buy and sell, deposit, Ring transfer, withdraw, OTC, pay links,
privacy score, creator fees into the Ring, receipts, history, status.

111 tests (57 unit, 54 flow). Browser checks: 16 flow steps, crawler over 14 pages with 0
findings, 12 break-it checks, 11 motion checks, secrets scan clean. All pass from a fresh
clone on a just-started validator. Full detail: `TEST-REPORT.md`.

### 4. Still a mock or stand-in; not verified

Mock: Ring balances, Ring transfers, OTC settlement, pay-link payment (a ledger and escrow
wallet on the server, local validator only). OTC offers are readable by the server.
Stand-in: all ring images and video. Drafts: Terms, Privacy Policy.

Not verified: anything on devnet or mainnet; a real Ring deposit, transfer or withdrawal;
any browser but Chromium; a real phone; a real wallet extension signing; a screen reader;
load; the 17 `npm audit` advisories inside the Solana and pump.fun SDKs; any outside review.

### 5. Decisions made for you

All 46 are in `DECISIONS.md` with the reason and how to reverse each. The ones you would
most want to know: Ring balances are a mock locked to the local validator; the server
settles deposits itself and never refunds a withdrawal on a guess; copy says "not
published" instead of "encrypted" for anything the mock does; the unlocked browser key is
kept in the tab's session storage; search engines are asked not to index the site; the
launchpad uses ports 4710 to 4712 and 8799.

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

Most visible first: the ring images are stand-ins; no price chart on a coin page; empty
space under "How it works" on phones before the callout list; market cap in SOL only; the
main heading is replaced by second-level headings while the sequence scrolls; no "show
password" option; Explore loads every coin at once; Terms and Privacy read as drafts.
The full list with what was fixed: `TEST-REPORT.md`, section 7.

### 9. The next three things

1. The devnet pass: replace the mock with the real Ring, then repeat the whole test report there.
2. Move the code to a private repository, as soon as you name one.
3. A price chart on the coin page from the price points already recorded, and paging on Explore.

## Done

Research and plan; homepage, scroll sequence and background; local chain with the real
programs; launch, wallet, explore, coin pages; privacy score, pay links, no-wallet mode;
OTC; creator fees to the Ring; docs, technical page, terms, privacy, status, changelog;
two audit passes; own ports; OTC check.

## Doing

Nothing in flight.

## Next

See "The next three things".
