// Login brute-force protection, persisted in Firestore so it survives
// restarts (Render's free tier sleeps and wakes often).
//
// Two limits:
//   - per client IP: 5 attempts in 15 min → locked 15 min, doubling on each
//     repeat lockout (capped at 24 h); a successful login resets it.
//   - global backstop: 100 attempts in 1 h across all IPs → logins paused
//     15 min, EXCEPT from "known devices" (a signed cookie with a random id,
//     set on a previous successful login, lib/session.ts) — so a distributed
//     attacker can't lock the family out. A known device instead gets its own
//     bucket (same policy as an IP) keyed by that id, so a leaked cookie
//     can't be replayed from many IPs. Signed-in devices are unaffected.
//
// Attempts are counted *before* the password is checked, inside one
// transaction with the lock check (beginLoginAttempt). Checking first and
// recording after would let a burst of parallel guesses all pass the check.
//
// The policy math is pure (recordFailure / lockRemaining / decideAttempt) and
// unit-tested; the Firestore wrappers below just load/store the state.

import { createHash } from "node:crypto";
import { getDb } from "./firestore";

export const LOGIN_ATTEMPTS_COLLECTION = "login_attempts";
const GLOBAL_DOC_ID = "global";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export interface Policy {
  maxFailures: number;
  windowMs: number;
  baseLockMs: number;
  maxLockMs: number;
}

export const IP_POLICY: Policy = {
  maxFailures: 5,
  windowMs: 15 * MIN,
  baseLockMs: 15 * MIN,
  maxLockMs: 24 * HOUR,
};

export const GLOBAL_POLICY: Policy = {
  maxFailures: 100,
  windowMs: HOUR,
  baseLockMs: 15 * MIN,
  maxLockMs: 15 * MIN,
};

export interface AttemptState {
  failures: number;
  window_start: number;
  locked_until: number;
  /** Consecutive lockouts — drives the doubling. */
  lockouts: number;
}

const EMPTY: AttemptState = { failures: 0, window_start: 0, locked_until: 0, lockouts: 0 };

/** Milliseconds until `state` unlocks (0 = not locked). */
export function lockRemaining(state: AttemptState | undefined, now: number): number {
  return state ? Math.max(0, state.locked_until - now) : 0;
}

/** State after one more failed attempt at `now`. */
export function recordFailure(
  prev: AttemptState | undefined,
  now: number,
  policy: Policy,
): AttemptState {
  const s = { ...EMPTY, ...prev };
  // A full max-lock period of good behaviour after the last lockout forgives
  // the escalation history.
  if (s.lockouts > 0 && now - s.locked_until > policy.maxLockMs) s.lockouts = 0;

  if (now - s.window_start > policy.windowMs) {
    s.failures = 0;
    s.window_start = now;
  }
  s.failures += 1;

  if (s.failures >= policy.maxFailures) {
    const lockMs = Math.min(policy.baseLockMs * 2 ** s.lockouts, policy.maxLockMs);
    s.lockouts += 1;
    s.locked_until = now + lockMs;
    s.failures = 0;
    s.window_start = now;
  }
  return s;
}

/** Reserve one login attempt: if no applicable limit is locked, count the
 * attempt and allow it; otherwise refuse without counting. A known device
 * (`device` given) answers to its own bucket instead of the global lock;
 * its attempts still count toward the global total. */
export function decideAttempt(
  ip: AttemptState | undefined,
  global: AttemptState | undefined,
  now: number,
  device?: { state: AttemptState | undefined },
): { lockedMs: number; ip?: AttemptState; global?: AttemptState; device?: AttemptState } {
  const lockedMs = Math.max(
    lockRemaining(ip, now),
    device ? lockRemaining(device.state, now) : lockRemaining(global, now),
  );
  if (lockedMs > 0) return { lockedMs };
  return {
    lockedMs: 0,
    ip: recordFailure(ip, now, IP_POLICY),
    global: recordFailure(global, now, GLOBAL_POLICY),
    device: device ? recordFailure(device.state, now, IP_POLICY) : undefined,
  };
}

/** Client IP for rate limiting. Every Render service sits behind Cloudflare,
 * which overwrites CF-Connecting-IP with the real client address, so it can't
 * be forged on Render. (True-Client-IP is deliberately NOT read: Cloudflare
 * only sets it on some plans, otherwise a client-sent value passes through.)
 * X-Forwarded-For is only a local-dev fallback: Render appends to a
 * client-supplied value, so on Render its entries can be forged or be shared
 * edge addresses. If IPs were ever spoofable, the global backstop still caps
 * an attacker, who has no known-device cookie. */
export function clientIp(req: Request): string {
  const trusted = req.headers.get("cf-connecting-ip");
  if (trusted?.trim()) return trusted.trim();
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
  return last || "unknown";
}

// --- Firestore persistence ------------------------------------------------

function ipDocId(ip: string): string {
  // Hash so raw IPs aren't stored; hex can't collide with the other ids.
  return createHash("sha256").update(ip).digest("hex");
}

function deviceDocId(deviceId: string): string {
  return `device-${deviceId}`;
}

function col() {
  return getDb().collection(LOGIN_ATTEMPTS_COLLECTION);
}

function asState(data: FirebaseFirestore.DocumentData | undefined): AttemptState | undefined {
  if (!data) return undefined;
  return {
    failures: Number(data.failures) || 0,
    window_start: Number(data.window_start) || 0,
    locked_until: Number(data.locked_until) || 0,
    lockouts: Number(data.lockouts) || 0,
  };
}

/** Atomically check the locks and count this attempt (see decideAttempt).
 * Returns milliseconds until the caller may try again; 0 = go ahead and
 * check the password. Firestore serializes transactions on the same docs,
 * so parallel requests can't all slip past the check. */
export async function beginLoginAttempt(
  ip: string,
  deviceId: string | null,
): Promise<number> {
  const ipRef = col().doc(ipDocId(ip));
  const globalRef = col().doc(GLOBAL_DOC_ID);
  const deviceRef = deviceId ? col().doc(deviceDocId(deviceId)) : null;
  return await getDb().runTransaction(async (tx) => {
    const [ipSnap, globalSnap, deviceSnap] = await Promise.all([
      tx.get(ipRef),
      tx.get(globalRef),
      deviceRef ? tx.get(deviceRef) : Promise.resolve(null),
    ]);
    const d = decideAttempt(
      asState(ipSnap.data()),
      asState(globalSnap.data()),
      Date.now(),
      deviceSnap ? { state: asState(deviceSnap.data()) } : undefined,
    );
    if (d.ip) tx.set(ipRef, d.ip);
    if (d.global) tx.set(globalRef, d.global);
    if (d.device && deviceRef) tx.set(deviceRef, d.device);
    return d.lockedMs;
  });
}

/** After a correct password: forget this IP's (and device's) counted attempts. */
export async function clearLoginFailures(ip: string, deviceId: string | null): Promise<void> {
  await Promise.all([
    col().doc(ipDocId(ip)).delete(),
    deviceId ? col().doc(deviceDocId(deviceId)).delete() : null,
  ]);
}
