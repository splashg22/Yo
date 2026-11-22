# Ring results: the real Privacy Rings program on devnet

Run with `npm run ring:prove` (script: `scripts/ring-prove.ts`). Every line below is copied from a run, not
written from memory. Last run: 22 November 2026, with the Helius key in `.env`, SDK `@heliuslabs/spr` 0.9.0-alpha.

## Status

| # | Step | Result |
| --- | --- | --- |
| 0 | Reach devnet: RPC, the Ring's indexer, the prover's attested enclave | **Proven** |
| 1 | Register two wallets in the on-chain registry | **Not run: no devnet SOL** |
| 2 | Deposit SOL into a Ring balance | Not run: needs step 1 |
| 3 | Transfer between two Ring balances | Not run: needs step 2 |
| 4 | Withdraw to a fresh address | Not run: needs step 3 |

**What is blocking steps 1 to 4.** They are real transactions and need test SOL for fees, registration rent
and the deposit itself. Both faucets refuse this machine: `api.devnet.solana.com` answers "The RPC faucet is
closed on this cluster", and `requestAirdrop` through the Helius devnet RPC answers "Internal server error"
for 1, 0.5 and 0.1 SOL. The script is written and waits only for this:

> Send 1 to 2 **devnet** SOL to `5bay9nphMrjypM3UQumPEhPdSQFxxLQ8FhfPxwXXehT5`, then run `npm run ring:prove`.

That address is a throwaway test wallet made by the script. Its key is in `.data-devnet/`, which git ignores.

## Step 0, evidence

```
RPC answers: solana-core 4.4.1
Indexer answers a registry lookup ({"context":{"blockTime":"1795300682","slot":"524864329"},"records":[null]})
Prover attestation verified by the SDK (platform, hpkePublicKey, imageId, gpuVerified)
Prover's proving keys match the SDK's ({"keys":[{"name":"batch_address-append_40_10.key", ...
```

What this proves: the key is accepted for the Ring's indexer and prover, not only for plain RPC; the SDK
verified the prover's enclave attestation against the devnet policy before trusting it; and the prover's
proving keys match the ones this SDK version pins.

Found on the way: the separate indexer and prover hosts printed in the SDK's README
(`d34xe1hqb2ibg2.cloudfront.net`, `dd73hh473h6ha.cloudfront.net`) refuse this key (indexer: HTTP error;
prover: attestation "unavailable"). Leaving both unset, so that the Helius RPC address serves all three,
works. The app is built that way.

## The app's own path, in a browser, evidence

Run on 22 November 2026: this app's server in devnet mode (`RING_NETWORK=devnet`, the key in `.env`), a new
wallet made on the wallet page in headless Chromium.

```
config: {"network":"devnet","ring":"real", ...}
register card shown after 3825 ms
requests from the page: /ring/v1/spr/getUserRecords 2, /ring/v1/spr/getEncryptedUtxosByTags 2,
  /ring/v1/spr/getShieldedTransactionsByTags 2; no request to any other host; no console error
page: "In your Ring balance: SOL 0" ... "Register with the Ring" ... "Your Ring history: Nothing yet."
```

What this proves: with the key present the app uses the real Ring and no stand-in; the Ring's SDK loads inside
the wallet's worker under the site's content security policy; it reaches Helius only through this server's
`/ring/*` door, so the key never reaches the browser; an unregistered, empty wallet is read correctly and is
offered registration. What it does not prove: anything that needs SOL (the table above).

Found on the way, and fixed: on devnet the indexer stopped at every block that held a version 1 transaction
("Transaction version (1) is not supported by the requesting client"), which is every block the Ring program
is used in. Blocks and receipts are now read as plain JSON with the newest transaction version allowed
(`lib/server/solana.ts: rawCall`). The local test chain never produced such a block, which is why no test caught it.

After that fix, the same server in devnet mode on 22 November: started in 6 seconds, followed devnet's
blocks with no read error (`/health`: cursor 524,924,744 against a head of 524,924,751), and the wallet,
OTC, status and pay pages each said what is and is not connected to the real program.

## The three unknowns

| Question | Answer | Evidence |
| --- | --- | --- |
| Can OTC settle atomically (both transfers in one transaction, or neither)? | **Not known yet** | Needs two funded, registered wallets with Ring balances: steps 1 to 3 first |
| Does registering a coin with the Ring need Helius's permission on mainnet? | **Not known yet** | Cannot be tested without touching mainnet, which is not allowed. To be answered from the program's own rules and from Helius, and marked as such |
| Can wallet extensions sign version 1 transactions? | **Not known yet** | No extension can run on this machine. To be answered from the wallets' published behaviour, and by you with a real extension |

Each will be filled in with evidence, or with the plain statement that it failed and the feature is stopped.
