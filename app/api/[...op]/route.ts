import { NextResponse, type NextRequest } from "next/server";
import { run } from "@/lib/server/handlers";

export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ op: string[] }> }) {
  const op = (await context.params).op.join("/");
  try {
    const input = request.method === "POST" ? await request.json().catch(() => ({})) : Object.fromEntries(request.nextUrl.searchParams);
    return NextResponse.json(await run(op, input), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // A person reads this. Keep the first line: chain errors carry pages of logs after it.
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);
    return NextResponse.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
export { handle as GET, handle as POST };
