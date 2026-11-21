# Decisions

Calls made without asking, newest last. Each can be reversed; the note says how.

| # | Decision | Why | To reverse |
| --- | --- | --- | --- |
| 1 | Working name RINGPAD, accent amber #F5A524 | Your instruction | `name` in `site.config.ts`; `--accent` in `app/globals.css` |
| 2 | Typeface: Doto, self-hosted | Open licence (SIL OFL 1.1, checked), a true dot-matrix face with weights | Replace `public/fonts/doto.woff2` and the `@font-face` rule |
| 3 | Background concept "Passing" | It leaves the hero object alone and turns down cleanly on app pages | `components/Background.tsx`; the other two concepts are in git history (`prototypes/background/`, removed in the audit) |
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
| 17 | The 24-hour change is measured from the oldest price inside the last 24 hours, and labelled "since launch" for a younger coin | There is no price history before launch | `coinView` in `lib/server/operations/market.ts` |
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
| 28 | The server submits signed transactions and settles them itself: a deposit is credited from what the chain shows escrow received, by signature, once | A browser that closes after signing must not leave a deposit uncredited; two requests must not credit it twice | `settle()` in `lib/server/settle.ts` |
| 29 | A withdrawal ends as landed, not sent, or unknown. Unknown is kept as a pending payout and resolved from the chain; the balance stays reduced meanwhile | Refunding on any error could pay twice | `payFromEscrow`, `payoutStatus` in `lib/server/escrow.ts` |
| 30 | A coin is listed only from the launch this server built, after checking the creator on the chain. There is no "record a launch" request | Anyone could otherwise list any coin under any name | `pendingLaunches` in `lib/server/settle.ts` |
| 31 | Prices are whole micro-lamports per coin; change is basis points; share is parts per million | No floating point anywhere near money; whole lamports per coin rounded to zero | `lib/format.ts`, `lib/contract.ts` |
| 32 | TypeScript is held at 5.9.3 and ESLint at 9, every dependency pinned to an exact version | The type-aware lint rules do not support newer TypeScript yet; pinned versions make a clone reproducible | `package.json` |
| 33 | Lint: `recommendedTypeChecked`, zero warnings allowed, no rule switched off in code. Prettier at 160 columns | Your standard: no "any", no silenced rules | `eslint.config.mjs`, `.prettierrc.json` |
| 34 | A notice on every page: pre-release, local test chain, Ring balances simulated, coins have no value. Copy about the mock says "not published", not "encrypted" | The mock's server can read transfers, so "encrypted" would be untrue today | `BuildNotice` in `components/Chrome.tsx`; a test in `test/unit/site.test.ts` |
| 35 | The escrow keeps a 5 SOL float of its own for network fees and token-account rent on withdrawals, marked so it is never credited to anyone | Fees must not come out of users' deposits | `setUp()` in `lib/server/bootstrap.ts` |
| 36 | The status page shows the escrow wallet's address and, per coin, what it holds on-chain against what the ledger owes | So the stand-in can be checked by anyone, not taken on trust | `status` in `lib/server/operations/system.ts` |
| 37 | The server keeps one copy of web3.js (not bundled), and fee wallets are recognised by shape, not class | A second bundled copy made the built server find no fee wallets, so first buys failed on a fresh chain while tests passed | `next.config.mjs`, `recipientsIn` in `lib/server/pump.ts` |
| 38 | The local faucet runs airdrops one at a time and never hands out the same signature twice | Two identical airdrops in the same moment are one transaction to the chain; the second click was told it had been paid when it had not | `airdrop` in `lib/server/bootstrap.ts` |
| 39 | Server errors are logged with their cause; the caller gets one plain sentence. Inputs are not logged | An operator needs the cause; a signed request must not end up in a log | `run` in `lib/server/handlers.ts` |
| 40 | The unlocked browser wallet's key is in the tab's session storage until Lock or the tab closes | So a reload mid-action does not lose the wallet. The privacy policy says so. A stricter choice is to ask for the password after every reload | `SESSION_KEY` in `components/wallet/WalletProvider.tsx` |
| 41 | On the homepage the header lies over the hero; on phones the five callouts follow the sequence as a list; a page is at least one window tall | Nothing that arrives late may move what is on screen; five callouts do not fit under the object on a short phone | `app/globals.css` |
| 42 | Phone controls are at least 44px tall; link underlines are text decoration | Small targets were the crawler's main finding | `app/globals.css` |
| 43 | Coin and wallet pages list recent public transactions straight from the chain; receipts show what the paying wallet spent and received | History and receipts should not depend on this site's own records | `coin/activity`, `wallet/activity`, `payerChanges` |
| 44 | Search engines are asked not to index the site | A pre-release on a test chain should not be found by search | `robots` in `app/layout.tsx` |
| 45 | The prototypes folder and one-off probe scripts were removed; browser check scripts were added | Dead code out; every check repeatable by one command | git history; `scripts/` |
| 46 | The launchpad uses ports of its own: site 4710, checks 4711 and 4712, validator 8799 (and 8800, 9799, 8701, 8710 to 8740) | So it cannot collide with any other project on the same machine, whatever that project uses | `README.md`, "Ports and folders" |
| 47 | Every privacy claim carries what does it in this build and the source file (`proof` in the visibility table); the panel before each signature shows it | A claim should point at what proves it. Where the mock does the work, the panel says so before you sign | `lib/visibility.ts`, `components/PrivacyPanel.tsx` |
| 48 | The coin page's chart draws the prices this site has read, and says so. It is not a trade history | Rebuilding every trade from the chain is a separate indexer; a mislabelled chart would be a false figure | `coin/prices`, `components/ui/PriceChart.tsx` |
| 49 | The wallet tab and the buy or sell side live in the address after the #; switching replaces history instead of adding to it | A reload or shared link should open in the same place; Back should leave the page, not step through tabs | `components/ui/useHashChoice.ts` |
| 50 | Balances refresh when you return to a tab, for the browser-made wallet only | Reading a Ring balance is a signed request; an extension would ask for approval every time | `components/pages/WalletPage.tsx` |
| 51 | A second tab on the same wallet asks for the password | The unlocked key is per tab by design (decision 40) | n/a |
| 52 | Explore shows 24 coins and a "Show more" button | Enough for now without a paged server call | `components/pages/ExplorePage.tsx` |
| 53 | A ceiling on requests per address per minute: 30 faucet, 240 that build, send or are signed, 1,200 reads. Over it: status 429 and how long to wait | One caller should not starve the rest or drain the faucet. Reads are high because pages refresh themselves | `PER_MINUTE` in `lib/server/limit.ts` |
| 54 | The server answers POST only | A GET can be fired by a link or image on another site | `app/api/[...op]/route.ts` |
| 55 | A state file that cannot be read stops the server and is left untouched | Starting again from empty would erase every balance without a word | `read` in `lib/server/store.ts` |
| 56 | Notes on a transfer are sealed in the sender's browser with libsodium's sealed box, one copy to the recipient's key and one to the sender's own. The server refuses a readable note | The server has no need to read a note, so it should not be able to. The library's own construction is used; nothing cryptographic is written here | `lib/notes.ts`. To reverse: accept `memo` again in `ring/transfer` |
| 57 | A wallet's note key is derived from its seed and published when it registers. Wallet extensions have no note key, so they cannot send or open notes | Deriving from the seed means a restored backup reads old notes. An extension does not expose its seed | `noteKeysFor` in `lib/notes.ts` |
| 58 | A pay link carries its request after the #, and a link with the request in the query string is refused | Browsers do not send that part to servers, so the server and any log in front of it never see who asks whom for how much | `lib/paylink.ts` |
| 59 | `Referrer-Policy: no-referrer` | A coin page or receipt address says what someone was looking at | `next.config.mjs` |
| 60 | The site may not say "zero-knowledge", "zk" or "shielded", as well as the earlier list | The code generates and verifies no proof today | `FORBIDDEN_CLAIMS` in `lib/visibility.ts` |
| 61 | Privacy plan: adopt the real Default Ring with proofs made in the browser; wait for Helius's anonymous rings for hidden addresses; build no circuits of our own | It is the only audited, live option that takes arbitrary coins. Our own pool would need a trusted setup and an outside audit and would start with almost no users to hide among | `PRIVACY-AUDIT.md`, section 3 |

## Only you

1. **A private repository.** Steps are in `README.md`. I cannot create one from here.
2. **`HELIUS_API_KEY`** in `.env.local`, for the devnet pass.
3. **The real brand media** in `brand/`, from `brand/HIGGSFIELD-PROMPTS.md`.
4. **A lawyer's read** of Terms and Privacy Policy, and of OTC and pay links as features.
5. **The sealed launch window**: build it with custody, or leave it out.
6. **Anything on mainnet**, including who pays for the lookup table and with which key.
