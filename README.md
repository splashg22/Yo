# DA City strategy bot

A small Node/TypeScript bot for a pump.fun coin paired with TTWO (tokenized
Take-Two stock). The coin earns creator fees in TTWO. Each cycle the bot:

1. **Claims** the creator fees (TTWO) into the treasury wallet.
2. **Splits** them three ways: 40% / 20% / 40% by default.
3. **Buys and burns DCTY** with the first share.
4. **Buys back and burns the coin itself** with the second share.
5. **Pays the third share in TTWO** to holders above a minimum balance, in
   proportion to what they hold.

Three tokens are involved, set in `.env`:

| Setting         | What it is                                               |
| --------------- | -------------------------------------------------------- |
| `STRATEGY_MINT` | Your pump.fun coin. Its creator fees fund everything; it is also what gets bought back. |
| `BURN_MINT`     | The coin that is bought and burned (DCTY).               |
| `HOLDER_MINT`   | Whose holders get the TTWO. Empty = holders of your coin. |

The split is `BURN_SHARE_PERCENT`, `BUYBACK_SHARE_PERCENT` and
`HOLDER_SHARE_PERCENT` (whole numbers adding up to 100; default 40/20/40).

TTWO itself is read from the chain (it is whatever `STRATEGY_MINT` is paired
with); set `EXPECTED_QUOTE_MINT` to have the bot refuse anything else.

## Setup

Do this on the always-on machine that will run the bot.

```bash
npm install
npm test                # 98 tests
npm run typecheck
npm run setup:wallet    # creates the treasury wallet OUTSIDE this folder, prints its address
```

Fund that address with SOL and launch the coin on pump.fun **from that
wallet** (TTWO pair, **Creator Fee**, not Holder Rewards). Then:

```bash
npm run setup:env       # asks for the RPC URL, your coin's address and the minimum hold
npm run status
npm run cycle           # dry run
```

`setup:wallet` uses `solana-keygen`, which shows a seed phrase once: write it
on paper. The scripts never read or print the private key. `.env` is created
with `DRY_RUN=true` and is ignored by git.

## Commands

