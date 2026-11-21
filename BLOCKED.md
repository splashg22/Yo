# Blocked: what only you can do

| # | What | Why I could not | Exactly what to do |
| --- | --- | --- | --- |
| 1 | A private repository for the launchpad | Creating one is refused for this session (`403 Resource not accessible by integration`, tried twice) | Create an empty **private** repository on GitHub (no README, licence or .gitignore). Give the Claude GitHub App access to it (github.com/apps/claude, Configure, Repository access). Tell me its name. Or push it yourself: `git remote add origin git@github.com:<you>/<name>.git && git push -u origin main` from a copy unpacked from `ringpad.bundle` |
| 2 | Removing the launchpad from the public `Yo` repository | You asked for nothing to be deleted there | When ready: `git push https://github.com/splashg22/Yo.git --delete claude/exciting-gates-vdquz4`, or on GitHub: `Yo`, Branches, the bin icon. The branch holds research notes, the homepage and stand-in media, no secrets |
| 3 | The separate OTC project, if there is one | I cannot find it (see `OTC-CHECK.md`) | Tell me its folder or repository name if you want it checked |
| 4 | Devnet | No Helius key | Put `HELIUS_API_KEY=<key>` in `.env.local`. The site works without it on the local chain |
| 5 | The real ring images and video | They come from your Higgsfield runs | Save them over the files in `brand/` under the same names, then tell me. Prompts: `brand/HIGGSFIELD-PROMPTS.md` |
| 6 | Real Ring balances | A real Ring deposit failed on the local validator (`InvalidTreeAccounts`); it needs devnet and the Helius endpoints | Follows from 4 |
| 7 | Sealed launch window | Needs custody of user funds, which you ruled out without asking | Decide: build with custody, or drop |
| 8 | Terms and Privacy Policy | Need a lawyer | A lawyer's read |
| 9 | Safari, Firefox, real phones, real wallet extensions | Only Chromium is installed here | Try the site in them, or give me a machine that has them |
| 10 | Anything on mainnet, any real money, any deploy | Ruled out | Ask in so many words |

Nothing in this session waits on an approval prompt, a login or a missing tool for the
local work: the validator, Node, the browser and the test tools are all installed.
