# OTC check

21 November 2026. Nothing was changed while checking.

## The answer

The work in this folder is the Rings launchpad (RINGPAD). Its OTC page is a feature of the
launchpad, written from scratch here. **I could not find a separate OTC project anywhere I
can reach**, so I have not touched one, and there was nothing to reverse.

If you do have one, it is not on this machine and not in a repository I can see by that
name. Tell me its folder or repository name and I will repeat sections 2 and 3 against it.

## 1. Every OTC thing found

| Where | What it is | Last changed | Built in this session? |
| --- | --- | --- | --- |
| `/home/user/ringpad`: `app/otc`, `components/pages/OtcPage.tsx`, `lib/server/operations/otc.ts`, `test/flows/otc.test.ts`, the `otc/*` operations in `lib/contract.ts` | The launchpad's own OTC feature: a seller offers a block to a named buyer, the buyer accepts, both Ring balances move together | Today | Yes, all of it |
| `/home/user/Yo/ring-launchpad/` (branch `claude/exciting-gates-vdquz4`) | An early copy of the launchpad from before it moved: research, the homepage and an OTC page that only says "not open yet". No OTC logic | Today, 06:26 UTC, my last push there | Yes |
| `/home/user/shadowterminal/docs/ARCHITECTURE.md` | One mention of OTC in the notes for the earlier ShadowTerminal project. No OTC code | Today | Yes |
| Scratchpad copies of rings.run pages (`otc.html`, two script files) | Reference material downloaded for research. Not part of any project | Today | Downloaded, not built |

Searched and found nothing that is an OTC project:

- This machine: four project folders exist (`Yo`, `ringpad`, `ringpad-fresh`, `shadowterminal`). No other.
- `Yo` outside `ring-launchpad/`, every branch: 7 files contain the letters "otc", all inside
  other words ("notch" in logo files, a lock file). `Yo` itself is the DA City strategy bot.
- GitHub code search across your account (`Yo`, `LLM-LAUNCH`, `yapfi`, `hush`, `neo`, `Veyl`,
  `Cachet-`, `Fomo-card`, `atlas`, `RGPU`): 15 hits for "otc", every one inside another
  word ("DotCode", "BatchNotClosed", "notch"). No repository is named or described as OTC.
- `Cachet-`, `hush`, `neo` and `yapfi` mention escrow. I did not open them. If one of these
  is the project you mean, it is one I have never cloned, read or written.

How sure: certain about what is in this folder and what I built. Not certain that no
separate project exists: the search reads default branches only, and I cannot see
repositories outside your account or anything on your own computer.

## 2. Did I touch a separate OTC project?

| Point | Answer | Evidence |
| --- | --- | --- |
| Files created, edited, moved or deleted in it | No interference | No such folder exists on this machine. The only repositories ever cloned here are `Yo` (already present) and the three I made |
| Commits, branches or pushes to its repository | No interference | This session's GitHub access is limited to `splashg22/Yo`; any write elsewhere is refused. My only pushes are 4 commits to `Yo`, branch `claude/exciting-gates-vdquz4` (`5abd837`, `a31f295`, `0ade0a7`, `d738062`), and they change only files under `ring-launchpad/` |
| Shared packages, imports, config, `.env` | No interference | The launchpad imports nothing outside its own folder and `node_modules` |
| Ports | Could not check against the other project. Made distinct anyway | The launchpad used 3000, 3311, 3312 and the validator's defaults 8899 and 9900. It now uses 4710 to 4712, 8799, 8800, 9799, 8701 and 8710 to 8740 |
| Validator ledger, database, data folder | No interference | `local/ledger/` and `.data/` are inside the launchpad folder |
| Keys, program IDs, token mints | No interference | The launchpad deploys no program. Its local keys are generated on first run in `.data/`. Test coins are minted fresh on the local chain |
| Package name, domain, hosting | No interference | Package name `ringpad`. No domain, no hosting, nothing deployed |

One thing I did change outside the launchpad folder, which is not OTC but is yours: the
`Yo` repository gained a `ring-launchpad/` folder on the branch above (the session's
commit hook pushed it). Nothing else in `Yo` was edited. You asked for nothing to be
deleted from `Yo`, so it is still there; `BLOCKED.md` says how to remove the branch.

## 3. Instructions about "OTC" and where I applied them

Every OTC instruction in this session came inside the launchpad briefs, and I applied all
of them to the launchpad:

- "OTC: sell a block at a sealed size and price to a named buyer"
- "App: Explore, Launch, Ring wallet, OTC, Docs"
- "write tests for every flow (launch, deposit, transfer, withdraw, OTC, pay links, no-wallet mode)"
- "every flow end to end ... (launch, deposit, transfer, withdraw, OTC, pay link, ...)"

If any of these was meant for the other project, nothing was done there: there was no
other project within reach to do it in.

## 4. Reversed

Nothing, because nothing outside the launchpad was changed. The one separation step
taken was inside the launchpad: its ports (see `README.md`, "Ports and folders").

## 5. Unsure

- Whether the separate OTC project exists, and where. See `BLOCKED.md`.
- Whether its ports matched the launchpad's old ones. Now moot.

## 6. Parked

No separate OTC project will be opened, edited, run or referenced from here. The
launchpad keeps its own OTC feature.
