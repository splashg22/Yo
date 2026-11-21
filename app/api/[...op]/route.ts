import { NextResponse, type NextRequest } from "next/server";
import { isOperation, run } from "@/lib/server/handlers";
import { bucketOf, callerOf, overLimit } from "@/lib/server/limit";
import type { Input } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };
/** A picture of 1.5 MB in base64, and room for the rest of the request. */
const MAX_BODY_BYTES = 2_300_000;

async function handle(request: NextRequest, context: { params: Promise<{ op: string[] }> }): Promise<NextResponse> {
  const name = (await context.params).op.join("/");
  if (!isOperation(name)) return NextResponse.json({ error: "there is no such operation" }, { status: 404, headers: noStore });
  const caller = callerOf(request.headers.get("x-forwarded-for"));
  const wait = overLimit(caller, bucketOf(name));
  if (wait > 0) {
    return NextResponse.json(
      { error: `too many requests from this address. Wait ${wait} seconds and try again. Nothing was sent.` },
      { status: 429, headers: { ...noStore, "retry-after": String(wait) } },
    );
  }
  // A request is small, except a launch carrying a picture. Anything larger is refused before it is read into memory.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES)
    return NextResponse.json({ error: "the request is too large" }, { status: 413, headers: noStore });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "the request is too large" }, { status: 413, headers: noStore });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // answered just below
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return NextResponse.json({ error: "the request body must be a JSON object" }, { status: 400, headers: noStore });
  const input = parsed as Input;
  try {
    return NextResponse.json(await run(name, input), { headers: noStore });
  } catch (error) {
    // `run` has already turned the failure into one plain sentence.
    const message = error instanceof Error ? error.message : String(error);
    const unreachable = message.startsWith("the chain is not answering");
    return NextResponse.json({ error: message }, { status: unreachable ? 503 : 400, headers: noStore });
  }
}
// POST only: an operation can change something, and a GET can be fired by a link or an image on another site.
export { handle as POST };
