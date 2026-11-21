/**
 * pump.fun, through its own SDK: the real program. Builds launches, trades and fee claims
 * for the wallet to sign, and reads a coin's bonding curve.
 */
import { getCreateSplInterfaceInstructionAsync } from "@heliuslabs/spr/instructions";
import type * as PumpSdk from "@pump-fun/pump-sdk";
import { address, isSignerRole, isWritableRole, type Instruction } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "node:module";
import { COIN_DECIMALS, NATIVE } from "../constants";
import { connection } from "./solana";
import { pumpSettings, tokenProgramOf } from "./warm";

export { tokenProgramOf };

// The pump SDK only loads as CommonJS: one of its dependencies breaks under ES modules.
const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;
const NATIVE_KEY = new PublicKey(NATIVE);
const MICRO = 1_000_000n;
const toBig = (value: BN): bigint => BigInt(value.toString());
const toBN = (value: bigint): BN => new BN(value.toString());

/** pump.fun's settings, from the warm cache: read from the chain once a minute at most. */
export async function pumpState() {
  return { online: new sdk.OnlinePumpSdk(connection()), ...(await pumpSettings()) };
}

const toWeb3 = (instruction: Instruction): TransactionInstruction =>
  new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((meta) => ({
      pubkey: new PublicKey(meta.address),
      isSigner: isSignerRole(meta.role),
      isWritable: isWritableRole(meta.role),
    })),
    data: Buffer.from(instruction.data ?? []),
  });

/** The Privacy Rings instruction that registers a coin with the Ring. The real program. */
async function registerWithRing(wallet: PublicKey, mint: PublicKey): Promise<TransactionInstruction> {
  return toWeb3(
    await getCreateSplInterfaceInstructionAsync({
      authority: address(wallet.toBase58()),
      mint: address(mint.toBase58()),
      tokenProgram: address(TOKEN_2022_PROGRAM_ID.toBase58()),
    }),
  );
}

export interface LaunchPlan {
  instructions: TransactionInstruction[];
  /** Coins the first buy will deliver, in base units. Zero without a first buy. */
  firstBuyTokens: bigint;
}

/** Create the coin on the curve, optionally make the first buy, register the coin with the Ring. */
export async function launchInstructions(input: {
  wallet: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  firstBuyLamports: bigint;
  /** Who makes the first buy and receives the coins. The creator, unless a sealed window's pool is buying. */
  buyer?: PublicKey;
}): Promise<LaunchPlan> {
  const { global, feeConfig } = await pumpState();
  const common = { mint: input.mint, name: input.name, symbol: input.symbol, uri: input.uri, creator: input.wallet, user: input.wallet, mayhemMode: false };
  const instructions: TransactionInstruction[] = [];
  let firstBuyTokens = 0n;
  if (input.firstBuyLamports > 0n) {
    const solAmount = toBN(input.firstBuyLamports);
    const amount = sdk.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_KEY });
    firstBuyTokens = toBig(amount);
    if (firstBuyTokens <= 0n) throw new Error("the first buy is too small to buy anything");
    const buyer = input.buyer ?? input.wallet;
    const built = await sdk.PUMP_SDK.createV2AndBuyInstructions({ ...common, user: buyer, global, solAmount, amount });
    if (!buyer.equals(input.wallet)) {
      // The SDK has the buyer create the coin too. Here the creator creates and pays for it, and only the buy is the pool's.
      const create = await sdk.PUMP_SDK.createV2Instruction(common);
      const index = built.findIndex(
        (instruction) => instruction.programId.equals(create.programId) && instruction.data.subarray(0, 8).equals(create.data.subarray(0, 8)),
      );
      if (index < 0) throw new Error("the launch could not be built for a pooled first buy");
      built[index] = create;
    }
    instructions.push(...built);
  } else {
    instructions.push(await sdk.PUMP_SDK.createV2Instruction(common));
  }
  instructions.push(await registerWithRing(input.wallet, input.mint));
  return { instructions, firstBuyTokens };
}

export interface TradePlan {
  instructions: TransactionInstruction[];
  /** What the trade should deliver at the current price: coins for a buy, lamports for a sell. */
  expected: bigint;
  /** Lamports the trade moves at the current price: paid on a buy, received on a sell. What a fee is a share of. */
  lamports: bigint;
}

