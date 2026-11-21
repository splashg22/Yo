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
}

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
  },
  {
    id: "curve-trade",
    action: "Buy or sell on the curve",
    public: ["Your wallet", "The coin", "The amount", "The price"],
    encrypted: [],
    note: "A Ring cannot hide a trade on the curve. This includes the creator's first buy.",
    proof: { today: "One transaction: pump.fun buy or sell.", source: "lib/server/pump.ts (tradeInstructions)", real: true },
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
