import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { isSameOriginRequest } from "@/lib/origin";

export async function POST(req: Request) {
  // Outside the proxy matcher, so check Origin here (blocks forced sign-outs).
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
