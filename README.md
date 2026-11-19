# Strategy-coin bot: DA City and LLM Launchpad

A small Node/TypeScript bot for pump.fun coins that are paired with a
tokenized stock. Such a coin earns its creator fees in that stock. Each cycle
the bot:

1. **Claims** the creator fees (stock tokens) into the treasury wallet.
2. **Splits** them 50/50.
3. **Buys and burns** a coin with one half.
4. **Pays the other half, in the stock,** to holders above a minimum balance,
   in proportion to what they hold.

Two coins are set up. Each is a small file in `brands/` (names and tickers
only, nothing secret) plus its own settings file, treasury wallet, books and
proof page:

| Coin              | Paired with                          | Buys and burns     | Settings   | Books       | Proof page  |
| ----------------- | ------------------------------------ | ------------------ | ---------- | ----------- | ----------- |
| **DA City** (`dacity`, the default) | TTWO, tokenized Take-Two stock | DCTY (DacityCoin) | `.env`     | `data/`     | `web/`      |
| **LLM Launchpad** (`llm`) | ANT, tokenized Anthropic stock | LLM, the coin itself | `.env.llm` | `data/llm/` | `web/llm/`  |

Every command takes the coin's name as its last word: `npm run status` is
DA City, `npm run status llm` is LLM Launchpad. The examples below show both
where it matters. To add another coin, copy a file in `brands/`.

Three tokens are involved per coin, set in its settings file:

| Setting         | What it is                                               |
| --------------- | -------------------------------------------------------- |
| `STRATEGY_MINT` | Your pump.fun coin. Its creator fees fund everything.    |
| `BURN_MINT`     | The coin that is bought and burned. Empty = the brand's choice (DCTY for DA City; LLM Launchpad buys itself back). |
| `HOLDER_MINT`   | Whose holders get the stock. Empty = holders of your coin. |

The stock token itself is read from the chain (it is whatever `STRATEGY_MINT`
is paired with); set `EXPECTED_QUOTE_MINT` to have the bot refuse anything else.

## LLM Launchpad and Anthropic stock

Anthropic began trading on Nasdaq as ANT on 2026-11-19, and tokenized versions
appeared on Solana the same day from more than one issuer (Backpack Securities
with Sunrise as ANT, xStocks as ANTx, and Securitize). They are different
tokens with different mint addresses, issued by third parties and not by
Anthropic.

- Launch the coin on pump.fun **from the LLM treasury wallet**, with the
  Anthropic stock token as the pair and **Creator Fee** (not Holder Rewards).
  Which Anthropic token pump.fun offers as a pair is pump.fun's choice; the
  bot reads the pair from the chain and works with any of them.
- After launch, `npm run status llm` prints the pair's mint address. Compare it
  with the issuer's published address, then put it in `EXPECTED_QUOTE_MINT` in
  `.env.llm` so the bot refuses to run against anything else.
- If pump.fun's ticker differs from ANT (for example ANTx), set
  `QUOTE_SYMBOL` in `.env.llm`. It only changes what is displayed.
- `MAX_SWAP_PER_CYCLE` is in shares: `1` means at most one share's worth of
  the coin is bought per cycle. Start lower (for example `0.05`).

## Setup

Do this on the always-on machine that will run the bot.

```bash
npm install
npm test                # 103 tests
npm run typecheck
npm run setup:wallet llm   # creates the coin's treasury wallet OUTSIDE this folder, prints its address
```

Fund that address with SOL and launch the coin on pump.fun **from that
wallet** (paired with the stock token, **Creator Fee**, not Holder Rewards).
Then:

```bash
npm run setup:env llm   # asks for the RPC URL, your coin's address and the minimum hold
npm run status llm
npm run cycle llm       # dry run
```

Leave out `llm` for DA City. Each coin gets its own wallet
(`~/.config/dacity-bot/treasury.json`, `treasury-llm.json`): two coins sharing
one wallet would mix their fees.

`setup:wallet` uses `solana-keygen`, which shows a seed phrase once: write it
on paper. The scripts never read or print the private key. The settings file
is created with `DRY_RUN=true` and is ignored by git.

