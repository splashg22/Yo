import { storedFile } from "@/lib/server/pictures";

/** Serves coin pictures and description files kept on this server. Only names this site made itself are answered. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  const file = storedFile((await context.params).name);
  if (!file) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.type,
      // The name is a hash of the contents, so what it names never changes.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // Shown as an image or read as data, never run: no script, no framing.
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
