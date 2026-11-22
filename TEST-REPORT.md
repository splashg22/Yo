# Test report

21 and 22 November 2026. Section 0 is the latest round. Everything from section 1 down was run on 21 November, from a fresh clone, a fresh local
validator and an empty data folder unless it says otherwise.

**Read this first.** The site runs on a local test chain only. pump.fun and the Privacy
Rings program are the real programs, copied from devnet. Ring balances are a mock: a ledger
on the site's server with an escrow wallet. Nothing here has run on devnet or mainnet, and
nothing has been audited by anyone but me. "Holds real money" is the standard the code was
checked against, not something it does or is ready to do.

## 0. The round of 22 November 2026

Run on 22 November on the code as pushed, from a fresh local validator and an empty data folder.
Sections 1 to 7 below are the report of 21 November and describe the build as it was then; where
this section and they disagree, this section is the later one.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, lint (zero warnings, no rule switched off), format | `npm run check` | Clean |
| Unit tests, no chain | `npm run test:site` | 156 of 156, 1 skipped (it needs a real Postgres) |
| Flow tests on the local validator | `npm run test:flows` | 110 of 110, 5 skipped (they need a real Postgres) |
| Every flow in a browser, as two people | `npm run e2e` | 19 of 19 steps, 0 browser errors. Press to "sent": 13 to 27 ms |
| Every page, every control | `npm run crawl` | 16 pages and 5 error pages, two widths, with and without a wallet: 194 controls, 0 findings |
| Breaking it on purpose | `npm run break` | 14 of 14 |
| Scroll sequence and background | `npm run motion` | 11 of 11 |
| The sealed window in a browser, flag on | `npm run window` | 3 of 3 |
| Secrets in served files and git history | `npm run scan` | Nothing found |
| Load: 60 trades a second on one coin, 1,000 live connections | `npm run load` | Every budget held |
| Speed in a browser, under 50 trades a second | `npm run perf` | Every budget held |
| High or critical advisories | `npm audit --audit-level=high` | None. The moderate ones are assessed in `ADVISORIES.md` |

Numbers for the last two rows, and what they do not show: `PERFORMANCE.md`.

**Not rerun this round:** the flow tests and the browser run with the state in a real Postgres
(`npm run test:flows:pg`), the crawl in devnet mode, the screenshots (`npm run shots`), the SDK example
(`npm run example`) and `npm run measure`. They passed on 21 November; the database layer and many pages
have changed since, so those passes are not evidence about today's code.

**New tests this round**, by what they prove: the indexer's order, restarts and reorganisations on a
made-up chain; the live hub's replay and resets; the store's database constraints; the server over
HTTP and websocket (zero chain calls for reads, at most two to build a trade, the fast trade path,
sessions, per-caller limits, security headers); graduation and pool trading; fees; the door to the
real Ring's services and what it refuses; blocks holding version 1 transactions; the withdrawal
planner and its queue; what each privacy panel says the server sees.

**What the checks found this round, and what was done:**

| Found by | Finding | Fix |
| --- | --- | --- |
| A browser on devnet | The indexer stopped at every block holding a version 1 transaction, which is every block the Ring program is used in | Blocks and receipts are read as plain JSON; `test/unit/rpc-source.test.ts` |
| `npm run perf` | Layout shift of 0.217 on a coin's page on a phone | The price of SOL and the build's settings are in the first HTML; fixed rows for the chart toolbar |
| `npm run perf`, by eye | The chart toolbar ran off a phone's screen, hiding a control; the header took a quarter of the screen | One column that cannot outgrow the screen; one row of navigation |
| `npm run perf` | 41 to 46 frames a second on a slowed phone under a fast stream | Words and figures redraw at most ten times a second; the chart every frame. 57 |
| `npm run e2e` | A pointer resting where a dropdown opened took over from the keyboard | The list follows pointer movement, not presence |
| `npm run crawl` | Controls under 40px tall on a phone; a clipped line on the board; 10px tags | Fixed in the styles |
| `npm run break` | The trade button was dead for a bad amount and said nothing | It is always live and says what is wrong |
| `npm run check` | A chain-call budget test depended on how fast the machine was | It names the calls it saw and leaves out the blockhash, which the running server keeps warm; that is proven by its own test |
| Reading the code | With the real Ring on, the OTC desk and two shortcuts offered forms that would have failed | They say they are not connected yet, and why |

## 1. What was tested

