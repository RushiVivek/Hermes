import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { docsCol } from "@/lib/firestore";
import {
  pickAccountForUpload,
  uploadFile,
  deleteFile,
  isTransientPickError,
} from "@/lib/buzzheavier";
import { CATEGORIES, type Category } from "@/lib/types";

export const runtime = "nodejs";

interface UploadResultItem {
  index: number;
  id: string;
  title: string;
  path: string;
}

interface UploadErrorItem {
  index: number;
  filename: string;
  error: string;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }

  const category = formString(form, "category");
  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const subfolder = sanitizeSubfolder(formString(form, "subfolder"));
  if (subfolder === null) {
    return NextResponse.json(
      { error: "Sub-folder contains invalid characters or '..'." },
      { status: 400 },
    );
  }
  // Cap path length so a hostile or fat-fingered subfolder doesn't pollute
  // every Firestore index entry. 200 chars is well under Firestore's
  // ~1500-byte indexed-field limit.
  if (subfolder.length > 200) {
    return NextResponse.json(
      { error: "Sub-folder is too long." },
      { status: 400 },
    );
  }
  const owner = formString(form, "owner") || undefined;
  const docDateRaw = formString(form, "doc_date");
  // Only accept real ISO calendar dates — the regex alone would let
  // "2026-13-45" through and break any future caller that does
  // new Date(doc.doc_date) with RangeError: Invalid time value.
  if (docDateRaw && !isValidIsoDate(docDateRaw)) {
    return NextResponse.json(
      { error: "Date on document must be a real YYYY-MM-DD date." },
      { status: 400 },
    );
  }
  const docDate = docDateRaw || undefined;
  const tagsRaw = formString(form, "tags");
  const tags = tagsRaw
    ? Array.from(
        new Set(
          tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ).slice(0, 10)
    : [];

  const path = subfolder ? `${category}/${subfolder}` : category;

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  // Family-scale upload caps. These are sanity guards, not a security boundary.
  // 25 files / 250 MB combined keeps a single request under typical serverless
  // function memory + timeout limits, so we don't end up partially persisted.
  const MAX_FILES = 25;
  const MAX_BYTES = 250 * 1024 * 1024;
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files in one upload (max ${MAX_FILES}).` },
      { status: 413 },
    );
  }
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  if (totalBytes > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Upload too large (${(totalBytes / (1024 * 1024)).toFixed(0)} MB; ` +
          `max ${MAX_BYTES / (1024 * 1024)} MB per request).`,
      },
      { status: 413 },
    );
  }

  // Pick a Buzzheavier account once for the whole batch — preflight checks
  // each account's used bytes via /api/fs and rotates forward if the active
  // account would exceed 90% of the per-account quota.
  let account: Awaited<ReturnType<typeof pickAccountForUpload>>;
  try {
    account = await pickAccountForUpload(totalBytes);
  } catch (e) {
    // 502 Bad Gateway when Buzzheavier itself flaked; 507 Insufficient
    // Storage when accounts are genuinely full.
    const status = isTransientPickError(e) ? 502 : 507;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  const created: UploadResultItem[] = [];
  const errors: UploadErrorItem[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const filename = file.name || "untitled";
    let blob: { buzzheavier_id: string; buzzheavier_url: string; buzzheavier_account_id: string };
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      blob = await uploadFile(account, {
        bytes: buf,
        filename,
        mime: file.type || "application/octet-stream",
      });
    } catch (e) {
      errors.push({ index, filename, error: (e as Error).message });
      continue;
    }

    try {
      const ref = docsCol().doc();
      const title = stripExtension(filename);
      await ref.set({
        path,
        title,
        category,
        owner,
        doc_date: docDate,
        tags,
        buzzheavier_id: blob.buzzheavier_id,
        buzzheavier_url: blob.buzzheavier_url,
        buzzheavier_account_id: blob.buzzheavier_account_id,
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
        uploaded_at: Timestamp.now(),
        status: "active",
      });
      created.push({ index, id: ref.id, title, path });
    } catch (e) {
      // Clean up the orphaned blob so storage doesn't drift. Awaited because
      // on Vercel/Lambda the function context is frozen as soon as the
      // response returns — a fire-and-forget DELETE would never reach
      // Buzzheavier.
      try {
        await deleteFile({
          buzzheavier_id: blob.buzzheavier_id,
          buzzheavier_account_id: blob.buzzheavier_account_id,
        });
      } catch {
        // Swallow — we're already in the failure path; the leaked blob is
        // recoverable manually but we won't fail the whole request over it.
      }
      errors.push({
        index,
        filename,
        error: `Firestore write failed: ${(e as Error).message}`,
      });
    }
  }

  return NextResponse.json({ created, errors });
}

/** Read a string-typed FormData field. File parts are coerced to "" so a
 * `multipart/form-data` with `owner=@something.txt` doesn't write the
 * literal `[object File]` into Firestore. */
function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** True iff `s` is a real YYYY-MM-DD calendar date (rejects 13/45 etc.). */
function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
  );
}

function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return name;
  return name.slice(0, i);
}

/**
 * Returns the cleaned subfolder string, or null if the input contains
 * traversal segments / backslashes / control chars. We split on `/`, drop
 * empties, and reject any segment that's `.` or `..`.
 */
function sanitizeSubfolder(raw: string): string | null {
  if (raw === "") return "";
  // Reject control chars (incl. DEL 0x7f), Unicode line/paragraph separators,
  // and backslashes (which some platforms treat as path separators).
  if (/[\x00-\x1f\x7f\u2028\u2029\\]/.test(raw)) return null;
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}
