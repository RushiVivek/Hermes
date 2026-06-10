import { NextResponse } from "next/server";

// Liveness probe for Render's health check (and any future keep-alive ping).
// Deliberately does no Firestore/Buzzheavier work — it only confirms the
// process is up and serving. Must stay outside the auth proxy (see proxy.ts
// matcher) so an unauthenticated prober gets 200, not a redirect.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
