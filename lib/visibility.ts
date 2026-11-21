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
}

export const VISIBILITY: Visibility[] = [
  {
    id: "launch",
    action: "Launch a coin",
    public: ["Your wallet", "The coin", "That the coin is registered with a Ring"],
    encrypted: [],
    note: "A launch on a bonding curve is fully public.",
  },
  {
    id: "curve-trade",
    action: "Buy or sell on the curve",
    public: ["Your wallet", "The coin", "The amount", "The price"],
    encrypted: [],
    note: "A Ring cannot hide a trade on the curve. This includes the creator's first buy.",
  },
  {
    id: "deposit",
    action: "Deposit to a Ring balance",
    public: ["Your wallet", "The coin", "The amount"],
    encrypted: ["Your balance afterwards"],
  },
  {
    id: "transfer",
    action: "Transfer between Ring balances",
    public: ["Your wallet", "The recipient's wallet", "The time"],
    encrypted: ["The coin", "The amount", "The memo"],
  },
  {
    id: "withdraw",
    action: "Withdraw to a wallet",
    public: ["Your wallet", "The destination", "The coin", "The amount"],
    encrypted: ["Your remaining balance"],
  },
  {
    id: "otc",
    action: "Settle an OTC block",
    public: ["The seller's wallet", "The buyer's wallet", "The time"],
    encrypted: ["The coin", "The size", "The price"],
  },
  {
    id: "creator-fees",
    action: "Claim creator fees into a Ring balance",
    public: ["Your wallet", "The coin", "The amount claimed"],
    encrypted: ["What you do with it afterwards"],
  },
  {
    id: "pay-link",
    action: "Pay through a pay link",
    public: ["The payer's wallet", "The recipient's wallet", "The time"],
    encrypted: ["The coin", "The amount"],
    note: "Anyone holding the link can read the coin and amount it asks for.",
  },
];

/** Words the Default Ring does not deliver. A test fails if the site uses them. */
export const FORBIDDEN_CLAIMS = ["anonymous", "untraceable", "hidden wallet", "private launch", "nobody can see", "fully private"];

export const visibilityOf = (id: string): Visibility => {
  const row = VISIBILITY.find((v) => v.id === id);
  if (!row) throw new Error(`no visibility row "${id}"`);
  return row;
};