| Check | Command | Result |
| --- | --- | --- |
| Fresh clone: install, typecheck, lint, format, build | `npm ci`, `npm run check`, `npm run build` | Clean. Zero lint warnings, no rule switched off, no `any` |
| Unit tests, no chain | `npm run test:site` | 85 of 85 |
| Flow tests on the local validator | `npm run test:flows` | 80 of 80 |
| The same flow tests with the state in a real local Postgres 16 | `npm run test:flows:pg` | 85 of 85 (5 more that only apply to Postgres) |
| The Postgres store by itself | `test/unit/database.test.ts` with `DATABASE_URL` | 4 of 4 |
| Every flow in a browser, as two people | `npm run e2e` | 17 of 17 steps, 0 browser errors |
| The same browser run with the state in Postgres | `npm run e2e`, server started with `DATABASE_URL` | 17 of 17 |
| The sealed window in a browser, flag on | `npm run window` | 3 of 3 |
| Every page in devnet mode (pointed at the local chain) | `npm run crawl` against that server | 0 findings |
| Every page, every control | `npm run crawl` | 0 findings |
| Breaking it on purpose | `npm run break` | 14 of 14 |
| Scroll sequence and background | `npm run motion` | 11 of 11 |
| Secrets in served files and git history | `npm run scan` | Nothing found |
| Screenshots, overflow, text over background | `npm run shots` | 11 pages x 2 widths, no overflow |
| SDK example | `npm run example` | Runs: a launch and a Ring transfer from a script |

**Test count.** Before this audit: 45 tests (15 site, 30 flow) and a 12-step browser run.
Now: 165 tests (85 unit, 80 flow), a further 9 that run only with Postgres, a 17-step browser run, and four new browser checks
(crawler, break-it, motion, secrets scan).

### The flows, end to end (part 3)

`npm run e2e` drives the built site in a browser as a seller and a buyer. Each flow is done
twice back to back and a third time after a page reload. After every action the figure on
screen is compared with a balance read straight from the validator over JSON-RPC, not
through the app.

| Flow | Times | Compared with the chain |
| --- | --- | --- |
| No-wallet mode: make a wallet, reload, faucet | 3 per person | Wallet gains exactly 10 SOL each time; address unchanged after reload |
| Backup file restores the wallet in a clean browser | 1 | Same address; wrong password refused |
| Launch (create + register + first buy into the Ring) | 3 | Coin supply exists; first buy is in escrow, not the wallet |
| Buy and sell on the curve | 3 buys, 1 sell | Wallet figure equals chain; a sell of 1,000 removes exactly 1,000 |
| Deposit | 3 | Escrow gains and wallet loses exactly the amount |
| Transfer between Ring balances | 3 | Both Ring balances move; nothing moves on the chain |
| Withdraw | 3 | Wallet gains and escrow loses exactly the amount |
| OTC block | 3, plus 1 cancelled | Both Ring balances, both legs |
| Pay link | 3 | Link keeps address case; both Ring balances |
| Privacy score | 3 | Share = escrow balance / supply, both read from the chain |
| Books balance | 1 | For each coin, escrow on-chain equals the sum of Ring balances; status page shows the same |
| Creator fees into the Ring | 1 | Escrow gains what the page says was claimed |

The first word of status appeared at most 15 ms after a click, over 31 timed actions.
Every transaction ends with a receipt link; the receipt's slot and amounts match the chain.

### Every page, every control (part 4)

13 pages plus 5 addresses that should fail (bad coin, bad signature, unknown page, bad pay
link), at 1440 and 390 pixels wide, with and without a wallet: 74 controls clicked, 15
links followed, 4 forms submitted empty. Checks: console errors, failed requests, error
responses, sideways overflow, clipped text, text under 11px, dim text, tap targets under
40px on the phone, missing labels, one heading per page, dead links, buttons that do nothing.

### Breaking it (part 5)

