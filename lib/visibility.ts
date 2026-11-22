/**
 * What each action reveals on-chain and what it encrypts, on the permissionless Default
 * Ring. This table is the only place a privacy claim is written. The privacy panel, the
 * homepage and the docs render from it. Source: docs/RESEARCH.md, section 1.
 */
export interface Visibility {
  id: string;
  action: string;
  public: string[];
  encrypted: string[];
  note?: string;
  /** What carries this action out in this build, and the source file to read. Shown beside every claim. */
  proof: { today: string; source: string; real: boolean };
  /** What this site's own server learns when you do this, beyond what the chain shows everyone. */
  server: string;
  /**
   * Where the real Privacy Rings program is connected (devnet with a key): how the action is carried out there and
   * what this server sees. Absent: the action is the same there, or is not connected to the real program yet.
   */
  realRing?: { today: string; source: string; server: string };
}

/** Said under every action: a server always sees who is asking. */
const ASKER = "Your IP address and the time of each request, as any server does.";

export const VISIBILITY: Visibility[] = [
  {
    id: "launch",
    action: "Launch a coin",
    public: ["Your wallet", "The coin", "That the coin is registered with a Ring"],
    encrypted: [],
    note: "A launch on a bonding curve is fully public.",
    proof: {
      today: "One transaction: pump.fun create_v2, then Privacy Rings createSplInterface.",
      source: "lib/server/transactions.ts (buildLaunch)",
      real: true,
    },
    server: `${ASKER} It builds the transaction and passes it on, so it sees the launch as you sign it: all of it is public on the chain a moment later. If you add a picture, it keeps the picture.`,
  },
  {
    id: "curve-trade",
    action: "Buy or sell on the curve",
    public: ["Your wallet", "The coin", "The amount", "The price"],
    encrypted: [],
    note: "A Ring cannot hide a trade on the curve. This includes the creator's first buy.",
    proof: { today: "One transaction: pump.fun buy or sell.", source: "lib/server/pump.ts (tradeInstructions)", real: true },
    server: `${ASKER} It builds the trade and passes it on. Everything in it is public on the chain a moment later.`,
  },
  {
    id: "deposit",
    action: "Deposit to a Ring balance",
    public: ["Your wallet", "The coin", "The amount"],
    encrypted: ["Your balance afterwards"],
    proof: {
      today: "One transaction moving the coins to the stand-in escrow wallet. Under the real Ring: its deposit instruction.",
      source: "lib/server/escrow.ts (depositInstructions)",
      real: false,
    },
    server: `${ASKER} It builds the deposit and records the credit. The stand-in is a ledger on this server, so it knows your Ring balance.`,
    realRing: {
      today:
        "One transaction built in your browser by the Ring's own SDK: the Privacy Rings deposit instruction. Run end to end on devnet on 22 November 2026, through this site's wallet page (RING-RESULTS.md). It is alpha software.",
      source: "lib/client/ring-real.ts",
      server: `${ASKER} It passes the transaction on to Helius's RPC, so it sees the deposit as the chain will show it. It does not learn your Ring balance: that is worked out in your browser from records only your keys open.`,
    },
  },
  {
    id: "transfer",
    action: "Transfer between Ring balances",
    public: ["Your wallet", "The recipient's wallet", "The time"],
    encrypted: ["The coin", "The amount", "The note"],
    proof: {
      today:
        "A request signed by your wallet to the stand-in, which can read the coin and the amount. A note is sealed in your browser with libsodium and the stand-in cannot read it. Under the real Ring: an encrypted transfer on-chain.",
      source: "lib/server/ring.ts (transfer), lib/notes.ts",
      real: false,
    },
    server: `${ASKER} Everything: both wallets, the coin and the amount. The stand-in is a ledger on this server. The one thing it cannot read is the note, which is sealed in your browser.`,
    realRing: {
      today:
        "A transaction built in your browser by the Ring's own SDK. The proof is made by Helius's prover; the SDK checks the prover's enclave attestation and sends it the request encrypted. Run end to end on devnet on 22 November 2026, through this site's wallet page (RING-RESULTS.md). It is alpha software.",
      source: "lib/client/ring-real.ts, lib/server/ringgate.ts",
      server: `${ASKER} It passes your requests on to Helius's indexer and prover and adds this site's API key. The request to the prover is sealed in your browser to the prover's enclave and travels in headers this server passes on unread, so this server cannot read the coin or the amount. That the sealing is sound rests on the SDK and on Helius; we have not audited it. Helius's prover does see them.`,
    },
  },
  {
    id: "withdraw",
    action: "Withdraw to a wallet",
    public: ["Your wallet", "The destination", "The coin", "The amount"],
    encrypted: ["Your remaining balance"],
    proof: {
      today: "A signed request; the stand-in pays out with one public transaction. Under the real Ring: its withdraw instruction.",
      source: "lib/server/escrow.ts (payFromEscrow)",
      real: false,
    },
    server: `${ASKER} Everything about the withdrawal, and your balance before and after: the stand-in pays it out.`,
    realRing: {
      today:
        "A transaction built in your browser by the Ring's own SDK, with a proof from Helius's prover: the Privacy Rings withdraw instruction. Run end to end on devnet on 22 November 2026, through this site's wallet page (RING-RESULTS.md). It is alpha software.",
      source: "lib/client/ring-real.ts, lib/server/ringgate.ts",
      server: `${ASKER} It passes the transaction on, so it sees the withdrawal as the chain will show it. It does not learn your remaining balance. Helius's prover sees what the proof is about.`,
    },
  },
  {
    id: "otc",
    action: "Settle an OTC block",
    public: ["The seller's wallet", "The buyer's wallet", "The time"],
    encrypted: ["The coin", "The size", "The price"],
    proof: {
      today: "Signed requests to the stand-in, which can read the offer. Under the real Ring: two encrypted transfers.",
      source: "lib/server/operations/otc.ts",
      real: false,
    },
    server: `${ASKER} Everything: both wallets, the coin, the size and the price. The stand-in holds the offer and settles it.`,
  },
  {
    id: "creator-fees",
    action: "Claim creator fees into a Ring balance",
    public: ["Your wallet", "The coin", "The amount claimed"],
    encrypted: ["What you do with it afterwards"],
    proof: {
      today: "One transaction: pump.fun fee claim, then a deposit to the stand-in escrow.",
      source: "lib/server/transactions.ts (buildClaimFees)",
      real: false,
    },
    server: `${ASKER} It builds the claim and records the credit, so it knows the amount (public) and your Ring balance.`,
  },
  {
    id: "pay-link",
    action: "Pay through a pay link",
    public: ["The payer's wallet", "The recipient's wallet", "The time"],
    encrypted: ["The coin", "The amount"],
    note: "Anyone holding the link can read the coin and amount it asks for.",
    proof: {
      today:
        "The request sits after the # of the link, which a browser never sends to a server. Paying it is a signed request to the stand-in; the note is sealed in your browser.",
      source: "lib/paylink.ts, lib/notes.ts",
      real: false,
    },
    server: `${ASKER} Not what the link asks for: that part of the link never reaches a server. When it is paid, the stand-in sees both wallets, the coin and the amount, and not the note.`,
    realRing: {
      today:
        "The request sits after the # of the link, which a browser never sends to a server. Paying it is a Ring transfer built in your browser by the Ring's own SDK; it carries no note. A Ring transfer has been run end to end on devnet through this site's wallet page (RING-RESULTS.md); paying from a pay link on the real program has not been run by us yet.",
      source: "lib/paylink.ts, lib/client/ring-real.ts",
      server: `${ASKER} Not what the link asks for. The payment is a Ring transfer: this server passes the requests on and, by the SDK's design, cannot read the coin or the amount. Helius's prover does see them.`,
    },
  },
  {
    id: "sealed-window",
    action: "Commit to a sealed launch window",
    public: ["Your wallet", "That you committed to this window", "The window's total, when it launches", "The launch and its first buy, with the amount"],
    encrypted: ["How much you committed", "How many coins you received"],
    note: "A commitment is a transfer between Ring balances, so both ends are public. The feature is switched off unless the operator turns it on, because it holds buyers' funds.",
    proof: {
      today:
        "Signed requests to the stand-in, which holds the committed SOL in its escrow wallet and can read every amount. The stand-in does not publish who committed. The launch is one public transaction.",
      source: "lib/server/windows.ts",
      real: false,
    },
    server: `${ASKER} Everything: who committed and how much. The stand-in holds the committed SOL.`,
  },
];

/** Words the Default Ring does not deliver. A test fails if the site uses them. */
// Also ruled out until the code does it: any claim of zero-knowledge proofs. This build generates and verifies none.
export const FORBIDDEN_CLAIMS = [
  "anonymous",
  "untraceable",
  "hidden wallet",
  "private launch",
  "nobody can see",
  "fully private",
  "zero-knowledge",
  "zero knowledge",
  "zk-",
  "zk proof",
  "shielded",
];

export const visibilityOf = (id: string): Visibility => {
  const row = VISIBILITY.find((v) => v.id === id);
  if (!row) throw new Error(`no visibility row "${id}"`);
  return row;
};
