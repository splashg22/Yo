# Decisions

Calls made without asking, newest last. Each can be reversed; the note says how.

| # | Decision | Why | To reverse |
| --- | --- | --- | --- |
| 1 | Working name RINGPAD, accent amber #F5A524 | Your instruction | `name` in `site.config.ts`; `--accent` in `app/globals.css` |
| 2 | Typeface: Doto, self-hosted | Open licence (SIL OFL 1.1, checked), a true dot-matrix face with weights | Replace `public/fonts/doto.woff2` and the `@font-face` rule |
| 3 | Background concept "Passing" | It leaves the hero object alone and turns down cleanly on app pages | `components/Background.tsx`; the other two concepts are in `prototypes/background/` |
| 4 | Media black is keyed to transparency at build time | So the background passes behind the object, not across it | `keyed()` in `scripts/build-media.mjs` |
| 5 | Addresses keep their real case everywhere | Your instruction; they are case-sensitive | n/a |
| 6 | Project moved out of the public `Yo` repository into its own git repository, history kept | Your instruction: it must end up private, and nothing new should be pushed to `Yo` | n/a |
| 7 | Local chain = a `solana-test-validator` holding **copies of the real programs** from devnet (pump.fun, its fee program, Privacy Rings, the registry) | Tests then run against the real pump.fun and the real Ring registration, not imitations | `local/clone.json` lists what is copied |
| 8 | Coins are created with pump.fun's `create_v2` (Token-2022) | It is pump.fun's current default. Proven locally: the Ring accepts these mints, and also the older SPL Token kind | `launchInstructions` in `lib/server/chain.ts` |
| 9 | A launch with a first buy uses an address lookup table | Without it the transaction is 1,366 bytes, over the 1,232 limit. With it, 627 | The table is made by a local set-up key. On devnet or mainnet someone must pay about 0.003 SOL once to create it: see "Only you" below |
| 10 | **Ring balances on the local chain are a mock** (`lib/server/ring.ts`) | The real Ring needs Helius's indexer and prover, which do not exist locally. A real deposit was tried and the program rejected the copied state tree | Replaced by the real SDK in the devnet pass; every caller goes through `lib/server/handlers.ts` |
| 11 | The mock holds deposited coins in an escrow wallet whose key is on the server | Deposits and withdrawals then really move coins on the local chain. **This is custody, so it is locked to a local validator**: `assertLocalOnly` refuses any other RPC host or network, and a test proves it | Do not lift the guard. The real Ring needs no escrow key at all |
| 12 | Requests that read or move a Ring balance are signed by the wallet, with a nonce and a 90-second window | Mirrors the real Ring, where only the wallet's keys can spend or read | `lib/auth.ts` |
| 13 | The Ring ledger is credited only from a confirmed transaction read back from the chain, to whoever paid for it | A client cannot claim a deposit it did not make | `escrowReceipts` in `lib/server/chain.ts` |
| 14 | Transactions are built on the server and signed in the browser; the server submits them | The server never sees a user key, and the browser never needs an RPC address or an API key | `lib/client/api.ts` |
| 15 | No-wallet mode: the key is made in the browser, stored only as a password-encrypted backup (scrypt N=32768, AES-256-GCM). The unlocked key lives in the tab's session storage until the tab closes or "Lock" | So a reload does not ask for the password every time | Remove `SESSION_KEY` in `components/Wallet.tsx` to ask on every load |
| 16 | Privacy score = share of supply in Ring balances + number of wallets that have deposited the coin, each labelled as exactly that | Your instruction. Both are public facts. Holders inside the Ring cannot be counted | `coinStats` in `lib/server/ring.ts` |
| 17 | The 24-hour change is measured from the oldest price inside the last 24 hours, and labelled "since launch" for a younger coin | There is no price history before launch | `coinView` in `lib/server/handlers.ts` |
| 18 | Market cap is shown in SOL | There is no USD price source on a local chain, and inventing one would be a fake figure | Add a price source in the devnet pass |
| 19 | OTC: the seller names the buyer, size and price; the buyer accepts; both legs settle in one step or not at all. Payment is in SOL held in the Ring. No fee | The simplest thing that matches "sealed size and price to a named buyer". No fee because no token or revenue model has been agreed | `otc/*` in `lib/server/handlers.ts` |
| 20 | OTC offers are held by the server in the clear in this local build, shown only to the two wallets | End-to-end encryption of offers belongs with the real Ring keys in the devnet pass | n/a |
| 21 | Pay links carry recipient, coin, amount and memo in the URL, and say on the page that anyone holding the link can read them | It is true, and there is no way round it for a link | `lib/paylink.ts` |
| 22 | Creator fees: the claim and the deposit are one transaction | So "claimed into a Ring balance by default" is literally one signature | `buildClaimFees` |
| 23 | Sealed launch window: not built. Shown on the homepage as "under review" with the reason | Your instruction: no custody of user funds without asking | n/a |
| 24 | Proof of holdings: dropped | Your instruction; Rings has no threshold proof | n/a |
| 25 | A "Pay" link was added to the navigation, and a coin detail page at `/coin/<address>` | Pay links need a home; buying, selling and creator fees need a page per coin | `site.config.ts`, `app/coin/[mint]` |
| 26 | The pump.fun program's code is not committed. `npm run local:fetch` downloads it from devnet into `local/accounts/`, which is git-ignored | It is someone else's program | n/a |
| 27 | Terms and Privacy Policy are written as plain-language drafts and marked "not yet reviewed by a lawyer" | They need a lawyer before launch; a draft is better than a blank | `app/terms`, `app/privacy` |

## Only you

1. **A private repository.** Steps are in `README.md`. I cannot create one from here.
2. **`HELIUS_API_KEY`** in `.env.local`, for the devnet pass.
3. **The real brand media** in `brand/`, from `brand/HIGGSFIELD-PROMPTS.md`.
4. **A lawyer's read** of Terms and Privacy Policy, and of OTC and pay links as features.
5. **The sealed launch window**: build it with custody, or leave it out.
6. **Anything on mainnet**, including who pays for the lookup table and with which key.
