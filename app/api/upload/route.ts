import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { docsCol } from "@/lib/firestore";
import {
  pickAccountForUpload,
  uploadFile,
  deleteFile,
  isTransientPickError,
} from "@/lib/buzzheavier";
import { adjustAccountUsedBytes } from "@/lib/account-usage";
import { registerFolderPath } from "@/lib/folder-store";
import { extractDocMeta, geminiConfigured, type DocSuggestion } from "@/lib/gemini";
import { CATEGORIES, type Category } from "@/lib/types";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

interface UploadResultItem {
  index: number;
  id: string;
  title: string;
  path: string;
  /** Present in auto-organize mode: Gemini's proposed fields for the confirm
   * screen. The doc is saved as pending_confirm until the user confirms. */
  suggestion?: DocSuggestion;
  /** Whether the doc still needs confirmation. */
  pending?: boolean;
}

interface UploadErrorItem {
  index: number;
  filename: string;
  error: string;
}

const MAX_FILES = 25;
const MAX_BYTES = 250 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }

  const autoOrganize =
    formString(form, "autoOrganize") === "1" && geminiConfigured();

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
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

  // --- Manual mode reads shared metadata from the form up front. Auto mode
  // derives per-file metadata from Gemini and saves rows as pending_confirm. ---
  let manual: ManualMeta | null = null;
  if (!autoOrganize) {
    const parsed = parseManualMeta(form);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    manual = parsed;
  }

  // Pick a Buzzheavier account once for the whole batch.
  let account: Awaited<ReturnType<typeof pickAccountForUpload>>;
  try {
    account = await pickAccountForUpload(totalBytes);
  } catch (e) {
    const status = isTransientPickError(e) ? 502 : 507;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  // For auto mode we may need known owners/paths to nudge Gemini toward reuse.
  let knownOwners: string[] = [];
  let knownPaths: string[] = [];
  if (autoOrganize) {
    try {
      const snap = await docsCol().where("status", "==", "active").get();
      const owners = new Set<string>();
      const paths = new Set<string>();
      snap.forEach((d) => {
        const data = d.data();
        if (typeof data.owner === "string" && data.owner) owners.add(data.owner);
        if (typeof data.path === "string" && data.path) paths.add(data.path);
      });
      knownOwners = [...owners];
      knownPaths = [...paths];
    } catch {
      // Non-fatal — Gemini just won't get the reuse hints.
    }
  }

  const created: UploadResultItem[] = [];
  const errors: UploadErrorItem[] = [];
  const finalizedPaths = new Set<string>();

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const filename = file.name || "untitled";
    const mime = file.type || "application/octet-stream";

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      errors.push({ index, filename, error: (e as Error).message });
      continue;
    }

    // Run Gemini (auto mode) before the upload so a Gemini failure doesn't
    // leave an orphan blob — it just falls back to a blank confirm.
    let suggestion: DocSuggestion | null = null;
    if (autoOrganize) {
      suggestion = await extractDocMeta({
        bytes,
        mime,
        filename,
        hint: formString(form, "hint") || undefined,
        knownOwners,
        knownPaths,
      });
    }

    let blob: { buzzheavier_id: string; buzzheavier_url: string; buzzheavier_account_id: string };
    try {
      blob = await uploadFile(account, { bytes, filename, mime });
    } catch (e) {
      errors.push({ index, filename, error: (e as Error).message });
      continue;
    }

    // Resolve the fields + status for this doc.
    const fields = autoOrganize
      ? autoFields(suggestion, filename)
      : manualFields(manual!, filename);
    const status = autoOrganize ? "pending_confirm" : "active";

    try {
      const ref = docsCol().doc();
      await ref.set({
        path: fields.path,
        title: fields.title,
        category: fields.category,
        owner: fields.owner,
        doc_date: fields.doc_date,
        tags: fields.tags,
        buzzheavier_id: blob.buzzheavier_id,
        buzzheavier_url: blob.buzzheavier_url,
        buzzheavier_account_id: blob.buzzheavier_account_id,
        mime,
        size_bytes: file.size,
        uploaded_at: Timestamp.now(),
        status,
      });
      created.push({
        index,
        id: ref.id,
        title: fields.title,
        path: fields.path,
        suggestion: autoOrganize
          ? {
              title: fields.title,
              category: fields.category,
              subfolder: fields.subfolder,
              owner: fields.owner ?? "",
              doc_date: fields.doc_date ?? "",
              tags: fields.tags,
            }
          : undefined,
        pending: autoOrganize,
      });
      if (!autoOrganize) finalizedPaths.add(fields.path);
      // Count bytes now — the blob is on Buzzheavier regardless of whether this
      // is an active or pending_confirm doc. Confirm doesn't re-count; discard
      // and delete decrement. KNOWN LEAK: if an auto-organize draft is never
      // confirmed or discarded (user closes the tab), the bytes stay counted
      // and the blob lingers. It's bounded by how often that happens, and
      // getAccountUsedBytes()'s backfill (which walks the real tree, pending
      // blobs included) keeps the counter consistent with reality rather than
      // drifting. A periodic sweep of stale pending_confirm rows is the proper
      // fix if it ever matters at family scale.
      void adjustAccountUsedBytes(blob.buzzheavier_account_id, file.size).catch(
        (err) => {
          console.warn(
            `[hermes] failed to adjust used_bytes for account: ${(err as Error).message}`,
          );
        },
      );
    } catch (e) {
      try {
        await deleteFile({
          buzzheavier_id: blob.buzzheavier_id,
          buzzheavier_account_id: blob.buzzheavier_account_id,
        });
      } catch {
        // Already in the failure path; orphan blob is recoverable manually.
      }
      errors.push({
        index,
        filename,
        error: `Firestore write failed: ${(e as Error).message}`,
      });
    }
  }

  // Manual mode finalizes immediately: register folders + refresh browse.
  // Auto mode defers both to the confirm step (pending docs aren't shown).
  if (!autoOrganize && finalizedPaths.size > 0) {
    for (const p of finalizedPaths) {
      try {
        await registerFolderPath(p);
      } catch (e) {
        console.warn(`[hermes] failed to register folder "${p}": ${(e as Error).message}`);
      }
    }
    revalidatePath("/browse");
  }

  return NextResponse.json({ created, errors, autoOrganize });
}

