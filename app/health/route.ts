import { NextResponse } from "next/server";
import { connection } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

/** For a host's health check: is the server up, and can it reach the chain. Nothing else is said. */
export async function GET(): Promise<NextResponse> {
  let chain = false;
  try {
    await connection().getSlot();
    chain = true;
  } catch {
    chain = false; // reported, not thrown: the server itself is up
  }
  return NextResponse.json({ server: true, chain }, { status: chain ? 200 : 503, headers: { "cache-control": "no-store" } });
}
