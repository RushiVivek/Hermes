import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { isSameOriginRequest } from "@/lib/origin";

export async function proxy(req: NextRequest) {
  // Reject cross-site writes before anything else (CSRF defense in depth).
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = await isValidSession(token);
  if (ok) return NextResponse.next();

  // For API routes, redirecting to /login would make fetch() follow the 302
  // and return the login HTML as a 200 — silently looking like success.
  // Return JSON 401 instead so callers can surface the failure.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except: login page, login API, static assets, favicon.
  // Each alternative is anchored with `(?:/|$)` so a future `/login-help` or
  // `/icons-debug` route doesn't accidentally inherit the auth bypass.
  matcher: [
    // /api/auth/logout is excluded so a stuck/stale session can clear its own
    // cookie via POST /api/auth/logout without first having to be valid.
    // /api/health is excluded so Render's (unauthenticated) health probe gets
    // a 200 instead of a 401.
    "/((?!login(?:/|$)|api/auth/login(?:/|$)|api/auth/logout(?:/|$)|api/health(?:/|$)|_next/static/|_next/image/|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|robots\\.txt$|icons/).*)",
  ],
};
