# Ring plan: from the stand-in to the real Privacy Rings program

21 November 2026, with a note added on 22 November.

**22 November: what has happened since this plan was written.** A Helius key arrived. Step 0
(reaching devnet's RPC, the Ring's indexer and its attested prover) is proven. The app is wired to
the real program behind the same wallet page, and in a browser it loads the SDK, reads an empty
wallet and offers registration. Registering, depositing, transferring and withdrawing are written
and **have not been run**: they need devnet SOL. Evidence, and the three open questions, are in
`RING-RESULTS.md`. The rest of this file is the plan as written, and still the order of work.

**Where this comes from.** The SDK that is already installed in this project,
`@heliuslabs/spr` 0.9.0-alpha: its README and its type definitions, read on this date.
**Nothing below has been run.** A real Ring deposit was tried once on the local validator
and failed (`InvalidTreeAccounts`); nothing has been tried on devnet, because there is no
key. Every "should" in this file is a claim to be proven in the order given at the end.
Where the SDK does not say, this file says "not known".

## Does the finished product hold user funds?

**No, with one exception that stays switched off.**

- Once the stand-in is replaced, coins in a Ring balance are held by the Privacy Rings
  program on-chain and can be spent only with the user's own keys. This site's server
  holds no key that can move them. The escrow wallet, the ledger and the payout code are
  deleted.
- This site never holds a user's private key. Keys are made in the user's browser or
  stay in their wallet extension.
- **The exception is the sealed launch window.** It pools buyers' SOL before a coin
  exists, and whoever holds the pool holds funds. That stays behind
  `FEATURE_SEALED_WINDOW`, off, and does not ship without your say-so and an outside
  review. Under the real Ring it would still be custody: see "Cannot be done".
- A fee sponsor or relayer, if we add one, holds only its own SOL for fees.
- Not ours, but true: Helius's protocol authorities are multisigs that can pause a Ring's
  state trees (reported from their repository, not verified by us). A pause would stop
  transfers and withdrawals for everyone. That is their power, not ours, and the site
  should say so.

## The pieces of the real Ring

| Piece | What it is | Who runs it |
| --- | --- | --- |
| Shielded pool program `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW` | Holds the coins and verifies proofs | On-chain |
| User registry `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ` | Maps a Solana address to the keys others encrypt to | On-chain |
| State tree `777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor` (devnet) | Where encrypted balances are recorded | On-chain |
| Indexer (Photon) | Serves the encrypted records a wallet scans for its own | Helius |
| Prover | Makes the zero-knowledge proof for a transfer or withdrawal. By default it runs in an enclave; the SDK checks the enclave's attestation and encrypts each request to it | Helius |
| Solana RPC | Sends transactions | Helius, with the API key |

A balance is not a number in an account. It is a set of encrypted notes that only the
owner's keys can find and open. The wallet finds them by asking the indexer and trying
its keys (`syncWallet`).

## Feature by feature

### Ring balance (reading it)

| | Stand-in today | Real Ring |
| --- | --- | --- |
| Where it is | A number in this server's state | Encrypted notes on-chain |
| How it is read | Signed request `ring/mine` to our server | In the browser: `syncWallet({ client, wallet, keys })`, then `wallet.balance(mint)` and `getPrivateTransactions(wallet)` |
| Keys | None | `ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed))` for a wallet made in the browser. For a wallet extension: `LocalKeys.fromDerivationSeed`, from the extension's signature over `ed25519DerivationMessage(publicKey)`. One signature at connect, which can replace the note-key signature we ask for today |
| Our server | Holds and sees every balance | Holds none. Sees none |

The wallet's synced state is cached in the browser, encrypted
(`syncPersistedWallet`, `walletSnapshotCipher`), so a reload does not rescan history.

### Registration

| | Stand-in | Real Ring |
| --- | --- | --- |
| What | A line in our state | An on-chain record: `buildRegistrationTransaction({ client, owner, address })`, instruction `register` on the registry program |
| Cost | Nothing | Rent for the record, once, paid by the user or a sponsor (`payer`) |
| Without it | "Not registered" from our server | A transfer to that wallet fails with `WALLET_RECIPIENT_NOT_REGISTERED` |

### Deposit

