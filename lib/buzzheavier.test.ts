import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pickAccountForUpload reads per-account used-bytes from Firestore via
// account-usage.ts. The tests below set the "used bytes" indirectly through
// a controllable mock so they don't need a real Firebase connection.
const usedBytesByAccount = new Map<string, number>();
vi.mock("./account-usage", () => ({
  getAccountUsedBytes: vi.fn(async (id: string) => usedBytesByAccount.get(id) ?? 0),
  adjustAccountUsedBytes: vi.fn(async () => undefined),
  reseedAccountUsedBytes: vi.fn(async () => 0),
}));

// Re-import the module per test so module-level env reads pick up
// per-test process.env mutations.
async function load() {
  vi.resetModules();
  return await import("./buzzheavier");
}

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

// ---------- safeFilename (via uploadFile path-construction is hard to assert,
// so we exercise the function through a public re-export at the bottom of the
// module's tests by reaching into uploadFile's URL building? Instead: we add
// a thin test-only re-export by using "const __testing = { safeFilename }"
// approach? Cleaner: keep safeFilename non-exported but test via uploadFile
// with a mocked fetch that captures the URL.)

describe("uploadFile filename sanitization", () => {
  beforeEach(() => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["acc1"]);
  });

  function mockFetchCapturing(): {
    fetchMock: ReturnType<typeof vi.fn>;
    lastUrl: () => string;
  } {
    let lastUrl = "";
    const fetchMock = vi.fn(async (url: string | URL) => {
      lastUrl = String(url);
      return new Response(
        JSON.stringify({ data: { id: "uploaded-id" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return { fetchMock, lastUrl: () => lastUrl };
  }

  it("preserves a normal filename", async () => {
    const { uploadFile } = await load();
    const cap = mockFetchCapturing();
    await uploadFile(
      { id: "acc1", rootDir: "rootid", usedBytes: 0 },
      { bytes: new Uint8Array([1]), filename: "passport.pdf", mime: "application/pdf" },
    );
    expect(cap.lastUrl()).toBe(
      "https://w.buzzheavier.com/rootid/passport.pdf",
    );
  });

  it("replaces path separators", async () => {
    const { uploadFile } = await load();
    const cap = mockFetchCapturing();
    await uploadFile(
      { id: "acc1", rootDir: "rootid", usedBytes: 0 },
      { bytes: new Uint8Array([1]), filename: "evil/../passport.pdf", mime: "application/pdf" },
    );
    expect(cap.lastUrl()).toBe(
      "https://w.buzzheavier.com/rootid/evil_.._passport.pdf",
    );
  });

  it("falls back to file-<ts> when input is whitespace-only", async () => {
    const { uploadFile } = await load();
    const cap = mockFetchCapturing();
    await uploadFile(
      { id: "acc1", rootDir: "rootid", usedBytes: 0 },
      { bytes: new Uint8Array([1]), filename: "   ", mime: "" },
    );
    expect(cap.lastUrl()).toMatch(
      /^https:\/\/w\.buzzheavier\.com\/rootid\/file-\d+$/,
    );
  });

  it("truncates filenames over 500 chars while preserving the extension", async () => {
    const { uploadFile } = await load();
    const cap = mockFetchCapturing();
    const long = "a".repeat(600) + ".pdf";
    await uploadFile(
      { id: "acc1", rootDir: "rootid", usedBytes: 0 },
      { bytes: new Uint8Array([1]), filename: long, mime: "application/pdf" },
    );
    const url = cap.lastUrl();
    const path = new URL(url).pathname.split("/").pop()!;
    expect(path.length).toBeLessThanOrEqual(500);
    expect(path.endsWith(".pdf")).toBe(true);
  });

  it("clamps a pathologically long extension instead of busting the cap", async () => {
    const { uploadFile } = await load();
    const cap = mockFetchCapturing();
    const long = "a." + "x".repeat(800); // 802 chars, ext is 801
    await uploadFile(
      { id: "acc1", rootDir: "rootid", usedBytes: 0 },
      { bytes: new Uint8Array([1]), filename: long, mime: "" },
    );
    const path = decodeURIComponent(new URL(cap.lastUrl()).pathname.split("/").pop()!);
    expect(path.length).toBeLessThanOrEqual(500);
  });
});

describe("loadAccounts (via pickAccountForUpload)", () => {
  it("rejects missing BUZZHEAVIER_ACCOUNTS", async () => {
    delete process.env.BUZZHEAVIER_ACCOUNTS;
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/required/i);
  });

  it("rejects non-array JSON", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify({ id: "x" });
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/non-empty JSON array/i);
  });

  it("rejects empty string ids", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["", "good"]);
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/non-empty account-id/i);
  });

  it("rejects whitespace-only ids", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["   "]);
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/non-empty account-id/i);
  });

  it("accepts both string and {id} entry forms", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a", { id: "b" }]);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: "rootA", size: 0 } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(0);
    expect(["a", "b"]).toContain(picked.id);
  });

  it("rejects out-of-range BUZZHEAVIER_ACTIVE_INDEX", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a"]);
    process.env.BUZZHEAVIER_ACTIVE_INDEX = "5";
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/must be in/i);
  });

  it("rejects non-integer BUZZHEAVIER_ACTIVE_INDEX", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a"]);
    process.env.BUZZHEAVIER_ACTIVE_INDEX = "1.9";
    const { pickAccountForUpload } = await load();
    await expect(pickAccountForUpload(0)).rejects.toThrow(/non-negative integer/i);
  });
});

