# Plan

> Where this stands: steps 1 to 4 are built **on a local validator**, with Ring balances
> as a mock (see `README.md`, `TEST-REPORT.md`). The devnet pass, which replaces the mock
> with the real Ring calls, has not started: it needs `HELIUS_API_KEY`. The sealed launch
> window is not built and waits on the owner. The rest of this file is the original plan.

## What it is

One web app, working name RINGPAD: launch a coin on a pump.fun curve with its Ring
registration in the same signature, hold and send it with hidden amounts, see which coins
have real Ring usage, and trade blocks over the counter at a sealed size and price.

## Shape

- **Web:** Next.js App Router, React, TypeScript. Homepage (hero, live stats, how it works
  as the exploded view, what is hidden and what is not, the added features, product cards,
  launch call to action, footer) plus app routes: Explore, Launch, Ring wallet, OTC, Docs,
  Terms, Privacy Policy.
- **Chain code** in one package, used by the app and the tests: a Rings module wrapping
  `@heliuslabs/spr`, a curve module wrapping `@pump-fun/pump-sdk`, a wallet module (Wallet
  Standard and the in-browser key), and the visibility table.
- **Server**, kept small: a proxy to Helius that hides the API key and rate-limits proofs;
  an indexer that records our launches and price points for Explore; later, a relay for
  OTC offers that it cannot read.
- **Networks:** devnet and a local validator. Mainnet is not configured at all until you ask.

## Order of work

| Step | Delivers | Proven by |
| --- | --- | --- |
| 1 | These notes and this plan | You reading them. Done. |
| 2 | The homepage with the `brand/` media and the scroll sequence | Screenshots at desktop and phone width, compared with the style screenshots in `brand/`, with every weaker point listed and fixed |
| 3 | Launch (create + register, optional public dev buy into the Ring), Ring wallet (deposit, transfer, withdraw), Explore (feed, market cap, 24h change, Ring badge), privacy panel on each action | Unit tests, plus devnet tests for every flow with their transaction signatures listed |
| 4 | Pre-launch sealed window (if you approve it, see decision 1), privacy score, pay links and QR, no-wallet mode with encrypted backup | Same |
| 5 | OTC block trades, creator fees into the Ring. Proof of holdings is dropped | Same |
| 6 | Terms, Privacy Policy, docs, final polish on phone and desktop | Screenshots at phone, tablet and desktop widths; a test that every privacy claim on the site is in the visibility table |

Step 3 starts with two half-day proofs on devnet, because the rest depends on them:
a pump.fun coin registered with the Ring, and a Ring transfer of that coin.

## Step 2: done, on stand-in media

Built without waiting for the name, the colour or the real renders, as instructed:

- **Name** RINGPAD, in `site.config.ts` only. **Accent** amber #F5A524, as `--accent` only.
- **Stand-in media** drawn in code under the exact names and sizes in `brand/README.md`.
- **Homepage:** pinned hero that plays 96 frames of `hero.mp4` against scroll, words that
  change with a 150 ms glitch, five callouts joined to their layers, then live stats (no
  number is shown until one is read from the chain), what is hidden and what is not, what
  the project adds (each with its true status), four tools, call to action, footer.
- **Background:** concept 1, "Passing", on every page. See `CLAUDE.md` for how it works.
- **Other pages:** Explore, Launch, Ring wallet, OTC as shells that say "not open yet",
  each with the real privacy panels; Docs; Terms and Privacy Policy as drafts.
- **Checks, all pages, desktop and phone:** no horizontal scroll, no console errors, pure
  black behind every piece of text on desktop, at most a faint hairline on phones.

Choices I made where the brief was cut off or silent, all easy to reverse:

| Choice | Why |
| --- | --- |
| Background concept "Passing" | My recommendation; it is the one that leaves the hero object alone and turns down cleanly on app pages. |
| Sealed launch window left out | Listed on the homepage as "under review", with the reason. No pooled-funds code. |
| Media black keyed to transparency | So the background passes behind the object. Needs true black source files. |
| Tables stack on phones | Three columns of dot-matrix text do not fit 390 px. |
| Phone nav says "Wallet", not "Ring wallet" | So five links fit on one line. |
| Small frame set on modest devices | A sharp frame that arrives late is worse than a soft one that keeps up. |

Not measured on a real phone. Frame pacing was measured in a headless browser with the
CPU throttled four times: 60 frames a second once the frames have loaded. During the few
seconds they are still arriving, scrolling shows the nearest frame that has.

## Steps 3 to 5: done on a local validator

Proven on copies of the real programs: one transaction creates a pump.fun coin and
registers it with the Ring, for both kinds of coin, with or without a first buy. That
settles the main risk in `RESEARCH.md` section 6 as far as registration goes. Whether the
Ring's deposits and transfers accept these coins is for the devnet pass.

Working end to end, with tests: launch, first buy into the Ring, buy and sell on the
curve, deposit, transfer, withdraw, OTC, pay links with QR, no-wallet mode with encrypted
backup, the privacy score, creator fees into the Ring, the privacy panel before every
signature. See `DECISIONS.md`.

## What is left

1. **Devnet pass.** Replace the mock Ring ledger with the real SDK. Needs `HELIUS_API_KEY`.
2. **Real media** in `brand/`, then `npm run media` and re-measure two values in `site.config.ts`.
3. **Step 6 polish** that depends on the two above, and a lawyer's read of the legal pages.

