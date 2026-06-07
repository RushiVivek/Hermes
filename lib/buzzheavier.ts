// Server-only Buzzheavier client.
//
// API surface (verified from the official CLI script + a live probe):
//   GET    https://buzzheavier.com/api/fs                   Bearer={accountId}  -> { data: { size, ... } }
//   PUT    https://w.buzzheavier.com/{rootDir}/{filename}   body=raw bytes, Bearer={accountId}  -> { data: { id } }
//   DELETE https://buzzheavier.com/api/fs/{id}              Bearer={accountId}
//   GET    https://buzzheavier.com/{id}                     -> public download URL (no auth)
//
// "API key" is the account ID itself, used as a Bearer token. Free-tier
// accounts cap at 500MB. We support multiple accounts with auto-rotation:
// before each upload batch we walk accounts from BUZZHEAVIER_ACTIVE_INDEX
// forward and pick the first one that still has room for the incoming bytes
// (using 90% of the cap as the soft ceiling). Deletes always use whichever
// account originally uploaded the file (recorded on the doc).

export interface BuzzheavierAccount {
  /** Account ID (also the Bearer token). */
  id: string;
}

export interface UploadResult {
  buzzheavier_id: string;
  buzzheavier_url: string;
  buzzheavier_account_id: string;
}

const UPLOAD_BASE = "https://w.buzzheavier.com";
const API_BASE = "https://buzzheavier.com/api";
const DOWNLOAD_BASE = "https://buzzheavier.com";

/** Per-account quota in bytes. Buzzheavier free tier is 500 MB; we rotate
 * once an account would exceed 90% of this with the incoming upload.
 *
 * NOTE on size accounting: probeAccount reads `/api/fs` and uses
 * `data.size`, which from a live probe is the recursive size of the
 * account's contents. For this to correctly reflect full account usage,
 * hermes must be the *only* writer for accounts in BUZZHEAVIER_ACCOUNTS —
 * don't manually drop files into a hermes account via the Buzzheavier web
 * UI, especially into subfolders. */
const ACCOUNT_QUOTA_BYTES = 500 * 1000 * 1000;
const ROTATE_AT = Math.floor(ACCOUNT_QUOTA_BYTES * 0.9);

