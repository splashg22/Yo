# Privacy audit

21 November 2026. Written from the code as it is, not from the design.

**The short version.** Today this product hides very little from us, the operator. Ring
balances are a stand-in on our own server, so we can read every transfer's wallets, coin
and amount. Nothing here uses zero-knowledge proofs, and no wallet address is hidden from
anyone at any step. What is hidden today: the coin and amount of a Ring transfer from
the public, the note on a transfer from everyone but its two wallets, and what a pay link
asks for from our server until it is paid.

## 1. What is private today

Three kinds of observer:

- **The public**: anyone reading the chain, or this site's public record of Ring events.
- **Us**: this site's server and whoever runs it or hosts it.
- **The RPC provider**: whoever serves chain data. Today that is a validator on the same
  machine. On devnet it would be Helius.

Marks: **public** (anyone can see it), **us** (hidden from the public but visible to us),
**hidden** (not visible to the public or to us).

### Launch, buy, sell, creator fee claim

These are ordinary transactions to pump.fun. A Ring cannot hide them.

| | Public | Us | RPC provider |
| --- | --- | --- | --- |
| Wallet | public | public | public |
| Coin | public | public | public |
| Amount and price | public | public | public |
| Counterparty (the curve, fee wallets) | public | public | public |
| Time | public | public | public |
| IP address | hidden | **us** | sees our server's address, not yours |

A creator's first buy is public even when it goes straight into a Ring balance, and so is
the fact that it went there.

### Deposit to a Ring balance

One transaction that moves the coins to the stand-in's escrow wallet.

| | Public | Us | RPC provider |
| --- | --- | --- | --- |
| Wallet | public | public | public |
| Coin | public | public | public |
| Amount | public | public | public |
| Counterparty (the escrow wallet) | public | public | public |
| Time | public | public | public |
| Balance afterwards | hidden from the public | **us** | hidden |
| IP address | hidden | **us** | our server's |

### Transfer between Ring balances

In this build a transfer is not a transaction. It is a request signed by the sender's
wallet to our server, which moves two numbers in its ledger.

| | Public | Us | RPC provider |
| --- | --- | --- | --- |
| Sender's wallet | public (this site publishes it, as the real Ring would) | public | never sees it |
| Recipient's wallet | public (same) | public | never sees it |
| Time | public (same) | public | never sees it |
| Coin | hidden from the public | **us** | hidden |
| Amount | hidden from the public | **us** | hidden |
| Note | **hidden** | **hidden**: sealed in the browser; we hold no key | hidden |
| That a note exists, and its rough length | hidden from the public | **us** | hidden |
| IP address of the sender | hidden | **us** | hidden |

Because nothing reaches the chain, the "public" column here is what our server chooses to
publish (`ring/public`). That is a property of the stand-in, not a guarantee.

### Withdraw

A signed request; the escrow wallet then pays out with one public transaction.

