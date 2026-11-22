# Where the site says something is simulated, not connected, or not final

22 November 2026. Every place a visitor is told that a feature is a stand-in, for you to
check the wording. Text is quoted as it appears (the site shows it in capitals).

A test (`test/unit/site.test.ts`) fails if the homepage's own copy calls anything the
stand-in does "encrypted", or if the site says "anonymous", "untraceable",
"zero-knowledge", "shielded" and similar.

## On every page

| Where | Wording | Source |
| --- | --- | --- |
| The line under the header, local chain | "Pre-release. Runs on a local test chain. Ring balances are simulated here. Coins have no value. Status" | `components/Chrome.tsx` |
| The same line, devnet | "Pre-release. Runs on Solana devnet. Ring balances are not connected yet. Coins have no value. Status" | `components/Chrome.tsx` |
| The same line, devnet with the real Ring connected | "Pre-release. Runs on Solana devnet, with the real Privacy Rings program, which is alpha software. Coins have no value. Status" | `components/Chrome.tsx` |
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
| Ring wallet, under the title | "Deposits and withdrawals are public. A transfer between Ring balances shows both wallets, not the coin or the amount. Ring balances are simulated in this build." The last sentence is left out where the real Ring is connected | `components/pages/WalletPage.tsx` |
| OTC, under the title | "Sell a block to one named buyer: coin and payment change hands together, or nothing moves. Simulated in this build." With the real Ring: "... Not connected to the real Privacy Rings program yet." | `components/pages/OtcPage.tsx` |
| Pay links, under the title | Ends "In this build Ring balances are simulated." Left out where the real Ring is connected | `components/pages/PayPage.tsx` |
| OTC with the real Ring connected | "This build runs on the real Privacy Rings program here, and the OTC desk is not connected to it yet. A block must change hands for its payment in one step or not at all, and whether the real program can do that is not yet proven (RING-RESULTS.md). Deposits, transfers and withdrawals are on the wallet page." | `components/ui/NeedsRing.tsx`, `components/pages/OtcPage.tsx` |
| Ring wallet with the real Ring, before a wallet has registered | "Before this wallet can receive into a Ring balance it publishes its Ring keys in the Ring's registry. It is one public transaction from this wallet, once, and costs the registry record's rent and a network fee." | `components/pages/WalletPage.tsx` |
| Withdraw, split into parts | "The parts are public withdrawals like any other, and they add up. Splitting makes matching by amount and time harder; it does not hide the wallet, the destination or the coin. The plan is kept in this browser only." | `components/wallet/WithdrawPlans.tsx` |
| Withdraw, a fresh address | "An address that has never appeared on the chain gives an observer nothing but itself. ... That file and the password you choose here are the only way to use what you withdraw there" | `components/pages/WalletPage.tsx` |
| The strip at the foot of the trading screens, when the server is behind the chain | "Live data paused. The server last read the chain N seconds ago. Prices here are that old; a trade is still checked against the chain when it is built." | `components/terminal/LiveStrip.tsx` |
| The trade panel | "Public: your wallet, the coin, the amount and the price. A Ring cannot hide a trade on the curve." | `components/terminal/Ticket.tsx` |
| A coin's screen, holders list | The stand-in's escrow wallet is labelled "Ring stand-in" among the holders | `components/terminal/Feed.tsx` |
| Before every signature, the privacy panel, new line | "This site's server sees:" followed by what it learns for that action. For the stand-in's transfer: "Everything: both wallets, the coin and the amount." Each action done through the real Ring ends "Not yet run by us end to end (RING-RESULTS.md)." | `components/PrivacyPanel.tsx`, from `lib/visibility.ts` |
| Before every signature, the privacy panel | A column headed "Encrypted by a Ring", then a line beginning "In this build:" that says what does the work today, for example "A request signed by your wallet to the stand-in, which can read the coin and the amount." | `components/PrivacyPanel.tsx`, `lib/visibility.ts` |
| Ring wallet history | "Not published:" before a transfer's coin and amount (not "Encrypted") | `components/ui/RingEventRow.tsx` |
| Ring wallet, OTC and Pay on devnet | "Ring balances are not connected on this network in this build. Launching, buying and selling coins work here. Holding and moving coins in a Ring does not yet." | `components/ui/NeedsRing.tsx` |
| Launch page, sealed window (only when switched on) | "Experimental, and switched on by this site's operator. A window holds what buyers commit until the coin is launched. In this build it is held by the stand-in's escrow wallet on a local test chain." | `components/pages/SealedWindows.tsx` |

## Status page

| Where | Wording | Source |
| --- | --- | --- |
| Ring balances row | "Simulated by a local stand-in. The Privacy Rings program does not hold them in this build." | `components/pages/StatusPage.tsx` |
| Ring balances row, with the real Ring connected | "Held by the real Privacy Rings program on devnet, reached through its SDK in your browser. It is alpha software, and this build has not yet run a deposit, transfer or withdrawal through it." | same |
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
