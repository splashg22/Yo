# The path to a public link

22 November 2026. Feature freeze: nothing below adds a feature. Two launches, each a separate deployment of
the same code with different settings, because they run on different networks.

|  | A. The terminal | B. The launchpad |
| --- | --- | --- |
| What it is | Live coin board and coin pages | Launch a coin, trade it, hold SOL in a real Ring balance |
| Network | Solana mainnet, **read only** | Solana devnet. Coins and SOL have no value |
| Can it move money | No. The build refuses to build or send any transaction on mainnet | Devnet test SOL only |
| Paid plan needed | Helius Developer, $49 a month | None. A free Helius key reaches devnet |
| Settings | `deploy/terminal.env.example` | `deploy/launchpad.env.example` |
| Ready | **About 70%** | **About 85%** |
| Ships first | Second | **First** |

Both keep "Pre-release" and "Not audited" on every page. Neither holds a mainnet key or anyone's funds.

## Why B ships first

Everything on B's path has now been run on the real network, and it needs nothing paid:

| Step, on real devnet | Proven | How |
| --- | --- | --- |
| Register, deposit, transfer, withdraw SOL on the Privacy Rings program | Yes, again today | `npm run ring:prove`, signatures in `RING-RESULTS.md` |
| The same four through this site's wallet page in a browser | Yes, earlier today | `npm run ring:browser` |
| One-off set-up (the launch lookup table) | Yes, today. It failed first: it waited on a websocket. Fixed to poll | `npm run devnet:setup` |
| Launch a coin through the site in a browser | **Yes, today, for the first time** | `npm run devnet:launch`: coin `Mk39fmChqUQNNP6QjCeabDxvkQm1XTENUU72Zz9UfuM`, transaction `31o2J99cfLsiqdEi6s9BqPWS48hj8jJUtJcmL7T9oy7zQVKfM7NqudngcK5bAP3psc4sxBBNg79aGpwvRDuefJT1` |
| Its page showing the first buy, read from the chain | Yes, today | Same run |
| Buy and sell through the site in a browser | **Not yet.** The test wallet ran out of devnet SOL before this step | Proven on the local chain (e2e) and in flow tests. Needs 0.5 devnet SOL to finish: see "From you" |

A's one unproven part is its most important: **the live Helius stream has never been run.** It is written and
tested against recorded mainnet blocks, but there has been no paid key, and this build machine cannot open
outbound websockets at all, so the first live run can only happen on the host. Until that run, A is a board that
works on recordings.

## What ships, and what is hidden

| Feature | In launch | Why |
| --- | --- | --- |
| Board, trending, search, coin page, safety checks | A | Real data, read only |
| Launch a coin, buy, sell, portfolio, receipts | B | pump.fun's program on devnet |
| Ring wallet: register, deposit, transfer, withdraw SOL | B | The real program, proven |
| OTC blocks | **Hidden** (`FEATURE_OTC`, off) | Built on the stand-in Ring only |
| Pay links | **Hidden** (`FEATURE_PAY_LINKS`, off) | Built on the stand-in Ring only |
| Sealed launch window | **Hidden** (`FEATURE_SEALED_WINDOW`, off) | Holds buyers' funds. Stays off without your say-so and an outside review |
| Signed-in-advance orders | Not in the product | A proof and a write-up only |
| First buy straight into a Ring balance; a coin (not SOL) in a Ring balance; split withdrawals | Not shown on devnet | Never run on the real program |
| Meteora pools, coins priced in another coin | Not on plan A | They need the full stream |

A hidden feature is out of the menu, its page says "not part of this build", and the server refuses its
requests. On a public network nothing runs on the stand-in Ring.

## Done by me, in this round

- The working-screen theme (version C) is applied by default. The homepage, docs and legal pages keep the brand's look.
- OTC and pay links are behind flags that are off outside a local test chain.
- One-command deploy: `npm run deploy -- launchpad` or `-- terminal` (`scripts/deploy.sh`). It runs the secret scan and
  the whole suite, checks the host has every setting the launch needs, then deploys. **It has not been run against
  Railway: there was no account to run it against.**
- Settings checklists: `deploy/launchpad.env.example`, `deploy/terminal.env.example`.
- Three faults that would have hit a public deployment, found by running on devnet and fixed:
  1. The devnet set-up hung on hosts that cannot open a websocket.
  2. A server restarted after a long stop tried to read every block it had missed (eight hours of reads for a day's
     stop) and starved everything else, so a launch was sent and never confirmed. It now starts again from the
     present after about twenty minutes' gap and reports the gap on `/health`.
  3. A server busy catching up did not stop when asked. It now stops within eight seconds.
- A buy pressed before the wallet's balance had loaded was refused as "too little SOL". Fixed.
- A help address appears in every page's footer once `site.config.ts` has a real one.

## Checks on this build

