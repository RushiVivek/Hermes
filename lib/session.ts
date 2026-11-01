import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getPasswordHash } from "./password";

export const SESSION_COOKIE_NAME = "hermes_session";
const ALG = "HS256";
const TTL = 60 * 60 * 24 * 30; // 30 days

/** "Known device" marker set on successful login. Not a credential — it only
 * swaps the global login backstop for a per-device limit (lib/rate-limit.ts).
 * Survives sign-out; a password change invalidates it (the key is bound to
 * the password hash). 400 days is the browser maximum. */
export const DEVICE_COOKIE_NAME = "hermes_device";
const DEVICE_TTL = 60 * 60 * 24 * 400;

const keyCache = new Map<string, Uint8Array>();

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a 32+ char string.");
  }
  return secret;
}

/** HMAC-SHA256(SESSION_SECRET, label) as a JWT key. Web Crypto so it runs in
 * both the proxy and route handlers. */
async function deriveKey(label: string): Promise<Uint8Array> {
  const secret = sessionSecret();
  const source = `${secret}\u0000${label}`;
  const cached = keyCache.get(source);
  if (cached) return cached;
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const key = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(label)));
  keyCache.set(source, key);
  return key;
}

/** Session key is bound to the password hash, so changing the password (or
 * rotating SESSION_SECRET) signs every device out — old cookies stop
 * verifying. */
async function getKey(): Promise<Uint8Array> {
  return deriveKey(getPasswordHash());
}

/** Device key is bound to the password hash too, so a password change voids
 * every device cookie along with every session. The prefix keeps it distinct
 * from the session key, so the two token kinds can't be swapped. */
function getDeviceKey(): Promise<Uint8Array> {
  return deriveKey(`hermes-known-device-v1:${getPasswordHash()}`);
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

export async function setDeviceCookie() {
  // Random per-device id: rate-limit.ts gives each known device its own
  // attempt bucket, so a leaked cookie can't be replayed from many IPs.
  const token = await new SignJWT({ device: true })
    .setProtectedHeader({ alg: ALG })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_TTL}s`)
    .sign(await getDeviceKey());
  const store = await cookies();
  store.set(DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_TTL,
  });
}

/** The verified device id from the known-device cookie, or null. */
export async function knownDeviceId(): Promise<string | null> {
  const token = (await cookies()).get(DEVICE_COOKIE_NAME)?.value;
  if (!token) return null;
  const key = await getDeviceKey();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    return typeof payload.jti === "string" && /^[0-9a-f-]{36}$/.test(payload.jti)
      ? payload.jti
      : null;
  } catch {
    return null;
  }
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
