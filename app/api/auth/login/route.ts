import { NextResponse } from "next/server";
import { checkPassword } from "@/lib/password";
import { createSession, setSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
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
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = await createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
