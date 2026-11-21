# RINGPAD

A launchpad and trading suite on Helius Privacy Rings: launch a coin on a pump.fun bonding
curve and register it with a Ring in one signature, a Ring wallet, an explore feed, an OTC
desk and pay links.

Status: a pre-release that runs on a **local validator** only. pump.fun and the Privacy
Rings program are the real programs, copied from devnet. **Ring balances are a mock**: a
ledger on the server with an escrow wallet, locked to the local validator. Devnet is not
wired up. `TEST-REPORT.md` says what is proven and what is not; `DECISIONS.md` lists the
calls made; `README.md` has the commands.

The name is written once, in `site.config.ts`. The accent colour is written once, as
`--accent` in `app/globals.css`. Tests fail if either is spelled anywhere else in the code.
All media in `brand/` is a stand-in drawn in code. See `brand/README.md`.

## Hard rules

- Local validator or devnet only. Never deploy to mainnet, never read, create or handle a
  mainnet key, never point a default RPC at mainnet, unless the owner asks in so many words.
- No custody of user funds beyond the local mock. The mock refuses to run off a local
  validator (`assertLocalOnly`). Do not loosen that without the owner asking.
- No token. Ask the owner before adding one.
- No fake stats, testimonials, partners, audit badges or "first ever" claims. Numbers on the
  site come from the chain or are not shown. Alpha technology is labelled alpha. Mocks and
  stand-ins are never presented as live.
- Independent of Helius, pump.fun, rings.run, hushrings.app and mazerealestate.fun, and the
  footer says so. Copy none of their text, code, images, names or logos.
- No real names or personal details anywhere. Invented names only in demos and tests.
- Secrets never go in the repo, in `NEXT_PUBLIC_*` variables or in client code.
  `npm run scan` checks what is served and the git history.
- Only stop for the owner on: money, keys, mainnet, custody of user funds, or a choice that
  cannot be reversed. Otherwise make the sensible call and add a row to `DECISIONS.md`.

## Switches

Anything that changes what the product is sits behind one setting with a safe default, and
`npm run doctor` reports them: `RING_NETWORK`, `DATABASE_URL`, `PINATA_JWT`,
`PREVIEW_PASSWORD`, `FEATURE_SEALED_WINDOW`. A path that has only been run against a
stand-in is marked "not verified" in the code, in `README.md` and in `TEST-REPORT.md`, and
stays marked until it has run against the real service.

With Postgres, `save()` only queues the write. Await `durable()` before anything that
cannot be undone (a payout); `run()` awaits it before every answer.

## Money rules

- An amount is a whole number of base units: `bigint` in code, a decimal string on the
  wire. Never a JavaScript number, never a float. Prices are micro-lamports per coin;
  change is basis points; share is parts per million.
- `lib/format.ts` is the only place text becomes an amount or an amount becomes text.
- The server builds transactions, the browser signs, the server submits **and settles**.
  A deposit is credited from what the chain shows escrow received, by signature, once.
- A withdrawal ends as landed, not sent, or unknown. Unknown is held as pending and
  resolved from the chain; it is never refunded on a guess.
- For every coin, escrow on the chain must hold exactly what the ledger owes (for SOL, at
  least that much). Flow tests assert it after every test; the status page shows it.
- Every bug fixed gets a test that fails without the fix. Never weaken, skip or delete a
  test to make it pass.

## Privacy copy

`lib/visibility.ts` is the single table of what each action makes public and what a Ring
encrypts. The privacy panel shown before each signature, the docs page and the homepage
table all render from it, and `test/unit/site.test.ts` fails on forbidden claims.

Words to avoid because the Default Ring does not deliver them: "anonymous", "untraceable",
"hidden wallet", "private launch", "nobody can see". Both wallet addresses of every transfer
are public. In this build, say "not published" rather than "encrypted" for anything the
mock does, because the mock's server can read it.

## Site style

- Pure black page, white text only. All colour comes from the media in `brand/`.
- One typeface for everything: an open-licence pixel / dot-matrix display font, self-hosted,
  all caps, wide tracking. No second font. Exception that is not a style choice: wallet and
  coin addresses are case-sensitive, so they are never upper-cased, only set in the same font.
- Square corners. 1px white outlines. No fills except black.
- Hero: `brand/hero.png` on the right, a three-line headline on the left, one outlined
  button. Nothing else.
- Every page has every state designed: loading, empty, error, offline, success. Nothing
  that arrives late may move what is already on screen (`npm run motion` and `measure`).