/** The balance in a token account's data, or zero if there is no account. */
const heldIn = (info: { data: Buffer } | null): bigint => (info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n);

/**
 * A public buy (amount in lamports) or sell (amount in coin base units) on the curve.
 * One call to the chain: the curve and the wallet's coin account, read together. Everything else is warm.
 */
export async function tradeInstructions(input: {
  wallet: PublicKey;
  mint: PublicKey;
  side: "buy" | "sell";
  amount: bigint;
  slippagePercent: number;
  /** Known to have graduated: go straight to the pool, without reading the curve first. */
  graduated?: boolean;
}): Promise<TradePlan> {
  if (input.graduated) return poolTradeInstructions(input);
  const [{ global, feeConfig }, tokenProgram] = await Promise.all([pumpSettings(), tokenProgramOf(input.mint.toBase58())]);
  const [bondingCurveAccountInfo, associatedUserAccountInfo] = await connection().getMultipleAccountsInfo([
    sdk.bondingCurvePda(input.mint),
    getAssociatedTokenAddressSync(input.mint, input.wallet, true, tokenProgram),
  ]);
  if (!bondingCurveAccountInfo) throw new Error("that coin has no bonding curve on this chain");
  const bondingCurve = sdk.PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);
  // A curve that has sold out no longer trades. The coin trades in its pool from then on, if the pool has been made.
  if (bondingCurve.complete) return poolTradeInstructions(input);
  if (input.side === "buy") {
    const solAmount = toBN(input.amount);
    const amount = sdk.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: solAmount,
      quoteMint: NATIVE_KEY,
    });
    if (toBig(amount) <= 0n) throw new Error("that is too little SOL to buy anything");
    const instructions = await sdk.PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo: associatedUserAccountInfo ?? null,
      mint: input.mint,
      user: input.wallet,
      amount,
      solAmount,
      slippage: input.slippagePercent,
      tokenProgram,
    });
    return { instructions, expected: toBig(amount), lamports: input.amount };
  }
  const held = heldIn(associatedUserAccountInfo ?? null);
  if (held < input.amount) throw new Error(held === 0n ? "you hold none of this coin in your wallet" : "you hold less than that in your wallet");
  const amount = toBN(input.amount);
  const solAmount = sdk.getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount });
  if (toBig(solAmount) <= 0n) throw new Error("that is too few coins to sell for anything");
  const instructions = await sdk.PUMP_SDK.sellInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    mint: input.mint,
    user: input.wallet,
    amount,
    solAmount,
    slippage: input.slippagePercent,
    tokenProgram,
    mayhemMode: false,
  });
  return { instructions, expected: toBig(solAmount), lamports: toBig(solAmount) };
}

// ---- after graduation: the coin's pool ------------------------------------------------------------

interface SwapState {
  pool: {
    coinCreator: PublicKey;
    creator: PublicKey;
    virtualQuoteReserves: BN;
    protocolFees: BN;
    creatorFees: BN;
    quoteMint: PublicKey;
    isMayhemMode: boolean;
    creatorFeeBps: BN;
  };
  poolBaseAmount: BN;
  poolQuoteAmount: BN;
  userBaseAccountInfo: { data: Buffer } | null;
  [key: string]: unknown;
}
interface SwapSdk {
  OnlinePumpAmmSdk: new (chain: unknown) => { swapSolanaState(pool: PublicKey, user: PublicKey): Promise<SwapState> };
  PumpAmmSdk: new () => {
    buyInstructions(state: SwapState, baseOut: BN, maxQuoteIn: BN): Promise<TransactionInstruction[]>;
    sellInstructions(state: SwapState, baseIn: BN, minQuoteOut: BN): Promise<TransactionInstruction[]>;
  };
  buyQuoteInput(input: Record<string, unknown>): { base: BN; maxQuote: BN };
  sellBaseInput(input: Record<string, unknown>): { uiQuote: BN; minQuote: BN };
  GLOBAL_CONFIG_PDA: PublicKey;
  PUMP_AMM_FEE_CONFIG_PDA: PublicKey;
}
const swap = createRequire(import.meta.url)("@pump-fun/pump-sdk/swap") as SwapSdk;
const WSOL = "So11111111111111111111111111111111111111112";

