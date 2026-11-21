import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { canonical, signRequest, verifyRequest } from "../../lib/auth";
import { decryptBackup, encryptBackup } from "../../lib/backup";
import { newActor, signMessage } from "../../lib/keys";
import { checkPayRequest, parsePayLink, payLink } from "../../lib/paylink";
import { explain, isUnreachable } from "../../lib/server/solana";
import { addressOf, amountOf, plainText, signatureOf } from "../../lib/server/validate";

const FAST = { N: 2 ** 14, r: 8, p: 1 };

describe("signed requests", () => {
  const wallet = newActor();
  const sign = (op: string, payload: object, at?: number) => signRequest(op, wallet.address, payload, (message) => signMessage(wallet, message), at);

  it("sign the same bytes whatever order the fields are in", () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(canonical({ a: [2, { d: 3 }], b: 1 }));
  });
  it("verify once, for the right action, from the right wallet, in time", async () => {
    const used: string[] = [];
    const request = await sign("ring/mine", { mint: "x" });
    expect(verifyRequest("ring/mine", request, used).wallet).toBe(wallet.address);
    expect(() => verifyRequest("ring/mine", request, used)).toThrow(/already used/);
    expect(() => verifyRequest("ring/withdraw", request, [])).toThrow(/different action/);
    expect(() => verifyRequest("ring/mine", { ...request, body: { ...request.body, mint: "y" } }, [])).toThrow(/does not match the wallet/);
    expect(() => verifyRequest("ring/mine", { ...request, signature: "@@not base64@@" }, [])).toThrow(/does not match the wallet/);
    expect(() => verifyRequest("ring/mine", { ...request, body: { ...request.body, wallet: newActor().address } }, [])).toThrow(/does not match the wallet/);
  });
  it("refuse a request from the past or the future", async () => {
    expect(() => verifyRequest("ring/mine", {} as never, [])).toThrow(/must be signed/);
    await expect(sign("ring/mine", {}, Date.now() - 91_000).then((request) => verifyRequest("ring/mine", request, []))).rejects.toThrow(/too old/);
    await expect(sign("ring/mine", {}, Date.now() + 91_000).then((request) => verifyRequest("ring/mine", request, []))).rejects.toThrow(/too old/);
  });
  it("keep the list of used requests bounded", async () => {
    const used = Array.from({ length: 5_000 }, (_, index) => `w:${index}`);
    verifyRequest("ring/mine", await sign("ring/mine", {}), used);
    expect(used).toHaveLength(5_000);
  });
});

describe("the encrypted wallet backup", () => {
  it("restores the same key, and shows only the address without the password", () => {
    const wallet = newActor();
    const text = JSON.stringify(encryptBackup(wallet, "correct horse battery", FAST));
    expect(text).toContain(wallet.address);
    expect(text).not.toContain(Buffer.from(wallet.seed).toString("base64"));
    const restored = decryptBackup(JSON.parse(text), "correct horse battery");
    expect(restored.address).toBe(wallet.address);
    expect([...restored.seed]).toEqual([...wallet.seed]);
  });
  it("uses a fresh salt and nonce each time", () => {
    const wallet = newActor();
    const first = encryptBackup(wallet, "correct horse battery", FAST),
      second = encryptBackup(wallet, "correct horse battery", FAST);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
  });
  it("refuses a wrong or short password and any altered file", () => {
    const wallet = newActor();
    expect(() => encryptBackup(wallet, "short")).toThrow(/8 characters/);
    const backup = encryptBackup(wallet, "correct horse battery", FAST);
    expect(() => decryptBackup(backup, "wrong horse battery")).toThrow(/wrong password/);
    expect(() => decryptBackup({ ...backup, address: newActor().address }, "correct horse battery")).toThrow(/wrong password/);
    expect(() => decryptBackup({ ...backup, kdf: { ...backup.kdf, N: 2 } }, "correct horse battery")).toThrow(/unexpected settings/);
    expect(() => decryptBackup({ ...backup, kdf: { ...backup.kdf, N: 2 ** 30 } }, "correct horse battery")).toThrow(/unexpected settings/);
    expect(() => decryptBackup({ hello: "world" }, "correct horse battery")).toThrow(/not a wallet backup/);
    expect(() => decryptBackup(null, "correct horse battery")).toThrow(/not a wallet backup/);
  });
});

