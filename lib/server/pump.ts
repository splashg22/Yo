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

// The pump SDK only loads as CommonJS: one of its dependencies breaks under ES modules.
const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;
const NATIVE_KEY = new PublicKey(NATIVE);
const MICRO = 1_000_000n;
const toBig = (value: BN): bigint => BigInt(value.toString());
const toBN = (value: bigint): BN => new BN(value.toString());

export async function pumpState() {
  const online = new sdk.OnlinePumpSdk(connection());
  // The fee configuration account is optional on-chain; without it the SDK falls back to the global rates.
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  return { online, global, feeConfig };
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
    instructions.push(...(await sdk.PUMP_SDK.createV2AndBuyInstructions({ ...common, global, solAmount, amount })));
  } else {
    instructions.push(await sdk.PUMP_SDK.createV2Instruction(common));
  }
  instructions.push(await registerWithRing(input.wallet, input.mint));
  return { instructions, firstBuyTokens };
}

export async function tokenProgramOf(mint: string): Promise<PublicKey> {
  const info = await connection().getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error("that coin does not exist on this chain");
  return info.owner;
}

export interface TradePlan {
  instructions: TransactionInstruction[];
  /** What the trade should deliver at the current price: coins for a buy, lamports for a sell. */
  expected: bigint;
}

/** A public buy (amount in lamports) or sell (amount in coin base units) on the curve. */
export async function tradeInstructions(input: {
  wallet: PublicKey;
  mint: PublicKey;
  side: "buy" | "sell";
  amount: bigint;
  slippagePercent: number;
}): Promise<TradePlan> {
  const { online, global, feeConfig } = await pumpState();
  const tokenProgram = await tokenProgramOf(input.mint.toBase58());
  if (input.side === "buy") {
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = await online.fetchBuyState(input.mint, input.wallet, tokenProgram);
    if (bondingCurve.complete) throw new Error("this curve has completed; the coin no longer trades here");
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
      associatedUserAccountInfo,
      mint: input.mint,
      user: input.wallet,
      amount,
      solAmount,
      slippage: input.slippagePercent,
      tokenProgram,
    });
    return { instructions, expected: toBig(amount) };
  }
  const held = await connection()
    .getTokenAccountBalance(getAssociatedTokenAddressSync(input.mint, input.wallet, true, tokenProgram))
    .then(
      (balance) => BigInt(balance.value.amount),
      (error: unknown) => {
        if (/could not find account|Invalid param/i.test(String(error))) return 0n; // the wallet has never held this coin
        throw error;
      },
    );
  if (held < input.amount) throw new Error(held === 0n ? "you hold none of this coin in your wallet" : "you hold less than that in your wallet");
  const { bondingCurveAccountInfo, bondingCurve } = await online.fetchSellState(input.mint, input.wallet, tokenProgram);
  if (bondingCurve.complete) throw new Error("this curve has completed; the coin no longer trades here");
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
  return { instructions, expected: toBig(solAmount) };
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