function loadAccounts(): { accounts: BuzzheavierAccount[]; activeIndex: number } {
  const raw = process.env.BUZZHEAVIER_ACCOUNTS;
  if (!raw) {
    throw new Error(
      "BUZZHEAVIER_ACCOUNTS env var is required. Set it to a JSON array " +
        '(e.g. \'[{"id":"...","rootDir":"..."}]\').',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`BUZZHEAVIER_ACCOUNTS is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("BUZZHEAVIER_ACCOUNTS must be a non-empty JSON array.");
  }
  const accounts = parsed.map((entry, i): BuzzheavierAccount => {
    // Accept either ["id1","id2"] or [{id:"..."}] shapes — the latter for
    // forward-compat if we add per-account fields later.
    let id: unknown;
    if (typeof entry === "string") id = entry;
    else if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === "string"
    ) {
      id = (entry as { id: string }).id;
    }
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(
        `BUZZHEAVIER_ACCOUNTS[${i}] must be a non-empty account-id string ` +
          `or an object { id: "..." }.`,
      );
    }
    return { id };
  });
  const idxRaw = process.env.BUZZHEAVIER_ACTIVE_INDEX ?? "0";
  // Strict integer match — Number.parseInt would silently accept "1.9" as 1.
  if (!/^\d+$/.test(idxRaw)) {
    throw new Error(
      `BUZZHEAVIER_ACTIVE_INDEX must be a non-negative integer, got "${idxRaw}".`,
    );
  }
  const activeIndex = Number(idxRaw);
  if (activeIndex >= accounts.length) {
    throw new Error(
      `BUZZHEAVIER_ACTIVE_INDEX must be in [0, ${accounts.length - 1}], got ${idxRaw}.`,
    );
  }
  return { accounts, activeIndex };
}

function findAccount(accountId: string): BuzzheavierAccount {
  const { accounts } = loadAccounts();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) {
    // Don't include the accountId in the message — it doubles as the Bearer
    // token, and this error gets surfaced into API response bodies on the
    // delete path. A short prefix is enough for server-side logs.
    const prefix = accountId.slice(0, 6);
    throw new Error(
      `Buzzheavier account (id starting "${prefix}…") is not in BUZZHEAVIER_ACCOUNTS.`,
    );
  }
  return acc;
}

/** Sanitize a filename for use in a URL path. Buzzheavier puts the name in
 * the URL path and caps it at 500 chars per their API docs. */
const MAX_FILENAME_CHARS = 500;
const MAX_PRESERVED_EXT_CHARS = 16;
function safeFilename(name: string): string {
  // Replace path separators; collapse whitespace.
  const trimmed = name.replace(/[\\/]/g, "_").replace(/\s+/g, " ").trim();
  const fallback = trimmed.length > 0 ? trimmed : `file-${Date.now()}`;
  if (fallback.length <= MAX_FILENAME_CHARS) return fallback;
  // Preserve the extension when truncating so the file still opens — but cap
  // the extension we preserve so a pathologically long ".xxxx…" doesn't bust
  // the 500-char limit on its own.
  const dot = fallback.lastIndexOf(".");
  const rawExt = dot > 0 ? fallback.slice(dot) : "";
  const ext = rawExt.slice(0, MAX_PRESERVED_EXT_CHARS);
  const base = dot > 0 ? fallback.slice(0, dot) : fallback;
  const room = MAX_FILENAME_CHARS - ext.length;
  return base.slice(0, Math.max(1, room)) + ext;
}

export interface UploadInput {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

/** A picked account, with the root-directory id discovered via /api/fs.
 * Buzzheavier requires {parentId} in the upload URL; the account root's id
 * is what we use. */
export interface PickedAccount {
  id: string;
  rootDir: string;
  usedBytes: number;
}

const PROBE_TIMEOUT_MS = 3000;
const PROBE_MAX_ATTEMPTS = 3;

/** Headers that look like a real browser. Buzzheavier sits behind
 * Cloudflare, which intermittently serves a challenge HTML interstitial
 * when the request UA reads like a bot/crawler (which "Mozilla/5.0
 * (compatible; …)" does). A plain Mozilla UA reduces the rate.
 *
 * Cache-Control: no-cache forces upstream/intermediaries to re-validate —
 * an observation from this codebase's debugging is that once CF serves a
 * challenge HTML for a given URL, retrying the *exact same* URL gets the
 * cached challenge back. Cache-busting via a random query param on each
 * retry sidesteps that for free. */
const CLIENT_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

/** Append a unique cache-buster query param so a retry hits a different URL
 * than the previous attempt — defeats CF's per-URL cache of challenge HTML. */
function withCacheBuster(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  // crypto.randomUUID is available in Node 18+ and Edge runtime.
  const nonce = (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  ).slice(0, 8);
  return `${url}${sep}_=${nonce}`;
}

type ProbeResult =
  /** Account is healthy; we know its root dir id and current usage. */
  | { kind: "ok"; rootDir: string; usedBytes: number }
  /** Account doesn't exist or rejected our token — skip silently. */
  | { kind: "skip" }
  /** Buzzheavier itself was unhappy (5xx, 429, network blip). Don't silently
   *  rotate past it; the operator should see the upstream problem. */
  | { kind: "transient"; reason: string };

/** Try one /api/fs probe. Caller decides whether to retry on transient.
 * `attempt > 1` adds a cache-busting query param so we don't keep getting
 * back CF's cached challenge HTML for the same URL. */
async function probeOnce(
  account: BuzzheavierAccount,
  attempt: number,
): Promise<ProbeResult> {
  const url = attempt === 1 ? `${API_BASE}/fs` : withCacheBuster(`${API_BASE}/fs`);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${account.id}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    // DNS / TLS / ECONNRESET / AbortError.
    return { kind: "transient", reason: (e as Error).message };
  }
  if (res.ok) {
    const text = await res.text().catch(() => "");
    let body: { data?: { id?: unknown; size?: unknown } } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const id = body?.data?.id;
    const size = body?.data?.size;
    if (typeof id !== "string" || id === "") {
      console.warn(
        `[buzzheavier] /api/fs returned 200 but body wasn't { data: { id } }. ` +
          `First 200 chars: ${text.slice(0, 200).replace(/\s+/g, " ")}`,
      );
      return {
        kind: "transient",
        reason: "Buzzheavier /api/fs returned an unexpected payload (likely a Cloudflare challenge).",
      };
    }
    const usedBytes =
      typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
    return { kind: "ok", rootDir: id, usedBytes };
  }
  // Auth/not-found-ish: account is misconfigured or removed.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const prefix = account.id.slice(0, 6);
    console.warn(
      `[buzzheavier] account (id "${prefix}…") returned ${res.status} on /api/fs — skipping. Check BUZZHEAVIER_ACCOUNTS.`,
    );
    return { kind: "skip" };
  }
  return { kind: "transient", reason: `Buzzheavier /api/fs returned ${res.status}.` };
}

