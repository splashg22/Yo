/** Sealing a note in the browser, to the recipient's published key, before anything is sent. */
import { sealNote, type SealedNote } from "../notes";
import { api, type Signer } from "./api";

export async function sealNoteFor(signer: Signer, recipient: string, text: string): Promise<SealedNote | undefined> {
  if (!text.trim()) return undefined;
  if (!signer.noteKeys) throw new Error("notes need a wallet made in this browser. Send without a note, or use that wallet.");
  const { key } = await api("ring/note-key", { wallet: recipient });
  if (!key) throw new Error("the recipient has not published a note key yet, so a note cannot be sealed to them. Send without a note.");
  return sealNote(text, key, await signer.noteKeys());
}
