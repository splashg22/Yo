/** Server settings, all in one place. The Helius key is read here and never reaches the browser. */

export interface Settings {
  /**
   * "mainnet" is read-only, always: the server reads Solana mainnet and can build, sign or send nothing there.
   * There is no setting that makes it trade on mainnet.
   */
  network: "local" | "devnet" | "mainnet";
  /** True on mainnet. Every operation that builds or sends a transaction is refused. */
  readOnly: boolean;
  /** Where the indexer's data comes from: whole blocks over the RPC, or Helius's transaction stream. FEED_PROVIDER. */
  feedProvider: "rpc" | "helius-ws";
  /** With a stream fed only the coins being followed: how many of the newest coins are followed trade by trade. FEED_FOLLOW_NEWEST. */
  feedFollowNewest: number;
  rpcUrl: string;
  dataDir: string;
  /** A Postgres connection string. Empty: the state is kept in a file under `dataDir`. */
  databaseUrl: string;
  /** The Postgres schema the state table lives in, so several deployments can share one database. */
  databaseSchema: string;
  /** For the devnet pass. Unused on a local validator. */
  heliusApiKey: string;
  /** This site's own address, for links it writes into a coin's details. */
  siteUrl: string;
  /** A Pinata key for keeping coin pictures on IPFS. Empty: pictures are kept in a folder on this server. */
  pinataJwt: string;
  /** How long one RPC call may take before it counts as a dead connection. */
  rpcTimeoutMs: number;
  /** Parts of the product that are built but switched off unless asked for. */
  features: Features;
  /** This site's own fee. All zero unless set: see `Fees`. */
  fees: Fees;
  /** Extra addresses a signed transaction is also sent to, beside the main RPC. */
  sendUrls: string[];
  /** Where a tip to Jito's block builders is paid. Empty: no tip is ever added. Only exists on mainnet. */
  jitoTipAccount: string;
  /** How much of the chain the indexer is fed: see FeedScope. */
  feedScope: FeedScope;
  /**
   * Which pool programs besides pump.fun's own are read, with FEED_SCOPE=all. FEED_VENUES, a comma-separated list.
   * "pump" is always read. "meteora-damm2": Meteora's DAMM v2 pools against SOL. Each one added is more stream to carry.
   */
  feedVenues: FeedVenue[];
}

/**
 * The site's own fee, off by default. Rates are in hundredths of a percent. A fee is paid by its own
 * instruction in the same transaction, to `wallet`, and is shown before anyone signs.
 */
export interface Fees {
  wallet: string;
  /** Share of the SOL a curve or pool trade moves. FEE_TRADE_BPS. */
  tradeBps: number;
  /** A fixed charge for a launch, in lamports. FEE_LAUNCH_LAMPORTS. */
  launchLamports: bigint;
  /** Share of an OTC block's price, paid by the buyer on top. FEE_OTC_BPS. */
  otcBps: number;
}
export const MAX_FEE_BPS = 300;
function feesFromEnv(): Fees {
  const bps = (name: string): number => {
    const value = Number(process.env[name] ?? "0");
    if (!Number.isInteger(value) || value < 0 || value > MAX_FEE_BPS)
      throw new Error(`${name} must be a whole number from 0 to ${MAX_FEE_BPS} (hundredths of a percent)`);
    return value;
  };
  const launch = process.env.FEE_LAUNCH_LAMPORTS ?? "0";
  if (!/^\d{1,12}$/.test(launch)) throw new Error("FEE_LAUNCH_LAMPORTS must be a whole number of lamports");
  const fees: Fees = { wallet: process.env.FEE_WALLET ?? "", tradeBps: bps("FEE_TRADE_BPS"), launchLamports: BigInt(launch), otcBps: bps("FEE_OTC_BPS") };
  if ((fees.tradeBps > 0 || fees.launchLamports > 0n || fees.otcBps > 0) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(fees.wallet))
    throw new Error("a fee is set but FEE_WALLET is not a wallet address");
  return fees;
}

export interface Features {
  /** The sealed launch window: buyers commit before a coin exists and all buy in its first transaction. Holds buyers' funds. Off unless FEATURE_SEALED_WINDOW=on. */
  sealedWindow: boolean;
  /**
   * OTC blocks and pay links. Both are built on the stand-in Ring only: neither has been run on the real program.
   * So each is on where the Ring is the stand-in on a local test chain, and off everywhere else unless its flag
   * (FEATURE_OTC, FEATURE_PAY_LINKS) is set to "on". Off: not in the menu, its page says so, the server refuses it.
   */
  otc: boolean;
  payLinks: boolean;
}

const flag = (name: string): boolean => {
  const value = process.env[name] ?? "off";
  if (value !== "on" && value !== "off") throw new Error(`${name} must be "on" or "off"`);
  return value === "on";
};

/**
 * Where the chain is reached. Local: a validator on this machine. Devnet: Helius, with the key;
 * or DEVNET_RPC_URL if that is set, which is how devnet mode is tested without a key.
 */
