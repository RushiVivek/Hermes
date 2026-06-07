// Per-Buzzheavier-account used-bytes accounting, persisted in Firestore.
//
// Why not trust /api/fs's `data.size`? An empty root reports `size: 0` even
// after we've uploaded files into it (the `children` array shows them with
// non-zero sizes, but the parent aggregate stays 0). So we keep our own
// counter that we increment on successful upload and decrement on delete.
//
// Documents live at  accounts/{accountId}  with shape  { used_bytes: number }.
// On first access for a given account, if the doc doesn't exist we walk the
// real Buzzheavier tree once to seed it.

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firestore";

const COLLECTION = "accounts";

/** GET /api/fs/{rootDir} returns the children list for a given dir. */
const API_BASE = "https://buzzheavier.com/api";
const FETCH_TIMEOUT_MS = 5000;

const CLIENT_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

interface ChildEntry {
  id: string;
  isDirectory: boolean;
  size: number;
}

interface DirResponse {
  data?: {
    children?: Array<{
      id?: unknown;
      isDirectory?: unknown;
      size?: unknown;
    }>;
  };
}

/** Walk a directory recursively (children of children of …) and sum sizes. */
async function recursiveSize(accountId: string, dirId: string): Promise<number> {
  const url =
    dirId === "" ? `${API_BASE}/fs` : `${API_BASE}/fs/${encodeURIComponent(dirId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${accountId}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return 0;
  }
  if (!res.ok) return 0;
  const body = (await res.json().catch(() => null)) as DirResponse | null;
  const children = body?.data?.children;
  if (!Array.isArray(children)) return 0;

  const entries: ChildEntry[] = [];
  for (const c of children) {
    if (
      typeof c?.id === "string" &&
      typeof c?.isDirectory === "boolean" &&
      typeof c?.size === "number" &&
      Number.isFinite(c.size) &&
      c.size >= 0
    ) {
      entries.push({ id: c.id, isDirectory: c.isDirectory, size: c.size });
    }
  }

  let total = 0;
  for (const e of entries) {
    if (e.isDirectory) {
      total += await recursiveSize(accountId, e.id);
    } else {
      total += e.size;
    }
  }
  return total;
}

/** Return the cached used-bytes for an account, backfilling from Buzzheavier
 * on first access. */
export async function getAccountUsedBytes(accountId: string): Promise<number> {
  const ref = getDb().collection(COLLECTION).doc(accountId);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data();
    const v = data?.used_bytes;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  // First time — seed from the real Buzzheavier tree.
  const live = await recursiveSize(accountId, "");
  await ref.set(
    {
      used_bytes: live,
      backfilled_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return live;
}

/** Atomically add `delta` (can be negative) to the account's used_bytes.
 * Used after successful upload (+= file.size) and successful blob delete
 * (-= file.size). */
export async function adjustAccountUsedBytes(
  accountId: string,
  delta: number,
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  const ref = getDb().collection(COLLECTION).doc(accountId);
  await ref.set(
    {
      used_bytes: FieldValue.increment(delta),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Force a re-seed of the cached used-bytes from Buzzheavier. Useful when
 * the local counter has drifted from reality. Not currently exposed via UI;
 * call from a script or a one-off route. */
export async function reseedAccountUsedBytes(accountId: string): Promise<number> {
  const live = await recursiveSize(accountId, "");
  const ref = getDb().collection(COLLECTION).doc(accountId);
  await ref.set(
    {
      used_bytes: live,
      backfilled_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return live;
}