describe("pay links", () => {
  const to = newActor().address,
    mint = newActor().address;
  it("carry the recipient, coin, amount and memo, and nothing else", () => {
    const link = payLink("https://example.test", { to, mint, amount: "2500000", memo: "  two prints  " });
    expect(parsePayLink(link)).toEqual({ to, mint, amount: "2500000", memo: "two prints" });
    expect(new URL(link).pathname).toBe("/pay");
    expect([...new URL(link).searchParams.keys()].sort()).toEqual(["amount", "coin", "memo", "to"]);
    expect(parsePayLink(payLink("https://example.test", { to, mint, amount: "1" })).memo).toBeUndefined();
  });
  it("keep the address exactly as it is, case included", () => {
    expect(new URL(payLink("https://example.test", { to, mint, amount: "1" })).searchParams.get("to")).toBe(to);
  });
  it("reject anything tampered with or malformed", () => {
    const good = payLink("https://example.test", { to, mint, amount: "1" });
    for (const bad of [
      good.replace(to, "nobody"),

      good.replace("amount=1", "amount=-5"),
      good.replace("amount=1", "amount=1.5"),
      good.replace("amount=1", "amount=0"),
      good.replace("amount=1", `amount=${"9".repeat(40)}`),
      good.replace(`coin=${mint}`, "coin=x"),
      "https://example.test/pay",
      "::::",
    ]) {
      expect(() => parsePayLink(bad), bad).toThrow();
    }
    expect(() => checkPayRequest({ to, mint })).toThrow(/amount/);
    // Changing an address's case gives a different address or none at all: never the original.
    const lowered = good.replace(to, to.toLowerCase());
    try {
      expect(parsePayLink(lowered).to).not.toBe(to);
    } catch (error) {
      expect(String(error)).toMatch(/valid recipient/);
    }
  });
});

describe("what the server accepts", () => {
  it("addresses: base58, 32 bytes, nothing else", () => {
    const address = newActor().address;
    expect(addressOf(` ${address} `, "wallet address")).toBe(address);
    for (const bad of [undefined, null, 42, "", "0OIl", "abc", `${address}x`, bs58.encode(new Uint8Array(31).fill(7)), bs58.encode(new Uint8Array(33).fill(7))])
      expect(() => addressOf(bad, "wallet address"), String(bad)).toThrow(/wallet address is (missing|not a valid Solana address)/);
  });
  it("amounts: whole base units, above zero, within what the chain holds", () => {
    expect(amountOf("18446744073709551615", "amount")).toBe(2n ** 64n - 1n);
    for (const bad of [undefined, 5, "", "1.5", "-1", " 1", "1e3", "0x1", "9".repeat(31)])
      expect(() => amountOf(bad, "amount"), String(bad)).toThrow(/whole number of base units/);
    expect(() => amountOf("0", "amount")).toThrow(/above zero/);
    expect(() => amountOf("18446744073709551616", "amount")).toThrow(/larger than the chain can hold/);
  });
  it("names and memos: printable text only", () => {
    expect(plainText("  Lantern  ", "coin name", 32)).toBe("Lantern");
    expect(plainText("Señor 🏮", "coin name", 32)).toBe("Señor 🏮");
    for (const bad of ["a\u0000b", "a\nb", "a‮b", "a​b"]) expect(() => plainText(bad, "coin name", 32)).toThrow(/cannot be shown/);
    expect(() => plainText("x".repeat(33), "coin name", 32)).toThrow(/too long/);
    expect(() => plainText("   ", "coin name", 32)).toThrow(/missing/);
  });
  it("signatures: base58, 64 bytes", () => {
    expect(() => signatureOf("1".repeat(88))).toThrow(/not a transaction signature/);
    expect(() => signatureOf(undefined)).toThrow(/not a transaction signature/);
  });
});

describe("failures from the chain, in plain words", () => {
  it("knows when the chain could not be reached at all", () => {
    for (const error of [
      new TypeError("fetch failed"),
      Object.assign(new Error("x"), { name: "TimeoutError" }),
      new Error("connect ECONNREFUSED 127.0.0.1:1"),
      new Error("The operation was aborted"),
    ]) {
      expect(isUnreachable(error)).toBe(true);
      expect(explain(error)).toBe("the chain is not answering. Nothing was sent. Try again in a moment.");
    }
    expect(isUnreachable(new Error("custom program error: 0x1775"))).toBe(false);
  });
  it("names the common reasons", () => {
    expect(
      explain(
        Object.assign(new Error("Simulation failed"), {
          logs: ["Program log: Error Message: The bonding curve has completed and liquidity migrated to raydium.."],
        }),
      ),
    ).toBe("the program refused it: The bonding curve has completed and liquidity migrated to raydium");
    expect(explain(new Error("Transfer: insufficient lamports 5, need 10"))).toMatch(/not enough in the wallet/);
    expect(explain(new Error("Blockhash not found"))).toMatch(/expired/);
    expect(explain(new Error("first line\nsecond line with a stack"))).toBe("first line");
    expect(explain("a plain string")).toBe("a plain string");
  });
});