| Tried | What happens |
| --- | --- |
| Empty, zero, too many decimals, negative, `1e5`, letters, `1.2.3`, larger than the chain can hold, non-Latin digits, in 7 money fields | Refused in the form with a reason. Nothing is built or sent |
| One base unit; more than the wallet holds; more than the Ring balance | 1 lamport arrives as 1 lamport; the others are refused with a reason |
| Empty, malformed, one byte short, one byte long, an Ethereum address, an unregistered wallet, your own address | Each refused with its own reason; balance unchanged |
| Double click on Sign (a transaction, and a Ring transfer) | One request, money moves once |
| Reload in the middle of a deposit | The server had already settled it; chain and Ring agree |
| Chain frozen for 5 seconds mid-deposit | Page keeps saying it is waiting, then completes; books balance |
| Wallet extension declines to sign | "did not sign ... Nothing was sent." Nothing is sent |
| No wallet | Every money page offers to make one; a pay link still shows what is asked |
| Empty account: deposit, withdraw, transfer, buy, sell, launch | Each says what is missing |
| The site's server stops answering | Each page says so and offers a retry |
| The chain stops answering | Each page says so within its time limit; nothing is sent |
| Two tabs on one wallet | The second tab asks for the password; a deposit made in one shows in the other on return; both can act |
| A 32-letter name and 10-letter ticker; names with characters that cannot be shown | Pages still fit at 320px; the bad names are refused with a reason |
| After all of it | Escrow still covers every Ring balance; no payout left pending |

The flow tests cover the same ground at the server, plus: two concurrent credits of one
deposit, a withdrawal whose outcome is unknown, replayed and forged signed requests, a
restart between steps, and the mock refusing to run off a local validator.

### Sequence and background (part 6)

Slow phone (processor 6x slower, slow network): headline at 0.74 s, picture at 1.3 s,
layout shift 0.000, picture and words at every step even before the frames have loaded.
200 scroll jumps a frame apart: never blank, never unpinned; the frame lands on the scroll
position. Reduced motion: stills, no frames downloaded, background does not draw at rest.
Hidden tab: drawing stops and resumes. Windows of 390x3000, 1440x2400, 280x600, 2560x480,
1024x600 and 768x1024, and a phone rotated mid-sequence: pinned, on screen, no overflow.

### Speed

| Page | Transferred before load, before -> after | Script | Load | Layout shift |
| --- | --- | --- | --- | --- |
| `/` | 319 KB -> 246 KB | 245 -> 171 KB | 108 to 164 ms -> 157 ms | 0 -> 0.004 |
| app pages | 256 to 269 KB -> 185 to 197 KB | 245 -> 168 to 183 KB | -> 96 to 120 ms | about 0.02 -> 0.004 |

Measured on this machine against a local server, cold cache. The saving is web3.js leaving
the browser. The 0.004 is the "Status" link in the top notice moving sideways when the
notice's wording arrives. Not measured on a real network or a real phone.

## 2. Bugs found and fixed

Each has a test or a scripted check that fails without the fix.

