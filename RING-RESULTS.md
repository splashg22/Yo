# Ring results: the real Privacy Rings program on devnet

22 November 2026. Every line of evidence below is copied from a run on that day, with the Helius key in
`.env`, SDK `@heliuslabs/spr` 0.9.0-alpha, and the 2 devnet SOL you sent to the test wallet. The full run was
made twice that day; the signatures and costs in section 1 are from the second, at 04:55 UTC, from wallets
that had never touched the chain. **The stand-in was not used for any of it**: every step named here is a
transaction on Solana devnet, to the real program `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW`. Each
transaction can be opened on the explorer; the links are in the JSON files named beside each part, in
`.data-devnet/` (which git ignores, because it also holds the throwaway test keys).

**Devnet only. No real money. Nothing here was run on mainnet**, and the two mainnet facts below are
reads of public data.

## What passed, what failed, what is still unknown

| | Result |
| --- | --- |
| Reach devnet's RPC, the Ring's indexer and the attested prover | **Passed** |
| Register two wallets | **Passed** |
| Deposit SOL into a Ring balance | **Passed** |
| Transfer between two Ring balances | **Passed** |
| Withdraw to a fresh address | **Passed** |
| The same four steps through this site's own wallet page, in a browser | **Passed**, after three faults in our own code were found and fixed (below) |
| Can OTC settle atomically | **Yes. Proven** for SOL both ways |
| Does registering a coin need permission | **No, on devnet. Proven.** On mainnet the program's code is identical; not tried there, because nothing may be sent on mainnet |
| Can wallet extensions sign version 1 transactions | **Still unknown.** No extension can run on this machine. What is known is below; it needs two minutes of your time with a real wallet |
| A pump.fun coin (not SOL) deposited, moved or withdrawn on the real program | **Not run** |
| Anything failed that stops a feature | **No** |

## 1. The four steps, by script, each read back from the chain

`npm run ring:prove -- --fresh` (`scripts/ring-prove.ts`). Evidence: `.data-devnet/ring-prove.json`.
This is the run of 22 November at 04:55 UTC, the second of the day. `--fresh` makes three wallets that
have never touched the chain, so registration really runs. They were paid from the wallet you funded
(`5bay9nph...XehT5`), which held 1.0466 SOL at the start: your 2 SOL less what the day's earlier runs spent.

After every step the script asks the chain for the transaction by its signature and reports what the
chain recorded. Nothing in the "read back" lines comes from what was sent.

| Step | Result | Signature | Read back from the chain | What it cost the paying wallet |
| --- | --- | --- | --- | --- |
| Fund new wallet A with 0.4 SOL | Passed | `xxg7BP5qx8WAnJttiRNE2MdY9G7KsGJucYc9dfsHPF7oDPnFT4dnXwgby1ifT7rVjV9XMFnTsCfYwdoBfTujom2` | Slot 524958357, version 0. A holds 400,000,000 lamports | 0.4 SOL sent + 0.000005 fee |
| Fund new wallet B with 0.05 SOL | Passed | `4x3r15sfrGDf3cFLJKTT2ZH6aivGWLc3w8yRmB5FSFhY7a5J4Y5ZhXQvLympWM2zCtSg3t4jQsfBR7wnc7K4hnEG` | Slot 524958369, version 0 | 0.05 SOL sent + 0.000005 fee |
| **Register A** | **Passed** | `4dHDU6M7PSxK62KFrUXUEuZXZdL9wrqwJWbbz9nrMatoRmxKqPtHHHqrrvKHeHfAriGQBW5GVLaEaY75pSWEnsnS` | Slot 524958378, version 1, 7,002 compute units | **0.00116324 SOL**: 0.000005 fee + 0.00115824 rent for the registry record |
| **Register B** | **Passed** | `2T68EPdewJCub3tcG9PFwn4poFzspBgcEVHsMsAGB4RqiDAW9Jmg7B4gyShZjxPLwiBCD2vmwnr2XTMioiYx5SDN` | Slot 524958388, version 1. Both records then read back from the Ring's registry | 0.00116324 SOL, the same |
| **Deposit 0.1 SOL** | **Passed** | `tXRaJ2kuY8iypWkXAYjyztSDCeSBi8eSaR3qoTQMm8m1AdvtXSN4LXxv4dcdFvRZ76T33kLVheikfp7pHxr9rTL` | Slot 524958403, version 1, 37,898 compute units. A's Ring balance, read with A's keys: 0 to 100,000,000 | **0.000005 SOL** fee, on top of the 0.1 SOL deposited |
| **Transfer 0.03 SOL, A to B** | **Passed** | `3bbsFHSrk8cBHJAFsK8dc5suEY1cdEmTMyLNbDrhjKHZcxTafAgWVFdKhKuC8BdSbTTCxhHpa3Qz6MsFPVjoC2vD` | Slot 524958425, version 1, 142,053 compute units. A: 100,000,000 to 70,000,000; B: 0 to 30,000,000, each read with its own keys | **0.00001 SOL**: 0.000005 network fee + 0.000005 taken by the Ring program |
| **Withdraw 0.01 SOL, B to fresh address C** | **Passed** | `2ikb3TqyWYuHXkhUnenTnht1gfMZvovBzNepoY3hfn9qBteFaf9KLLYjhVW2HiUP1thoNPsABThp9nk4XAg74qya` | Slot 524958452, version 1, 145,275 compute units. C on the chain: 0 to 10,000,000 lamports. B's Ring balance: 20,000,000 | **0.00001 SOL**, the same two parts |