| Check | Result |
| --- | --- |
| Types, lint (zero warnings), formatting | Pass |
| Unit tests | 301 pass |
| Flow tests on a local chain | 115 pass |
| Browser: end to end, break, crawl, motion | 19 of 19, 14 of 14, 0 findings over 16 pages at two widths, 11 of 11 |
| Load: 50 trades a second, 2,000 connections | Every budget held. Trade to screen: 44 ms median, 91 ms at the 95th |
| Speed, emulated phone on 4G | Home 0.5 s, terminal 0.5 s to largest paint. Layout shift 0.000 to 0.009 |
| **Speed, a coin's page, emulated phone slowed four times** | **Misses its budget: 1.6 to 1.7 s to largest paint against 1.5 s.** First paint is 0.35 s. The largest thing on the screen is the chart's read-out, which waits for the candles. Not fixed in the freeze: the fix is to send the coin with the page instead of fetching it after |

Found by the re-measure and fixed: on a phone, the figures under a coin's name wrapped by width, so a price
that lost a digit pulled everything below it up a row (layout shift 0.13 in about half the loads). They now
have fixed places.

## From you: five small steps

Prices are from each provider's pricing page as I last read it (Helius: confirmed 22 November). Check on the day.

| # | Step | Exact clicks | Time | Cost |
| --- | --- | --- | --- | --- |
| 1 | **Hosting: Railway** | railway.com, "Login", sign in with GitHub. "New Project", "Deploy from GitHub repo", pick this repository and the `ringpad` branch. Rename the service `ringpad-launchpad`. In its "Variables" tab, paste the names from `deploy/launchpad.env.example` and fill the values. "Settings", "Networking", "Generate Domain". For launch A, "New", "GitHub Repo" again, name it `ringpad-terminal`, use `deploy/terminal.env.example` | 15 min | Hobby plan $5 a month, which includes $5 of use. Two small services may run a few dollars over |
| 2 | **Database** | Simplest: in each Railway service, "Settings", "Volumes", "Add Volume", mount path `/data`. No database account needed. Or Postgres: neon.com, "Sign up", "Create project", copy the connection string into `DATABASE_URL` | 3 min | Volume: cents a month. Neon: free tier |
| 3 | **Helius key** | Launch B: your existing key works; put it in `HELIUS_API_KEY` on the launchpad service. **Rotate it first** (it was pasted in chat once): dashboard.helius.dev, "API Keys", delete, "Create". Launch A: same dashboard, "Billing", choose "Developer", turn automatic top-up off, and use that project's key on the terminal service | 5 min | B: $0. A: $49 a month |
| 4 | **Operator details** | Open `site.config.ts` on GitHub, pencil icon, replace the three placeholders under `operator` (name, country, contact email), "Commit changes". The email also becomes the "Help" link on every page | 3 min | $0 |
| 5 | **Devnet SOL** | faucet.solana.com, choose devnet. Send 0.1 to the operator wallet that the first deploy prints in its log (`npm run devnet:setup` on the host), and 0.5 to my test wallet `5bay9nphMrjypM3UQumPEhPdSQFxxLQ8FhfPxwXXehT5` so I can finish the buy and sell proof | 3 min | $0 |

Brand media is not on the critical path: the stand-ins are the right size and the site works with them. Replace
them when ready (`brand/README.md` has each file's size), then `npm run media`.

Not needed for a first public link: a domain (Railway's generated address works), Pinata (pictures are kept on
the volume), a preview password (set `PREVIEW_PASSWORD` if you want the link private at first).

## Order of events

1. You do steps 1 to 5 for the launchpad service (about half an hour).
2. Railway builds and starts it. Open `<address>/health`: `"server": true` and the indexer level with the chain.
3. Run the devnet set-up once on the host (Railway, the service, "..." menu, "Run command": `npm run devnet:setup`),
   fund the wallet it prints, run it again.
4. Tell me the address. I run `npm run devnet:launch` and `npm run ring:browser` against it and report.
5. Launch B is public.
6. For launch A: subscribe to Helius Developer, set the terminal service's variables, deploy. Tell me. I compare
   the live board against a recording taken at the same time and run the board check. That first run decides
   when A is public.

## Biggest risk, each

- **A: the live stream.** Never run. If Helius's transaction stream behaves differently from its documentation
  (message shape, reconnects, credit use), the board is late or empty until fixed. Second: plan A's credits. The
  estimate says it fits; a bill is the proof. Keep automatic top-up off.
- **B: the Ring is somebody else's alpha software.** The Privacy Rings program is upgradeable by Helius and its
  SDK is at 0.9.0-alpha. A change on their side can break deposits or withdrawals with no change on ours. The
  status page reads the program on every load; the proof scripts can be rerun in a minute. Second: only a wallet
  made in the browser is proven. Whether Phantom, Solflare or Backpack will sign the Ring's transactions is
  unknown.

## Where the percentages come from

**B, about 85%.** Done: every flow built; the Ring and a coin launch proven on devnet; suite green. Left: buy and
sell in a browser on devnet (needs test SOL), the first real deploy and its set-up, operator details, one pass of
the proofs against the public address.

**A, about 70%.** Done: board, coin pages, search, checks, read-only guard, all on recordings; suite green. Left: the
first live run of the stream and whatever it turns up, the paid plan, the first real deploy, a day of watching
credit use.
