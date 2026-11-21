# Plan

## What it is

One web app, working name [NAME]: launch a coin on a pump.fun curve with its Ring
registration in the same signature, hold and send it with hidden amounts, see which coins
have real Ring usage, and trade blocks over the counter at a sealed size and price.

## Shape

- **Web:** Next.js App Router, React, TypeScript. Homepage plus app routes: Explore,
  Launch, Ring wallet, OTC, Docs, Terms, Privacy Policy.
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
| 1 | These notes and this plan | You reading them |
| 2 | Launch (create + register, optional public dev buy into the Ring), Ring wallet (deposit, transfer, withdraw), Explore (feed, market cap, 24h change, Ring badge), privacy panel on each action | Unit tests, plus devnet tests for every flow with their transaction signatures listed |
| 3 | Pre-launch sealed window (if you approve it, see decision 1), privacy score, pay links and QR, no-wallet mode with encrypted backup | Same |
| 4 | OTC block trades, creator fees into the Ring. Proof of holdings is dropped | Same |
| 5 | Site polish against the branding screenshots, Terms, Privacy Policy, docs | Screenshots at phone, tablet and desktop widths; a test that every privacy claim on the site is in the visibility table |

Step 2 starts with two half-day proofs on devnet, because the rest depends on them:
a pump.fun coin registered with the Ring, and a Ring transfer of that coin.

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
2. **Name.** The brief still says [NAME]. I used the folder `ring-launchpad`.
3. **Branding screenshots.** None reached me with your message. I captured the live
   reference site myself. Three items on your avoid list are things that site does: a
   wine-on-black palette (close to "purple and black"), pill-shaped navigation and buttons
   ("soft corner radius"), and a cell texture behind the hero (close to "dot grids"). I
   plan to keep its depth, type scale and spacing, shift the hue to oxblood and bone, use
   square corners, and drop the texture. Say if you would rather match it exactly.
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