| # | Bug | Fix | Pinned by |
| --- | --- | --- | --- |
| 1 | Two requests at once could credit one deposit twice | The signature is claimed before anything is awaited | flow: resilience |
| 2 | A deposit stayed uncredited if the browser closed after signing | The server settles on send; anything missed can be reconciled from the chain | flow: resilience; break: reload |
| 3 | A withdrawal was refunded on any error, so a slow confirmation could pay twice | Outcomes are landed, not sent, or unknown; unknown is held until the chain answers | flow: resilience |
| 4 | Anyone could list any coin under any name | Listing only from the launch this server built, creator checked on-chain | flow: launch |
| 5 | Price, change and share were floating-point; whole lamports per coin rounded to zero | Integers end to end: micro-lamports, basis points, parts per million | unit: format |
| 6 | Malformed addresses and signatures reached the chain and came back as raw errors | Validated first, with a plain sentence | unit: requests; break |
| 7 | The escrow's own start-up funding could be credited to a user on reconcile | Its signature is marked as already accounted for | flow: resilience |
| 8 | A double click could send twice | A lock that holds before the page re-renders | break: double click |
| 9 | No time limit on chain calls; a dead chain hung the page | Timed calls, a 503, and an offline state on every page | flow: resilience; break |
| 10 | An OTC expiry that was not a number never expired | Whole hours, 1 to 168 | flow: otc |
| 11 | Selling a coin you do not hold gave an SDK error | "You hold none of this coin" | flow: launch; break |
| 12 | Used request numbers were forgotten on restart, allowing a replay | Saved as they are used | flow: resilience |
| 13 | **In the built site, every launch with a first buy failed on a fresh chain.** The server bundled a second copy of web3.js, so it recognised none of pump.fun's fee wallets and funded none. Tests passed because they load one copy; the long-running validator hid it because earlier runs had already funded those wallets | Wallets found by shape; one copy of web3.js on the server; set-up fails loudly if it finds none | unit: fee-wallets; e2e on a fresh chain |
| 14 | "Get test SOL" pressed twice said "added" twice and paid once | Airdrops run one at a time, never reuse a signature, and ask for the newest blockhash (on a chain only seconds old the faucet otherwise repeats itself for about 15 seconds, which the second fresh-clone run caught) | flow: resilience |
| 15 | Unknown addresses showed the framework's 404, black text on black | A designed page with ways back | crawl |
| 16 | Phone tap targets were 14 to 23px tall | 44px for every stand-alone control | crawl |
| 17 | The page jumped as late data arrived: the top notice re-wrapped (18px), the hero moved 2px on start-up, the stats row grew 166px, the footer jumped on Explore and Pay | Space is held before the data arrives; the homepage header lies over the hero; pages are a window tall | motion; measure |
| 18 | On short or very narrow phones the words and the five callouts ran off the pinned stage | The object sizes to the window; on phones the callouts follow the sequence as a list | motion |
| 19 | After rotating a phone mid-sequence the frame was 3 behind | Removed with the hero's dependence on the header height | motion |
| 20 | Homepage copy called simulated features "encrypted"; an unseen sizing copy in the page source read "server is not answering"; earlier, "runs on devnet" and a privacy policy that said the server cannot read transfers | Reworded to what is true in this build; a notice on every page | unit: site |
| 21 | A declined wallet signature showed the wallet's raw error; a damaged stored wallet showed a JSON error | Plain sentences, "Nothing was sent" | break: declined signature. The damaged-wallet message has no test |
| 22 | The Ring line read "balances2 wallets" to a screen reader | A space | e2e: privacy score |
| 23 | Failures on send lost their cause, so an operator could not see why | Logged on the server with the cause, without inputs | none: seen in the log while fixing 13 |
| 24 | One unit test failed at random: a lower-cased address is sometimes still a valid address | The test now asserts what is actually true | 3 runs in a row |
| 25 | A coin with a 32-letter name pushed the coin page wider than a phone screen, leaving a Copy button out of reach while the page itself did not scroll | Long names and addresses wrap inside their column | break: awkward names; crawl |
| 26 | With the pay-link request moved after the #, opening a second pay link in the same tab left the first one on screen, marked as paid | The page follows a change of link and starts each request clean | e2e: pay link, three times |
| 27 | **Sealed window, critical.** A launch was recognised by any confirmed transaction that named the coin's address. A creator could settle a decoy, have the pool refunded as an empty "launch", then send the real launch and be credited every coin escrow bought | A launch is recognised only by the signature escrow put on it. Nothing that reaches escrow in a transaction escrow signed is credited to the fee payer | flow: window, "attacks on a window by its own creator" |
| 28 | Sealed window: an older check could unlock a window that a newer launch had locked, and a crash mid-build left a window locked for ever | The lock is released only if it is still the same lock; a half-made lock is released after a restart; a launch that expired is given up only after a margin of blocks and a settlement pass | flow: window |
| 29 | Withdrawals: escrow paid the network fee, and the rent for a new token account, from its own SOL. Repeated withdrawals to fresh addresses could drain it | The withdrawing wallet is charged both, exactly. A test checks escrow's spare SOL is unchanged by payouts | flow: ring-wallet, "charges the withdrawing wallet" |
| 30 | Withdrawals: a crash while a payout was being sent left the coins out of the balance with nothing on record to resolve it | The payout is recorded, with its signature, and stored before it is sent. A withdrawal with no payout on record is given back | flow: resilience |
| 31 | Withdrawals: any error from the node on sending was treated as "not sent" and refunded, though the node may already have taken the transaction | Only a refusal before broadcast is "not sent". Anything else is "unknown" and settled from the chain | flow: resilience, with a node that accepts and never answers |
| 32 | Settlement: a deposit's signature was marked as handled before it was credited. A crash in between meant it was never credited | Claims are held in memory; the signature is recorded in the same step as the credit | flow: resilience (existing tests), by construction |
| 33 | Signed requests: a time that was not a number never expired; used requests were forgotten by count, so a flood could make room for a replay | Time must be a finite number; nonce a string; forgotten by age only | unit: requests |
| 34 | Anyone could prepare a launch for a coin address another wallet was about to launch, changing the name it would be listed under | The first wallet to prepare an address keeps it; stale ones are dropped after an hour | flow: launch |
| 35 | No limit on request size; pictures of up to 40 megapixels decoded without limit on how many at once | 2.3 MB cap; 16 megapixels; one decode at a time; launches limited to 30 a minute | unit: config, limit |
| 36 | The request limit trusted an address the caller writes themselves | Believed only as far as `TRUSTED_PROXY_HOPS` says | unit: limit |
| 37 | Coin pictures were linked by the site's configured address, so they broke when the site was reached at another | The site's own pages use a path | e2e |
| 38 | The wallet page asked for a Ring balance before knowing whether the network has one | Waits for the server's answer first | crawl in devnet mode |
| 39 | Opening a second pay link in the same tab left the first on screen | Follows the change | e2e |
| 40 | libsodium was loaded on every page, doubling page weight | Loaded only when a note is sealed or opened | measure |

