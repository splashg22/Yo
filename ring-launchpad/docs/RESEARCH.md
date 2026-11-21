# Research notes

Read on 21 November 2026. Sources: the Helius Privacy Rings docs (overview, architecture,
encryption, UTXO, deposit, transfer, withdraw, endpoints, addresses, security, billing),
the published TypeScript SDK `@heliuslabs/spr` 0.9.0-alpha, the pump.fun program interface
as shipped in `@pump-fun/pump-sdk` 4.3.1, and the public pages of the two reference sites.
Items marked **unverified** were not confirmed by a primary source or by a run on devnet.

## 1. What a Ring hides and what stays public

This is the permissionless Default Ring, the only kind open to us. It is "confidential",
not "anonymous".

| Action | Public on-chain | Encrypted |
| --- | --- | --- |
| Deposit from a public balance | Depositor, recipient, coin, amount, optional memo | The recipient's resulting Ring balance |
| Transfer between Ring balances | Sender address, recipient address, time, the fact that a Ring transfer happened | Coin, amount, optional memo |
| Withdraw to a public balance | Sender, destination, coin, amount | The remaining Ring balance |
| Registering a wallet with the Ring | The wallet address and its published shielded keys | Nothing |
| Registering a coin with the Ring | The coin, who paid | Nothing |
| A Ring balance at rest | That the wallet is registered | Which coins it holds and how much |

Consequences that the site must state wherever they apply:

- A Ring does not hide who you are or who you deal with. Both addresses of every transfer
  are public. Hiding them needs an "anonymous Custom Ring", which is a separate product for
  enterprises whose audit is expected to finish in December 2026. We cannot build on it now.
- Anything that touches the bonding curve is fully public: creating the coin, every buy and
  sell, the dev buy, collecting creator fees. A Ring cannot hide a trade on pump.fun.
- A balance is only as hidden as its history. If a wallet's only Ring activity is one public
  deposit of 1,000,000 of a coin, its balance is known. It becomes unknown only after
  transfers in or out.
- The total of a coin held in the Ring is public: it is the balance of that coin's escrow
  account. How it is split between holders is not.
- Each party to a transfer can read that transfer. The sender can also disclose a single
  transfer by sharing its transaction viewing key. Sharing a wallet's viewing key gives
  read access to the whole wallet.
- Helius (the RPC, indexer and prover we would use) sees addresses, commitments and
  ciphertexts, not coins or amounts, per the docs. The prover runs in an attested enclave
  and the SDK encrypts requests to it.

## 2. Costs

| Cost | Amount | Source |
| --- | --- | --- |
| Solana network fee | 5,000 lamports per signature, plus any priority fee | Solana |
| Ring tree fee | 5,000 lamports per state tree an instruction updates (default; configurable per tree) | Architecture doc |
| Registering a coin with the Ring (once per coin) | Rent for the coin's registry record and escrow token account, paid by whoever creates it. One reference site quotes about 0.0024 SOL | Deposit guide; amount **unverified** |
| Registering a wallet (once per wallet) | Rent for the user record; a sponsor can pay it | SDK readme; amount **unverified** |
| Helius credits | 10 per indexer read, 1,000 per proof. A transfer or withdrawal needs a proof; a deposit does not | Billing doc |
| pump.fun fees | A protocol fee and a creator fee in basis points on every trade, read from the program's `Global` and the coin's curve at run time | Program interface; rates **unverified**, we will display what the chain returns |

The proof cost falls on whoever owns the Helius API key, which is us. At 1,000 credits per
transfer this is the main running cost and needs a rate limit from day one.

## 3. What is alpha, beta or not live

- The SDK is `0.9.0-alpha`. The docs call the endpoints "Beta".
- Audits of the Solana Privacy Program and circuits: Certora (October 2026) and zkSecurity
  (August 2026) have published reports; OtterSec's report is listed as awaited. The trusted
  setup finished on 2 November 2026. We may link to these. We may not show audit badges of
  our own: our code will be unaudited.
- Custom Rings (including anonymous ones): audits expected December 2026. Not available.
- The Helius embedded private wallet: "coming soon", not live. No-wallet mode is ours to build.
- ZK programs (private escrow, swaps) are documented as a concept with a Rust program SDK.
  The public example swap and escrow programs use insecure test keys and are explicitly not
  for real funds (**unverified** by us; reported by search, repository not read).
- Mainnet status: the docs index says the permissionless Ring is live on mainnet; the
  program accounts exist on both mainnet and devnet at the same addresses (checked by RPC).

## 4. Program facts we will build on

Rings (same addresses on devnet and mainnet):

- Solana Privacy Program `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW`
- User Registry Program `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ`
- One Helius URL with an API key serves the RPC, the indexer and the prover.
- Supports SOL, SPL Token and Token-2022. The program has an error for unsupported
  Token-2022 extensions, so not every Token-2022 mint is accepted.
- A coin needs a per-mint "SPL interface" (escrow). It can be created by anyone, once, and
  can be created in the same transaction as another instruction.
- Private transfers are one Solana transaction in the new v1 format (up to 4,096 bytes).
  A typical transfer is about 1,279 bytes and 140,000 compute units.
- A transfer spends at most 40 UTXOs. A wallet that receives many small transfers must
  merge before it can spend everything at once. Merges need no user signature.
- A recipient must be registered before it can receive a transfer.
- Wallets sign with their normal Solana key. The shielded keys can be derived from a wallet
  signature, so browser wallets work.

pump.fun (program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, present on devnet):

- `create` (SPL Token) and `create_v2` (Token-2022 by default), with the creator as an
  argument. The SDK builds "create and first buy" as one set of instructions.
- `buy`, `sell` and exact-in variants. No instruction pauses a curve, restricts who may
  buy, or batches buyers: the curve is open to everyone from the transaction that creates
  the coin, and each buy moves the price for the next.
