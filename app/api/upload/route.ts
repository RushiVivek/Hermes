import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { docsCol } from "@/lib/firestore";
import {
  STORAGE_CAP_BYTES,
  deleteObject,
  putObject,
  storageKey,
} from "@/lib/r2";
import { isAllowedMime } from "@/lib/mime";
import { registerFolderPath } from "@/lib/folder-store";
import { extractDocMeta, geminiConfigured, type DocSuggestion } from "@/lib/gemini";
import {
  CATEGORIES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  type Category,
} from "@/lib/types";
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
  if (files.length > MAX_UPLOAD_FILES) {
    return NextResponse.json(
      { error: `Too many files in one upload (max ${MAX_UPLOAD_FILES}).` },
      { status: 413 },
    );
  }
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Upload too large (${(totalBytes / (1024 * 1024)).toFixed(0)} MB; ` +
          `max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB at once — upload fewer files at a time).`,
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

  // One read serves both the free-tier cap (stored bytes = every blob still
  // in R2: active docs + unconfirmed drafts) and, in auto mode, the known
  // owners/paths that nudge Gemini toward reusing existing names.
  const stored = await docsCol()
    .where("status", "in", ["active", "pending_confirm"])
    .get();
  let usedBytes = 0;
  const owners = new Set<string>();
  const paths = new Set<string>();
  stored.forEach((d) => {
    const data = d.data();
    if (typeof data.size_bytes === "number") usedBytes += data.size_bytes;
    if (data.status !== "active") return;
    if (typeof data.owner === "string" && data.owner) owners.add(data.owner);
    if (typeof data.path === "string" && data.path) paths.add(data.path);
  });
  if (usedBytes + totalBytes > STORAGE_CAP_BYTES) {
    const gb = (n: number) => (n / 1e9).toFixed(2);
    return NextResponse.json(
      {
        error:
          `Storage is almost full (${gb(usedBytes)} of ${gb(STORAGE_CAP_BYTES)} GB used). ` +
          `Delete some documents first.`,
      },
      { status: 507 },
    );
  }
  const knownOwners = [...owners];
  const knownPaths = [...paths];

  const created: UploadResultItem[] = [];
  const errors: UploadErrorItem[] = [];
  const finalizedPaths = new Set<string>();

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const filename = file.name || "untitled";
    const mime = file.type || "application/octet-stream";
    if (!isAllowedMime(mime)) {
      errors.push({ index, filename, error: "Only images and PDFs can be stored." });
      continue;
    }

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

    // The Firestore id doubles as the blob key, so allocate it first.
    const ref = docsCol().doc();
    const key = storageKey(ref.id);
    try {
      await putObject(key, bytes, mime);
    } catch (e) {
      console.warn(`[hermes] R2 upload failed for ${ref.id}: ${(e as Error).message}`);
      errors.push({ index, filename, error: "Couldn't store the file. Try again." });
      continue;
    }

    // Resolve the fields + status for this doc.
    const fields = autoOrganize
      ? autoFields(suggestion, filename)
      : manualFields(manual!, filename);
    const status = autoOrganize ? "pending_confirm" : "active";

    try {
      await ref.set({
        path: fields.path,
        title: fields.title,
        category: fields.category,
        owner: fields.owner,
        doc_date: fields.doc_date,
        tags: fields.tags,
        storage_key: key,
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
    } catch (e) {
      try {
        await deleteObject(key);
      } catch {
        // Already in the failure path; an orphan blob is harmless (unreferenced).
      }
      console.warn(`[hermes] Firestore write failed for ${ref.id}: ${(e as Error).message}`);
      errors.push({ index, filename, error: "Couldn't save the document. Try again." });
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
        // Lowercase so tags are case-canonical across all write paths
        // (auto-suggest already lowercases) — keeps tag filters / grouping
        // from treating "CBSE" and "cbse" as different tags.
        new Set(tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)),
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
