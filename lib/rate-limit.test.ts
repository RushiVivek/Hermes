import { describe, expect, it } from "vitest";
import {
  GLOBAL_POLICY,
  IP_POLICY,
  clientIp,
  decideAttempt,
  lockRemaining,
  recordFailure,
  type AttemptState,
} from "./rate-limit";

const MIN = 60 * 1000;

function failN(n: number, start: AttemptState | undefined, now: number, policy = IP_POLICY) {
  let s = start;
  for (let i = 0; i < n; i++) s = recordFailure(s, now, policy);
  return s!;
}

describe("recordFailure (per-IP policy)", () => {
  it("doesn't lock below the threshold", () => {
    const s = failN(4, undefined, 1000);
    expect(lockRemaining(s, 1000)).toBe(0);
  });

  it("locks for 15 min on the 5th failure", () => {
    const s = failN(5, undefined, 1000);
    expect(lockRemaining(s, 1000)).toBe(15 * MIN);
    expect(lockRemaining(s, 1000 + 15 * MIN)).toBe(0);
  });

  it("forgets failures once the window passes", () => {
    const s = failN(4, undefined, 0);
    const later = recordFailure(s, 16 * MIN, IP_POLICY);
    expect(later.failures).toBe(1);
    expect(lockRemaining(later, 16 * MIN)).toBe(0);
  });

  it("doubles the lock on each repeat lockout, capped at 24 h", () => {
    let s: AttemptState | undefined;
    let now = 0;
    const locks: number[] = [];
    for (let i = 0; i < 9; i++) {
      s = failN(5, s, now);
      locks.push(lockRemaining(s, now));
      now = s.locked_until; // try again the moment it unlocks
    }
    expect(locks.slice(0, 4)).toEqual([15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN]);
    expect(Math.max(...locks)).toBe(24 * 60 * MIN);
  });

  it("forgives escalation after a full max-lock period of quiet", () => {
    let s = failN(5, undefined, 0);
    s = failN(5, s, s.locked_until); // second lockout: 30 min
    const quiet = s.locked_until + 25 * 60 * MIN;
    s = failN(5, s, quiet);
    expect(lockRemaining(s, quiet)).toBe(15 * MIN);
  });
});

describe("recordFailure (global policy)", () => {
  it("pauses all logins after 100 failures in an hour, without escalating", () => {
    let s = failN(100, undefined, 0, GLOBAL_POLICY);
    expect(lockRemaining(s, 0)).toBe(15 * MIN);
    s = failN(100, s, s.locked_until, GLOBAL_POLICY);
    expect(lockRemaining(s, s.locked_until - 15 * MIN)).toBe(15 * MIN);
  });
});

describe("decideAttempt", () => {
  it("counts the attempt up front: exactly 5 allowed, the 6th refused uncounted", () => {
    let ip: AttemptState | undefined;
    let global: AttemptState | undefined;
    for (let i = 0; i < 5; i++) {
      const d = decideAttempt(ip, global, 0, false);
      expect(d.lockedMs).toBe(0);
      ip = d.ip;
      global = d.global;
    }
    const sixth = decideAttempt(ip, global, 0, false);
    expect(sixth.lockedMs).toBe(15 * MIN);
    expect(sixth.ip).toBeUndefined(); // a refused attempt writes nothing
    expect(sixth.global).toBeUndefined();
  });

  it("lets a known device past the global backstop", () => {
    const global = failN(100, undefined, 0, GLOBAL_POLICY);
    expect(decideAttempt(undefined, global, 0, false).lockedMs).toBe(15 * MIN);
    expect(decideAttempt(undefined, global, 0, true).lockedMs).toBe(0);
  });

  it("still applies the per-IP lock to a known device", () => {
    const ip = failN(5, undefined, 0);
    expect(decideAttempt(ip, undefined, 0, true).lockedMs).toBe(15 * MIN);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://x/", { headers });

  it("prefers Cloudflare's CF-Connecting-IP over a forgeable X-Forwarded-For", () => {
    expect(
      clientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6, 9.9.9.9" })),
    ).toBe("1.2.3.4");
  });
  it("uses True-Client-IP when CF-Connecting-IP is absent", () => {
    expect(clientIp(req({ "true-client-ip": "1.2.3.4" }))).toBe("1.2.3.4");
  });
  it("falls back to the rightmost X-Forwarded-For entry (local dev)", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
  });
  it("falls back when no header is present", () => {
    expect(clientIp(req())).toBe("unknown");
  });
});
