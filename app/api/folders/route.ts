import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { deleteFile } from "@/lib/buzzheavier";
import { adjustAccountUsedBytes } from "@/lib/account-usage";
import { unregisterFolderTree } from "@/lib/folder-store";
import { isUnderPath } from "@/lib/folders";

export const runtime = "nodejs";

/** DELETE /api/folders?path=<canonical-folder-path>
 *
 * Soft-deletes every active doc whose `path` is the given path or any
 * descendant of it, then best-effort deletes the corresponding Buzzheavier
 * blobs and adjusts each account's used-bytes counter.
 *
 * Returns:
 *   { deleted: number, blobErrors: Array<{ id, error }> }
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

  // Best-effort blob cleanup. Awaited (Vercel/Lambda would otherwise reap
  // pending fetches).
  const blobErrors: Array<{ id: string; error: string }> = [];
  for (const doc of targets) {
    try {
      const res = await deleteFile({
        buzzheavier_id: doc.buzzheavier_id,
        buzzheavier_account_id: doc.buzzheavier_account_id,
      });
      if (res.ok) {
        // Update the per-account counter only on confirmed delete.
        try {
          await adjustAccountUsedBytes(
            doc.buzzheavier_account_id,
            -doc.size_bytes,
          );
        } catch (err) {
          console.warn(
            `[hermes] used-bytes adjust after folder delete failed: ${(err as Error).message}`,
          );
        }
      } else {
        blobErrors.push({ id: doc.id, error: `${res.status}` });
      }
    } catch (e) {
      blobErrors.push({ id: doc.id, error: (e as Error).message });
    }
  }

  revalidatePath("/browse");

  return NextResponse.json({ deleted: targets.length, blobErrors });
}
