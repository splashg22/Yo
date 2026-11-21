# [NAME] (working folder: ring-launchpad)

A private launchpad and trading suite on Helius Privacy Rings: launch a coin on a pump.fun
bonding curve and register it with a Ring, a Ring wallet, an explore feed, and an OTC desk.

Status: step 1 of 5 (research and plan). No application code yet. See `docs/PLAN.md`.

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
  none of their text, code, images, names or logos. The branding reference is a GTA fan
  site: use none of its game imagery, names or logos.
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

Mood from the branding reference: very dark wine ground, rose-white text, light-weight
large headings with tight tracking, generous spacing, small type for labels.

Never use: harsh gradients, Lucide icons, em dashes, Inter / Geist / Space Grotesk,
coloured left stripes, bento grids, terminal windows, "it's not X, it's Y" copy, checkmark
bullets, pricing tiers, purple and black, skeleton loaders, radial orbs, dot grids, sparkle
icons, animated arrows, hover animations, neon or pastel colours, soft corner radius.

The hero shows the real product working, not an illustration.

## Stack (planned)

Next.js App Router, React, TypeScript. `@heliuslabs/spr` with `@solana/kit` for Rings,
`@pump-fun/pump-sdk` for the curve, Wallet Standard for wallets. Vitest for tests.
Commands will be listed here once the project is scaffolded in step 2.
