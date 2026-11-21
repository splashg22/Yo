/** Amounts are whole numbers of base units everywhere. These turn them into and out of what a person types. */
export function parseAmount(text: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`"${text}" is not a positive number`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`"${text}" has more than ${decimals} decimal places`);
  return BigInt(match[1]!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}
export function formatAmount(amount: bigint | string, decimals: number, places = decimals): string {
  const value = BigInt(amount);
  const digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(digits.length - decimals).slice(0, places).replace(/0+$/, "");
  return `${value < 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
export const SOL_DECIMALS = 9;
export const COIN_DECIMALS = 6;
