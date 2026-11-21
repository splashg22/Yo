/**
 * A private preview. When PREVIEW_PASSWORD is set, every page and every request asks for
 * it (any user name) before anything is served, so a deployed copy is not open to passers-by.
 * Unset, the site is served as it is: that is the case on a developer's machine.
 * The health check stays open so a host can tell the server is up; it says nothing else.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Compares in constant time, so the answer does not leak how much of a guess was right. */
function same(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

export function proxy(request: NextRequest): NextResponse {
  const password = process.env.PREVIEW_PASSWORD;
  if (!password || request.nextUrl.pathname === "/health") return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let given = "";
    try {
      given = atob(header.slice(6)).split(":").slice(1).join(":");
    } catch {
      given = ""; // not base64: treated as a wrong password
    }
    if (same(given, password)) return NextResponse.next();
  }
  return new NextResponse("This preview is private.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Private preview", charset="UTF-8"', "cache-control": "no-store" },
  });
}
