import { NextResponse } from "next/server";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { deleteObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/docs/discard — throw away pending_confirm docs the user chose not
 * to keep (e.g. backed out of the confirm screen). Hard-removes the Firestore
 * row and best-effort deletes the R2 blob. Body: { ids: string[] }.
 *
 * Only operates on pending_confirm docs — never deletes an active doc, so a
 * stray/duplicate call can't destroy saved data.
 */
export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "No ids to discard." }, { status: 400 });
  }

  let discarded = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    let ref: FirebaseFirestore.DocumentReference;
    try {
      ref = docsCol().doc(id);
    } catch {
      skipped.push({ id, reason: "bad id" });
      continue;
    }
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    const doc = fromFirestore(snap.id, snap.data()!);
    if (doc.status !== "pending_confirm") {
      // Refuse to discard anything that isn't a pending draft.
      skipped.push({ id, reason: `status ${doc.status}` });
      continue;
    }

    // Best-effort blob cleanup, then remove the row entirely (it was never
    // shown in browse, so a hard delete is fine and keeps the collection tidy).
    try {
      await deleteObject(doc.storage_key);
    } catch (e) {
      // An orphan blob is unreferenced; log it and still drop the draft.
      console.warn(`[hermes] R2 delete failed for draft ${id}: ${(e as Error).message}`);
    }
    await ref.delete();
    discarded++;
  }

  return NextResponse.json({ discarded, skipped });
}
