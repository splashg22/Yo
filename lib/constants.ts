/** Facts shared by the server and the browser. */

/** How SOL is named wherever a coin address is expected. */
export const NATIVE = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;
/** Every pump.fun coin has six decimals. */
export const COIN_DECIMALS = 6;
/** The largest amount a Solana program can hold in one field. */
export const U64_MAX = 2n ** 64n - 1n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const decimalsOf = (mint: string): number => (mint === NATIVE ? SOL_DECIMALS : COIN_DECIMALS);
