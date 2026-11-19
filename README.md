# DA City strategy bot

A small Node/TypeScript bot for a pump.fun coin paired with TTWO (tokenized
Take-Two stock). The coin earns creator fees in TTWO. Each cycle the bot:

1. **Claims** the creator fees (TTWO) into the treasury wallet.
2. **Splits** them 50/50.
3. **Buys and burns DCTY** with one half (through pump's own swap route).
4. **Pays the other half in TTWO** to holders above a minimum balance, in
   proportion to what they hold.

Three tokens are involved, set in `.env`:

| Setting         | What it is                                               |
| --------------- | -------------------------------------------------------- |
| `STRATEGY_MINT` | Your pump.fun coin. Its creator fees fund everything.    |
| `BURN_MINT`     | The coin that is bought and burned (DCTY).               |
| `HOLDER_MINT`   | The coin whose holders receive the TTWO rewards.         |

TTWO itself is read from the chain (it is whatever `STRATEGY_MINT` is paired
with); set `EXPECTED_QUOTE_MINT` to have the bot refuse anything else.

## Setup

```bash
npm install
npm test            # 38 tests
npm run typecheck
cp .env.example .env    # then fill it in; DRY_RUN stays true
```

The treasury wallet must be the wallet that **created** the coin on pump.fun
(TTWO pair, **Creator Fee**, not Holder Rewards). Keep its key file outside
this folder; the bot refuses a key path inside it.

## Commands

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `npm run status` | Read-only: balances, fees waiting, the books, and a books check. |
| `npm run cycle`  | One cycle. With `DRY_RUN=true` it only simulates.               |
| `npm run loop`   | A cycle every `LOOP_INTERVAL_SECONDS`, until stopped.           |

A dry run sends nothing and writes nothing. It reports what a live cycle
would do and three checks: (a) pump resolves a TTWO → DCTY route, (b) a TTWO
payout to a wallet simulates, (c) the holder snapshot works on your RPC.
The swap can only be simulated once the treasury holds some TTWO.

The bot is live only when `DRY_RUN` is exactly `false`.

## The rules

- **Split:** half to buy+burn, half to holders. An odd base unit goes to the burn.
- **Who qualifies:** wallets holding at least `MIN_HOLD` of `HOLDER_MINT`.
  Never paid: the treasury itself, `EXCLUDE_WALLETS`, and (by default)
  program-owned addresses such as the bonding curve and pools.
- **How much:** proportional to balance, rounded down. Rounding dust stays in
  the pool for the next cycle.
- **Swap cap:** at most `MAX_SWAP_TTWO_PER_CYCLE` is swapped per cycle; the
  rest of the burn half waits.
- **Only its own money:** the bot spends only TTWO it claimed and burns only
  DCTY it bought. Anything else in the treasury is left alone.

These live in `src/split.ts`. Paying a holder who has never held TTWO costs
the treasury about 0.002 SOL of account rent, once per holder;
`MIN_PAYOUT_TTWO` holds back shares too small to be worth it.

## The books

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

## Layout

```
src/split.ts    the money rules (pure)
src/state.ts    the books
src/cycle.ts    one cycle, live or dry; crash recovery
src/chain.ts    Solana + pump SDK calls
src/holders.ts  holder snapshot
src/cli.ts      status | cycle | loop
```

## Not yet proven

The on-chain layer (`src/chain.ts`, `src/holders.ts`) is written against
`@pump-fun/pump-sdk` 4.3.1 and its instructions assemble, but it has **never
been run against mainnet**. The first dry run is the test. The tests cover the
rules, the books and the cycle logic against a simulated chain.