## Commands

Add the coin's name to any of them (`npm run cycle llm`, `npm run verify llm 3`).
A settings file elsewhere can be given with `-- --env=<file>` or `ENV_FILE`.

| Command                  | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run status`         | Read-only: balances, fees waiting, the books, and a books check. |
| `npm run cycle`          | One cycle. With `DRY_RUN=true` it only simulates.                |
| `npm run verify [cycle]` | Re-checks every transaction of a cycle (default: the latest) on-chain and compares the amounts with the ledger. |
| `npm run loop`           | A cycle every `LOOP_INTERVAL_SECONDS`, until stopped.            |
| `npm run holders`        | Read-only preview of who qualifies and what each would receive; writes `data/holders.csv`. |
| `npm run report`         | Builds a public stats page (`data/report.html`) and `data/summary.json` from the ledger. |

A dry run sends nothing and writes nothing. It reports what a live cycle
would do and three checks: (a) a swap route from the stock token to the burn
coin exists, (b) a stock payout to a wallet simulates, (c) the holder snapshot
works on your RPC. The swap can only be simulated once the treasury holds some
of the stock token.

The bot is live only when `DRY_RUN` is exactly `false`.

## Going live

1. Set `DRY_RUN=false` and a small `MAX_SWAP_PER_CYCLE` in the coin's settings file.
2. `npm run cycle llm`, then `npm run verify llm`. Do nothing else until every
   transaction checks out.
3. Keep it running with **one** of:
   - pm2: `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`
     (starts a bot for every coin that has a settings file: `dacity-bot`, `llm-bot`)
   - systemd: see the comments in `deploy/dacity-bot.service`
4. Back up the books hourly: add `deploy/backup.sh` to cron (see the comments
   in the file) and point it at a disk that is not this machine's.

Both service configs restart the bot after a crash, but **not** after exit
code 2, which means the books and the treasury disagree and a person must look.

## The rules

- **Split:** half to buy+burn, half to holders. An odd base unit goes to the burn.
- **Who qualifies:** wallets holding at least `MIN_HOLD` of `HOLDER_MINT`.
  Never paid: the treasury itself, `EXCLUDE_WALLETS`, and (by default)
  program-owned addresses such as the bonding curve and pools.
- **How much:** proportional to balance, rounded down. Rounding dust stays in
  the pool for the next cycle.
- **Swap cap:** at most `MAX_SWAP_PER_CYCLE` is swapped per cycle; the
  rest of the burn half waits.
- **Only its own money:** the bot spends only stock tokens it claimed and
  burns only coins it bought. Anything else in the treasury is left alone,
  including coins the treasury bought itself at launch.

These live in `src/split.ts`. Paying a holder who has never held the stock
token costs the treasury about 0.002 SOL of account rent, once per holder;
`MIN_PAYOUT` holds back shares too small to be worth it.

The amount settings used to carry TTWO in their names
(`MAX_SWAP_TTWO_PER_CYCLE`, `MIN_CLAIM_TTWO`, ...). The old names are still
read, so an existing `.env` keeps working.

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

`SWAP_VENUE=auto` uses pump's own router when the burn coin can be bought
directly with the stock token (always the case when a coin buys itself back),
and otherwise Jupiter (which can go stock → SOL → coin). Jupiter builds the
transaction, so before signing it the bot checks that the treasury is the only
payer and signer, and simulates it to confirm it takes no more than the
intended amount of stock, delivers at least the quoted minimum of the coin,
and costs no more than `MAX_SWAP_SOL_COST` in SOL. Whatever actually arrives
is what gets burned, in a separate transaction right after.

## The books

DA City's are in `data/`, LLM Launchpad's in `data/llm/`.

- `data/state.json` — what the bot is holding and for what purpose. **Never
  edit it by hand.** It is written before every transaction is broadcast, so a
  crash or restart picks up exactly where it stopped and nothing is claimed,
  burned or paid twice. The previous version is kept as `state.json.bak`.
- `data/ledger.jsonl` — public, append-only record: every claim, swap, burn
  and payout with its transaction signature.

At the start of every live cycle the books are compared with the treasury. If
the treasury holds **less** than the books account for, the bot stops and
sends nothing. That means funds left the wallet some other way or the books
are wrong; find out which before restarting.

Back up `data/` regularly.

## Public proof pages

Each coin has a one-page site that proves the strategy to holders: DA City's
at the top of `web/` in DacityCoin's colours, LLM Launchpad's in `web/llm/`
in its own. The page runs entirely in the visitor's browser and reads the
Solana blockchain directly through a key-free public RPC, so nothing on it has
to be taken on trust:

- live treasury balances and the burn coin's current supply;
- every transaction of the treasury, classified from its on-chain contents as
  a claim, a buy, a burn or a holder payout, with a Solscan link each;
- a **Check your wallet** box: balance, whether the wallet qualifies, and every
  stock payout it has received;
- a cross-check of the bot's published ledger against the chain, so visitors
  can see the books are honest.

Publish it:

```bash
npm run web llm        # writes web/llm/config.json and copies the ledger next to the page
npm run web:publish    # pushes web/ (every coin's page) to the gh-pages branch, which GitHub Pages serves
```

`config.json` holds public facts only (addresses, tickers, the minimum hold, a
public RPC). `PUBLIC_RPC_URL` in the settings file must be a key-free
endpoint; the default PublicNode one works from browsers. Set `REPO_URL` to
show a source link in the footer. Without `config.json` a page shows a
"launching soon" state and no numbers, so both pages can be published before
either coin is live.

`web/index.html` is the one page: it is DA City's site as it stands and the
template LLM Launchpad's is made from. After editing it, run
`npm run web:sites` to rebuild `web/llm/index.html` (a test fails if you
forget). A page's words, colours and logo come from its file in `brands/`.

The pages are built from their own component kit in `web/kit/` (`kit.css` and
`kit.js`): tabs, tables, stat cards, badges, alerts, icons, a light / dark
switch. Nothing comes from a UI library or a template, and no web fonts are
loaded. The look is a plain product site: system font, a header with links,
tables for lists, a footer of links. A coin's colour is one line in
`web/index.html`: `:root[data-brand="..."] { --brand: ... }`.

`deploy/publish-web.sh` copies only `web/` into a commit on the `gh-pages`
branch and pushes it; nothing else in the repository (never `.env`, keys or
`data/`) goes there. Turn the site on once with **Settings → Pages → Deploy
from a branch → `gh-pages` / root**; after that every `npm run web:publish`
updates it within a minute; LLM Launchpad's page is then at `/llm/` under the
same address. Run `npm run web llm && npm run web:publish` after
live cycles so the ledger cross-check stays current; the chain data on the
page is always live regardless.

## Layout

```
brands/         one file per coin: names, tickers, default burn coin
src/brand.ts    reads them
src/env.ts      picks the coin's settings file
src/split.ts    the money rules (pure)
src/state.ts    the books
src/cycle.ts    one cycle, live or dry; crash recovery
src/chain.ts    Solana + pump SDK calls
src/jupiter.ts  Jupiter swap + the checks before signing
src/holders.ts  holder snapshot
src/notify.ts   Discord / Telegram alerts
src/report.ts   public stats page
src/cli.ts      status | cycle | loop | verify | holders | report
scripts/        guided setup (wallet, settings) and the proof-page builder
web/            the public proof pages (static): DA City at the top, web/llm/ for LLM Launchpad
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
`MAX_SWAP_PER_CYCLE`, is that test.

Nothing has been run on-chain for LLM Launchpad yet: the coin does not exist
and the Anthropic stock token is a day old. The same checks apply to it,
starting with `npm run status llm` and a dry `npm run cycle llm` once it is
launched. A coin buying itself back uses the same pump route that was
simulated above for DCTY on its pool (DCTY is also paired with its stock
directly). A buy on the bonding curve, before a coin graduates, has not been
simulated yet; the dry run's check (a) will show it.
