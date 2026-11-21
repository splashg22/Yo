# Blocked: what could not be done or proven here

The full list of what to provide, with steps, costs and where each thing goes, is in
`NEEDS.md`. The commands to run afterwards are in `GO-LIVE.md`. This file is the record of
what is blocked, why, and what was done instead.

| # | What | Why | Done instead |
| --- | --- | --- | --- |
| 1 | A private repository | Creating one is refused for this session (403, tried three times) | Committed locally; a bundle with the full history is sent after each round |
| 2 | The real Ring in place of the stand-in | It needs Helius's endpoints and devnet to build and prove against; a real Ring deposit failed on the local validator (`InvalidTreeAccounts`) | Everything Ring-based runs on the stand-in, locally only. On devnet it is switched off and the pages say so |
| 3 | Proving devnet mode on devnet | No Helius key, and the public devnet faucet refuses this machine ("The RPC faucet is closed on this cluster") | Devnet mode is tested with its chain address pointed at the local validator: `test/flows/devnet-mode.test.ts`, and a crawl of the built site |
| 4 | The Pinata upload | No key | Pictures are kept on the server's disk; the upload is written and unrun |
| 5 | A hosted Postgres | No account | The store is proven against a local Postgres 16 |
| 6 | Building the container | No container runtime is running here | The `Dockerfile` is written and unbuilt |
| 7 | Running the CI workflow | No repository to run it in | The same commands pass here by hand |
| 8 | The SOL price in dollars | The price account lives on devnet and mainnet, not on the local chain | Market cap stays in SOL |
| 9 | The real brand media | They come from your Higgsfield runs | Stand-ins with the exact names and sizes; a test checks both |
| 10 | Safari, Firefox, real phones, real wallet extensions | Only Chromium is installed here | A stand-in extension in the browser checks; emulated phone widths |
| 11 | The lawyer's review, the outside security review, the operator's details | Yours to arrange | Drafts and placeholders, marked as such on the pages |
| 12 | Anything on mainnet, any real money, any public deploy | Ruled out | Nothing was attempted |
| 13 | Removing the launchpad from the public `Yo` repository | You asked for nothing to be deleted there | `git push https://github.com/splashg22/Yo.git --delete claude/exciting-gates-vdquz4` when you are ready |

The separate OTC project (your "Agent OTC Desk: Working Spec" artifact) and the
ShadowTerminal artifact are parked and untouched: see `OTC-CHECK.md`.
