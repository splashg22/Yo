/**
 * A split withdrawal waiting to be carried out: its parts, when each is due and what became of it.
 *
 * It is kept in this browser only (localStorage), per wallet. Nothing about a plan is sent to the server before a
 * part is due: the server learns of each part when that part is withdrawn, as it would for any withdrawal.
 * Anyone who can read this browser's storage can read the plan: its amounts, times and destination. It holds no key.
 *
 * A part is sent by the page, so the page must be open and the wallet unlocked when the part comes due. A part that
 * came due while the page was closed is sent the next time the page is open.
 */
import type { PlannedPart } from "../withdraw-plan";

export type PartState = "waiting" | "sending" | "sent" | "failed" | "interrupted";
export interface QueuedPart {
  /** Base units. */
  amount: string;
  /** When it is due, in milliseconds since 1970. */
  dueAt: number;
  state: PartState;
  /** When sending began. A part "sending" for longer than a withdrawal can take was cut off. */
  startedAt?: number;
  signature?: string;
  problem?: string;
}
/** Longer than any withdrawal takes, proof included. After this a part still marked as sending was cut off. */
export const SENDING_LIMIT_MS = 3 * 60_000;
export interface QueuedPlan {
  id: string;
  mint: string;
  /** Empty: the withdrawing wallet itself. */
  destination: string;
  madeAt: number;
  parts: QueuedPart[];
}

const keyOf = (wallet: string): string => `ring.withdraw.plans.${wallet}`;
const STATES: PartState[] = ["waiting", "sending", "sent", "failed", "interrupted"];
const isPart = (value: unknown): value is QueuedPart => {
  const part = value as QueuedPart | null;
  return typeof part === "object" && part !== null && /^\d{1,30}$/.test(part.amount) && Number.isFinite(part.dueAt) && STATES.includes(part.state);
};
const isPlan = (value: unknown): value is QueuedPlan => {
  const plan = value as QueuedPlan | null;
  return (
    typeof plan === "object" &&
    plan !== null &&
    typeof plan.id === "string" &&
    typeof plan.mint === "string" &&
    typeof plan.destination === "string" &&
    Number.isFinite(plan.madeAt) &&
    Array.isArray(plan.parts) &&
    plan.parts.every(isPart)
  );
};

/**
 * Reads the plans from what was stored. A part left in "sending" for longer than a withdrawal takes was cut off by a
 * reload or a closed tab: whether it reached the chain is not known here, so it is never sent again without the
 * person saying so. Until then it may be another tab sending it, and nothing else goes out.
 */
export function parsePlans(stored: string | null, now = Date.now()): QueuedPlan[] {
  let found: unknown;
  try {
    found = JSON.parse(stored ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(found)) return [];
  return found.filter(isPlan).map((plan) => ({
    ...plan,
    parts: plan.parts.map((part) =>
      part.state === "sending" && now - (part.startedAt ?? 0) > SENDING_LIMIT_MS ? { ...part, state: "interrupted" as const } : part,
    ),
  }));
}
export function loadPlans(wallet: string): QueuedPlan[] {
  try {
    return parsePlans(localStorage.getItem(keyOf(wallet)));
  } catch {
    return [];
  }
}
export function savePlans(wallet: string, plans: QueuedPlan[]): void {
  try {
    if (plans.length === 0) localStorage.removeItem(keyOf(wallet));
    else localStorage.setItem(keyOf(wallet), JSON.stringify(plans));
  } catch {
    /* storage is full or switched off: the plan lives as long as the page does, and the page says so */
  }
}

export function newPlan(input: { id: string; mint: string; destination: string; parts: PlannedPart[]; now: number }): QueuedPlan {
  return {
    id: input.id,
    mint: input.mint,
    destination: input.destination,
    madeAt: input.now,
    parts: input.parts.map((part) => ({ amount: part.amount.toString(), dueAt: input.now + part.afterMs, state: "waiting" })),
  };
}

/** The earliest part that is due and still waiting, across every plan. One at a time: parts never go out side by side. */
export function nextDue(plans: QueuedPlan[], now: number): { plan: string; index: number } | null {
  let best: { plan: string; index: number } | null = null;
  let bestDue = Infinity;
  for (const plan of plans) {
    for (const [index, part] of plan.parts.entries()) {
      if (part.state === "sending") return null;
      if (part.state === "waiting" && part.dueAt <= now && part.dueAt < bestDue) {
        best = { plan: plan.id, index };
        bestDue = part.dueAt;
      }
    }
  }
  return best;
}

export function withPart(plans: QueuedPlan[], plan: string, index: number, patch: Partial<QueuedPart>): QueuedPlan[] {
  return plans.map((entry) => (entry.id === plan ? { ...entry, parts: entry.parts.map((part, at) => (at === index ? { ...part, ...patch } : part)) } : entry));
}
/** A plan is over when nothing in it is still to be sent or in doubt. */
export const planOver = (plan: QueuedPlan): boolean => plan.parts.every((part) => part.state === "sent");
/** What a plan still holds back: the parts not yet sent, in base units. */
export const planOutstanding = (plan: QueuedPlan): bigint => plan.parts.reduce((sum, part) => (part.state === "sent" ? sum : sum + BigInt(part.amount)), 0n);
