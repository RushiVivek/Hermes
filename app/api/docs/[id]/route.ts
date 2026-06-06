import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { deleteFile } from "@/lib/buzzheavier";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ref = docsCol.doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const doc = fromFirestore(snap.id, snap.data()!);
  if (doc.status === "deleted") {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
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

  return NextResponse.json({ ok: true, blobDeleted, path: doc.path });
}