function rpcUrlFor(network: "local" | "devnet" | "mainnet"): string {
  if (network === "local") return process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8799";
  if (network === "mainnet") {
    if (process.env.MAINNET_RPC_URL) return process.env.MAINNET_RPC_URL;
    if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    throw new Error("RING_NETWORK is mainnet but neither HELIUS_API_KEY nor MAINNET_RPC_URL is set");
  }
  if (process.env.DEVNET_RPC_URL) return process.env.DEVNET_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  throw new Error("RING_NETWORK is devnet but neither HELIUS_API_KEY nor DEVNET_RPC_URL is set");
}

/**
 * How much of the chain the indexer is fed. FEED_SCOPE.
 * "coins" (the default): new coins, migrations, and the coins being followed. What the cheapest data plan carries.
 * "all": every pump.fun and pool trade. Coins already trading are then followed from the first trade seen. Needs a full stream.
 */
export type FeedScope = "coins" | "all";
export type FeedVenue = "pump" | "meteora-damm2";
function feedVenuesFromEnv(): FeedVenue[] {
  const named = (process.env.FEED_VENUES ?? "pump")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of named) if (name !== "pump" && name !== "meteora-damm2") throw new Error('FEED_VENUES may name "pump" and "meteora-damm2"');
  return [...new Set(["pump", ...named])] as FeedVenue[];
}
function feedScopeFromEnv(): FeedScope {
  const scope = process.env.FEED_SCOPE ?? "coins";
  if (scope !== "coins" && scope !== "all") throw new Error('FEED_SCOPE must be "coins" or "all"');
  return scope;
}

export function settings(): Settings {
  const network = process.env.RING_NETWORK ?? "local";
  if (network !== "local" && network !== "devnet" && network !== "mainnet")
    throw new Error('RING_NETWORK must be "local", "devnet" or "mainnet" (mainnet is read-only)');
  const feedProvider = process.env.FEED_PROVIDER ?? "rpc";
  if (feedProvider !== "rpc" && feedProvider !== "helius-ws") throw new Error('FEED_PROVIDER must be "rpc" or "helius-ws"');
  const feedFollowNewest = Number(process.env.FEED_FOLLOW_NEWEST ?? 300);
  if (!Number.isInteger(feedFollowNewest) || feedFollowNewest < 0 || feedFollowNewest > 40_000)
    throw new Error("FEED_FOLLOW_NEWEST must be a whole number from 0 to 40000");
  const rpcTimeoutMs = Number(process.env.RPC_TIMEOUT_MS ?? 20_000);
  if (!Number.isInteger(rpcTimeoutMs) || rpcTimeoutMs < 100) throw new Error("RPC_TIMEOUT_MS must be a whole number of milliseconds, 100 or more");
  return {
    network,
    readOnly: network === "mainnet",
    feedProvider,
    feedFollowNewest,
    rpcUrl: rpcUrlFor(network),
    dataDir: process.env.APP_DATA_DIR ?? ".data",
    databaseUrl: process.env.DATABASE_URL ?? "",
    databaseSchema: process.env.DATABASE_SCHEMA ?? "ringpad",
    heliusApiKey: process.env.HELIUS_API_KEY ?? "",
    siteUrl: (process.env.SITE_URL ?? "http://localhost:4710").replace(/\/$/, ""),
    pinataJwt: process.env.PINATA_JWT ?? "",
    rpcTimeoutMs,
    features: {
      sealedWindow: flag("FEATURE_SEALED_WINDOW"),
      otc: process.env.FEATURE_OTC === undefined ? network === "local" : flag("FEATURE_OTC"),
      payLinks: process.env.FEATURE_PAY_LINKS === undefined ? network === "local" : flag("FEATURE_PAY_LINKS"),
    },
    fees: feesFromEnv(),
    sendUrls: (process.env.SEND_RPC_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
    jitoTipAccount: process.env.JITO_TIP_ACCOUNT ?? "",
    feedScope: feedScopeFromEnv(),
    feedVenues: feedVenuesFromEnv(),
  };
}

/**
 * Whether Ring balances exist on this network in this build. They are a stand-in that runs only beside a local
 * validator. On devnet they are not connected: the real Ring has not been wired in.
 */
export function ringAvailable(): boolean {
  const { network, rpcUrl } = settings();
  return network === "local" && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname);
}
export function assertRing(): void {
  if (!ringAvailable()) throw new Error("Ring balances are not connected on this network in this build");
}

/**
 * The mock Ring holds deposited coins in an escrow wallet whose key sits on this machine.
 * That is acceptable on a local validator, where coins are worthless, and nowhere else.
 */
export function assertLocalOnly(what: string): void {
  const { network, rpcUrl } = settings();
  const host = new URL(rpcUrl).hostname;
  if (network !== "local" || !["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`${what} is a local-validator mock and refuses to run against ${host} (${network})`);
  }
}

/** What is said when anything that would build or send a transaction is asked for on mainnet. */
export const READ_ONLY_REFUSAL = "this build only reads Solana mainnet. It builds and sends nothing there: trading is switched off. Nothing was built or sent.";
/** Refuses, on mainnet, anything that would build, sign or send. Called at every door a transaction could leave by. */
export function assertMaySend(): void {
  if (settings().readOnly) throw new Error(READ_ONLY_REFUSAL);
}
