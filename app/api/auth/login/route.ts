import { NextResponse } from "next/server";
import { checkPassword } from "@/lib/password";
import {
  createSession,
  knownDeviceId,
  setDeviceCookie,
  setSessionCookie,
} from "@/lib/session";
import { isSameOriginRequest } from "@/lib/origin";
import { beginLoginAttempt, clearLoginFailures, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // This route is outside the proxy matcher, so it does its own Origin check.
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  // Count this attempt before checking the password (atomic with the lock
  // check), so parallel guesses can't all slip past the limit.
  const ip = clientIp(req);
  const deviceId = await knownDeviceId();
  const lockedMs = await beginLoginAttempt(ip, deviceId);
  if (lockedMs > 0) {
    const minutes = Math.ceil(lockedMs / 60_000);
    return NextResponse.json(
      {
        error: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(lockedMs / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password =
    typeof body === "object" && body !== null && "password" in body
      ? String((body as { password: unknown }).password ?? "")
      : "";

  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }
  // Long inputs only burn scrypt CPU; no real password is this long.
  if (password.length > 1024 || !(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  await clearLoginFailures(ip, deviceId);
  const token = await createSession();
  await setSessionCookie(token);
  await setDeviceCookie();
  return NextResponse.json({ ok: true });
}
