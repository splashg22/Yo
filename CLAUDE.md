# [NAME] (working folder: ring-launchpad)

A private launchpad and trading suite on Helius Privacy Rings: launch a coin on a pump.fun
bonding curve and register it with a Ring, a Ring wallet, an explore feed, and an OTC desk.

Status: step 1 of 6 (research and plan) is done. Step 2, the homepage, is waiting on the
media in `brand/`. No application code yet. See `docs/PLAN.md`.

## Read first

- `docs/RESEARCH.md`: what a Ring hides and what stays public, costs, what is alpha, and what
  each requested feature can and cannot do. **Every privacy claim in the product must match
  section 1 of that file.** If the docs change, update the file first, then the product.
- `docs/PLAN.md`: scope, order of work, open decisions.

## Hard rules

- Devnet or a local validator only. Never deploy to mainnet, never read, create or handle a
  mainnet key, never point a default RPC at mainnet, unless the owner asks in so many words.
- No token. Ask the owner before adding one.
- No fake stats, testimonials, partners, audit badges or "first ever" claims. Numbers on the
  site come from the chain or are not shown. Alpha technology is labelled alpha.
- The project is independent of Helius, pump.fun, rings.run, hushrings.app and
  mazerealestate.fun, and says so in the footer. Take inspiration from the references; copy
  none of their text, code, images, names or logos. The style screenshots in `brand/` (a
  jacket product site and a GTA fan site) give approach and mood only.
- No real names or personal details anywhere. Invented names only in demos and tests.
- Secrets (the Helius API key above all) never go in the repo, in `NEXT_PUBLIC_*` variables
  or in client bundles. The browser reaches Helius through our own proxy route.
- Every flow has a test. A flow that touches the chain also has a devnet test, skipped
  unless `DEVNET_RPC_URL` is set.
- Stop at the end of each step in `docs/PLAN.md` and show the owner before going on.

## Privacy copy

One table in code (`lib/visibility.ts`, to be written) is the single source for what each
action reveals. The pre-signature privacy panel, the docs page and the homepage section all
render from it, and a test fails if a page states a claim the table does not contain.

Words to avoid because the Default Ring does not deliver them: "anonymous", "untraceable",
"hidden wallet", "private launch", "nobody can see". Say what is true: amounts and the
asset of a transfer between Ring balances are encrypted; the two addresses are public.

## Site style

- Pure black page, white text only. All colour comes from the media in `brand/`.
- One typeface for everything: an open-licence pixel / dot-matrix display font, self-hosted,
  all caps, wide tracking. No second font. Exception that is not a style choice: wallet and
  coin addresses are case-sensitive, so they are never upper-cased, only set in the same font.
- Square corners. 1px white outlines. No fills except black.
- Hero: `brand/hero.png` on the right, a three-line headline on the left, one outlined
  button. Nothing else.
- How it works: `brand/layers.png` with five numbered callouts (01 to 05) in 1px outlined
  boxes, each joined to its layer by a thin line. Layers, top to bottom: your wallet, the
  coin, the amount, the Ring (sealed), the public chain.
- Scroll: `brand/hero.mp4` played frame by frame against scroll position. Text changes
  with a brief glitch (two offset copies, about 150 ms). With reduced motion: stills only.
- Phone: object on top, text below, callouts become a numbered list under the image.
- Logo: a clean SVG redrawn from `brand/logo.png`. Link previews use `brand/banner.png`.
- Media is compressed, lazy-loaded below the fold, and first load stays fast.

Never use: gradients, icon libraries (draw the few icons needed as pixel glyphs), em
dashes, Inter / Geist / Space Grotesk, coloured left stripes, bento grids, cards with soft
corners, terminal windows, "it's not X, it's Y" copy, checkmark bullets, pricing tiers,
purple and black, skeleton loaders, radial orbs, background grids, sparkle icons, animated
arrows, hover animations, neon or pastel colours.

`brand/README.md` lists the media files the site expects and their exact specifications.

## Stack (planned)

Next.js App Router, React, TypeScript. `@heliuslabs/spr` with `@solana/kit` for Rings,
`@pump-fun/pump-sdk` for the curve, Wallet Standard for wallets. Vitest for tests.
Commands will be listed here once the project is scaffolded in step 2.
