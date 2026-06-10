// Persistent folder registry. Folders are normally *derived* from document
// paths (see lib/folders.ts), which means a folder vanishes the moment its
// last document is deleted. To keep folders around after they're emptied, we
// also record every folder path (and its ancestors) in a Firestore `folders`
// collection. The browse view unions these with the doc-derived folders.

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firestore";
import { splitPath, joinPath } from "./folders";

const COLLECTION = "folders";

/** Firestore doc ids can't contain "/", so we encode the path. */
function encodeId(path: string): string {
  return encodeURIComponent(path);
}

/** Every ancestor path of `path`, inclusive. "A/B/C" -> ["A","A/B","A/B/C"]. */
export function ancestorPaths(path: string): string[] {
  const parts = splitPath(path);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    out.push(joinPath(parts.slice(0, i)));
  }
  return out;
}

/** Record `path` and all its ancestors as persistent folders. Idempotent. */
export async function registerFolderPath(path: string): Promise<void> {
  const paths = ancestorPaths(path);
  if (paths.length === 0) return;
  const db = getDb();
  const batch = db.batch();
  for (const p of paths) {
    batch.set(
      db.collection(COLLECTION).doc(encodeId(p)),
      { path: p, created_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
}

/** All registered folder paths. */
export async function listFolderPaths(): Promise<string[]> {
  const snap = await getDb().collection(COLLECTION).get();
  const paths: string[] = [];
  for (const d of snap.docs) {
    const p = d.data()?.path;
    if (typeof p === "string" && p !== "") paths.push(p);
  }
  return paths;
}

/** Remove `folderPath` and every descendant folder entry. Used by folder
 * delete so a deleted folder doesn't linger as an empty shell. */
export async function unregisterFolderTree(folderPath: string): Promise<void> {
  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    const p = d.data()?.path;
    if (
      typeof p === "string" &&
      (p === folderPath || p.startsWith(folderPath + "/"))
    ) {
      batch.delete(d.ref);
      n++;
    }
  }
  if (n > 0) await batch.commit();
}
