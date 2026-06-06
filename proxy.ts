import { NextResponse, type NextRequest } from "next/server";
import { isAuthedFromToken, SESSION_COOKIE_NAME } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = await isAuthedFromToken(token);
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except: login page, login API, static assets, favicon
  matcher: [
    "/((?!login|api/auth/login|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|robots.txt|icons).*)",
  ],
};
