import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { deleteObject } from "@/lib/r2";
import { unregisterFolderTree } from "@/lib/folder-store";
import { isUnderPath } from "@/lib/folders";

export const runtime = "nodejs";

/** DELETE /api/folders?path=<canonical-folder-path>
 *
 * Soft-deletes every active doc whose `path` is the given path or any
 * descendant of it, then best-effort deletes the corresponding R2 blobs.
 *
 * Returns:
 *   { deleted: number, blobErrors: Array<{ id }> }
 *
 * The path is required and must be non-empty — deleting "everything" is
 * intentionally not supported via this endpoint to avoid the worst foot-gun.
 */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const path = (url.searchParams.get("path") ?? "").trim();
  if (path === "") {
    return NextResponse.json(
      { error: "path query parameter is required and cannot be empty." },
      { status: 400 },
    );
  }

  // Find every active doc under this folder.
  const snap = await docsCol().where("status", "==", "active").get();
  const targets = snap.docs
    .map((d) => fromFirestore(d.id, d.data()))
    .filter((doc) => isUnderPath(doc.path, path));

  // Remove the folder (and descendants) from the persistent registry first,
  // so deleting an empty folder also makes it disappear. Done even when there
  // are zero docs.
  try {
    await unregisterFolderTree(path);
  } catch (e) {
    console.warn(`[hermes] failed to unregister folder "${path}": ${(e as Error).message}`);
  }

  if (targets.length === 0) {
    revalidatePath("/browse");
    return NextResponse.json({ deleted: 0, blobErrors: [] });
  }

  // Soft-delete the rows first (one batch).
  const db = (await import("@/lib/firestore")).getDb();
  const writer = db.batch();
  const now = Timestamp.now();
  for (const doc of targets) {
    writer.update(docsCol().doc(doc.id), { status: "deleted", deleted_at: now });
  }
  await writer.commit();

  // Best-effort blob cleanup; failures leave unreferenced orphans.
  const blobErrors: Array<{ id: string }> = [];
  for (const doc of targets) {
    try {
      await deleteObject(doc.storage_key);
    } catch (e) {
      console.warn(`[hermes] R2 delete failed for ${doc.id}: ${(e as Error).message}`);
      blobErrors.push({ id: doc.id });
    }
  }

  revalidatePath("/browse");

  return NextResponse.json({ deleted: targets.length, blobErrors });
}
