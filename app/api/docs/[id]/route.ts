import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { deleteFile } from "@/lib/buzzheavier";
import { adjustAccountUsedBytes } from "@/lib/account-usage";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Firestore throws synchronously on ids like "." or ".." — coerce those to a
  // 404 before they bubble up as a 500 with a leaky message.
  let ref: FirebaseFirestore.DocumentReference;
  try {
    ref = docsCol().doc(id);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const doc = fromFirestore(snap.id, snap.data()!);
  if (doc.status === "deleted") {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }
  // pending_confirm drafts belong to the upload-confirm flow; they're discarded
  // via /api/docs/discard, not this route (which is for live, browsable docs).
  if (doc.status !== "active") {
    return NextResponse.json(
      { error: "This document isn't active; use the upload flow to discard it." },
      { status: 409 },
    );
  }

  // Soft-delete first; the row is the source of truth and we don't want a
  // failed Buzzheavier delete to leave the doc visible.
  await ref.update({
    status: "deleted",
    deleted_at: Timestamp.now(),
  });

  // Best-effort blob cleanup. If it fails the row is still soft-deleted; the
  // blob is orphaned but unreferenced.
  let blobDeleted: { ok: boolean; status: number } | { error: string };
  try {
    blobDeleted = await deleteFile({
      buzzheavier_id: doc.buzzheavier_id,
      buzzheavier_account_id: doc.buzzheavier_account_id,
    });
  } catch (e) {
    blobDeleted = { error: (e as Error).message };
  }

  // Decrement the account's used-bytes counter only when the blob delete
  // actually succeeded — otherwise the counter would drift if the blob
  // remains. Best-effort; backfill on next probe self-heals if it fails.
  if ("ok" in blobDeleted && blobDeleted.ok) {
    void adjustAccountUsedBytes(doc.buzzheavier_account_id, -doc.size_bytes).catch(
      (err) => {
        console.warn(
          `[hermes] failed to adjust used_bytes after delete: ${(err as Error).message}`,
        );
      },
    );
  }

  // Refresh the browse view so the deleted doc disappears immediately.
  revalidatePath("/browse");

  return NextResponse.json({ ok: true, blobDeleted, path: doc.path });
}
