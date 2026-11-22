# Dependency advisories

`npm audit`, read on 22 November 2026. Before: 17 advisories, 7 of them high. After: 15, **none high or
critical**. CI now fails if a high or critical one appears (`npm audit --audit-level=high`).

## The high ones

All seven high findings came from two packages deep in the Solana libraries. The other five were the
packages that depend on them.

| Root | Advisory | How it reached this project | Was it reachable | What was done |
| --- | --- | --- | --- | --- |
| `bigint-buffer` (all versions, no fixed release) | GHSA-3gc7-fjrx-p6mg: its native `toBigIntLE` reads past the end of the buffer it is given | `@solana/spl-token` → `@solana/buffer-layout-utils` → `bigint-buffer`. Used on the server to read amounts out of token accounts | **Yes, in principle.** The native addon was built and loaded here. The buffers it is handed are slices of account data from our own RPC, always the right width, so no path to exploit it was found; but the faulty code was running | **Fixed.** Replaced by a pure-JavaScript stand-in in `vendor/bigint-buffer` (the package's own fallback, made the only path). No native code is installed. `test/unit/vendor.test.ts` checks every width and that it is the copy the token library loads |
| `toml` (all versions, no fixed release) | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j, GHSA-4qx8-w7c3-pj3p: recursion, prototype pollution and slow parsing on crafted TOML | `@pump-fun/pump-sdk` → `@coral-xyz/anchor`, whose "workspace" helper reads an `Anchor.toml` from a developer's folder | **No.** Nothing here calls that helper, and no TOML from anyone is ever parsed | **Removed.** `vendor/toml` stands in its place and throws if it is ever called. The vulnerable parser is no longer installed |

The stand-ins are wired in through `overrides` in `package.json`. **To reverse:** delete the two entries
under `overrides` and `dependencies`, and `vendor/`. `npm audit fix --force` is not the way: it "fixes"
these by downgrading the pump.fun SDK to a version from before the programs this project calls existed.

## The ones left (moderate and low)

| Package | Advisory | Reached through | Assessment |
| --- | --- | --- | --- |
| `stream-json` | Three: slow filters, slow comment parsing, prototype pollution in its assembler | `@solana/web3.js` → `jayson` (a JSON-RPC library) | `jayson` uses it only for its streaming server mode, which web3.js does not use. Not reachable. No fixed version that `jayson` accepts |
| `uuid` | GHSA-w5hq-g745-h8pq: no bounds check in v3/v5/v6 when a caller passes its own buffer | `@solana/web3.js` → `jayson` | `jayson` calls `uuid.v4()` with no buffer, to number requests. Not reachable |
| `elliptic` | GHSA-848j-6mx2-7j84: a risky implementation of a signature primitive | `@heliuslabs/spr` → `@phala/dcap-qvl`, which verifies the prover enclave's attestation | Used to **verify** signatures in an attestation, not to make any. The advisory concerns signing. Low. It will be looked at again with the Ring SDK's next release |

None of these packages is in what the browser downloads: the Solana libraries run on the server only
(`npm run scan` and the bundle check look at what is served).