describe("pickAccountForUpload", () => {
  beforeEach(() => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a", "b", "c"]);
    process.env.BUZZHEAVIER_ACTIVE_INDEX = "0";
  });

  function mockProbe(byId: Record<string, { status: number; size?: number; rootId?: string }>) {
    // The `size` field here is now the per-account used-bytes that
    // pickAccountForUpload reads from Firestore (mocked above). Seed the
    // map up front so the lazy import inside pickAccountForUpload sees
    // them.
    usedBytesByAccount.clear();
    for (const [id, cfg] of Object.entries(byId)) {
      if (cfg.status === 200) usedBytesByAccount.set(id, cfg.size ?? 0);
    }
    globalThis.fetch = vi.fn(async (_url, init) => {
      const auth = (init as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined;
      const bearer = auth?.Authorization?.replace("Bearer ", "") ?? "";
      const cfg = byId[bearer];
      if (!cfg) return new Response("nope", { status: 404 });
      if (cfg.status !== 200) return new Response("err", { status: cfg.status });
      // Probe response no longer carries size — pickAccountForUpload reads
      // the counter from Firestore.
      return new Response(
        JSON.stringify({ data: { id: cfg.rootId ?? `root-${bearer}` } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  }

  it("picks the active account when it has room", async () => {
    mockProbe({
      a: { status: 200, size: 100 * 1000 * 1000 },
      b: { status: 200, size: 100 * 1000 * 1000 },
      c: { status: 200, size: 100 * 1000 * 1000 },
    });
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(50 * 1000 * 1000);
    expect(picked.id).toBe("a");
    expect(picked.rootDir).toBe("root-a");
  });

  it("rotates forward when active is over the 90% threshold", async () => {
    mockProbe({
      a: { status: 200, size: 440 * 1000 * 1000 },
      b: { status: 200, size: 100 * 1000 * 1000 },
      c: { status: 200, size: 100 * 1000 * 1000 },
    });
    const { pickAccountForUpload } = await load();
    // 440 + 50 = 490 > 450 → skip a; 100 + 50 = 150 ≤ 450 → take b
    const picked = await pickAccountForUpload(50 * 1000 * 1000);
    expect(picked.id).toBe("b");
  });

  it("starts at the active index, not always at 0", async () => {
    process.env.BUZZHEAVIER_ACTIVE_INDEX = "1";
    mockProbe({
      a: { status: 200, size: 0 },
      b: { status: 200, size: 0 },
      c: { status: 200, size: 0 },
    });
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(1);
    expect(picked.id).toBe("b");
  });

  it("falls back to earlier indices when later ones are full", async () => {
    process.env.BUZZHEAVIER_ACTIVE_INDEX = "2";
    mockProbe({
      a: { status: 200, size: 0 },
      b: { status: 200, size: 460 * 1000 * 1000 },
      c: { status: 200, size: 460 * 1000 * 1000 },
    });
    const { pickAccountForUpload } = await load();
    // active=c full, next=a (wraps), should land on a
    const picked = await pickAccountForUpload(1);
    expect(picked.id).toBe("a");
  });

  it("treats 401/403/404 as skip, not transient", async () => {
    mockProbe({
      a: { status: 401 },
      b: { status: 200, size: 0 },
      c: { status: 200, size: 0 },
    });
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(1);
    expect(picked.id).toBe("b");
  });

  it("treats 5xx as transient and surfaces it when no good account", async () => {
    mockProbe({
      a: { status: 503 },
      b: { status: 503 },
      c: { status: 503 },
    });
    const { pickAccountForUpload, isTransientPickError } = await load();
    try {
      await pickAccountForUpload(1);
      throw new Error("expected throw");
    } catch (e) {
      expect(isTransientPickError(e)).toBe(true);
    }
  });

  it("treats 429 as transient", async () => {
    mockProbe({
      a: { status: 429 },
      b: { status: 429 },
      c: { status: 429 },
    });
    const { pickAccountForUpload, isTransientPickError } = await load();
    try {
      await pickAccountForUpload(1);
      throw new Error("expected throw");
    } catch (e) {
      expect(isTransientPickError(e)).toBe(true);
    }
  });

  it("treats network errors as transient", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const { pickAccountForUpload, isTransientPickError } = await load();
    try {
      await pickAccountForUpload(1);
      throw new Error("expected throw");
    } catch (e) {
      expect(isTransientPickError(e)).toBe(true);
    }
  });

  it("retries up to 3 times when a probe returns Cloudflare-shaped HTML", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a"]);
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        // Cloudflare-shaped HTML response — 200 OK but not the JSON we want.
        return new Response("<html><body>Just a moment...</body></html>", {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ data: { id: "rootA", size: 0 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(0);
    expect(picked.id).toBe("a");
    expect(calls).toBe(3);
  });

  it("gives up after 3 transient attempts and surfaces as transient", async () => {
    process.env.BUZZHEAVIER_ACCOUNTS = JSON.stringify(["a"]);
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response("<html>nope</html>", { status: 200 });
    }) as unknown as typeof fetch;
    const { pickAccountForUpload, isTransientPickError } = await load();
    try {
      await pickAccountForUpload(0);
      throw new Error("expected throw");
    } catch (e) {
      expect(isTransientPickError(e)).toBe(true);
      expect(calls).toBe(3);
    }
  });

  it("when one account is transient and another has room, picks the room one", async () => {
    mockProbe({
      a: { status: 503 },
      b: { status: 200, size: 0 },
      c: { status: 200, size: 0 },
    });
    const { pickAccountForUpload } = await load();
    const picked = await pickAccountForUpload(1);
    expect(picked.id).toBe("b");
  });

  it("rejects with non-transient error when all accounts are full", async () => {
    mockProbe({
      a: { status: 200, size: 460 * 1000 * 1000 },
      b: { status: 200, size: 460 * 1000 * 1000 },
      c: { status: 200, size: 460 * 1000 * 1000 },
    });
    const { pickAccountForUpload, isTransientPickError } = await load();
    try {
      await pickAccountForUpload(1);
      throw new Error("expected throw");
    } catch (e) {
      expect(isTransientPickError(e)).toBe(false);
      expect((e as Error).message).toMatch(/full or misconfigured/i);
    }
  });
});

describe("isTransientPickError", () => {
  it("returns false for plain Errors", async () => {
    const { isTransientPickError } = await load();
    expect(isTransientPickError(new Error("boom"))).toBe(false);
  });
  it("returns true when transient flag is set", async () => {
    const { isTransientPickError } = await load();
    const e = new Error("boom") as Error & { transient?: true };
    e.transient = true;
    expect(isTransientPickError(e)).toBe(true);
  });
  it("returns false for non-error values", async () => {
    const { isTransientPickError } = await load();
    expect(isTransientPickError(null)).toBe(false);
    expect(isTransientPickError("string")).toBe(false);
    expect(isTransientPickError({ transient: true })).toBe(true); // duck-typed; OK
  });
});