- On phones every stand-alone control is at least 44px tall.
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

Next.js App Router, React, strict TypeScript, Vitest, ESLint with type-aware rules and zero
warnings, Prettier. No UI library, no icon library. `README.md` lists every dependency and why.

```bash
npm run check        # typecheck, lint, format check, all tests. Run before every commit.
npm run test:site    # unit tests, no chain
npm run test:flows   # flow tests on the local validator (started if not running)
npm run e2e          # browser: every flow, against a built site on port 4711 and a FRESH validator
npm run crawl        # browser: every page, every control
npm run break        # browser: bad input, double clicks, declined signature, dead chain
npm run motion       # browser: the scroll sequence and background under hard conditions
npm run scan         # secrets in served files and git history
npm run window       # browser: the sealed launch window with its flag on
npm run test:flows:pg  # the flow tests with the state in a real local Postgres
npm run doctor       # what is ready, what is missing; prints no secret
npm run measure      # page weight, load time, layout shift
npm run media        # after changing anything in brand/: frames, sized stills, link preview
npm run standins     # redraws the stand-in media. Do NOT run once real media is in brand/
```

The built server and the tests load some code differently (the pump SDK is CommonJS). A
bug can pass the flow tests and fail in the built site, so the browser scripts are part of
"done", and `e2e` must start from a fresh validator and an empty `.data/`.

In this container: Node's `fetch` needs `NODE_USE_ENV_PROXY=1` to reach the internet
(`npm run local:fetch`), and a running site is stopped with `pkill -f next-server`.

## Where things are

```
site.config.ts                 the name, the five layer callouts, the navigation
app/                           one folder per route; app/api/[...op]/route.ts is the only server route
app/globals.css                every style; --accent is the one colour
lib/contract.ts                every server operation, typed: inputs, outputs, signed or open
lib/format.ts                  text <-> amounts, prices, times
lib/sign.ts, keys.ts, auth.ts  signing transactions and requests without web3.js in the browser
lib/backup.ts                  the password-encrypted wallet backup
lib/paylink.ts                 pay links
lib/visibility.ts              the one table of what each action reveals
lib/sdk.ts                     RingClient: the same operations for scripts and tests
lib/client/api.ts              the browser's typed calls to the server
lib/server/env.ts              all configuration
lib/server/validate.ts         every input check
lib/server/solana.ts           the connection, time limits, turning chain errors into one sentence
lib/server/pump.ts             pump.fun instructions and curve reads
lib/server/transactions.ts     building unsigned transactions; submitting signed ones
lib/server/escrow.ts           MOCK: the escrow wallet behind Ring balances
lib/server/ring.ts             MOCK: the Ring ledger
lib/server/settle.ts           crediting what the chain shows; reconciling
lib/server/bootstrap.ts        one-off set-up of a fresh local chain; the faucet; the lookup table
lib/server/database.ts         Postgres as the state store (DATABASE_URL): one writer, versioned writes
lib/server/windows.ts          the sealed launch window (FEATURE_SEALED_WINDOW): pools funds, off by default
lib/server/pictures.ts         coin pictures: cleaned on upload, kept on disk or on IPFS (PINATA_JWT)
lib/server/opskey.ts           the devnet-only operator key that pays for the lookup table
lib/server/limit.ts            requests per address per minute
lib/notes.ts                   notes sealed in the browser with libsodium
lib/linkability.ts             warnings before a withdrawal that is easy to link to a deposit
proxy.ts                       the private-preview password (PREVIEW_PASSWORD)
app/health, app/u/[name]       the health check; stored pictures served by hash name only
lib/server/operations/         the operations, grouped: market, ring, otc, system
components/pages/              one component per app page
components/ui/                 shared pieces: confirm step, status line, address, lists
components/wallet/             the in-browser wallet and wallet extensions
components/Sequence.tsx        the pinned hero driven by scroll
components/Background.tsx      the site-wide background
test/unit/, test/flows/        tests without and with the chain
scripts/                       the validator, media builders, and the browser checks
examples/                      the SDK example
brand/                         source media, prompts for the real renders
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
- The header and the build notice are one of the walls. On the homepage the header lies
  over the hero (`.shell:has(.seq) .masthead`), so nothing depends on the header's height.
- On phones the five callouts are a list after the sequence (`.how-list`), not inside the
  pinned stage: they do not fit under the object on a short screen.
- Reduced motion: the background draws one still frame and the pinned sequence is
  replaced by two plain sections (`StillStory`), by CSS alone.
