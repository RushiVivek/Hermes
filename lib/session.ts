import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getPasswordHash } from "./password";

export const SESSION_COOKIE_NAME = "hermes_session";
const ALG = "HS256";
const TTL = 60 * 60 * 24 * 30; // 30 days

let cachedKey: { source: string; key: Uint8Array } | null = null;

/** JWT signing key = HMAC-SHA256(SESSION_SECRET, HERMES_PASSWORD_HASH).
 * Binding the key to the password hash means changing the password (or
 * rotating SESSION_SECRET) signs every device out — old cookies stop
 * verifying. Web Crypto so it runs in both the proxy and route handlers. */
async function getKey(): Promise<Uint8Array> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a 32+ char string.");
  }
  const passwordHash = getPasswordHash();
  const source = `${secret}\u0000${passwordHash}`;
  if (cachedKey?.source === source) return cachedKey.key;

  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const key = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(passwordHash)));
  cachedKey = { source, key };
  return key;
}

export async function createSession(): Promise<string> {
  return await new SignJWT({ ok: true })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL}s`)
    .sign(await getKey());
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function isValidSession(token?: string): Promise<boolean> {
  if (!token) return false;
  // Derive the key BEFORE the try/catch so a config error (missing/short
  // SESSION_SECRET, bad password hash) propagates as a 500 instead of looking
  // like a normal failed auth — otherwise the user just sees a redirect loop.
  const key = await getKey();
  try {
    await jwtVerify(token, key, { algorithms: [ALG] });
    return true;
  } catch {
    return false;
  }
}
