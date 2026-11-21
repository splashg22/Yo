import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { recipientsIn } from "../../lib/server/pump";

const A = "9GDepfBcjJMvNgmijXWVWa97Am7VZYCqXx7kJV44E9ij";
const B = "DDMCfwbcaNYTeMk1ca8tr8BQKFaUfFCWFwBJq8JcnyCw";
const C = "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL";
/** A key from another copy of web3.js: same shape, not an instance of our PublicKey class. */
const foreign = (text: string) => ({ toBase58: () => text, equals: () => false });

describe("finding pump.fun's fee wallets in its decoded accounts", () => {
  it("finds keys that are not instances of this module's PublicKey class (the built server's case)", () => {
    const global = { feeRecipient: foreign(A), feeRecipients: [foreign(B)], nested: { buybackFeeRecipients: [foreign(C), foreign(A)] } };
    expect(foreign(A)).not.toBeInstanceOf(PublicKey);
    expect(recipientsIn(global).sort()).toEqual([A, B, C].sort());
  });
  it("finds this module's own keys too, and reads more than one account", () => {
    expect(recipientsIn({ feeRecipient: new PublicKey(A) }, { reservedFeeRecipients: [new PublicKey(B)] }).sort()).toEqual([A, B].sort());
  });
  it("ignores keys that are not fee recipients, empty slots, numbers and missing accounts", () => {
    const global = { authority: foreign(A), feeRecipients: [new PublicKey(PublicKey.default.toBase58()), foreign(B)], feeBasisPoints: 95, creatorFee: null };
    expect(recipientsIn(global, null, undefined)).toEqual([B]);
  });
});