Bugs 13 and 14 were only found because the browser run started from a fresh validator.
Bugs 27 to 36 were found by a second, independent read of the money and key code, asked
for without being told where to look. Each was confirmed against the code before fixing.

### Added after the first report

Each privacy claim now states what carries it out in this build and the source file, in
the panel before every signature and in the docs table, with a link to "Check it
yourself" on the technical page. Coin pages draw the recorded price. The wallet tab and
the buy or sell side are kept in the address, so a reload or a shared link opens in the
same place. Explore shows 24 coins at a time. The launchpad uses ports of its own.
The server now caps requests per address per minute (30 faucet, 240 writes, 1,200 reads),
answers only POST, and refuses to start from a damaged state file rather than begin empty.

Privacy, stage 1 (`PRIVACY-AUDIT.md`): notes on a transfer are sealed in the browser with
libsodium and the server cannot read them; pay-link requests are carried after the # and
do not reach the server; no referrer is sent. The site still sees every transfer's
wallets, coin and amount, and says so.

### Built in the last round, against stand-ins

| What | How it is switched | Proven by | Not verified |
| --- | --- | --- | --- |
| State in Postgres | `DATABASE_URL` | The whole flow suite and the browser run against a local Postgres 16 | A hosted provider |
| Devnet mode | `RING_NETWORK=devnet`, `HELIUS_API_KEY` | Flow tests and a crawl with devnet mode pointed at the local chain | **Real devnet and Helius.** The devnet faucet is closed to this machine |
| Coin pictures | `PINATA_JWT` | Unit, flow and browser tests of the local store | **The Pinata upload** |
| Sealed launch window | `FEATURE_SEALED_WINDOW` | 10 flow tests and a browser run | Anything off a local validator: it uses the stand-in's escrow |
| Private preview | `PREVIEW_PASSWORD` | Unit tests and a live check | A real host |
| Note keys for wallet extensions | One extra signature at connect | Browser run with a stand-in extension | **A real wallet extension** |
| Container | `Dockerfile` | Nothing: no container runtime here | **The image has not been built** |
| CI | `.github/workflows/check.yml` | Nothing: no repository to run it in | **The workflow has not run** |

## 3. Code quality pass: what changed and why

- `lib/server/`: one large handler file became `env`, `validate`, `store`, `solana`, `pump`,
  `escrow`, `ring`, `settle`, `bootstrap`, `transactions` and `operations/*`. One job each.
- `lib/contract.ts`: every operation typed once; server, browser client, SDK and tests share it.
- `lib/format.ts`: the only place text and amounts meet. `lib/units.ts` deleted.
- `lib/sign.ts`, `lib/keys.ts`: signing without web3.js, which removed it from the browser.
- `components/`: pages split out; shared confirm step, status line, lists and address.
- All dependencies pinned exactly; each justified in `README.md`. No unused dependency.
- ESLint type-aware rules, zero warnings, no disabled rule; Prettier; strict TypeScript.
- No empty `catch`: each either explains, falls back with a comment saying why, or rethrows.
- Removed: `prototypes/`, one-off probe scripts, `launch/record`, `site.config.network`.
- Configuration: `lib/server/env.ts` only. Secrets: none in the repository or its history.
- `README.md`, `CLAUDE.md`, `DECISIONS.md` (45 rows) and `docs/PLAN.md` match the code.

**On-chain programs:** this project deploys none. It calls pump.fun and Privacy Rings.
The checklist for program code (account checks, signer checks, overflow) therefore applies
to the mock's server code instead, where it is covered by the flow tests. It will apply to
the Ring integration in the devnet pass.

## 4. Still a mock or a stand-in

| What | State |
| --- | --- |
| Ring balances, transfers, OTC settlement, pay-link payment | Mock ledger and escrow on the server. Not encryption. Local validator only |
| OTC offers | Held by the server in readable form |
| Brand media (ring images, video frames, logo, link preview) | Drawn in code |
| Terms and Privacy Policy | Drafts, marked as not reviewed by a lawyer |
| Market cap | In SOL only; there is no USD price source |
| Devnet | Not wired up |