// ---------------------------------------------------------------------------

interface ManualMeta {
  category: Category;
  subfolder: string;
  owner?: string;
  docDate?: string;
  tags: string[];
}

function parseManualMeta(form: FormData): ManualMeta | { error: string } {
  const category = formString(form, "category");
  if (!CATEGORIES.includes(category as Category)) {
    return { error: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` };
  }
  const subfolder = sanitizeSubfolder(formString(form, "subfolder"));
  if (subfolder === null) {
    return { error: "Sub-folder contains invalid characters or '..'." };
  }
  if (subfolder.length > 200) {
    return { error: "Sub-folder is too long." };
  }
  const docDateRaw = formString(form, "doc_date");
  if (docDateRaw && !isValidIsoDate(docDateRaw)) {
    return { error: "Date on document must be a real YYYY-MM-DD date." };
  }
  const tagsRaw = formString(form, "tags");
  const tags = tagsRaw
    ? Array.from(
        new Set(tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)),
      ).slice(0, 10)
    : [];
  return {
    category: category as Category,
    subfolder,
    owner: formString(form, "owner") || undefined,
    docDate: docDateRaw || undefined,
    tags,
  };
}

interface ResolvedFields {
  path: string;
  title: string;
  category: Category;
  subfolder: string;
  owner?: string;
  doc_date?: string;
  tags: string[];
}

function manualFields(m: ManualMeta, filename: string): ResolvedFields {
  return {
    path: m.subfolder ? `${m.category}/${m.subfolder}` : m.category,
    title: stripExtension(filename),
    category: m.category,
    subfolder: m.subfolder,
    owner: m.owner,
    doc_date: m.docDate,
    tags: m.tags,
  };
}

function autoFields(s: DocSuggestion | null, filename: string): ResolvedFields {
  // Gemini failed/unavailable → blank confirm with a sane default category.
  if (!s) {
    return {
      path: "Other",
      title: stripExtension(filename),
      category: "Other",
      subfolder: "",
      owner: undefined,
      doc_date: undefined,
      tags: [],
    };
  }
  const cleanSub = sanitizeSubfolder(s.subfolder) ?? "";
  const path = cleanSub ? `${s.category}/${cleanSub}` : s.category;
  return {
    path,
    title: s.title,
    category: s.category,
    subfolder: cleanSub,
    owner: s.owner || undefined,
    doc_date: s.doc_date || undefined,
    tags: s.tags,
  };
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

/** Returns cleaned subfolder, or null on traversal/control-char input. */
function sanitizeSubfolder(raw: string): string | null {
  if (raw === "") return "";
  if (/[\x00-\x1f\x7f\u2028\u2029\\]/.test(raw)) return null;
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}
