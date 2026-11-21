import { NextResponse, type NextRequest } from "next/server";
import { isOperation, run } from "@/lib/server/handlers";
import type { Input } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

async function handle(request: NextRequest, context: { params: Promise<{ op: string[] }> }): Promise<NextResponse> {
  const name = (await context.params).op.join("/");
  if (!isOperation(name)) return NextResponse.json({ error: "there is no such operation" }, { status: 404, headers: noStore });
  let input: Input;
  if (request.method === "POST") {
    const parsed: unknown = await request.json().catch(() => null);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return NextResponse.json({ error: "the request body must be a JSON object" }, { status: 400, headers: noStore });
    input = parsed as Input;
  } else {
    input = Object.fromEntries(request.nextUrl.searchParams);
  }
  try {
    return NextResponse.json(await run(name, input), { headers: noStore });
  } catch (error) {
    // `run` has already turned the failure into one plain sentence.
    const message = error instanceof Error ? error.message : String(error);
    const unreachable = message.startsWith("the chain is not answering");
    return NextResponse.json({ error: message }, { status: unreachable ? 503 : 400, headers: noStore });
  }
}
export { handle as GET, handle as POST };