- `collect_creator_fee` pays accrued creator fees to the creator. It is a public
  instruction with a public amount.
- Newer options exist (holder-reward coins, token-quoted curves, "mayhem mode"). Out of scope
  for a first version: SOL-quoted, standard coins only.

## 5. What you asked for, against the facts

### Core

| # | Feature | Verdict |
| --- | --- | --- |
| 1 | Create on a curve and register with a Ring in one signature | **Possible**, with one thing to prove first: that the Ring accepts a mint made by `create_v2` (Token-2022 with pump's extensions). If it does not, use `create` (SPL Token). First task of step 2. |
| 1b | Dev buy straight into a Ring balance | **Possible, but public.** The buy and the deposit are both visible with amounts. What the creator does with the coins afterwards is hidden. The site must say "your dev buy is public". |
| 2 | Ring wallet: deposit, transfer, withdraw | **Possible.** This is the SDK's main path. |
| 3 | Explore feed: market cap, 24h change, Ring badge | **Possible.** Market cap comes from curve reserves; the Ring badge from the coin's escrow account. The 24h change needs our own record of prices, so it needs a small indexer and database. |
| 4 | OTC at a sealed size and price to a named buyer | **Likely possible, to prove on devnet.** Two Ring transfers (coin one way, payment the other) in one transaction signed by both sides, so both happen or neither. Coin, size and price are encrypted. Both addresses and the time are public. By size it should fit (about 2,600 of 4,096 bytes). If two transfers cannot share a transaction, the only other route is a ZK escrow program of our own, which is a separate, audited-or-nothing project. |

### What we add

| # | Feature | Verdict |
| --- | --- | --- |
| 1 | Sealed launch window after launch, filled together at one price | **Not possible on a pump.fun curve.** The curve cannot be paused or gated, so anyone can buy in the same second the coin exists, and every buy moves the price. **Closest thing:** a sealed window *before* the coin exists. Buyers commit SOL during the window. Then one transaction creates the coin and makes a single pooled first buy. Everyone in the pool gets the same average price, pro rata, delivered as Ring transfers with hidden amounts. No sniper can be ahead of the pool because the coin did not exist before that transaction. Limits, all of which the site must state: (a) commitments made as Ring transfers hide each size, but each committer's address is public and so is the pool's total; (b) snipers can still buy immediately after the pool; (c) someone holds the pooled SOL during the window. See open decision 1. |
| 2 | Privacy score per coin | **Half possible.** Share of supply held in the Ring is exact and public. The number of holders in the Ring cannot be known: that is what the encryption hides. **Closest thing:** the count of distinct wallets that have deposited the coin, labelled as exactly that. |
| 3 | Private pay links and QR codes | **Possible.** The link carries recipient, coin and amount and opens a pre-filled Ring transfer. Anyone holding the link can read it. On-chain the payment shows payer and recipient and hides coin and amount. The recipient must be registered. It cannot be a standard Solana Pay request, because the payer's wallet must build a proof. |
| 4 | No wallet needed | **Possible, built by us.** A key generated in the browser, a deposit address, and a password-encrypted backup file. Funding from an exchange is a public transfer to a public address. The user alone holds the key; losing the backup and the browser data loses the funds. |
| 5 | Proof of holdings ("at least X" without showing the balance) | **Not supported. Dropped.** The docs offer two disclosures: a wallet viewing key (shows everything) and a single-transaction key. Neither proves a threshold. It would need a custom circuit and its own trusted setup. |
| 6 | Private creator earnings | **Possible in a narrower sense.** Claiming creator fees is public and shows the amount. We can deposit the claim into the creator's Ring balance in the same transaction, so what happens next is hidden. Honest name: "creator fees go straight to your Ring balance". "Private earnings" would be false. |
| 7 | Privacy panel before every signature | **Possible**, and it is the feature that keeps the rest honest. One table in code drives the panel, the docs and the homepage. |

## 6. Risks found during research

- **Token-2022 acceptance.** Unknown until tried on devnet (core 1).
- **Transaction format.** Ring transfers use Solana's v1 transaction format. A wallet must
  be able to sign it. The reference sites manage it with common wallets, so it is workable,
  but we must test with each wallet we list. No-wallet mode avoids the question.
- **Helius key exposure.** The SDK needs the API key for proofs. It must sit behind our own
  proxy with rate limits, or anyone can spend our credits.
- **Custody.** The pre-launch pool holds other people's money for a period. That is a
  legal question as much as a technical one. See open decision 1.
- **Alpha dependency.** The SDK can change under us. Pin the version, wrap it in one module.
- **Privacy that looks better than it is.** A coin can be "in the Ring" while almost none
  of its supply is. The privacy score exists to show that, including when it is unflattering.

## 7. The references, in one paragraph each

**hushrings.app.** A launchpad. One transaction creates a pump.fun coin and registers the
mint with the Ring. Its page has a hero, four live counters, a newest-launches strip, a
three-step explainer, a plain "what a Ring hides and what it does not" section with a
public/encrypted list per action, and a launch call to action. It states that deposits are
public and that shielding is optional. Next.js.

**rings.run.** A suite presented as four numbered cards: OTC, Launch (a Meteora launch paid
for privately), DEX and Terminal, each marked audited or experimental. Its OTC page shows
one deal twice, as an explorer sees it and as the two parties see it, and lists what stays
public. It says it is independent of Helius. Next.js.

**mazerealestate.fun (branding only).** Near-black wine ground, rose-white text, DM Sans at
weight 300 with tight tracking for a 64px headline, 16px body with slightly open tracking,
a centred pill navigation, small buttons, a lot of empty space. Its imagery is game
artwork, which we do not use.
