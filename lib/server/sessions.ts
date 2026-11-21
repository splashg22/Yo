/**
 * Sessions: one wallet signature opens a short-lived session, and a session is enough to read that wallet's
 * own records and to upload a picture. Anything that moves a balance still takes its own signature.
 *
 * A session is a random token. The server keeps only its hash, in memory: a restart ends every session, and
 * the wallet signs once more. Nothing a session allows can move anything.
 */
import { createHash, randomBytes } from "node:crypto";

export const sessionMinutes = (): number => {
  const minutes = Number(process.env.SESSION_MINUTES ?? "60");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) throw new Error("SESSION_MINUTES must be a whole number from 1 to 720");
  return minutes;
};
const MAX_SESSIONS = 100_000;
const sessions = new Map<string, { wallet: string; expiresAt: number }>();
const hashOf = (token: string): string => createHash("sha256").update(token).digest("base64");

export function openSession(wallet: string, now = Date.now()): { token: string; expiresAt: number } {
  if (sessions.size >= MAX_SESSIONS) for (const [key, entry] of sessions) if (entry.expiresAt <= now) sessions.delete(key);
  if (sessions.size >= MAX_SESSIONS) throw new Error("the server has too many open sessions. Try again in a few minutes.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + sessionMinutes() * 60_000;
  sessions.set(hashOf(token), { wallet, expiresAt });
  return { token, expiresAt };
}
/** The wallet a session belongs to. Throws one plain sentence if the session is unknown or over. */
export function walletOfSession(token: unknown, now = Date.now()): string {
  const found = typeof token === "string" && token.length >= 32 && token.length <= 64 ? sessions.get(hashOf(token)) : undefined;
  if (!found || found.expiresAt <= now) {
    if (found && typeof token === "string") sessions.delete(hashOf(token));
    throw new Error("your session has ended. Sign in with your wallet again.");
  }
  return found.wallet;
}
export function closeSession(token: unknown): void {
  if (typeof token === "string") sessions.delete(hashOf(token));
}
/** Tests only. */
export const forgetSessions = (): void => sessions.clear();
