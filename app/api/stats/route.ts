import { NextResponse } from "next/server";
import { site } from "@/site.config";

/**
 * Homepage counters. They come from the chain or they are not shown: there is no
 * fallback number. Until the indexer exists (step 3) this reports that honestly.
 */
export function GET() {
  return NextResponse.json({ network: site.network, available: false, reason: "No coin has been launched here yet." });
}