| | Public | Us | RPC provider |
| --- | --- | --- | --- |
| Withdrawing wallet | public (in this site's record; on-chain the payer is the escrow) | public | sees the escrow and the destination |
| Destination | public | public | public |
| Coin | public | public | public |
| Amount | public | public | public |
| Time | public | public | public |
| Remaining balance | hidden from the public | **us** | hidden |
| IP address | hidden | **us** | our server's |

### OTC block

Signed requests to our server. The offer is stored readable; settlement moves ledger
numbers on both sides together.

| | Public | Us | RPC provider |
| --- | --- | --- | --- |
| Seller's and buyer's wallets | public once settled (this site's record) | public | never sees them |
| Time of settlement | public | public | never |
| Coin, size, price | hidden from the public | **us** | hidden |
| An open, unaccepted offer | hidden from the public; shown to the two wallets | **us** | hidden |
| IP addresses | hidden | **us** | hidden |

### Pay link

| | Public | Us | Anyone holding the link |
| --- | --- | --- | --- |
| Recipient, coin, amount, note asked for | hidden | **hidden** until paid: carried after the #, which browsers do not send | can read all of it |
| The payment | as a transfer, above | as a transfer, above | |

### A coin's picture and description

Public by nature: they describe a public coin. The file is redrawn before it is kept, so
hidden data in it (where a photo was taken, the device, the author) is removed. We see the
original file as it is uploaded. Without a picture store configured, it is kept on our
server; with one, on IPFS through Pinata, which then also sees it.

### Sealed launch window (built, off by default)

| | Public | Us |
| --- | --- | --- |
| That a window exists, who opened it, when it closes | public | public |
| How many wallets committed, and the total | public | public |
| Who committed, and how much each | not published by the stand-in | **us** |
| The launch and its first buy, with the amount | public | public |
| How many coins each committer received | hidden from the public | **us** |

Under the real Ring a commitment would be a transfer to the window, so the committing
wallet would be public. The window also holds the committed SOL, which is custody.

### No-wallet mode

| | Public | Us | This browser |
| --- | --- | --- | --- |
| Private key | hidden | **hidden**: never sent | stored encrypted with the password; held unencrypted in the tab's session storage while unlocked |
| Password | hidden | **hidden**: never sent | not stored |
| Wallet address | public once used | public | |
| Backup file | hidden | **hidden** | the user's copy; as strong as its password |
| IP address | hidden | **us** | |

Anything that can run script in this site's pages while a tab is unlocked, such as a
malicious browser extension, can read the key.

### Across all actions

- **IP address.** Our server sees it on every request. It writes no log of requests, and
  keeps a per-address count in memory for one minute to limit abuse. A host or proxy in
  front of it may log. All chain traffic goes through our server, so the RPC provider sees
  our address, not the user's. A wallet extension may talk to its own RPC provider, which
  we do not control.
- **Linking.** We can link every wallet used from one address or one browser. The public
  can link a deposit to a later withdrawal of the same amount, or a deposit and a
  withdrawal close in time, whatever happens in between.
- **Balances.** A Ring balance is hidden from the public only until its history gives it
  away: one deposit and nothing else leaves it known.
- **Leaving the site.** No address of this site is passed to other sites when a link is
  followed (`Referrer-Policy: no-referrer`). No analytics, no third-party scripts, no fonts
  or images from other hosts.

### What changes under the real Default Ring (not built, not verified by us)

By its specification, a transfer becomes a transaction whose coin and amount are
encrypted and proven correct with a zero-knowledge proof. Then the coin and amount of a
transfer would be **hidden** from us too, provided the proof is made in the browser.
Both wallet addresses stay **public**: each output carries its owner's public key. Helius's
indexer would see who transacts with whom and when. A remote prover, if used, receives the
secret inputs.

## 2. The options

Status of this section: Helius's repository was read directly (commit 42de575, 20
November 2026). Everything else is from search summaries of the sources named, because
their sites are outside this session's network access. Treat those as **reported, not
verified**. Nothing here was measured by us.

| Option | Would hide, beyond today | Cost | Must be trusted | Audited and live |
| --- | --- | --- | --- | --- |
| **Privacy Rings, Default Ring** (Helius) | Coin and amount of a transfer, from the public **and from us**. Not addresses, not timing. Deposits and withdrawals stay public | One transaction per action; about 140k compute units a transfer (reported); a fee per state tree, capped at 0.001 SOL; proof in a browser well under a second on a fast laptop (their figures) | Groth16 trusted setup: 15 contributions, finalised 2 November 2026. Authorities are multisigs that can pause trees. A permissioned forester. The indexer sees owners and timing. A remote prover sees secrets; proving locally avoids that | Mainnet beta since 10 November 2026 (reported). Audit by ZK Security, August 2026, in the repo. Certora report, October 2026, in the repo but watermarked draft, with one high and three medium findings. SDK is alpha |
| **Privacy Rings, anonymous rings** | Wallet addresses as well | Not known | Separate proving keys, not covered by the ceremony above | Not live. Reported in audit, target late 2026 |
| **Token-2022 confidential transfers** (ElGamal) | Amounts and balances only. Addresses and the coin stay public | About 368k compute units and several transactions per transfer (reported) | No trusted setup. Validators can switch it off | Switched off June 2025 after two vulnerabilities; reported re-enabled June 2026, **not verified**. Audit by Least Authority, November 2025. Needs an extension set when the coin is created, which pump.fun coins are reported not to have: **not verified**, and if so it cannot be used here without wrapping |
| **Shielded pool with our own circuits** (Groth16 or PLONK) | Addresses, amounts, coin | Months of work. New circuits, a new program, a ceremony, an audit. Privacy depends on how many others use the same pool: a new coin has almost none | Our circuits, our ceremony, our program, our relayer | Would be new and unaudited. **Not something to ship without a trusted setup and an outside audit** |
| **An existing shielded pool** (Privacy Cash, Umbra, Hush) | The link between depositor and withdrawer | 0.25% to 0.5% withdrawal fees (reported) | Their setup, operators and relayers | Privacy Cash: live, six audit firms named in its docs, SOL and stablecoins only, so not usable for launched coins. Deposits were paused in November 2026 after stolen funds arrived (reported). Umbra and Hush: live, audits not found |
| **Stealth addresses** | The recipient's long-term address, on public legs | A fresh account per payment, which needs SOL for fees and is linked by whoever funds it unless a relayer pays | The scheme and its library | No audited, live Solana product found. Libraries found are marked unaudited |
| **Relayer / fee payer** | Who paid the fee. With Rings' in-circuit signature mode, the owner need not sign the transaction, and the sender of a withdrawal can be hidden | A server that pays fees and can refuse | The relayer sees the transaction and the IP address | Kora (Solana Foundation): audited by Runtime Verification, October 2025, nine critical or high findings reported. Self-hosted |
| **Batching and delay** | The timing link between a deposit and a withdrawal | Waiting. Useless without many users in each batch | The batcher | No live Solana system found |
| **Encrypted computing** (Arcium MPC; TEE rollups) | In principle amounts, balances and logic | New network dependency | Arcium: at least one honest node among a small permissioned set (4 reported). TEE: the chip maker and the operator | Arcium mainnet alpha since February 2026; its confidential token standard not confirmed on mainnet; no audit report found. MagicBlock: reported live, no independent audit found |

## 3. Recommendation

**Use Privacy Rings' Default Ring with proofs made in the browser, and do not write our
own circuits.** It is the only option found that is live, has outside audits and a
completed trusted setup, accepts arbitrary launched coins by design, and removes us from
the set of parties who can read a transfer. Its limit is exact and must be stated
wherever it is used: **both wallet addresses stay public**.

For hidden addresses, wait for Helius's anonymous rings to finish audit and adopt them,
rather than build a shielded pool. A pool of our own would start with no audit, no
ceremony and an anonymity set of nearly nobody.

Not recommended here: confidential transfers (hide less, and pump.fun coins likely cannot
use them), existing shielded pools (they do not take launched coins), stealth addresses
(no audited implementation), encrypted computing (not ready for arbitrary coins).

### Staged plan

| Stage | What | Hides | Needs | State |
| --- | --- | --- | --- | --- |
| 1 | Stop our own server seeing what it has no need to see: notes sealed in the browser; pay-link requests kept out of the address the server receives; no referrer; no request logs; POST only | Notes, from us and everyone. Pay-link requests, from us until paid | Nothing new | **Built in this pass, with tests** |
| 2 | Replace the stand-in with the real Default Ring on devnet, proving in the browser. Seal OTC offers to the two wallets with the same note keys | Coin and amount of transfers and OTC blocks, from us | `HELIUS_API_KEY`; the Ring's own audits cover its circuits | Not started |
| 3 | Cut metadata: a relayer for withdrawals using the Ring's in-circuit signature mode; warn before a withdrawal that matches a recent deposit in amount or time; let the user point at their own RPC | Who sent a withdrawal; easy amount and timing matches | A relayer we run, which sees addresses and IPs. An outside review of the relayer | Not started |
| 4 | Adopt anonymous rings once Helius ships them audited | Wallet addresses inside the Ring | Their release and audit | Waits on Helius |

**Said plainly:** stage 1 uses libsodium's standard sealed box and writes no cryptographic
primitive, but the way it is used here has not been reviewed by anyone outside the
project. Stages 2 to 4 rely on Helius's circuits, ceremony and audits, none of which we
have checked ourselves. Anything that adds circuits or cryptography of our own would need
a trusted setup and an outside audit before mainnet, and none is planned.

## 4. Stage 1, as built

| Change | Proof |
| --- | --- |
| A note is sealed in the sender's browser to the recipient's published key (libsodium `crypto_box_seal`: X25519, XSalsa20-Poly1305), with a second copy to the sender's own key. The server stores both and has no key for either | `lib/notes.ts`; `test/unit/notes.test.ts`; `test/flows/ring-wallet.test.ts` ("notes on a transfer"), which checks the text is in neither the server's memory nor its state file |
| The server refuses a note sent as readable text | `lib/server/operations/ring.ts`; same flow test |
| Each wallet's note key comes from its seed (HKDF-SHA256, then libsodium `crypto_box_seed_keypair`), and only the wallet can publish it | `lib/notes.ts`, `lib/keys.ts`; flow test "only the wallet itself can publish or change its note key" |
| A pay link carries its request after the #. A link with the request in the query string is refused | `lib/paylink.ts`; `test/unit/requests.test.ts` |
| No address of this site is sent to other sites | `next.config.mjs` (`Referrer-Policy: no-referrer`) |
| The site may not say "anonymous", "untraceable", "zero-knowledge", "shielded" and similar | `FORBIDDEN_CLAIMS` in `lib/visibility.ts`; `test/unit/site.test.ts` |

Limits of stage 1:

- A wallet extension gets its note key by signing one fixed message when it connects. If
  it declines, it has no note key and cannot send or open notes. The key depends on the
  wallet producing the same signature for the same message every time, which standard
  Ed25519 wallets do; a wallet that does not would lose access to older notes.
- A sealed box does not identify its sender to the recipient by itself; the recipient
  trusts our server's record of who sent the transfer.
- We still see that a note exists and roughly how long it is.
- We still see every transfer's wallets, coin and amount. Only stage 2 changes that.
