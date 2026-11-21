# RINGPAD

A launchpad and trading suite on Solana Privacy Rings. Working name. Independent of
Helius, pump.fun and every other site built on Privacy Rings.

**This is a pre-release. It runs on a local test chain. Ring balances are simulated by a
stand-in on that chain. Nothing here is live, audited, or handles coins of value.**

Read `CLAUDE.md` for how the project is laid out, `docs/RESEARCH.md` for what a Ring
hides and what it does not, `DECISIONS.md` for the calls made along the way, and
`TEST-REPORT.md` for what has been proven and what has not.

## Run it

Needs Node 22.12 or newer and the Solana tools (`solana-test-validator`). If they are not
at `/opt/solana/bin`, set `SOLANA_BIN` to the folder that holds them.

```bash
npm ci
npm run local:fetch     # once, needs network: copies pump.fun and the Rings programs from devnet
npm run local           # the local validator, in its own terminal
npm run dev             # http://localhost:4710
```

Open Ring wallet, make a wallet with a password, press "Get test SOL", then Launch.

Configuration is in one place: environment variables, read by `lib/server/env.ts` and
listed in `.env.example`. The Helius key for the later devnet pass is `HELIUS_API_KEY`
and is only ever read on the server.

## Ports and folders

Everything the launchpad uses is its own, so it can run beside any other project:

| What | Where |
| --- | --- |
| The site in development (`npm run dev`, `npm run start`) | port 4710 |
| The built site the browser checks drive | port 4711 |
| A second site the dead-chain check starts and stops | port 4712 |
| Local validator: RPC, websocket | ports 8799, 8800 (`LOCAL_RPC_PORT`) |
| Local validator: faucet, gossip, its other sockets | ports 9799, 8701, 8710 to 8740 |
| Validator ledger and copied programs | `local/ledger/`, `local/accounts/` in this folder |
| Server state and the mock escrow's local key | `.data/` in this folder (`APP_DATA_DIR`) |

No key, program ID, token mint, package, config or `.env` is shared with any other
project. The local keys are made on first run inside `.data/` and are never committed.

## Check it

```bash
npm run check           # typecheck, lint (zero warnings), format check, then every test
npm run test:site       # 55 unit tests. No chain needed.
npm run test:flows      # 55 flow tests. Starts the local validator if none is running.
```

The browser checks drive the built site. Start from a fresh validator and an empty
`.data/` folder, so that the first launch also proves the local set-up:

```bash
npm run build && npm run start -- -p 4711 &
npm run e2e             # 17 steps as two people: every flow twice and once after a reload,
                        # each balance on screen compared with a direct read of the chain
npm run crawl           # every page, two widths, with and without a wallet: every control clicked
npm run break           # bad input, double clicks, declined signature, reload mid-action, dead chain
npm run motion          # the scroll sequence and background on a slow phone and in odd windows
npm run scan            # looks for secrets in what is served and in the git history
npm run measure         # page weight, load time and layout shift
npm run example         # the SDK example: a launch and a Ring transfer from a script
```

## What is real and what is a stand-in

| Part | Today |
| --- | --- |
| Creating a coin, buying, selling, creator fees | The real pump.fun program, copied from devnet to the local validator |
| Registering a coin with the Ring | The real Privacy Rings program, copied the same way |
| Ring balances: deposit, transfer, withdraw, OTC, pay links | **A mock.** A ledger on this site's server with the Ring's rules for what is public. Deposits and withdrawals really move coins on the local chain, into and out of an escrow wallet. It is not encryption, and it refuses to run anywhere but a local validator |
| The wallet made in the browser | Real. The key is made and encrypted in the browser and is never sent |
| Devnet | Not wired up. Needs `HELIUS_API_KEY` and the real Ring calls in place of the mock |
| Brand media | Stand-ins drawn in code. See `brand/README.md` |

No program of our own is deployed. The project calls pump.fun and Privacy Rings.

## Dependencies

Every version is pinned exactly. Each one, and why it is here:

| Package | Why |
| --- | --- |
| `next`, `react`, `react-dom` | The site and its server routes |
| `@solana/web3.js` | Building and sending transactions on the server; what the pump SDK speaks |
| `@pump-fun/pump-sdk` | pump.fun's own instructions for create, buy, sell and creator fees |
| `@heliuslabs/spr` | Privacy Rings: the instruction that registers a coin with a Ring |
| `@solana/kit` | The address and instruction types `@heliuslabs/spr` uses |
| `@solana/spl-token` | Token account addresses and transfers |
| `bn.js` | The big-number type the pump SDK takes and returns |
| `bs58` | Reading and writing Solana addresses |
| `@noble/curves` | Ed25519 keys and signatures in the browser, without web3.js in the page |
| `@noble/hashes` | scrypt, for turning the wallet password into a key |
| `@noble/ciphers` | AES-GCM, for the encrypted wallet backup |
| `@wallet-standard/app`, `@wallet-standard/base` | Finding and talking to wallet extensions |
| `qrcode` | The QR code of a pay link |

Development only:

| Package | Why |
| --- | --- |
| `typescript` | Held at 5.9: the linter's type-aware rules do not support newer yet |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` | Linting, with type-aware rules |
| `prettier` | Formatting |
| `vitest` | Tests |
| `tsx` | Running TypeScript scripts and the SDK example |
| `sharp` | Building the sized images and sequence frames from `brand/` |
| `@types/*` | Types for Node, React, bn.js and qrcode |

Playwright is not a dependency: the browser scripts use the one installed on the machine.

`npm audit` reports 17 advisories, all inside the Solana and pump.fun SDKs' own
dependency trees (`uuid`, `toml`, `stream-json` and what depends on them). None is in
code this project calls with untrusted input. They are listed in `TEST-REPORT.md`.

## Moving this to a private repository

1. On GitHub: New repository. Name it (for example `ringpad`). Choose **Private**. Do not
   add a README, a licence or a .gitignore: it must be empty.
2. Give the Claude GitHub App access to it: github.com/apps/claude, Configure, pick the
   account, and add the new repository under "Repository access".
3. Tell Claude the repository's name. It pushes this repository's full history to `main`.

Or do it yourself from a copy of this folder:

```bash
git remote add origin git@github.com:<you>/<name>.git
git push -u origin main
```

Then remove the old branch from the public repository:

```bash
git push https://github.com/splashg22/Yo.git --delete claude/exciting-gates-vdquz4
```

or on GitHub: the `Yo` repository, Branches, the bin icon next to
`claude/exciting-gates-vdquz4`. Deleting a branch does not erase its commits from GitHub
at once: they stay reachable by their hash until GitHub's own clean-up runs, and any copy
someone already made is theirs. Nothing in that branch is a secret: it holds research
notes, the homepage and stand-in media.
