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
    ],
  },
];
