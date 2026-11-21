# Where the site says something is simulated, not connected, or not final

21 November 2026. Every place a visitor is told that a feature is a stand-in, for you to
check the wording. Text is quoted as it appears (the site shows it in capitals).

A test (`test/unit/site.test.ts`) fails if the homepage's own copy calls anything the
stand-in does "encrypted", or if the site says "anonymous", "untraceable",
"zero-knowledge", "shielded" and similar.

## On every page

| Where | Wording | Source |
| --- | --- | --- |
| The line under the header, local chain | "Pre-release. Runs on a local test chain. Ring balances are simulated here. Coins have no value. Status" | `components/Chrome.tsx` |
| The same line, devnet | "Pre-release. Runs on Solana devnet. Ring balances are not connected yet. Coins have no value. Status" | `components/Chrome.tsx` |
| The same line, server down | "Pre-release. This site's server is not answering." | `components/Chrome.tsx` |
| Footer | "This is a pre-release build and is unaudited. Privacy Rings and their SDK are alpha software. Nothing here is financial advice. Coins launched on a bonding curve are speculative and can go to zero." | `components/Chrome.tsx` |
| Footer | "RINGPAD is an independent project. It is not affiliated with, endorsed by or operated by Helius, pump.fun, or any other site built on Privacy Rings." | `components/Chrome.tsx` |

## Homepage

| Where | Wording | Source |
| --- | --- | --- |
| "How it works", callout 04 | "A Ring keeps your balance encrypted on-chain. Simulated in this build." | `site.config.ts` |
| "What is hidden, and what is not" | "This table describes the Privacy Rings design. In this pre-release build the Ring's balances are simulated; see the Docs for exactly what is real today." | `app/page.tsx` |
| "What RINGPAD adds", five features | "Works on the local test chain" beside each | `app/page.tsx` |
| The same list, sealed window | "Built, switched off" and "It holds buyers' funds, so it is built but switched off." | `app/page.tsx` |

## Ring wallet, OTC, Pay, coin pages

| Where | Wording | Source |
| --- | --- | --- |
| Ring wallet, introduction | "In this build Ring balances are simulated: the site's own server keeps them and can read every move." | `components/pages/WalletPage.tsx` |
| OTC, introduction | "In this build Ring balances are simulated, and the site's own server can read every offer." | `components/pages/OtcPage.tsx` |
| Pay links, introduction | "In this build Ring balances are simulated." | `components/pages/PayPage.tsx` |
| Coin page, under the Ring figures | "How that total is split between holders is not published, so the number of holders inside the Ring cannot be known. In this build Ring balances are simulated." | `components/pages/CoinPage.tsx` |
| Before every signature, the privacy panel | A column headed "Encrypted by a Ring", then a line beginning "In this build:" that says what does the work today, for example "A request signed by your wallet to the stand-in, which can read the coin and the amount." | `components/PrivacyPanel.tsx`, `lib/visibility.ts` |
| Ring wallet history | "Not published:" before a transfer's coin and amount (not "Encrypted") | `components/ui/RingEventRow.tsx` |
| Ring wallet, OTC and Pay on devnet | "Ring balances are not connected on this network in this build. Launching, buying and selling coins work here. Holding and moving coins in a Ring does not yet." | `components/ui/NeedsRing.tsx` |
| Launch page, sealed window (only when switched on) | "Experimental, and switched on by this site's operator. A window holds what buyers commit until the coin is launched. In this build it is held by the stand-in's escrow wallet on a local test chain." | `components/pages/SealedWindows.tsx` |

## Status page

| Where | Wording | Source |
| --- | --- | --- |
| Ring balances row | "Simulated by a local stand-in. The Privacy Rings program does not hold them in this build." | `components/pages/StatusPage.tsx` |
| Escrow row | "Stand-in escrow wallet" | same |
| Table heading | "What the stand-in holds against what it owes" | same |

## Docs

| Where | Wording | Source |
| --- | --- | --- |
| Opening | "RINGPAD is a pre-release. It runs on a local test chain. Nothing here is live and coins have no value." | `app/docs/page.tsx` |
| "What is real in this build", Ring balances | "Simulated. A local stand-in keeps the balances and follows the same rules for what is public. It is not encryption: the stand-in's operator can read everything." | same |
| The same table, pictures of the ring | "Placeholders drawn in code." | same |
| The visibility table | A column "In this build" for every action | same, from `lib/visibility.ts` |
| "What is alpha, and what is not built" | "A sealed launch window is built and switched off. It pools buyers' commitments and buys in the coin's first transaction. It holds buyers' funds, which this build does only on a local test chain." | same |

## Technical page

| Where | Wording | Source |
| --- | --- | --- |
| "Whose logic is whose", Ring balances | "Meant to be Privacy Rings. Not in this build." and "A stand-in ledger and escrow wallet with the Ring's rules for what is public." | `app/technical/page.tsx` |
| "How a launch is laid out" | "Steps 6 and 7 are this build's stand-in for a Ring deposit." and "A transfer between Ring balances, an OTC settlement and a pay-link payment are not transactions in this build: they are signed requests to the stand-in." | same |
| "Who you are trusting" | "Kept by a stand-in on this site's server. Its operator can read every transfer and controls the escrow wallet. This is acceptable on a test chain with coins of no value, and nowhere else: the stand-in refuses to start on any other network." | same |
| "Known limits" | "Ring balances exist on a local test chain only. Devnet mode launches and trades coins but has not been run against real devnet." and "Ring balances are simulated. Nothing here is encrypted by the Ring today." | same |

## Terms and Privacy Policy

| Where | Wording | Source |
| --- | --- | --- |
| Top of both | "Draft. Not yet reviewed by a lawyer." | `app/terms/page.tsx`, `app/privacy/page.tsx` |
| Top of both, operator | "Not yet filled in. [OPERATOR NAME: TO BE FILLED IN]", and the same for country and contact | `components/Operator.tsx`, `site.config.ts` |
| Terms | "The project is a pre-release. It runs on a test chain, where coins have no value." | `app/terms/page.tsx` |
| Terms | "In this pre-release, Ring balances are simulated: coins you deposit on the test chain are held by a stand-in run by this site. That arrangement exists only on a test chain and will not be used with coins of value." | same |
| Privacy Policy | "Ring balances are simulated by a stand-in that runs on this site's server, so the server sees each transfer's wallets, coin and amount, and each OTC offer, in readable form. Under the real Ring it would see the wallets and encrypted data." | `app/privacy/page.tsx` |

## Places that say nothing about it, and why

- **Explore, Launch, a coin's trade form, receipts.** These use the real pump.fun and
  Privacy Rings programs. The line under the header still applies.
- **The ring pictures.** They are placeholders. You asked that the site never label them;
  the Docs table is the one place that says so.
- **The changelog.** It lists what was built and says "simulated Ring ledger" where that
  was the thing built.