| Command                  | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run status`         | Read-only: balances, fees waiting, the books, and a books check. |
| `npm run cycle`          | One cycle. With `DRY_RUN=true` it only simulates.                |
| `npm run verify [cycle]` | Re-checks every transaction of a cycle (default: the latest) on-chain and compares the amounts with the ledger. |
| `npm run loop`           | A cycle every `LOOP_INTERVAL_SECONDS`, until stopped.            |
| `npm run holders`        | Read-only preview of who qualifies and what each would receive; writes `data/holders.csv`. |
| `npm run report`         | Builds a public stats page (`data/report.html`) and `data/summary.json` from the ledger. |

A dry run sends nothing and writes nothing. It reports what a live cycle
would do and four checks: (a) a TTWO → DCTY swap route exists, (a2) a TTWO →
your coin route exists for the buyback, (b) a TTWO payout to a wallet
simulates, (c) the holder snapshot works on your RPC. The swaps can only be
simulated once the treasury holds some TTWO.

The bot is live only when `DRY_RUN` is exactly `false`.

## Going live

1. Set `DRY_RUN=false` and a small `MAX_SWAP_TTWO_PER_CYCLE` in `.env`.
2. `npm run cycle`, then `npm run verify`. Do nothing else until every
   transaction checks out.
3. Keep it running with **one** of:
   - pm2: `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`
   - systemd: see the comments in `deploy/dacity-bot.service`
4. Back up the books hourly: add `deploy/backup.sh` to cron (see the comments
   in the file) and point it at a disk that is not this machine's.

Both service configs restart the bot after a crash, but **not** after exit
code 2, which means the books and the treasury disagree and a person must look.

## The rules

- **Split:** `BURN_SHARE_PERCENT` to buy+burn DCTY, `BUYBACK_SHARE_PERCENT` to
  buy back+burn your coin, `HOLDER_SHARE_PERCENT` to holders (default
  40/20/40). Rounding dust, at most two base units, goes to the DCTY burn.
- **Buyback:** your coin is bought on its own bonding curve or pump pool with
  TTWO and burned in the next transaction. A buyback is itself a trade, so it
  earns the treasury a small creator fee back, which the next claim picks up.
- **Who qualifies:** wallets holding at least `MIN_HOLD` of `HOLDER_MINT`.
  Never paid: the treasury itself, `EXCLUDE_WALLETS`, and (by default)
  program-owned addresses such as the bonding curve and pools.
- **How much:** proportional to balance, rounded down. Rounding dust stays in
  the pool for the next cycle.
- **Swap cap:** at most `MAX_SWAP_TTWO_PER_CYCLE` goes into each swap (the
  DCTY buy and the buyback separately) per cycle; the rest waits.
- **Only its own money:** the bot spends only TTWO it claimed and burns only
  the DCTY and the coin it bought. Anything else in the treasury, including
  any of your coin you hold there yourself, is left alone.

These live in `src/split.ts`. Paying a holder who has never held TTWO costs
the treasury about 0.002 SOL of account rent, once per holder;
`MIN_PAYOUT_TTWO` holds back shares too small to be worth it.

## Extras

- **Low-SOL guard.** A live cycle is skipped, and nothing is sent, while the
  treasury has less than `MIN_SOL_BALANCE` (default 0.05 SOL).
- **Alerts.** Set `DISCORD_WEBHOOK_URL` and/or `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID` and the loop posts a short message after every cycle that
  moved money, and when something goes wrong (the same error is sent once, not
  every cycle). A failed alert never affects a cycle.
- **Public stats page.** `data/report.html` is one self-contained file (totals
  burned and paid, recent transactions with explorer links, top recipients).
  The loop refreshes it after every live cycle; host it anywhere static.

## The swap

`SWAP_VENUE=auto` uses pump's own router when the target coin can be bought
directly with TTWO, and otherwise Jupiter (which can go TTWO → SOL → DCTY).
Your own coin is always a direct pump route, since TTWO is its pair. Jupiter builds
the transaction, so before signing it the bot checks that the treasury is the
only payer and signer, and simulates it to confirm it takes no more than the
intended TTWO, delivers at least the quoted minimum of DCTY, and costs no more
than `MAX_SWAP_SOL_COST` in SOL. Whatever DCTY actually arrives is what gets
burned, in a separate transaction right after.

## The books

- `data/state.json` — what the bot is holding and for what purpose. **Never
  edit it by hand.** It is written before every transaction is broadcast, so a
  crash or restart picks up exactly where it stopped and nothing is claimed,
  burned or paid twice. The previous version is kept as `state.json.bak`.
- `data/ledger.jsonl` — public, append-only record: every claim, swap, burn,
  buyback and payout with its transaction signature.

At the start of every live cycle the books are compared with the treasury. If
the treasury holds **less** than the books account for, the bot stops and
sends nothing. That means funds left the wallet some other way or the books
are wrong; find out which before restarting.

Back up `data/` regularly.

## Public proof page

`web/` is a one-page site, in DacityCoin's colours, that proves the strategy
to holders. It runs entirely in the visitor's browser and reads the Solana
blockchain directly through a key-free public RPC, so nothing on it has to be
taken on trust:

- live treasury balances and the current DCTY supply;
- every transaction of the treasury, classified from its on-chain contents as
  a claim, a DCTY buy, a buyback of the coin, a burn of either, or a holder
  payout, with a Solscan link each;
- a **Check your wallet** box: balance, whether the wallet qualifies, and every
  TTWO payout it has received;
- a cross-check of the bot's published ledger against the chain, so visitors
  can see the books are honest.

Publish it:

```bash
npm run web            # writes web/config.json and copies the ledger next to the page
npm run web:publish    # pushes web/ to the gh-pages branch, which GitHub Pages serves
```

`config.json` holds public facts only (addresses, the minimum hold, a public
RPC). `PUBLIC_RPC_URL` in `.env` must be a key-free endpoint; the default
PublicNode one works from browsers. Set `REPO_URL` to show a source link in
the footer and `HOLDER_SYMBOL` to name your coin. Without `config.json` the
page shows a "launching soon" state and no numbers.

`deploy/publish-web.sh` copies only `web/` into a commit on the `gh-pages`
branch and pushes it; nothing else in the repository (never `.env`, keys or
`data/`) goes there. Turn the site on once with **Settings → Pages → Deploy
from a branch → `gh-pages` / root**; after that every `npm run web:publish`
updates it within a minute. Run `npm run web && npm run web:publish` after
live cycles so the ledger cross-check stays current; the chain data on the
page is always live regardless.

## Layout

```
src/split.ts    the money rules (pure)
src/state.ts    the books
src/cycle.ts    one cycle, live or dry; crash recovery
src/chain.ts    Solana + pump SDK calls
src/jupiter.ts  Jupiter swap + the checks before signing
src/holders.ts  holder snapshot
src/notify.ts   Discord / Telegram alerts
src/report.ts   public stats page
src/cli.ts      status | cycle | loop | verify | holders | report
scripts/        guided setup (wallet, .env) and the proof-page publisher
web/            the public proof page (static)
deploy/         pm2 + systemd configs, backup script
```

## What has been proven on mainnet

On 2026-11-19 the chain layer was run read-only against mainnet with
DacityCoin standing in as the strategy coin (it is a live pump.fun coin paired
with TTWO):

- `npm run status` and the dry run complete: pair detection, stage, creator
  check, Holder Rewards warning, books check.
- Check (a): pump's own router resolves TTWO -> DCTY directly on the pump pool,
  so `SWAP_VENUE=auto` never needs Jupiter. A 1 TTWO swap simulated
  successfully. Jupiter's `swap/v1` still answers without a key as a fallback.
- Check (b): a TTWO `transferChecked` to a brand-new wallet (with the
  associated-account create) simulated successfully, alone and five per
  transaction. TTWO is Token-2022 with no transfer fee, no active transfer
  hook, new accounts unfrozen and the mint not paused.
- Claim: the sweep and collect instructions build for a real creator.
- Check (c) depends on the RPC: free public RPCs refuse `getProgramAccounts`.

Still untested until the bot has its own fees: a real claim, a real swap, a
real payout, and `verify`. The first live cycle, with a small
`MAX_SWAP_TTWO_PER_CYCLE`, is that test.
