import { describe, expect, it } from "vitest";
import {
  GLOBAL_POLICY,
  IP_POLICY,
  clientIp,
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

describe("clientIp", () => {
  const req = (xff?: string) =>
    new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });

  it("takes the rightmost (proxy-appended) X-Forwarded-For entry", () => {
    expect(clientIp(req("6.6.6.6, 1.2.3.4"))).toBe("1.2.3.4");
  });
  it("handles a single entry", () => {
    expect(clientIp(req("1.2.3.4"))).toBe("1.2.3.4");
  });
  it("falls back when the header is absent", () => {
    expect(clientIp(req())).toBe("unknown");
  });
});
