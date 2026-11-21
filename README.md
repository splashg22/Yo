# RINGPAD

A launchpad and trading suite on Solana Privacy Rings. Working name. Independent of
Helius, pump.fun and every other site built on Privacy Rings.

Read `CLAUDE.md` for how the project is laid out, `docs/RESEARCH.md` for what a Ring
hides and what it does not, and `DECISIONS.md` for the calls made along the way.

## Run it

Needs Node 22.12 or newer and the Solana tools (`solana-test-validator`). If they are not
at `/opt/solana/bin`, set `SOLANA_BIN` to the folder that holds them.

```bash
npm install
npm run local:fetch     # once, needs network: copies pump.fun and the Rings programs from devnet
npm run local           # the local validator, in its own terminal
npm run dev             # http://localhost:3000
```

Open Ring wallet, make a wallet with a password, press "Get test SOL", then Launch.

## Check it

```bash
npm test                # 45 tests: 15 on the site, 30 flows on the local validator
npm run build && npm run start -- -p 3311 &
npm run e2e             # 12 steps through the real pages in a browser, as two people
npm run shots           # screenshots of every page, with overflow and legibility checks
```

## What is real and what is a stand-in

| Part | On the local validator |
| --- | --- |
| Creating a coin, buying, selling, creator fees | The real pump.fun program, copied from devnet |
| Registering a coin with the Ring | The real Privacy Rings program, copied from devnet |
| Ring balances: deposit, transfer, withdraw, OTC | A mock ledger with the Ring's visibility rules. Deposits and withdrawals really move coins on the local chain |
| Brand media | Stand-ins drawn in code. See `brand/README.md` |

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
