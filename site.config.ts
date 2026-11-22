/**
 * Everything that names or positions the brand lives here.
 * To rename the project, change `name`. Nothing else spells it out.
 */
export const site = {
  name: "RINGPAD",
  /**
   * Who runs the site, for the legal pages. Placeholders until the owner decides: anything in
   * square brackets is shown on the page marked as not yet filled in.
   */
  operator: {
    name: "[OPERATOR NAME: TO BE FILLED IN]",
    country: "[COUNTRY: TO BE FILLED IN]",
    contact: "[CONTACT EMAIL: TO BE FILLED IN]",
  },
  description:
    "Launch a coin on a pump.fun curve, register it with a Privacy Ring, and move it between Ring balances without publishing the coin or the amount.",
  /** Where the object's centre sits in every frame of brand/hero.mp4, as a share of the frame width. */
  objectX: 0.64,
  /**
   * The five callouts of the exploded view. `y` is the height of each layer's near rim in
   * brand/layers.png, as a share of the image height; `edge` is how far that rim reaches
   * from the image's centre line, as a share of its width. Re-measure when the real render lands.
   */
  layers: [
    { n: "01", label: "Your wallet", text: "Your address is public on every deposit, transfer and withdrawal.", y: 0.265, edge: 0.205 },
    { n: "02", label: "The coin", text: "A Ring encrypts which coin you sent in a transfer between Ring balances.", y: 0.395, edge: 0.2 },
    { n: "03", label: "The amount", text: "It encrypts how much you sent in the same transfer.", y: 0.525, edge: 0.2 },
    { n: "04", label: "The Ring", text: "A Ring keeps your balance encrypted on-chain. Simulated in this build.", y: 0.655, edge: 0.2 },
    { n: "05", label: "The public chain", text: "Deposits, withdrawals and every curve trade are public, amounts included.", y: 0.79, edge: 0.195 },
  ],
} as const;

export const nav = [
  { href: "/explore", label: "Explore" },
  { href: "/terminal", label: "Terminal" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/launch", label: "Launch" },
  { href: "/wallet", label: "Ring wallet" },
  { href: "/otc", label: "OTC" },
  { href: "/pay", label: "Pay" },
  { href: "/docs", label: "Docs" },
] as const;

export const footerLinks = [
  { href: "/docs", label: "Docs" },
  { href: "/technical", label: "Technical" },
  { href: "/status", label: "Status" },
  { href: "/changelog", label: "Changelog" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy Policy" },
] as const;
