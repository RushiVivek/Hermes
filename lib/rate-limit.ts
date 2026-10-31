// Login brute-force protection, persisted in Firestore so it survives
// restarts (Render's free tier sleeps and wakes often).
//
// Two limits:
//   - per client IP: 5 failures in 15 min → locked 15 min, doubling on each
//     repeat lockout (capped at 24 h); a successful login resets it.
//   - global backstop: 100 failures in 1 h across all IPs → all *new* logins
//     paused 15 min. Devices already signed in are unaffected.
//
// The policy math is pure (recordFailure / lockRemaining) and unit-tested;
// the Firestore wrappers below just load/store the state.

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

/** Client IP for rate limiting. Render's proxy *appends* the address it saw
 * to X-Forwarded-For, so the rightmost entry is trustworthy; anything to its
 * left was supplied by the client and can be forged. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
  return last || "unknown";
}

// --- Firestore persistence ------------------------------------------------

function ipDocId(ip: string): string {
  // Hash so raw IPs aren't stored; hex can't collide with GLOBAL_DOC_ID.
  return createHash("sha256").update(ip).digest("hex");
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

/** Milliseconds until this IP may try again (0 = allowed now). */
export async function loginLockRemaining(ip: string): Promise<number> {
  const now = Date.now();
  const [ipSnap, globalSnap] = await Promise.all([
    col().doc(ipDocId(ip)).get(),
    col().doc(GLOBAL_DOC_ID).get(),
  ]);
  return Math.max(
    lockRemaining(asState(ipSnap.data()), now),
    lockRemaining(asState(globalSnap.data()), now),
  );
}

export async function recordLoginFailure(ip: string): Promise<void> {
  const ipRef = col().doc(ipDocId(ip));
  const globalRef = col().doc(GLOBAL_DOC_ID);
  await getDb().runTransaction(async (tx) => {
    const [ipSnap, globalSnap] = await Promise.all([tx.get(ipRef), tx.get(globalRef)]);
    const now = Date.now();
    tx.set(ipRef, recordFailure(asState(ipSnap.data()), now, IP_POLICY));
    tx.set(globalRef, recordFailure(asState(globalSnap.data()), now, GLOBAL_POLICY));
  });
}

export async function clearLoginFailures(ip: string): Promise<void> {
  await col().doc(ipDocId(ip)).delete();
}
