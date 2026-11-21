import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Technical" };

const explorer = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;

const PROGRAMS = [
  ["pump.fun bonding curve", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "Creates coins, runs the curve, pays creator fees. Not ours."],
  ["pump.fun fee program", "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", "Works out trading fees for the curve. Not ours."],
  ["Privacy Rings", "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW", "Holds Ring balances and registers coins. By Helius. Not ours."],
  ["Rings user registry", "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ", "Where a wallet publishes its Ring keys. By Helius. Not ours."],
  ["Token-2022", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "The token program new pump.fun coins use. Solana's."],
] as const;

/** Who wrote the logic behind each feature. "Ours" always means code that runs off-chain: this project deploys no program. */
const OWNERSHIP = [
  [
    "Launch",
    "A call to pump.fun (create_v2, buy) and to Privacy Rings (createSplInterface).",
    "Putting all of it in one transaction with a lookup table; listing a coin only after checking its creator on-chain.",
    "lib/server/transactions.ts, lib/server/settle.ts",
  ],
  ["Buy and sell", "A call to pump.fun.", "Slippage limit, plain error messages, the price as whole micro-lamports.", "lib/server/pump.ts"],
  ["Creator fees into the Ring", "A call to pump.fun to claim.", "Claim and deposit in one transaction.", "lib/server/transactions.ts"],
  [
    "Ring balances",
    "Meant to be Privacy Rings. Not in this build.",
    "A stand-in ledger and escrow wallet with the Ring's rules for what is public. Crediting from chain receipts, once; withdrawals that are never paid twice.",
    "lib/server/ring.ts, escrow.ts, settle.ts",
  ],
  ["OTC", "Nothing.", "All of it: offers to a named buyer, both sides settle together or not at all, expiry, cancel.", "lib/server/operations/otc.ts"],
  ["Pay links", "Nothing.", "All of it: the link format, its checks, the QR code, the payment as a Ring transfer.", "lib/paylink.ts"],
  ["Privacy score", "Reads of the chain.", "The two figures and what they are allowed to claim.", "lib/server/ring.ts (coinStats)"],
  [
    "No-wallet mode",
    "Nothing.",
    "All of it: key made in the browser, scrypt and AES-GCM backup, transaction signing without a wallet library.",
    "lib/keys.ts, lib/backup.ts, lib/sign.ts",
  ],
  [
    "History and receipts",
    "Reads of the chain.",
    "What the paying wallet spent and received, from the chain's own before-and-after balances.",
    "lib/server/operations/system.ts",
  ],
] as const;

const LAUNCH_LAYOUT = [
  ["1", "Compute Budget", "Set the compute limit", "Nothing of note"],
  ["2", "pump.fun", "create_v2: make the coin and its bonding curve", "Creator wallet (signer, pays), the new coin's own key (signer)"],
  ["3", "Associated Token", "Open the creator's token account for the coin", "Creator wallet"],
  ["4", "pump.fun", "buy: the optional first buy", "Creator wallet, the curve, pump.fun's fee wallets"],
  ["5", "Privacy Rings", "createSplInterface: register the coin with the Ring", "Creator wallet (pays rent), the coin, the Ring's accounts"],
  ["6", "Associated Token", "Open the stand-in escrow's token account, if the buy goes to the Ring", "Creator wallet (pays rent)"],
  ["7", "Token-2022", "Move the bought coins to escrow, if the buy goes to the Ring", "Creator wallet (signer)"],
] as const;

const TRUST = [
  [
    "Your key",
    "In no-wallet mode it is made in your browser and stored there encrypted with your password. It is never sent. With a wallet extension, the extension holds it.",
  ],
  [
    "What you sign",
    "The server builds each transaction and your browser signs it. The page shows what the transaction is meant to do; it does not independently decode the bytes. A wallet extension shows its own reading before you approve. In no-wallet mode you are trusting this site's server to build what the page describes.",
  ],
  [
    "Requests that read or move a Ring balance",
    "Signed by your wallet over the exact request, a random number used once, and the time. The server rejects a signature older than 90 seconds, a reused number, or a request altered by one character.",
  ],
  [
    "Ring balances in this build",
    "Kept by a stand-in on this site's server. Its operator can read every transfer and controls the escrow wallet. This is acceptable on a test chain with coins of no value, and nowhere else: the stand-in refuses to start on any other network.",
  ],
  ["Ring balances under the real Ring", "Held by the Privacy Rings program. This site's server would see only encrypted data. Not built yet."],
  ["Prices and market cap", "Read from the bonding curve account each time. Nothing is cached as a fact."],
] as const;

const LIMITS = [
  "Runs on a local test chain only. Devnet is not wired up.",
  "Ring balances are simulated. Nothing here is encrypted by the Ring today.",
  "OTC offers are held on the server in readable form.",
  "State is one file on the server. It is right for a test build and wrong for anything else.",
  "No rate limiting.",
  "No price chart and no price in dollars.",
  "Tested in Chromium only. No real phone, no real wallet extension.",
  "Not audited by anyone outside the project.",
] as const;

