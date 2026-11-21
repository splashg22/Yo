import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../../lib/bytes";
import { newActor } from "../../lib/keys";
import { NOTE_MAX_CHARACTERS, SEALED_NOTE_MAX_LENGTH, noteKeysFor, openNote, sealNote } from "../../lib/notes";

describe("sealed notes", () => {
  it("are opened by the recipient and by the sender, and by nobody else", async () => {
    const [mara, ilya, other] = await Promise.all([noteKeysFor(newActor().seed), noteKeysFor(newActor().seed), noteKeysFor(newActor().seed)]);
    const sealed = await sealNote("for the poster", toBase64(ilya.publicKey), mara);
    expect(await openNote(sealed.forRecipient, ilya)).toBe("for the poster");
    expect(await openNote(sealed.forSender, mara)).toBe("for the poster");
    expect(await openNote(sealed.forRecipient, mara)).toBeNull();
    expect(await openNote(sealed.forSender, ilya)).toBeNull();
    expect(await openNote(sealed.forRecipient, other)).toBeNull();
  });

  it("do not contain the text, differ every time, and are refused if one byte is changed", async () => {
    const [mara, ilya] = await Promise.all([noteKeysFor(newActor().seed), noteKeysFor(newActor().seed)]);
    const first = await sealNote("two prints", toBase64(ilya.publicKey), mara);
    const second = await sealNote("two prints", toBase64(ilya.publicKey), mara);
    expect(first.forRecipient).not.toBe(second.forRecipient);
    expect(Buffer.from(fromBase64(first.forRecipient)).toString("latin1")).not.toContain("two prints");
    // 48 bytes of overhead around the text, and nothing more.
    expect(fromBase64(first.forRecipient)).toHaveLength(48 + "two prints".length);
    const altered = fromBase64(first.forRecipient);
    altered[altered.length - 1]! ^= 1;
    expect(await openNote(toBase64(altered), ilya)).toBeNull();
    expect(await openNote("not base64 at all", ilya)).toBeNull();
  });

  it("give the same key pair for the same wallet every time, and a different one for a different wallet", async () => {
    const wallet = newActor();
    const [once, again, another] = await Promise.all([noteKeysFor(wallet.seed), noteKeysFor(wallet.seed), noteKeysFor(newActor().seed)]);
    expect(toBase64(once.publicKey)).toBe(toBase64(again.publicKey));
    expect(toBase64(once.publicKey)).not.toBe(toBase64(another.publicKey));
    // The note key is not the wallet's signing key, nor its seed.
    expect(toBase64(once.privateKey)).not.toBe(toBase64(wallet.seed));
  });

  it("refuse text that is too long or cannot be shown, and a recipient key of the wrong size; the longest allowed note fits the size limit", async () => {
    const [mara, ilya] = await Promise.all([noteKeysFor(newActor().seed), noteKeysFor(newActor().seed)]);
    const key = toBase64(ilya.publicKey);
    await expect(sealNote("x".repeat(NOTE_MAX_CHARACTERS + 1), key, mara)).rejects.toThrow(/longer than 140/);
    await expect(sealNote("hidden‮text", key, mara)).rejects.toThrow(/cannot be shown/);
    await expect(sealNote("hello", toBase64(new Uint8Array(31)), mara)).rejects.toThrow(/note key is not valid/);
    const longest = await sealNote("\u{1F9FF}".repeat(NOTE_MAX_CHARACTERS), key, mara); // 140 four-byte characters
    expect(longest.forRecipient.length).toBeLessThanOrEqual(SEALED_NOTE_MAX_LENGTH);
    expect(await openNote(longest.forRecipient, ilya)).toBe("\u{1F9FF}".repeat(NOTE_MAX_CHARACTERS));
  });
});