Nothing failed. Before those: step 0 passed again (RPC `solana-core 4.4.1`; the Ring's indexer answered;
the SDK verified the prover's enclave attestation and that its proving keys match the SDK's).

What this shows, and what it does not:

- **The amount of a transfer is not in its public balances.** Every public SOL movement in the transfer,
  as the chain recorded it: -10,000, -701,120, +706,120, 0, 0 lamports. The paying wallet lost 10,000. One of
  the program's accounts passed 701,120 to another, which also kept 5,000 of the fee. The 30,000,000 lamports
  that moved between Ring balances appear nowhere.
- **Both wallets of the transfer are public**, as the design says: the sender signs and pays, and the
  recipient was looked up in the public registry.
- **The proof took 1.2 seconds**, made by Helius's prover, not in the browser. One measurement, at a quiet moment.
- **Every Ring transaction is version 1**, as the chain reports it.
- **Costs, in short:** registering a wallet 0.00116 SOL once (nearly all of it rent); a deposit 0.000005;
  a transfer or a withdrawal 0.00001. Devnet figures. The rent and the program's 5,000 lamports are set by
  the program, and the program can be changed by whoever holds its upgrade key.
- It does not show a coin other than SOL, anything under load, or anything on mainnet.

The whole run, with the three experiments below, took the funded wallet from 1.0466 SOL to about 0.64 SOL.
Most of that is not spent: it sits in the new test wallets and in their Ring balances.

## 2. The same four steps through this site, in a browser

`npm run ring:browser` (`scripts/ring-browser-prove.mjs`), against this app's server in devnet mode.
Evidence: `.data-devnet/ring-browser.json`. A wallet is made on the wallet page in headless Chromium,
funded with test SOL, and then everything is done by pressing the page's own buttons.

```
1. Registered from the page. The page no longer asks for registration.
2. Deposited 0.05 SOL. Ring balance on the page: 0 -> 0.05
3. Transferred 0.02 SOL to 5bay9nph...XehT5. Ring balance on the page: 0.03
4. Withdrew 0.01 SOL. Ring balance on the page: 0.02. The wallet on the chain: 148821760 -> 158811760 lamports
History on the page, read with the wallet's own keys: 3 rows (withdrawal, transfer, deposit), each confirmed, each with a receipt
Hosts the page talked to other than this site: d3gbdb0egjwcw9.cloudfront.net
Browser errors: 0
```

Signatures of that run (22 November, 04:23 UTC), wallet `76JSvoDa...ovKj` made in the browser:

- register `2KGQskgNQGJYZcxxwmLRB2onpNmvUza7uynMeqyqft179nGezrspk4bc4VFisCJHG61mDTVaDu2UEDCLRv2vwCbj`
- deposit `5Ue1uuJKsc6fbYdocL8A7LeeX5XnVzzuNez1mLXMis2fGwN5TofxqBGsA4Jte1U3HSztR8fZX5QQ8dqxNqj4YfT6`
- transfer `59EL6s4vcC6HYJXoyYpkrksWL2AbukSPpeQAM7DFMMwCZVgvTbDKnHJLutDj16uvAPCgkfxTkoxsBk9WLpSSkvZd`
- withdraw `5RDL1Aotw21ScXt2eYqLedrArCTCzf2VJuEK7qSCEphPbhqPjVjaqYbnJmT2MPPEepk5tcNUyfp7NmJGjgcmQ2qC`