const SECTIONS = [
  "Programs this site calls",
  "Whose logic is whose",
  "How a launch is laid out",
  "Who you are trusting",
  "Check it yourself",
  "The typed client",
  "Known limits",
] as const;
const anchor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function Technical() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Technical</span>
        <h1 className="h2">How it is built, who you trust, and how to check it</h1>
        <p className="body">
          {site.name} deploys no program of its own. It builds transactions for two programs it does not control, and adds its own logic off-chain. This page
          says which is which. File names refer to the project&apos;s source.
        </p>

        <nav aria-label="On this page">
          <ol className="contents">
            {SECTIONS.map((title) => (
              <li key={title}>
                <a className="link" href={`#${anchor(title)}`}>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="prose">
          <h2 id={anchor(SECTIONS[0])}>{SECTIONS[0]}</h2>
          <p>
            The local test chain holds copies of these programs taken from Solana devnet, at the same addresses. The links open each one on devnet in
            Solana&apos;s own explorer. The <Link href="/status">Status</Link> page shows whether each is present on the chain this build is using.
          </p>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>Program</th>
                <th>Address</th>
                <th>What it does here</th>
              </tr>
            </thead>
            <tbody>
              {PROGRAMS.map(([name, address, role]) => (
                <tr key={address}>
                  <td data-label="Program">{name}</td>
                  <td data-label="Address">
                    <a className="address" href={explorer(address)} rel="noreferrer">
                      {address}
                    </a>
                  </td>
                  <td data-label="Role">{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2 id={anchor(SECTIONS[1])}>{SECTIONS[1]}</h2>
          <p>&quot;Ours&quot; means code in this project that runs off-chain, in your browser or on this site&apos;s server.</p>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Someone else&apos;s program</th>
                <th>Ours</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {OWNERSHIP.map(([feature, theirs, ours, source]) => (
                <tr key={feature}>
                  <td data-label="Feature">{feature}</td>
                  <td data-label="Theirs">{theirs}</td>
                  <td data-label="Ours">{ours}</td>
                  <td data-label="Source" className="address">
                    {source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2 id={anchor(SECTIONS[2])}>{SECTIONS[2]}</h2>
          <p>
            One transaction, one signature from your wallet and one from the new coin&apos;s own key, which is made for the launch and then thrown away. It fits
            in one transaction only through an address lookup table of the accounts every launch shares. If any instruction fails, none of it happens.
          </p>
        </div>
        <div className="scroll-x">
          <table className="plain">
            <thead>
              <tr>
                <th>Step</th>
                <th>Program</th>
                <th>Instruction</th>
                <th>Accounts that matter</th>
              </tr>
            </thead>
            <tbody>
              {LAUNCH_LAYOUT.map(([step, program, instruction, accounts]) => (
                <tr key={step}>
                  <td data-label="Step" className="num">
                    {step}
                  </td>
                  <td data-label="Program">{program}</td>
                  <td data-label="Instruction">{instruction}</td>
                  <td data-label="Accounts">{accounts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="prose">
          <p>
            Steps 6 and 7 are this build&apos;s stand-in for a Ring deposit. Under the real Ring they become the Ring&apos;s own deposit instruction. A buy, a
            sell, a deposit and a fee claim are each one transaction built the same way. A transfer between Ring balances, an OTC settlement and a pay-link
            payment are not transactions in this build: they are signed requests to the stand-in.
          </p>

          <h2 id={anchor(SECTIONS[3])}>{SECTIONS[3]}</h2>
        </div>
        <dl className="kv">
          {TRUST.map(([what, how]) => (
            <span key={what} style={{ display: "contents" }}>
              <dt>{what}</dt>
              <dd>{how}</dd>
            </span>
          ))}
        </dl>

        <div className="prose">
          <h2 id={anchor(SECTIONS[4])}>{SECTIONS[4]}</h2>
          <p>
            Nothing on this site has to be taken on trust where the chain can answer. Every action that lands a transaction ends with a receipt, and the receipt
            shows its signature. With the signature you can ask the chain directly, without this site:
          </p>
          <pre className="code">{`curl -s http://127.0.0.1:8799 -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "getTransaction",
  "params": ["<signature>", { "maxSupportedTransactionVersion": 0 }]
}'`}</pre>
          <ul>
            <li>
              <b className="address">meta.err</b> is null if it succeeded.
            </li>
            <li>
              <b className="address">meta.preBalances</b> and <b className="address">meta.postBalances</b> are every account&apos;s SOL before and after; the
              first account is the wallet that paid.
            </li>
            <li>
              <b className="address">meta.preTokenBalances</b> and <b className="address">meta.postTokenBalances</b> are the same for coins. The receipt
              page&apos;s &quot;spent&quot; and &quot;received&quot; lines are these numbers subtracted, and nothing else.
            </li>
            <li>
              <b className="address">meta.logMessages</b> names every program that ran, in order. Compare them with the layout above.
            </li>
          </ul>
          <p>
            To check the stand-in: the <Link href="/status">Status</Link> page gives the escrow wallet&apos;s address and, for each coin, what it holds on-chain
            beside what Ring balances add up to. Ask the chain for that wallet&apos;s balance yourself with <b className="address">getBalance</b> or{" "}
            <b className="address">getTokenAccountsByOwner</b> and compare. The first must never be below the second.
          </p>

          <h2 id={anchor(SECTIONS[5])}>{SECTIONS[5]}</h2>
          <p>
            Every server operation is described once, with its input and output types, in <span className="address">lib/contract.ts</span>. The browser, the
            tests and a small client for scripts all use that one description. Amounts are whole base units, as text on the wire and as big integers in code.
          </p>
          <pre className="code">{`import { newActor } from "./lib/keys";
import { RingClient, httpTransport } from "./lib/sdk";

const mara = new RingClient(httpTransport("http://localhost:4710"), newActor());
const coin = await mara.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: 20_000_000n, toRing: true });
await mara.transfer(ilya.address, coin.mint, 250_000_000_000n, "for the poster");`}</pre>
          <p>
            The full example is <span className="address">examples/launch-and-transfer.ts</span>. It runs as part of the test suite, so it cannot fall out of
            step with the code.
          </p>

          <h2 id={anchor(SECTIONS[6])}>{SECTIONS[6]}</h2>
          <ul>
            {LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
