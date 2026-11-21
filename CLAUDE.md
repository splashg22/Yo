# RINGPAD

A private launchpad and trading suite on Helius Privacy Rings: launch a coin on a pump.fun
bonding curve and register it with a Ring, a Ring wallet, an explore feed, and an OTC desk.

Status: steps 1 to 5 of 6 are done **on a local validator**. Every flow works end to end
there and is tested. What remains is the devnet pass (replacing the mock Ring ledger with
the real SDK, which needs `HELIUS_API_KEY`), the real brand media, and a lawyer's read of
Terms and Privacy Policy. See `DECISIONS.md` for every call made without asking.

The name is a working name. It is written once, in `site.config.ts`. The accent colour is
written once, as `--accent` in `app/globals.css`. Tests fail if either is spelled anywhere
else in the site's code.

All media in `brand/` is a stand-in drawn in code. See `brand/README.md`.

## Read first

- `docs/RESEARCH.md`: what a Ring hides and what stays public, costs, what is alpha, and what
  each requested feature can and cannot do. **Every privacy claim in the product must match
  section 1 of that file.** If the docs change, update the file first, then the product.
- `docs/PLAN.md`: scope, order of work, open decisions.

## Hard rules

- Devnet or a local validator only. Never deploy to mainnet, never read, create or handle a
  mainnet key, never point a default RPC at mainnet, unless the owner asks in so many words.
- Never push this project to a public repository. It lives in its own repository and must
  end up private.
- Never build custody of user funds without asking the owner. The one exception is the
  mock Ring's escrow, which `assertLocalOnly` locks to a local validator. Do not lift it.
- Only stop for: money, keys, mainnet, custody of user funds, or a choice that cannot be
  reversed. Otherwise make the sensible call, add a row to `DECISIONS.md`, and keep going.
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

## Privacy copy

One table in code (`lib/visibility.ts`) is the single source for what each
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

## Stack and commands

Next.js App Router, React, TypeScript, Vitest, Playwright for the browser run. No UI
library, no icon library. `@pump-fun/pump-sdk` for the curve, `@heliuslabs/spr` for the
Ring's instructions, `@solana/web3.js` for transactions, noble for keys and encryption.

```bash
npm install
npm run local:fetch  # once: copies pump.fun and the Rings programs from devnet into local/accounts
npm run local        # the local validator (needs the Solana tools; SOLANA_BIN if not in /opt/solana/bin)
npm run dev          # http://localhost:3000

npm test             # 45 tests. Starts the validator itself if it is not running
npm run typecheck
npm run build && npm run start -- -p 3311 &
npm run e2e          # 12 browser steps through the real pages, as two people
npm run shots        # screenshots of every page into shots/, with checks

npm run media        # after changing anything in brand/
npm run standins     # redraws the stand-in media. Do NOT run once real media is in brand/
```

The pump SDK loads only as CommonJS (a dependency of it breaks under ES modules), so it is
loaded with `createRequire` and only ever on the server. Node's `fetch` ignores the proxy
in some sandboxes: set `NODE_USE_ENV_PROXY=1` for `local:fetch` if it cannot reach devnet.

## Where things are

```
site.config.ts             the name, the five layer callouts and their positions, the nav
lib/visibility.ts          the one table of what each action reveals and encrypts
lib/server/chain.ts        builds transactions (real pump.fun, real Ring registration), reads the curve
lib/server/ring.ts         MOCK Ring ledger for the local validator
lib/server/handlers.ts     every server operation as a plain function; app/api/[...op] calls these
lib/server/env.ts          settings, and assertLocalOnly, the guard on the mock's escrow
lib/auth.ts                wallet-signed requests
lib/backup.ts              no-wallet mode: the encrypted backup
lib/paylink.ts             pay links
components/Wallet.tsx      the shared wallet: browser key or a Wallet Standard extension
components/pages/          the working pages: wallet, launch, explore, coin, OTC, pay
components/Background.tsx  the site-wide background
components/Sequence.tsx    the pinned homepage hero
scripts/                   local validator set-up, probes, media, screenshots, the browser run
test/flows.test.ts         every flow on the local validator
test/site.test.ts          claims, single-source name and colour, media, structure
local/clone.json           which devnet accounts the local validator copies
brand/                     source media (stand-ins), prompts for the real renders
shots/                     screenshots; shots/app/ is the browser run
```

## How the chain side fits together

- The browser asks the server to build a transaction, signs it, and hands it back to be
  submitted. The server never sees a user key; the browser never sees an RPC URL.
- A launch is one transaction: pump.fun `create_v2` (plus a first buy), then the Ring's
  own "create SPL interface" instruction, which is what registers the coin. With a first
  buy it only fits through the lookup table that `bootstrap()` creates.
- The Ring ledger is credited from the chain (`escrowReceipts`), never from a client's word.
- Anything that reads or moves a Ring balance is a signed request (`lib/auth.ts`).
- The devnet pass replaces `lib/server/ring.ts` and the deposit and withdrawal builders in
  `chain.ts` with the real SDK. Handlers, pages and tests keep their shape.

## How the background and the media fit together

- The background canvas is fixed behind everything (`z-index: -1`) and never takes clicks.
- Its "walls" are the columns the text sits in, plus the header band. Rings are clipped
  out of them, so text on desktop always has plain black behind it. On phones, where text
  spans the width, only faint rings are drawn and no moving blocks.
- `build-media` turns the media's black into transparency, so the rings pass behind the
  object instead of across it. This is why the source media must be on true #000000.
- Each route has its own position in the scene (`VIEWS` in `Background.tsx`); navigating
  eases the view there. A new page needs an entry, or it falls back to the Terms view.
- Reduced motion: the background draws one still frame and the pinned sequence is
  replaced by two plain sections (`StillStory`), by CSS alone.