The site says each of these where it applies: the notice on every page, the status page,
the docs' "What is real in this build", and the footer.

## 5. Not verified

- **Not verified: anything on devnet or mainnet.** No Helius key was used. Devnet mode has
  only been run with its chain address pointed at the local validator.
- **Not verified: the Pinata upload, the container image, the CI workflow, a hosted
  Postgres.** Each is written and none has been run against the real thing.
- **Not verified: a real Ring deposit, transfer or withdrawal.** The one attempt on the local
  validator failed (`InvalidTreeAccounts`), which is why Ring balances are a mock.
- **Not verified: any browser but Chromium.** No Safari, no Firefox.
- **Not verified: a real phone.** Phone results are emulated width, touch and a slowed processor.
- **Not verified: a real wallet extension signing successfully.** Only a stand-in extension
  that declines. Phantom, Solflare and others were not tried.
- **Not verified: a screen reader.** Labels, headings and roles are checked by script only.
- **Not verified: the real brand media.** `npm run media` was not re-run on real files.
- **Not verified: load.** One or two users at a time; no concurrency beyond a few requests.
- **Not verified: the state file with more than a few hundred coins.** A write replaces the
  file whole, and a damaged file stops the server instead of being overwritten (tested), but It is one JSON file, right for a local build and wrong for anything else.
- **Not verified: the 17 `npm audit` advisories** (7 high, 7 moderate, 3 low). All are inside
  the Solana and pump.fun SDKs' dependencies (`uuid`, `toml`, `stream-json` and their
  dependants). I did not trace each to a reachable path.
- **Not verified by anyone else.** No second reviewer, no security audit.

### Features with no test of their own

The damaged-stored-wallet message; the "copy" buttons' clipboard content (only that they
respond); the link preview image beyond its size; the ordering options on
Explore beyond one being selected; `npm run media` and `npm run standins`; visual quality
of the background beyond "it draws, stops and resumes".

## 6. What I would still improve

1. Replace the mock with the real Ring on devnet, then repeat this whole report there.
2. Move state from a JSON file to a database with transactions.
3. Encrypt OTC offers to the two wallets' keys.
4. Test Safari, Firefox, real phones and real wallet extensions.
5. An outside security review before any coin of value is involved.
6. Trace or remove the audited dependencies; consider dropping the pump SDK for hand-built
   instructions to shrink the dependency tree.
7. The request ceiling is counted in memory by one process; several servers would need a shared count.
8. Ask for the password again after a reload, as an option, instead of keeping the
   unlocked key in session storage.

## 7. What still looks unfinished

Most visible first. The first ten that could be fixed without you were fixed in this pass.

| # | Rough edge | State |
| --- | --- | --- |
| 1 | The ring images are stand-ins drawn in code | Waits for your media |
| 2 | Unknown addresses showed a blank-looking 404 | Fixed |
| 3 | The page jumped when late data arrived (notice, stats, footer, hero) | Fixed |
| 4 | Phone controls too small to tap | Fixed |
| 5 | On short phones the sequence's words and callouts were cut off | Fixed |
| 6 | Coin pages had no history | Fixed: recent curve transactions from the chain |
| 7 | The wallet showed only Ring events, not the wallet's own public transactions | Fixed |
| 8 | Receipts did not say what was spent and received | Fixed |
| 9 | Explore could not be searched or ordered | Fixed |
| 10 | The docs were one long page with no contents | Fixed |
| 11 | Every coin tab was titled "Coin" | Fixed: named after the coin |
| 12 | Homepage lines promised encryption the mock does not do | Fixed |
| 13 | No price chart on a coin page | Fixed: the price as this site has read it, drawn as a stepped line |
| 14 | On a phone, the end of the sequence leaves empty space under "How it works" before the list | Open |
| 15 | While scrolling the sequence the page's main heading is replaced by second-level headings | Fixed: one steady heading for assistive technology |
| 16 | Market cap in SOL only | Open: needs a price source |
| 17 | The password field has no "show" option and no strength hint beyond 8 characters | "Show" added. No strength hint |
| 18 | Explore loads every coin at once: no paging | Shows 24 at a time. The server still sends the whole list |
| 19 | The top notice's "Status" link shifts sideways once on load (layout shift 0.004) | Open |
| 20 | No message when a copy to the clipboard is blocked beyond "Select it to copy" | Open |
| 21 | Terms and Privacy Policy read as drafts | Waits for a lawyer |
