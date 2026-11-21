# RINGPAD (working folder: ring-launchpad)

A private launchpad and trading suite on Helius Privacy Rings: launch a coin on a pump.fun
bonding curve and register it with a Ring, a Ring wallet, an explore feed, and an OTC desk.

Status: steps 1 and 2 of 6 are done (research and plan; the homepage with the scroll
sequence and the site-wide background). The app pages exist as honest shells: they say
"not open yet" and move no funds. Step 3 (devnet flows) is next. See `docs/PLAN.md`.

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

## Stack and commands

Next.js App Router, React, TypeScript, Vitest. No UI library, no icon library.
Planned for step 3: `@heliuslabs/spr` with `@solana/kit` for Rings, `@pump-fun/pump-sdk`
for the curve, Wallet Standard for wallets.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 15 tests: claims, single-source name and colour, media, structure
npm run typecheck
npm run build

npm run media        # after changing anything in brand/: frames, sized stills, link preview
npm run standins     # redraws the stand-in media. Do NOT run once real media is in brand/
npm run start -- -p 3311 & npm run shots   # screenshots of every page into shots/, with checks
```

## Where things are

```
site.config.ts            the name, the five layer callouts and their positions, the nav
lib/visibility.ts         the one table of what each action reveals and encrypts
app/globals.css           every style; --accent is the one colour
components/Background.tsx the site-wide background (rings passing behind walls)
components/Sequence.tsx   the pinned hero: frames of hero.mp4 driven by scroll
components/Callouts.tsx   the five callouts, as boxes with lines and as a list
scripts/build-media.mjs   brand/ -> public/media (keys black to transparent, cuts frames)
scripts/make-standins.mjs draws the stand-in media with a ray-marching shader
scripts/screenshots.mjs   every page at two widths, overflow and legibility checks
brand/                    source media, prompts for the real renders, what must match
shots/                    the latest screenshots and report.json
prototypes/background/    the three background concepts; "Passing" was built
```

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
