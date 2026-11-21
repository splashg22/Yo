# Plan

## What it is

One web app, working name [NAME]: launch a coin on a pump.fun curve with its Ring
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

## Blocked: step 2 needs files that are not here yet

The homepage is built from five media files and a set of style screenshots, all expected
in `brand/`. None of them exists in this folder or anywhere in the repository. The six
generation prompts in the brief still contain the placeholders `[NAME]` and
`[ACCENT COLOUR]`, and I cannot run an image or video generator from this session.
`brand/README.md` lists each file, its size and what must line up between them.

## How the homepage will be built (step 2)

- **Typeface.** Doto (SIL Open Font Licence), a dot-matrix face with real weights, self-hosted
  as one variable file. It is the only font. Long pages (Terms, Privacy Policy, Docs) will
  be harder to read in an all-caps dot-matrix face than in a text face; I will set them
  larger and looser and show you, so you can judge it before step 6.
- **Scroll sequence.** `hero.mp4` is cut into still frames at build time (about 120 for six
  seconds), encoded as AVIF with a WebP fallback, and drawn to a canvas from scroll
  position. Frames load in order after first paint; the first frame is `hero.png` itself,
  so the page is complete before any of the sequence arrives. A video element scrubbed by
  scroll stutters on most phones, which is why it is frames and not the video.
- **Callouts.** Positions are stored as fractions of the image, so the boxes and their
  lines stay on their layers at every width. On phones they become a numbered list.
- **Layer labels match the research.** 01 your wallet: public. 02 the coin: encrypted in a
  transfer. 03 the amount: encrypted in a transfer. 04 the Ring: where the encrypted
  balance lives. 05 the public chain: deposits, withdrawals and every curve trade.
- **Live stats** come from devnet through our own route and show nothing until there is a
  real number. With no launches yet the section says so.

## Decisions I need from you

1. **Sealed launch window.** What you described cannot be done on a pump.fun curve. The
   closest thing is a sealed window before the coin exists, ending in one pooled first buy.
   Someone has to hold the pooled SOL during the window. Options:
   - **Creator-held pool:** the launch creator's own key holds it. Simple, but buyers must
     trust the creator, which is the trust a launchpad is meant to remove.
   - **Platform-held pool:** our server key holds it. We become a custodian of user funds,
     with the legal weight that carries.
   - **Leave it out** until Rings has a production escrow path.
   My recommendation is to leave it out of the first release and decide with legal advice.
   A pooled purchase of a coin that does not exist yet can look like a presale.
2. **Name.** Both briefs say [NAME]. I used the folder `ring-launchpad`. The name is needed
   for the logo lockup, the headline and the page titles.
3. **Brand media and accent colour.** The revised brief settles the style (pure black,
   white text, one dot-matrix face, colour only from the media), so my earlier palette
   question is closed. What is open is the media itself: generate the six items, put them
   in `brand/` with the style screenshots, and tell me the accent colour you chose. Avoid
   violet or purple for it, since "purple and black" is on your own avoid list.
4. **Helius API key for devnet.** I need one to run anything. I will ask for it through
   the secure credential form, not in chat.
5. **Where the code lives.** This folder is inside the `Yo` repository, which is public,
   so I have committed and pushed nothing. Tell me to push here, or give me a private
   repository.
6. **Reuse.** The ShadowTerminal work from earlier has tested pieces this project needs
   (in-browser keys, encrypted local storage, wallet connection, the Rings wrapper). I plan
   to carry those over rather than rewrite them.

## What I will not claim

Nothing on the site will say or imply that launches, buys or sells on the curve are
private, that wallets are hidden, or that the project is audited. Section 1 of
`RESEARCH.md` is the limit of what can be said.
