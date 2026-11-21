/**
 * A private preview. When PREVIEW_PASSWORD is set, every page, every request and every live connection asks
 * for it (any user name) before anything is served, so a deployed copy is not open to passers-by.
 * The health check stays open so a host can tell the server is up; it says nothing else.
 */
/** Compares in constant time, so the answer does not leak how much of a guess was right. */
function same(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}
/** True if the request may go ahead: no password is set, or the right one was given. */
export function previewAllows(authorization: string | undefined): boolean {
  const password = process.env.PREVIEW_PASSWORD;
  if (!password) return true;
  if (!authorization?.startsWith("Basic ")) return false;
  let given = "";
  try {
    given = atob(authorization.slice(6)).split(":").slice(1).join(":");
  } catch {
    given = ""; // not base64: treated as a wrong password
  }
  return same(given, password);
}
