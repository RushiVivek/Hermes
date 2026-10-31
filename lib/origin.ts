// CSRF defense in depth (on top of the SameSite=Lax session cookie): reject
// state-changing requests whose Origin isn't this site.
//
// Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE, so a
// forged cross-site request is caught. A missing Origin means a non-browser
// client (curl, scripts), which can't ride a victim's cookie anyway.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSameOrigin(
  method: string,
  origin: string | null,
  host: string | null,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (origin === null) return true;
  if (!host) return false;
  try {
    // "null" (sandboxed iframes, file://) fails to parse → rejected.
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isSameOriginRequest(req: Request): boolean {
  return isSameOrigin(req.method, req.headers.get("origin"), req.headers.get("host"));
}
