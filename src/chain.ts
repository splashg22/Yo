/**
 * Everything that touches Solana and the pump programs. Implements the
 * `Chain` interface the cycle engine uses.
 */
import fs from "node:fs";
import BN from "bn.js";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getTransferHook,
} from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  canonicalPumpPoolPdaWithQuote,
  type BondingCurve,
  type MultiHopHop,
} from "@pump-fun/pump-sdk";
import { PUMP_AMM_SDK } from "@pump-fun/pump-sdk/swap";
import type { Config } from "./config.js";
import type { Built, Chain, HolderSnapshot, SimResult, TxStatus } from "./cycle.js";
import { aggregateByOwner, snapshotViaProgramAccounts, snapshotViaTokenAccountsApi } from "./holders.js";
import type { Mints, QueueItem } from "./state.js";
import { tokenDelta } from "./txmeta.js";

/** Reads a solana-keygen file. The secret never leaves this function's result. */
export function loadKeypair(file: string): Keypair {
  let bytes: unknown;
  try {
    bytes = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`could not read a keypair file at TREASURY_KEYPAIR_PATH (${file})`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("TREASURY_KEYPAIR_PATH is not a solana-keygen keypair file");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

export interface CoinInfo {
  curve: BondingCurve;
  quoteMint: PublicKey;
  quoteProgram: PublicKey;
  quoteDecimals: number;
  burnProgram: PublicKey;
  burnDecimals: number;
  holderProgram: PublicKey;
  holderDecimals: number;
  pool: PublicKey;
}

export class SolanaChain implements Chain {
  readonly connection: Connection;
  readonly sdk: OnlinePumpSdk;
  readonly treasury: PublicKey;
  private readonly strategyMint: PublicKey;
  private readonly burnMint: PublicKey;
  private readonly holderMint: PublicKey;
  private cached: CoinInfo | null = null;
  private quoteHasHook: boolean | null = null;

  constructor(
    private readonly config: Config,
    private readonly keypair: Keypair,
  ) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.sdk = new OnlinePumpSdk(this.connection);
    this.treasury = keypair.publicKey;
    this.strategyMint = new PublicKey(config.strategyMint);
    this.burnMint = new PublicKey(config.burnMint);
    this.holderMint = new PublicKey(config.holderMint);
  }

  /** Reads the coin from the chain. Must be called once before anything else. */
  async init(): Promise<CoinInfo> {
    const owners = await this.connection.getMultipleAccountsInfo([this.strategyMint, this.burnMint, this.holderMint]);
    const names = ["STRATEGY_MINT", "BURN_MINT", "HOLDER_MINT"];
    const programs = owners.map((info, i) => {
      if (!info) throw new Error(`${names[i]} does not exist on this network`);
      if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        throw new Error(`${names[i]} is not a token mint`);
      }
      return info.owner;
    }) as [PublicKey, PublicKey, PublicKey];

    const sell = await this.sdk.fetchSellState(this.strategyMint, this.treasury, programs[0]);
    if (sell.quoteMint.equals(NATIVE_MINT)) {
      throw new Error("STRATEGY_MINT is paired with SOL. This bot only handles a token pair such as TTWO.");
    }
    if (this.config.expectedQuoteMint && sell.quoteMint.toBase58() !== this.config.expectedQuoteMint) {
      throw new Error(
        `STRATEGY_MINT is paired with ${sell.quoteMint.toBase58()}, not EXPECTED_QUOTE_MINT ${this.config.expectedQuoteMint}`,
      );
    }
    const [quote, burn, holder] = await Promise.all([
      getMint(this.connection, sell.quoteMint, "confirmed", sell.quoteTokenProgram),
      getMint(this.connection, this.burnMint, "confirmed", programs[1]),
      getMint(this.connection, this.holderMint, "confirmed", programs[2]),
    ]);
    this.quoteHasHook = getTransferHook(quote) !== null && !getTransferHook(quote)!.programId.equals(PublicKey.default);
    this.cached = {
      curve: sell.bondingCurve,
      quoteMint: sell.quoteMint,
      quoteProgram: sell.quoteTokenProgram,
      quoteDecimals: quote.decimals,
      burnProgram: programs[1],
      burnDecimals: burn.decimals,
      holderProgram: programs[2],
      holderDecimals: holder.decimals,
      pool: canonicalPumpPoolPdaWithQuote(this.strategyMint, sell.quoteMint),
    };
    return this.cached;
  }

  get info(): CoinInfo {
    if (!this.cached) throw new Error("SolanaChain.init() has not been called");
    return this.cached;
  }

  mints(): Mints {
    return {
      strategyMint: this.strategyMint.toBase58(),
      burnMint: this.burnMint.toBase58(),
      holderMint: this.holderMint.toBase58(),
      quoteMint: this.info.quoteMint.toBase58(),
    };
  }

  private quoteAta(owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(this.info.quoteMint, owner, true, this.info.quoteProgram);
  }

  private burnAta(): PublicKey {
    return getAssociatedTokenAddressSync(this.burnMint, this.treasury, true, this.info.burnProgram);
  }

  private async tokenAmount(account: PublicKey): Promise<bigint> {
    const info = await this.connection.getAccountInfo(account, "confirmed");
    if (!info || info.data.length < 72) return 0n;
    return info.data.readBigUInt64LE(64);
  }

  async balances() {
    const [sol, quote, coin] = await Promise.all([
      this.connection.getBalance(this.treasury, "confirmed"),
      this.tokenAmount(this.quoteAta(this.treasury)),
      this.tokenAmount(this.burnAta()),
    ]);
    return { sol: BigInt(sol), quote, coin };
  }

  /** Fees still sitting on the pool (after graduation), with who they belong to. */
  private async poolBucket(): Promise<{ amount: bigint; coinCreator: PublicKey } | null> {
    const account = await this.connection.getAccountInfo(this.info.pool, "confirmed");
    if (!account) return null;
    const pool = PUMP_AMM_SDK.decodePoolNullable(account);
    if (!pool) return null;
    return { amount: BigInt(pool.creatorFees.toString()), coinCreator: pool.coinCreator };
  }

  private async freshCurve(): Promise<BondingCurve> {
    return this.sdk.fetchBondingCurve(this.strategyMint);
  }

  async pendingFees(): Promise<bigint> {
    const [vaults, curve, bucket] = await Promise.all([
      this.sdk.getCreatorVaultQuoteBalances(this.treasury, [this.info.quoteMint]),
      this.freshCurve(),
      this.poolBucket(),
    ]);
    const vault = vaults.find((v) => v.mint.equals(this.info.quoteMint));
    let total = BigInt(vault?.total.toString() ?? "0");
    if (curve.creator.equals(this.treasury)) total += BigInt(curve.creatorFee.toString());
    if (bucket?.coinCreator.equals(this.treasury)) total += bucket.amount;
    return total;
  }

  private async claimInstructions(): Promise<TransactionInstruction[]> {
    const { quoteMint, quoteProgram } = this.info;
    const [curve, bucket] = await Promise.all([this.freshCurve(), this.poolBucket()]);
    const instructions: TransactionInstruction[] = [];
    // Fees from v3 trades wait on the curve / pool until swept into the vault.
    if (curve.creator.equals(this.treasury) && !curve.creatorFee.isZero()) {
      instructions.push(
        await PUMP_SDK.sweepCreatorFeeInstruction({
          payer: this.treasury, mint: this.strategyMint, creator: this.treasury, quoteMint, quoteTokenProgram: quoteProgram,
        }),
      );
    }
    if (bucket && bucket.amount > 0n && bucket.coinCreator.equals(this.treasury)) {
      instructions.push(
        await PUMP_SDK.sweepPoolCreatorFeeInstruction({
          payer: this.treasury, mint: this.strategyMint, coinCreator: this.treasury, quoteMint, quoteTokenProgram: quoteProgram,
        }),
      );
    }
    instructions.push(
      ...(await this.sdk.collectCoinCreatorFeeV2Instructions(this.treasury, quoteMint, quoteProgram, this.treasury)),
    );
    return instructions;
  }

  private async build(instructions: TransactionInstruction[], computeUnits: number): Promise<Built> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: this.treasury,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.priorityFeeMicroLamports }),
        ...instructions,
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([this.keypair]);
    return { signature: bs58.encode(tx.signatures[0]!), lastValidBlockHeight, raw: tx.serialize() };
  }

  async buildClaim(): Promise<Built> {
    return this.build(await this.claimInstructions(), 400_000);
  }

  private async route(): Promise<MultiHopHop[]> {
    return this.sdk.resolveMultiHopRoute([this.info.quoteMint, this.burnMint], "buy");
  }

  async describeRoute(): Promise<string> {
    const hops = await this.route();
    return hops
      .map((hop) => `${hop.quoteMint.toBase58()} -> ${hop.baseMint.toBase58()} on the ${hop.venue === "curve" ? "bonding curve" : "pump pool"}`)
      .join(", then ");
  }

  async buildSwap(amountIn: bigint) {
    const hops = await this.route();
    const amount = new BN(amountIn.toString());
    const out = await this.sdk.simulateMultiHopSwap({ user: this.treasury, hops, side: "buy", amountIn: amount });
    const expectedOut = BigInt(out.toString());
    const minOut = (expectedOut * BigInt(10_000 - this.config.slippageBps)) / 10_000n;
    if (minOut <= 0n) throw new Error("the swap would buy nothing");
    const instructions = await PUMP_SDK.multiHopSwapInstructions({
      user: this.treasury, hops, side: "buy", amountIn: amount, minAmountOut: new BN(minOut.toString()),
    });
    const built = await this.build(instructions, 250_000 * hops.length + 150_000);
    return { ...built, expectedOut, minOut };
  }

  async buildBurn(amount: bigint): Promise<Built> {
    return this.build(
      [createBurnCheckedInstruction(this.burnAta(), this.burnMint, this.treasury, amount, this.info.burnDecimals, [], this.info.burnProgram)],
      60_000,
    );
  }

  async buildPayout(items: readonly QueueItem[], options: { withClaim?: boolean } = {}): Promise<Built> {
    const { quoteMint, quoteProgram, quoteDecimals } = this.info;
    const source = this.quoteAta(this.treasury);
    const instructions: TransactionInstruction[] = options.withClaim ? await this.claimInstructions() : [];
    for (const item of items) {
      const owner = new PublicKey(item.owner);
      const destination = this.quoteAta(owner);
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(this.treasury, destination, owner, quoteMint, quoteProgram),
      );
      instructions.push(
        this.quoteHasHook
          ? await createTransferCheckedWithTransferHookInstruction(
              this.connection, source, quoteMint, destination, this.treasury, BigInt(item.amount), quoteDecimals, [], "confirmed", quoteProgram,
            )
          : createTransferCheckedInstruction(source, quoteMint, destination, this.treasury, BigInt(item.amount), quoteDecimals, [], quoteProgram),
      );
    }
    return this.build(instructions, 120_000 * items.length + (options.withClaim ? 400_000 : 20_000));
  }

  async simulate(built: Built): Promise<SimResult> {
    const tx = VersionedTransaction.deserialize(built.raw);
    const { value } = await this.connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    if (!value.err) return { ok: true };
    const logs = (value.logs ?? []).slice(-6).join(" | ");
    return { ok: false, error: `${JSON.stringify(value.err)}${logs ? ` — ${logs}` : ""}` };
  }

  async send(built: Built): Promise<void> {
    if (this.config.dryRun) throw new Error("DRY_RUN is on: refusing to send a transaction");
    await this.connection.sendRawTransaction(built.raw, { skipPreflight: true, maxRetries: 5 });
  }

  async status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    const { value } = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = value[0];
    if (status) {
      if (status.err) return "failed";
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return "confirmed";
      return "unknown";
    }
    // Only call it expired once a FINALIZED block is past the deadline, so a
    // transaction that could still land is never treated as dead.
    const finalizedHeight = await this.connection.getBlockHeight("finalized");
    if (finalizedHeight <= lastValidBlockHeight) return "unknown";
    const again = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    return again.value[0] ? "unknown" : "expired";
  }

  async deltas(signature: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx?.meta) {
        const owner = this.treasury.toBase58();
        return {
          quote: tokenDelta(tx.meta, owner, this.info.quoteMint.toBase58()),
          coin: tokenDelta(tx.meta, owner, this.burnMint.toBase58()),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(`could not load confirmed transaction ${signature} to read what it moved`);
  }

  async snapshotHolders(): Promise<HolderSnapshot> {
    let source = "getProgramAccounts";
    let holdings;
    try {
      holdings = await snapshotViaProgramAccounts(this.connection, this.holderMint, this.info.holderProgram);
    } catch (first) {
      try {
        holdings = await snapshotViaTokenAccountsApi(this.config.rpcUrl, this.holderMint);
        source = "getTokenAccounts (DAS)";
      } catch (second) {
        throw new Error(
          `this RPC cannot list token holders. getProgramAccounts: ${(first as Error).message}. ` +
            `getTokenAccounts: ${(second as Error).message}`,
        );
      }
    }
    const balances = aggregateByOwner(holdings);
    const excluded = new Set<string>([this.treasury.toBase58(), ...this.config.excludeWallets]);
    if (this.config.excludeProgramOwned) {
      for (const owner of balances.keys()) {
        if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes())) excluded.add(owner);
      }
    }
    return { balances, excluded, source };
  }
}
