/** What changed, by day. Each entry is something in the repository's history; nothing is listed before it was built. */
export const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: "2026-11-21",
    changes: [
      "Research on what a Privacy Ring hides and what stays public; the plan.",
      "Homepage with the scroll-driven sequence and the site-wide background, on stand-in media.",
      "A local test chain holding copies of the real pump.fun and Privacy Rings programs.",
      "Launch: create a coin on the curve and register it with the Ring in one signature, with an optional first buy.",
      "Ring wallet with a simulated Ring ledger: deposit, transfer, withdraw.",
      "Explore with the privacy score, a page per coin, buying and selling, creator fees into the Ring.",
      "OTC blocks to a named buyer. Pay links with QR codes. A wallet made in the browser with an encrypted backup.",
      "Audit pass: deposits are credited by the server the moment it submits them; a withdrawal with an uncertain outcome is held, not guessed; listings are checked against the chain; prices are whole numbers end to end.",
      "A status page read live from the chain, a receipt page per transaction, and this changelog.",
      "Second audit pass, from a fresh chain: first buys failed in the built site because pump.fun's fee wallets were not funded; the test faucet reported a payment it had not made when pressed twice. Both fixed.",
      "Recent public transactions on each coin and wallet page, read from the chain. Receipts show what the paying wallet spent and received.",
      "Explore can be searched and ordered. The docs have a contents list. A designed page for addresses that do not exist.",
      "A technical page: the programs called, whose logic is whose, how a launch is laid out, who you are trusting, and how to check a transaction yourself. The SDK example now runs inside the tests.",
      "The site and its local chain moved to ports of their own.",
      "Phones: every control at least 44px tall; the scroll sequence fits short and very narrow screens; nothing moves when late data arrives.",
    ],
  },
];