The withdrawal was checked against the chain: the wallet's own SOL went from 148,821,760 to 158,811,760
lamports, which is the 0.01 SOL withdrawn less the 0.00001 it cost. This run was not repeated at 04:55; the
code it ran has not changed since.

What this shows: the Ring's SDK runs inside the wallet's worker under the site's content security
policy; the wallet's key never leaves that worker; the browser reaches Helius only through this server
(which adds the API key) and one other host, Helius's signed policy for the prover's enclave, which the SDK
checks for itself.

**Three faults in our own code, found by this run and fixed.** All three were in the door this server
puts between the browser and Helius (`lib/server/ringgate.ts`), and none could have been found without
the SOL:

1. It read the request to the prover as text. That request is sealed bytes; reading it as text spoiled it.
2. It relabelled every request as JSON and dropped the header that tells the prover how to answer.
3. It dropped the three `Spr-Tee` headers that carry the sealing, both on the way out and on the way back.

Each made the transfer fail with the prover answering "400". The door now carries the request byte for
byte and passes exactly five named headers out and four back, and nothing else of the caller's
(`test/unit/ringgate.test.ts`). Registering and depositing never touched the prover, which is why they
worked before the fix.

Also found: a history row for a transfer on the real program read "from you to ." because the recipient
is not something the wallet's own records name. It now reads "from you."

## 3. Can OTC settle atomically? Yes

`npm run ring:otc` (`scripts/ring-otc-prove.ts`). Evidence: `.data-devnet/ring-otc.json`.

An OTC trade is two transfers: the coin one way, the payment the other. Settling atomically means both
happen or neither does. The SDK builds one transaction per transfer. Here the two transfers' instructions
were taken out and put into **one** version 1 transaction, signed by both wallets.

```
Before: A holds 70000000 lamports in its Ring balance, B holds 20000000
Each leg is 1 and 1 instruction(s) to the Ring program
One version 1 transaction holding both, signed by both wallets: 1683 bytes
Signature: 417qVfMhRwxMFihdk76fKxBPWnCUM8Rqw2xScZdm56cYUJKPPLLm5ZwyQnz6P6UBcEUQUbMUdPvJGUzRUr1WPASY
Read back from the chain: went through in slot 524958619, version 1, fee 10000 lamports,
  the paying wallet's SOL fell by 20000 lamports, 288879 compute units
A: 70000000 -> 69000000 (gave 4000000, got 3000000); B: 20000000 -> 21000000 (got 4000000, gave 3000000)

B then moved everything it held to A by itself, which makes its prepared leg stale. A: 90000000, B: 0
One good leg and one stale leg in one transaction:
Signature: CPjpcENd4ckdUvopKE4tLt5bFNr8eq7DCWeUTM8gfRAA58JLK9CypWbpxdVcZ2ZgHotYZgCTwcfwTVfex1qUBEv
Read back from the chain: FAILED ({"InstructionError":["1",{"Custom":"7043"}]}) in slot 524958685, version 1,
  fee 10000 lamports, the paying wallet's SOL fell by 10000 lamports
After it: A 90000000 -> 90000000; B 0 -> 0
```

- **Both or neither: proven.** With both legs good, both balances moved by exactly the two amounts. With
  one leg made bad on purpose, the chain refused the second instruction and the whole transaction failed:
  the good leg did not go through by itself.
- It used 288,879 compute units and 1,683 bytes, well inside what a version 1 transaction allows.
- **Cost:** 0.00002 SOL for the trade that settled (two signatures' fees, and the program's 5,000 lamports per
  leg). **The failed attempt still cost its 0.00001 SOL fee**: on Solana a transaction that fails on the chain
  pays its fee. So an OTC trade whose leg has gone stale costs a fee and moves nothing.
- This was run twice on 22 November, from two different pairs of wallets, with the same result. The signatures
  above are the second run's; the first run's are `2w4T36Aj...tuzPEt` (settled) and `3Wksf92c...usAFE` (failed whole).
- **What it needs in practice:** both parties sign the same transaction. So an OTC trade on the real Ring
  is "seller prepares a leg, buyer prepares a leg, both sign one transaction", not the stand-in's "offer
  now, accept later". Each leg's proof goes stale if its owner spends the same notes meanwhile, in which
  case the trade simply fails and is prepared again. That flow is not built.