/** Accounts that do not change from one trade to the next (the pool program's settings, a pool's own record, a coin's mint), kept for a minute. */
const settled = new Map<string, { at: number; info: unknown }>();
const SETTLED_MS = 60_000;
/**
 * The chain as the pool SDK sees it: the same connection, except that accounts known not to change are
 * answered from memory. The SDK asks for a pool's state in three batches; with this, two of them reach the chain.
 */
function throughCache(steady: Set<string>) {
  const chain = connection();
  return new Proxy(chain, {
    get(target, property, receiver) {
      if (property !== "getMultipleAccountsInfo") return Reflect.get(target, property, receiver) as unknown;
      return async (keys: PublicKey[], ...rest: unknown[]) => {
        const now = Date.now();
        const answers = new Array<unknown>(keys.length);
        const missing: number[] = [];
        keys.forEach((key, index) => {
          const kept = settled.get(`${chain.rpcEndpoint}|${key.toBase58()}`);
          if (kept && now - kept.at < SETTLED_MS) answers[index] = kept.info;
          else missing.push(index);
        });
        if (missing.length > 0) {
          const fetched = await (target.getMultipleAccountsInfo as (keys: PublicKey[], ...rest: unknown[]) => Promise<unknown[]>)(
            missing.map((index) => keys[index]!),
            ...rest,
          );
          missing.forEach((index, place) => {
            answers[index] = fetched[place];
            const key = keys[index]!.toBase58();
            if (steady.has(key) && fetched[place] !== null) settled.set(`${chain.rpcEndpoint}|${key}`, { at: now, info: fetched[place] });
          });
        }
        return answers;
      };
    },
  });
}

/** A public buy or sell of a graduated coin, in its pump.fun pool. */
async function poolTradeInstructions(input: {
  wallet: PublicKey;
  mint: PublicKey;
  side: "buy" | "sell";
  amount: bigint;
  slippagePercent: number;
}): Promise<TradePlan> {
  const pool = sdk.canonicalPumpPoolPda(input.mint);
  const steady = new Set([swap.GLOBAL_CONFIG_PDA.toBase58(), swap.PUMP_AMM_FEE_CONFIG_PDA.toBase58(), pool.toBase58(), input.mint.toBase58(), WSOL]);
  let state: SwapState;
  try {
    state = await new swap.OnlinePumpAmmSdk(throughCache(steady)).swapSolanaState(pool, input.wallet);
  } catch (error) {
    if (/Pool account not found/.test(String(error)))
      throw new Error("this coin has sold out its curve and its pool has not been made yet. It cannot be traded until it has.");
    throw error;
  }
  const common = {
    slippage: input.slippagePercent,
    quoteTransferFee: state.quoteTransferFee,
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves,
    baseMintAccount: state.baseMintAccount,
    baseMint: state.baseMint,
    coinCreator: state.pool.coinCreator,
    creator: state.pool.creator,
    feeConfig: state.feeConfig,
    globalConfig: state.globalConfig,
    quoteMint: state.pool.quoteMint,
    isMayhemMode: state.pool.isMayhemMode,
    creatorFeeBps: state.pool.creatorFeeBps,
  };
  const amm = new swap.PumpAmmSdk();
  if (input.side === "buy") {
    const quote = swap.buyQuoteInput({ ...common, quote: toBN(input.amount), tradeV2: false });
    if (toBig(quote.base) <= 0n) throw new Error("that is too little SOL to buy anything");
    return { instructions: await amm.buyInstructions(state, quote.base, quote.maxQuote), expected: toBig(quote.base), lamports: input.amount };
  }
  const held = heldIn(state.userBaseAccountInfo);
  if (held < input.amount) throw new Error(held === 0n ? "you hold none of this coin in your wallet" : "you hold less than that in your wallet");
  const quote = swap.sellBaseInput({ ...common, base: toBN(input.amount), feeBucketsTotal: state.pool.protocolFees.add(state.pool.creatorFees) });
  if (toBig(quote.uiQuote) <= 0n) throw new Error("that is too few coins to sell for anything");
  return {
    instructions: await amm.sellInstructions(state, toBN(input.amount), quote.minQuote),
    expected: toBig(quote.uiQuote),
    lamports: toBig(quote.uiQuote),
  };
}

/**
 * Moves a sold-out curve's coins and SOL into its pool. pump.fun's program lets anyone do this once the curve
 * is complete; on its main network its own service does it within moments. Here whoever is first may.
 */
