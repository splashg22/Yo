/** Reading what a confirmed transaction actually moved. */

interface TokenBalanceRow {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/** Net change of `owner`'s holdings of `mint` in one transaction's metadata. */
export function tokenDelta(
  meta: { preTokenBalances?: TokenBalanceRow[] | null; postTokenBalances?: TokenBalanceRow[] | null },
  owner: string,
  mint: string,
): bigint {
  const total = (rows: TokenBalanceRow[] | null | undefined) =>
    (rows ?? [])
      .filter((row) => row.owner === owner && row.mint === mint)
      .reduce((acc, row) => acc + BigInt(row.uiTokenAmount.amount), 0n);
  return total(meta.postTokenBalances) - total(meta.preTokenBalances);
}