- **Not shown:** a pump.fun coin as one of the legs. Both legs here were SOL. The transfer instruction is
  the same for any registered coin, so I expect it to work; I have not run it.

## 4. Does registering a coin need permission? Not on devnet

`npm run ring:register` (`scripts/ring-register-prove.ts`). Evidence: `.data-devnet/ring-register.json`.

```
A (5bay9nph...XehT5) made a new Token-2022 coin CRzn6Qc8AiXQKVQepTDeuXzmCregWBUiC9iMge8mHgVt
The registering instruction names 8 accounts; the only one that signs is the wallet sending it
The Ring program's upgrade authority on devnet is AftkmqRy...Xyw9; B is 41HWQyRh...wbj8: a different wallet, with no role in the coin either
B registered the coin with the Ring.
Signature: 4mbC3CnjQ4LqeVGfZFrqNnUsRQbCbHnNtdiCzr9V28yjsiSq5RxfsvYajHEgxSBncmFX8YURbuSo6avUBxE1ZcQ4
Read back from the chain: went through in slot 524958734, fee 5000 lamports, the paying wallet's SOL fell by 2387520 lamports
A second registration of the same coin was refused (custom program error 0x1b63)
```

- **On devnet, any wallet can register any coin.** Wallet B had no role in the coin and none in the Ring.
  Run twice on 22 November with two different new coins; the first was `GwTwXRd3...ioNxP`.
- **Cost: 0.0023875 SOL**, nearly all of it rent for the accounts the registration creates, paid by whoever
  registers. At launch that would be the coin's creator, in the same transaction as the launch.
- **On mainnet: the same code, not tried.** Reading public data only: the Ring program is deployed on
  mainnet at the same address, and its code is byte for byte the same as devnet's (641,949 bytes, the
  same SHA-256). The same code applies the same rule, unless it reads a setting from an account whose
  contents differ on mainnet; the instruction names no such account that I can see. I have not sent
  anything on mainnet, so this is strong evidence, not proof.
- **A thing you should know:** on both networks the program can be upgraded by a key Helius holds
  (devnet `AftkmqRy...`, mainnet `CuZ42Bso...`). Whoever holds that key can change the rules, including
  this one, at any time. The program is in use on mainnet today: its five most recent transactions there
  were minutes old when I looked.

## 5. Can wallet extensions sign version 1 transactions? Still unknown

Every Ring transaction is version 1, a transaction format introduced with Agave 4.2. What is known:

- **Version 1 is live on mainnet and common.** In one mainnet block read on 22 November, 304 of 610
  transactions were version 1. Most of those will be bots signing with their own keys, so this says
  nothing certain about browser wallets.
- **This site's own wallet signs them.** The browser run above signed four with the wallet made on the
  page.
- **No wallet's documentation that I could read says it signs version 1.** Phantom's developer docs,
  read on 22 November, describe "legacy" and "versioned" (version 0, with lookup tables) and do not
  mention version 1. Solflare's and Backpack's indexes do not either. Silence is not a no.
- **It cannot be tested here.** No extension runs in this environment.

**This one is not answered, and I am not calling it a pass.** What I would try next, in order:

1. Build the test button described below and have you press it with Phantom, Solflare and Backpack on devnet.
   That answers "does the extension sign a version 1 transaction" for each, in a few minutes.
2. If they sign: try the SDK's route for making the Ring's keys from a signed message, so an extension user
   can hold a Ring balance without giving up their key.
3. If they do not: say on the wallet page that Ring balances need the wallet made in the browser, and offer a
   one-step "move SOL from your extension wallet to it".

**What would settle it:** a real wallet being asked to sign one. The site does not offer that yet: with
an extension connected, the wallet page says the real Ring works only with a wallet made in the browser,
because the Ring's keys are made from the wallet's key, which an extension never hands over. So the test
needs one small thing built: a button on the status page, shown on devnet with an extension connected,
that asks the wallet to sign a harmless version 1 transaction (a transfer of nothing to itself) and
reports what the wallet did. It is next on the list, and takes you two minutes to press once it exists.
Until then this is treated as unknown, and no feature depends on an extension signing one.

