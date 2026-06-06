// Server-only Buzzheavier client.
//
// API surface (verified from the official CLI script and developer docs):
//   PUT    https://w.buzzheavier.com/{rootDir}/{filename}    body=raw bytes, Bearer={accountId}  -> { data: { id } }
//   DELETE https://buzzheavier.com/api/fs/{id}              Bearer={accountId}
//   GET    https://buzzheavier.com/{id}                     -> public download URL (no auth)
//
// "API key" is the account ID itself, used as a Bearer token. Account caps at
// 500MB (free), so we support multiple accounts with rotation: new uploads go
// to the active account; deletes use whichever account uploaded the file.

export interface BuzzheavierAccount {
  /** Account ID (also the Bearer token). */
  id: string;
  /** Directory ID under the account root where uploads land. */
  rootDir: string;
}

export interface UploadResult {
  buzzheavier_id: string;
  buzzheavier_url: string;
  buzzheavier_account_id: string;
}

const UPLOAD_BASE = "https://w.buzzheavier.com";
const API_BASE = "https://buzzheavier.com/api";
const DOWNLOAD_BASE = "https://buzzheavier.com";

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
  const accounts = parsed.map((entry, i) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== "string" ||
      typeof (entry as { rootDir?: unknown }).rootDir !== "string"
    ) {
      throw new Error(
        `BUZZHEAVIER_ACCOUNTS[${i}] must be an object with string fields { id, rootDir }.`,
      );
    }
    const e = entry as { id: string; rootDir: string };
    return { id: e.id, rootDir: e.rootDir };
  });
  const idxRaw = process.env.BUZZHEAVIER_ACTIVE_INDEX ?? "0";
  const activeIndex = Number.parseInt(idxRaw, 10);
  if (
    !Number.isInteger(activeIndex) ||
    activeIndex < 0 ||
    activeIndex >= accounts.length
  ) {
    throw new Error(
      `BUZZHEAVIER_ACTIVE_INDEX must be an integer in [0, ${accounts.length - 1}], got ${idxRaw}.`,
    );
  }
  return { accounts, activeIndex };
}

function findAccount(accountId: string): BuzzheavierAccount {
  const { accounts } = loadAccounts();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) {
    throw new Error(
      `Buzzheavier account "${accountId}" is not in BUZZHEAVIER_ACCOUNTS. Did you remove it?`,
    );
  }
  return acc;
}

/** Sanitize a filename for use in a URL path. Buzzheavier puts the name in the path. */
function safeFilename(name: string): string {
  // Replace path separators and any control chars; collapse whitespace.
  const trimmed = name.replace(/[\\/]/g, "_").replace(/\s+/g, " ").trim();
  // Last-resort fallback if the entire name was stripped.
  return trimmed.length > 0 ? trimmed : `file-${Date.now()}`;
}

export interface UploadInput {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

export async function uploadFile(input: UploadInput): Promise<UploadResult> {
  const { accounts, activeIndex } = loadAccounts();
  const account = accounts[activeIndex];
  const filename = safeFilename(input.filename);
  const url = `${UPLOAD_BASE}/${account.rootDir}/${encodeURIComponent(filename)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
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
    headers: { Authorization: `Bearer ${account.id}` },
  });
  return { ok: res.ok, status: res.status };
}