| | Stand-in | Real Ring |
| --- | --- | --- |
| Transaction | A token transfer to our escrow wallet | `buildDepositTransaction({ client, feePayer, recipient, asset, splTokenAccount, amount, splTokenProgram })`, instruction `deposit` on the pool program. Token-2022 for pump.fun coins |
| Accounts | Depositor, escrow's token account | Depositor and their token account, the coin's Ring interface (the pool's vault for that coin, made at launch by `createSplInterface`), the state tree |
| Public | Wallet, coin, amount | The same. A deposit is public by design |
| Our server | Receives the coins. Credits the ledger from the chain | Receives nothing. Builds nothing: the browser builds and signs |

### Transfer between Ring balances

| | Stand-in | Real Ring |
| --- | --- | --- |
| What it is | A signed request; two numbers change in our state | One Solana transaction with a proof: `buildTransferTransaction({ client, wallet, keys, feePayer, recipient, asset, amount })`, instruction `transact` |
| Proof | None | Made by the prover from the wallet's notes. Verified on-chain |
| Public | Both wallets, time (because we publish them) | Both wallets, time (on-chain, by design of the Default Ring) |
| Hidden | Coin and amount, from the public only | Coin and amount, from the public and from us |
| Note | Sealed in the browser, stored by us | **The transfer builder takes no note.** Notes stay as they are today: sealed in the browser with libsodium, stored by us as ciphertext, attached to the transfer by its signature |
| Limits | None | A transfer spends whole notes. A wallet that has received many small payments must merge them first (`buildMergeTransaction`), or the build fails with `WALLET_TOO_MANY_INPUTS`. The interface needs a "tidy up" step |

### Withdraw

| | Stand-in | Real Ring |
| --- | --- | --- |
| Transaction | Our escrow pays out | `buildWithdrawalTransaction({ client, wallet, keys, feePayer, recipient, asset, amount, splTokenProgram })`, instruction `transact` with a public output. The recipient's token account is opened in the same transaction if needed |
| Who signs | Our server | The user |
| Public | Wallet, destination, coin, amount | Destination, coin, amount. The withdrawing wallet too, unless a sponsor pays the fee and the owner signs inside the proof (`owner` parameter): then the sender is not on the transaction |
| Our server | Holds the coins, signs, tracks pending payouts | None of it. The "pending payout" and "reconcile" code goes |

### Launch, with a first buy into the Ring

| | Stand-in | Real Ring |
| --- | --- | --- |
| Create and register | Real already: pump.fun `create_v2` + Rings `createSplInterface` | Unchanged |
| First buy into the Ring | Buy, then a token transfer to escrow | Buy, then the `deposit` instruction (`getDepositInstructionAsync`) in the same transaction |
| Risk | | **Size.** Rings transactions are a newer format (version 1, up to 4,096 bytes); our launch is version 0 with a lookup table, 1,232 bytes. Whether create + buy + register + deposit fits in either is **not known**. If not: launch in one transaction, deposit in a second, and say so |
| Note | | On mainnet, registering a coin with the Ring may need Helius's permission for each coin. **Not verified.** If so, a launch here cannot register by itself there |

### Creator fee claim into the Ring

pump.fun's claim instruction followed by the `deposit` instruction for SOL, in one
transaction. Public either way, as now. Same size question as the launch, smaller.

### Pay links

Unchanged in shape. The link still carries its request after the `#`. Paying it becomes
`buildTransferTransaction` to the recipient's address. Our server no longer sees the
payment at all, only the sealed note if there is one.

### OTC

| | Stand-in | Real Ring |
| --- | --- | --- |
| Offer | Stored readable on our server | Sealed in the seller's browser to the buyer's key (the same libsodium sealed box as notes). We store ciphertext and the two addresses |
| Settlement | Our ledger swaps both sides in one step | **Not known to be possible as one step.** It needs two transfers, one by each party, to land together or not at all. The plan: both `transact` instructions in one Solana transaction, signed by both. Whether two proofs fit in 4,096 bytes and the compute limit is to be proven |
| If it does not fit | | OTC is offered only as "seller sends first" with that risk stated, or is withdrawn. It is **not** rebuilt with an escrow of ours: that would be custody |

### Privacy score

Both figures become plain chain reads, with no ledger behind them: the total of a coin in
the Ring is the balance of that coin's Ring vault account; "wallets that have deposited"
is counted from `deposit` instructions on that vault. Our server keeps a count, not a
ledger.

### Sealed notes, pictures, listings, price readings

Unchanged. None of them touches a Ring balance.

## What our server stops holding and seeing

| | Today | Once real |
| --- | --- | --- |
| Coins in Ring balances | Held in our escrow wallet | Not held |
| The escrow key | On our server's disk | Deleted |
| Every wallet's Ring balance | Stored, readable | Not stored, not readable |
| Coin and amount of every transfer | Stored, readable | Never sent to us |
| OTC terms | Stored, readable | Stored sealed; not readable |
| Pending payouts, reconciliation | Ours | Gone |
| Ring history | Stored | Read in the browser from the indexer |
| Signed requests for Ring actions | Verified by us | Gone: the chain verifies a proof instead |

What it still holds: coin listings and pictures, price readings, sealed notes and sealed
offers as ciphertext, request counts per address.

What it still sees, and this must be said on the site:

- **IP addresses**, as now.
- **The Helius key lives on our server**, so the browser reaches the RPC, the indexer and
  the prover through us. We therefore see every request pass. Requests to the prover are
  encrypted to its enclave, so we cannot read them. Requests to the indexer are not
  secret in the same way: we would see which records a browser asks for, and when. That
  is metadata tying an IP address to a wallet's activity. Whether the indexer can be
  queried in a way that hides this is **not known**.
- **Helius** sees what its indexer and RPC are asked, and runs the prover. The proof's
  secret inputs go to the prover's enclave. Making proofs in the browser instead needs
  Helius's separate web prover package, which is not part of this SDK and which we have
  not used; whether to adopt it is a decision for the devnet pass.

## Cannot be done on the real Default Ring

- **Hide either wallet address.** Every transfer shows sender and recipient. Only
  Helius's anonymous rings would change that, and they are not released.
- **Hide a deposit or a withdrawal.** Coin and amount are public on the way in and out.
- **Hide anything on the bonding curve.** Launch, buys, sells and fee claims are pump.fun
  transactions.
- **Attach a private note to a transfer on-chain.** The transfer has no note field.
- **Pay a wallet that has not registered.** There is nothing to encrypt to.
- **A sealed launch window without custody.** Whoever holds the pooled SOL before the
  coin exists holds funds, on the real Ring as on the stand-in.
- **An OTC escrow without custody.** See OTC above.
- **Proof of holdings above a threshold.** The Ring has no such proof. Already dropped.

## What has to change in our own code

1. **A seam.** One interface, `RingBackend`, with today's stand-in behind it and the real
   Ring as a second implementation, chosen by `RING_NETWORK`. Pages call the interface.
2. **The SDK runs in the browser.** Keys must not reach our server. Its endpoints go
   through a proxy route on our server that adds the Helius key.
3. **Signing.** Rings transactions are version 1. Our signing code reads legacy and
   version 0 only, and wallet extensions must be able to sign version 1. **Not known**
   whether today's extensions do.
4. **Two libraries.** The SDK uses `@solana/kit`; pump.fun's SDK uses `web3.js`. The
   launch needs instructions from both in one transaction.
5. **Deleted once real:** `lib/server/escrow.ts`, `lib/server/ring.ts`, most of
   `lib/server/settle.ts`, the withdrawal and reconcile operations, the escrow rows on
   the status page, and every "simulated" sentence listed in `SITE-WORDING.md`.

## Order of work, each step proven before the next

| # | Step | Proven by | Stops the plan if |
| --- | --- | --- | --- |
| 0 | The seam: `RingBackend`, with the stand-in behind it. No behaviour changes | Every existing test still passes | |
| 1 | Reach devnet: proxy route, `createSprClient`, prover attestation check | A script that prints the client's health; `npm run doctor` | Helius's Ring endpoints are not open to our key |
| 2 | Keys and registration for a browser-made wallet | The registry record read back from the chain | |
| 3 | Deposit SOL, then a pump.fun Token-2022 coin | Vault balance on-chain rises by exactly the amount; `syncWallet` shows it | The Ring refuses pump.fun coins on devnet |
| 4 | Read balance and history in the browser; encrypted local cache | Reload shows the same balance without a rescan | |
| 5 | Transfer between two registered wallets | Both wallets' synced balances; the transaction on-chain shows no coin or amount | Proofs cannot be had with our key |
| 6 | Withdraw, to self and to a fresh address | Destination's on-chain balance; vault falls by exactly the amount | |
| 7 | Merge, and the "tidy up" step in the interface | A wallet with many small notes can send again | |
| 8 | Launch with first buy into the Ring, and fee claim into the Ring | One transaction if it fits; otherwise two, and the page says two | |
| 9 | Pay links on real transfers | The existing pay-link browser run, on devnet | |
| 10 | Wallet extensions: key derivation by signature; version 1 signing | A real extension, on your machine. I cannot run one here | Extensions cannot sign version 1 |
| 11 | OTC: sealed offers; one-transaction settlement, if it fits | Both sides' balances after one transaction; neither moves if it fails | It does not fit: OTC is reduced or withdrawn |
| 12 | Privacy score from the vault; status page from the chain | Figures equal direct chain reads | |
| 13 | Delete the stand-in and its wording. Sponsor for withdrawal fees, if wanted | `npm run scan`; the wording test; the full report repeated on devnet | |

Each step gets flow tests against devnet beside the local ones, and the browser checks
are repeated on devnet at steps 6, 9 and 13. The local validator keeps the stand-in for
offline tests until step 13, behind the seam.

## What I need to start

`HELIUS_API_KEY`, and a few devnet SOL in a wallet whose address I will give you
(`NEEDS.md`, items 2 and 3). Nothing else blocks step 0, which needs no key and which I
have not started, as you asked me to stop here.