A second, separate question hides behind this one and is also open: even if an extension signs version
1, **the Ring's own keys are made from the wallet's private key**, which an extension keeps to itself. The
SDK has a way to make them from a signed message instead; I have not tried it. For now the real Ring is
for the wallet made in this browser.

## What this changes

- The stand-in is no longer the only proof that the wallet page works: deposits, transfers and
  withdrawals of SOL run on the real program, through this site, on devnet.
- OTC on the real Ring is possible and needs its own flow (both sign one transaction). Not built.
- Still on the stand-in only: the OTC desk, fee claims straight into a Ring balance, a first buy straight
  into a Ring balance, notes on transfers, the sealed window. Each says so on its page when the real Ring
  is connected.
- Not yet run on the real program: any pump.fun coin; a pay link being paid; a split withdrawal.

## Found on the way, earlier

- The separate indexer and prover hosts printed in the SDK's README refuse this key. Leaving them unset,
  so that the Helius RPC address serves all three, works. The app is built that way.
- On devnet the indexer stopped at every block that held a version 1 transaction. Blocks and receipts are
  now read as plain JSON with the newest transaction version allowed (`test/unit/rpc-source.test.ts`).


## Rerun before launch: 22 November 2026, later the same day

Run again from scratch with three new wallets (`npm run ring:prove -- --fresh`), paid for by the funded devnet
wallet `5bay9nphMrjypM3UQumPEhPdSQFxxLQ8FhfPxwXXehT5`. **Every step passed.** Each result below was read back
from the chain or from the Ring's own indexer by the script, not taken from the SDK's return value.

| Step | Result | Signature (devnet) | Cost to the paying wallet |
| --- | --- | --- | --- |
| Reach devnet: RPC, the Ring's indexer, the prover's attested enclave | Passed. solana-core 4.4.1; attestation verified by the SDK; proving keys match | | |
| Register wallet A | Passed, version 1 transaction, 316 bytes | `5rk4ZFdTZRkKDud7hbpGh4gGAHgBz2LaAUvFh544DxKxFo5cU1cppySk1cGnBCw5U6EJ4TB3yiKKEtHRjr6BkNiF` | 0.00116324 SOL (rent for the registry record, and the fee) |
| Register wallet B | Passed | `3HBwGNxsMYcujaA4PJGQja9fFu5rW2ppouLWU3uTDzG3rbMUaRvqbri9UhSpoBKxecm6p4GmXqFhcNEVrGVKyV2w` | 0.00116324 SOL |
| Deposit 0.1 SOL into A's Ring balance | Passed. A's Ring balance, read with A's keys: 0 to 100,000,000 lamports | `53tu7rTMPq2uX4SUVb5oPnALX97z7AeUTK7tAosm71yL5Mee5VMcis81uabhQCg2AnbRgGNHvaTwVCrqDuxTKqx1` | 0.1 SOL deposited, 0.000005 SOL fee |
| Transfer 0.03 SOL from A to B | Passed. A: 100,000,000 to 70,000,000; B: 0 to 30,000,000. The amount is not among the public SOL movements of the transaction. Proof made in 1.5 s | `5uLhRheaxiG5tiEQgfGpjYbd3dqAbcCRq1RS6txow9vK3MWHoH3P5TenYjCiTxbS4ZkSVdKVFEtXNSZi5Turu4eG` | 0.00001 SOL |
| Withdraw 0.01 SOL from B to a fresh address | Passed. The fresh address on the chain: 0 to 10,000,000 lamports. B's Ring balance after: 20,000,000 | `2pSzWSu6B6QZ5pprXfWisU49JWtKPVZTBHCKpcH6FUFGW4gnz7bWs76oP9zqyoZu9pQ9bpbkBR8gM2K6N3eJWknP` | 0.00001 SOL |

The funded wallet held 0.6455 SOL before this run and about 0.245 after (0.4 went to the new test wallets).

What this settles for launch: **register, deposit, transfer and withdraw of SOL work on the real program on
devnet, by script and (proven earlier today) through this site's wallet page in a browser.** That is what
launch B can honestly offer.

Still not run on the real program, and so not offered at launch: a pump.fun coin in a Ring balance, pay links,
split withdrawals, and OTC (the two-transfers-in-one-transaction proof exists; the product flow on it does not).
Still unknown: whether wallet extensions (Phantom, Solflare, Backpack) will sign a version 1 transaction. A wallet
made in the browser does, and is the only kind the launch relies on.
