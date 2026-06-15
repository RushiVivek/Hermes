import { NextResponse } from "next/server";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { registerFolderPath } from "@/lib/folder-store";
import { CATEGORIES, type Category } from "@/lib/types";

export const runtime = "nodejs";

interface ConfirmItem {
  id: string;
  title: string;
  category: string;
  subfolder: string;
  owner?: string;
  doc_date?: string;
  tags?: string[];
}

/**
 * POST /api/docs/confirm — finalize one or more pending_confirm docs with the
 * user-edited fields, flipping them to active. Body: { items: ConfirmItem[] }.
 *
 * Only touches docs currently in pending_confirm — confirming an already-active
 * or deleted doc is a no-op for that id (so a double-submit can't corrupt
 * anything).
 */
export async function POST(req: Request) {
  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? (body.items as ConfirmItem[]) : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "No items to confirm." }, { status: 400 });
  }

  const confirmedPaths = new Set<string>();
  const confirmed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const item of items) {
    if (typeof item?.id !== "string" || !item.id) {
      skipped.push({ id: String(item?.id), reason: "missing id" });
      continue;
    }
    const fields = resolveFields(item);
    if ("error" in fields) {
      skipped.push({ id: item.id, reason: fields.error });
      continue;
    }

    let ref: FirebaseFirestore.DocumentReference;
    try {
      ref = docsCol().doc(item.id);
    } catch {
      skipped.push({ id: item.id, reason: "bad id" });
      continue;
    }
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push({ id: item.id, reason: "not found" });
      continue;
    }
    const doc = fromFirestore(snap.id, snap.data()!);
    if (doc.status !== "pending_confirm") {
      skipped.push({ id: item.id, reason: `status ${doc.status}` });
      continue;
    }

    // Use FieldValue.delete() for empty owner/doc_date so the field is removed
    // rather than stored as null — keeps the representation consistent with the
    // upload route (which writes undefined, dropped by ignoreUndefinedProperties).
    await ref.update({
      title: fields.title,
      category: fields.category,
      path: fields.path,
      owner: fields.owner ?? FieldValue.delete(),
      doc_date: fields.doc_date ?? FieldValue.delete(),
      tags: fields.tags,
      status: "active",
      confirmed_at: Timestamp.now(),
    });
    confirmed.push(item.id);
    confirmedPaths.add(fields.path);
  }

  for (const p of confirmedPaths) {
    try {
      await registerFolderPath(p);
    } catch (e) {
      console.warn(`[hermes] confirm: folder register "${p}" failed: ${(e as Error).message}`);
    }
  }
  if (confirmed.length > 0) revalidatePath("/browse");

  return NextResponse.json({ confirmed, skipped });
}

interface Resolved {
  title: string;
  category: Category;
  path: string;
  owner?: string;
  doc_date?: string;
  tags: string[];
}

function resolveFields(item: ConfirmItem): Resolved | { error: string } {
  const title = (item.title ?? "").trim();
  if (!title) return { error: "title required" };

  const category = (item.category ?? "").trim();
  if (!CATEGORIES.includes(category as Category)) {
    return { error: "invalid category" };
  }
  const subfolder = sanitizeSubfolder((item.subfolder ?? "").trim());
  if (subfolder === null) return { error: "invalid subfolder" };
  if (subfolder.length > 200) return { error: "subfolder too long" };

  const docDate = (item.doc_date ?? "").trim();
  if (docDate && !isValidIsoDate(docDate)) return { error: "invalid date" };

  const tags = Array.isArray(item.tags)
    ? Array.from(
        new Set(
          item.tags
            .map((t) => (typeof t === "string" ? t.trim() : ""))
            .filter(Boolean),
        ),
      ).slice(0, 10)
    : [];

  return {
    title,
    category: category as Category,
    path: subfolder ? `${category}/${subfolder}` : category,
    owner: (item.owner ?? "").trim() || undefined,
    doc_date: docDate || undefined,
    tags,
  };
}

function sanitizeSubfolder(raw: string): string | null {
  if (raw === "") return "";
  if (/[\x00-\x1f\x7f\u2028\u2029\\]/.test(raw)) return null;
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}

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