export async function graduateInstructions(wallet: PublicKey, mint: PublicKey): Promise<TransactionInstruction[]> {
  const [{ global }, tokenProgram] = await Promise.all([pumpSettings(), tokenProgramOf(mint.toBase58())]);
  const [curveInfo, poolInfo] = await connection().getMultipleAccountsInfo([sdk.bondingCurvePda(mint), sdk.canonicalPumpPoolPda(mint)]);
  if (!curveInfo) throw new Error("that coin has no bonding curve on this chain");
  if (!sdk.PUMP_SDK.decodeBondingCurve(curveInfo).complete) throw new Error("this coin's curve has not sold out yet, so there is nothing to move to a pool");
  if (poolInfo) throw new Error("this coin's pool has already been made");
  return [await sdk.PUMP_SDK.migrateInstruction({ withdrawAuthority: global.withdrawAuthority, mint, user: wallet, tokenProgram })];
}

export async function claimableFees(wallet: string): Promise<bigint> {
  const { online } = await pumpState();
  return toBig(await online.getCreatorVaultBalance(new PublicKey(wallet)));
}
export async function claimFeesInstructions(wallet: PublicKey): Promise<TransactionInstruction[]> {
  const { online } = await pumpState();
  return online.collectCoinCreatorFeeInstructions(wallet);
}

export interface Curve {
  supply: bigint;
  marketCapLamports: bigint;
  /**
   * The price of one whole coin in millionths of a lamport. One coin costs far less than
   * a lamport, so a whole number of lamports would round every price to zero.
   */
  microLamportsPerCoin: bigint;
  complete: boolean;
  creator: string;
}

/** The curve's public state for one coin. */
export async function curveOf(mint: string): Promise<Curve> {
  const { online } = await pumpState();
  const curve = await online.fetchBondingCurve(new PublicKey(mint));
  const marketCap = sdk.bondingCurveMarketCap({
    mintSupply: curve.tokenTotalSupply,
    virtualQuoteReserves: curve.virtualQuoteReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });
  const virtualTokens = toBig(curve.virtualTokenReserves);
  return {
    supply: toBig(curve.tokenTotalSupply),
    marketCapLamports: toBig(marketCap),
    microLamportsPerCoin: virtualTokens > 0n ? (toBig(curve.virtualQuoteReserves) * 10n ** BigInt(COIN_DECIMALS) * MICRO) / virtualTokens : 0n,
    complete: curve.complete,
    creator: curve.creator.toBase58(),
  };
}

/** The account that holds a coin's bonding curve: every buy and sell touches it. */
export const curveAddress = (mint: string): PublicKey => sdk.bondingCurvePda(new PublicKey(mint));

export async function curveExists(mint: string): Promise<boolean> {
  return (await connection().getAccountInfo(sdk.bondingCurvePda(new PublicKey(mint)))) !== null;
}

/**
 * Every wallet named as a fee recipient anywhere in a decoded pump.fun account.
 * Keys are recognised by shape, not by class: the pump SDK is loaded as CommonJS and can
 * carry its own copy of web3.js, whose keys are not instances of ours. Checking the class
 * found no wallets at all in the built server, so none were funded and every first buy failed.
 */
export function recipientsIn(...decoded: unknown[]): string[] {
  const found = new Set<string>();
  const collect = (value: unknown, key: string): void => {
    if (Array.isArray(value)) value.forEach((item) => collect(item, key));
    else if (isKeyLike(value)) {
      const text = value.toBase58();
      if (/recipient/i.test(key) && text !== EMPTY_KEY) found.add(text);
    } else if (value && typeof value === "object" && !BN.isBN(value)) for (const [name, inner] of Object.entries(value)) collect(inner, name);
  };
  for (const account of decoded) collect(account, "");
  return [...found];
}
const EMPTY_KEY = PublicKey.default.toBase58();
const isKeyLike = (value: unknown): value is { toBase58: () => string } =>
  typeof value === "object" && value !== null && "toBase58" in value && typeof value.toBase58 === "function";

/** Every fee wallet pump.fun's configuration names. Needed once, to fund them on a fresh local chain. */
export async function feeWallets(): Promise<PublicKey[]> {
  const { global, feeConfig } = await pumpState();
  const wallets = recipientsIn(global, feeConfig);
  if (wallets.length === 0) throw new Error("pump.fun's fee wallets could not be read from its accounts");
  return wallets.map((key) => new PublicKey(key));
}