/** GET /api/fs for the given account, retrying transient failures up to
 * PROBE_MAX_ATTEMPTS times (Cloudflare's challenge HTML returns flakily). */
async function probeAccount(account: BuzzheavierAccount): Promise<ProbeResult> {
  let last: ProbeResult = { kind: "transient", reason: "no probe attempted" };
  for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
    last = await probeOnce(account, attempt);
    if (last.kind !== "transient") return last;
    if (attempt < PROBE_MAX_ATTEMPTS) {
      // Small linear backoff — 150 ms, 300 ms. Total worst-case adds <500 ms.
      // Skipped under vitest so the unit tests don't pay 450 ms per case.
      if (process.env.NODE_ENV !== "test") {
        await new Promise((r) => setTimeout(r, attempt * 150));
      }
    }
  }
  return last;
}

/** Pick the first account (starting at BUZZHEAVIER_ACTIVE_INDEX) that has
 * room for `incomingBytes`. Probes all accounts in parallel so total
 * latency is bounded by the slowest single probe, not the sum.
 *
 * Throws if no account has room. The error distinguishes "all full" (a 507
 * upstream-capacity situation) from "Buzzheavier flaked on us" (a 502/503
 * transient that the operator should see, not paper over). */
export async function pickAccountForUpload(
  incomingBytes: number,
): Promise<PickedAccount> {
  const { accounts, activeIndex } = loadAccounts();
  // Try active first, then later indices, then earlier (in case the operator
  // already rotated past a freshly-cleaned-up account).
  const order = [
    ...accounts.slice(activeIndex),
    ...accounts.slice(0, activeIndex),
  ];

  const probes = await Promise.all(order.map((a) => probeAccount(a)));

  let sawTransient = false;
  let firstTransientReason: string | null = null;
  for (let i = 0; i < order.length; i++) {
    const account = order[i];
    const probe = probes[i];
    if (probe.kind === "transient") {
      sawTransient = true;
      if (!firstTransientReason) firstTransientReason = probe.reason;
      continue;
    }
    if (probe.kind === "skip") continue;
    if (probe.usedBytes + incomingBytes <= ROTATE_AT) {
      return { id: account.id, rootDir: probe.rootDir, usedBytes: probe.usedBytes };
    }
  }

  if (sawTransient) {
    const err = new Error(
      `Buzzheavier didn't respond cleanly while picking an account: ` +
        `${firstTransientReason}. Try again in a moment.`,
    );
    (err as Error & { transient?: true }).transient = true;
    throw err;
  }
  throw new Error(
    "All Buzzheavier accounts are full or misconfigured. Add another account " +
      "to BUZZHEAVIER_ACCOUNTS or free space, then bump BUZZHEAVIER_ACTIVE_INDEX.",
  );
}

export function isTransientPickError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { transient?: unknown }).transient === true
  );
}

export async function uploadFile(
  account: PickedAccount,
  input: UploadInput,
): Promise<UploadResult> {
  const filename = safeFilename(input.filename);
  const url = `${UPLOAD_BASE}/${account.rootDir}/${encodeURIComponent(filename)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...CLIENT_HEADERS,
      Authorization: `Bearer ${account.id}`,
      "Content-Type": input.mime || "application/octet-stream",
    },
    // Re-wrap into a fresh ArrayBuffer-backed Uint8Array — Node's fetch types
    // narrow ArrayBufferLike (`SharedArrayBuffer | ArrayBuffer`) and only the
    // ArrayBuffer branch is BodyInit-compatible.
    body: new Uint8Array(input.bytes),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Buzzheavier upload failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { data?: { id?: unknown } }
    | null;
  const id =
    data && typeof data.data?.id === "string" ? data.data.id : null;
  if (!id) {
    throw new Error(
      `Buzzheavier upload returned an unexpected payload (no data.id).`,
    );
  }

  return {
    buzzheavier_id: id,
    buzzheavier_url: `${DOWNLOAD_BASE}/${id}`,
    buzzheavier_account_id: account.id,
  };
}

export async function deleteFile(opts: {
  buzzheavier_id: string;
  buzzheavier_account_id: string;
}): Promise<{ ok: boolean; status: number }> {
  const account = findAccount(opts.buzzheavier_account_id);
  const res = await fetch(`${API_BASE}/fs/${opts.buzzheavier_id}`, {
    method: "DELETE",
    headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${account.id}` },
  });
  return { ok: res.ok, status: res.status };
}
