# Ring results: the real Privacy Rings program on devnet

22 November 2026. Every line of evidence below is copied from a run on that day, with the Helius key in
`.env`, SDK `@heliuslabs/spr` 0.9.0-alpha, and 2 devnet SOL that you sent to the test wallet. Each
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

## 1. The four steps, by script

`npm run ring:prove` (`scripts/ring-prove.ts`). Evidence: `.data-devnet/ring-prove.json`.

```
ok   0. Reach devnet: RPC, the Ring's indexer, and the prover's attested enclave
       RPC answers: solana-core 4.4.1
       Prover attestation verified by the SDK (platform, hpkePublicKey, imageId, gpuVerified)
       Prover's proving keys match the SDK's
ok   1. Register two wallets in the on-chain registry
       A registered: 316 bytes        B registered: 316 bytes
       Registry read back: both records present
ok   2. Deposit 0.1 SOL into A's Ring balance
       Deposit: 361 bytes
       A's Ring balance, read with A's keys: 0 -> 100000000 lamports
ok   3. Transfer 0.03 SOL from A's Ring balance to B's
       Proof made by the attested prover and the transaction built in 1.2 s
       Transfer: 899 bytes
       A: 100000000 -> 70000000; B: 0 -> 30000000
       Public SOL movements in the transaction: -10000, -701120, +706120, 0, 0
ok   4. Withdraw 0.01 SOL from B's Ring balance to a fresh address
       Withdrawal: 943 bytes
       Fresh address C on-chain: 0 -> 10000000 lamports
       B's Ring balance after: 20000000
5 of 5 steps proven.
```

What this shows, and what it does not:

- **The amount of a transfer is not in its public balances.** The transfer moved 30,000,000 lamports
  between Ring balances; the public changes in that transaction are a 10,000 lamport fee and about
  700,000 lamports passing between two of the program's own accounts. 30,000,000 appears nowhere.
- **Both wallets of the transfer are public**, as the design says: the sender signs and pays, and the
  recipient was looked up in the public registry.
- **The proof took 1.2 seconds**, made by Helius's prover, not in the browser. That is one measurement on
  devnet at a quiet moment.
- **Every one of these is a version 1 transaction**, read back from the chain (`"version": 1`). The
  script's own printed label said "legacy": the script was reading the wrong byte, and is corrected.
- It does not show a coin other than SOL, anything under load, or anything on mainnet.

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
Each leg is 1 and 1 instruction(s) to the Ring program
One version 1 transaction holding both, signed by both wallets: 1683 bytes
It went through
A: 69000000 -> 68000000 (gave 4000000, got 3000000); B: 21000000 -> 22000000 (got 4000000, gave 3000000)

B then moved everything it held to A by itself, which makes its prepared leg stale. A: 90000000, B: 0
One good leg and one stale leg in one transaction: failed on the chain ({"InstructionError":["1",{"Custom":"7043"}]})
After it: A 90000000 -> 90000000; B 0 -> 0
```

- **Both or neither: proven.** With both legs good, both balances moved by exactly the two amounts. With
  one leg made bad on purpose, the chain refused the second instruction and the whole transaction failed:
  the good leg did not go through by itself.
- It used 280,420 compute units and 1,683 bytes, well inside what a version 1 transaction allows.
- **What it needs in practice:** both parties sign the same transaction. So an OTC trade on the real Ring
  is "seller prepares a leg, buyer prepares a leg, both sign one transaction", not the stand-in's "offer
  now, accept later". Each leg's proof goes stale if its owner spends the same notes meanwhile, in which
  case the trade simply fails and is prepared again. That flow is not built.
- **Not shown:** a pump.fun coin as one of the legs. Both legs here were SOL. The transfer instruction is
  the same for any registered coin, so I expect it to work; I have not run it.

## 4. Does registering a coin need permission? Not on devnet

`npm run ring:register` (`scripts/ring-register-prove.ts`). Evidence: `.data-devnet/ring-register.json`.

```
A made a new Token-2022 coin GwTwXRd3...ioNxP
The registering instruction names 8 accounts; the only one that signs is the wallet sending it
The Ring program's upgrade authority on devnet is AftkmqRy...Xyw9; B is 41HWQyRh...wbj8: a different wallet, with no role in the coin either
B registered the coin with the Ring
A second registration of the same coin was refused (custom program error 0x1b63)
```

- **On devnet, any wallet can register any coin.** Wallet B had no role in the coin and none in the Ring.
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
