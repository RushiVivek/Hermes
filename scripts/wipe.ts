// Hard-wipe every active/pending doc + its R2 blob.
// Run via:    npm run wipe
//
// Use cases:
//   - Reset the vault during dev.
//   - Recover from an aborted import.
//
// What it does, in order:
//   1) Lists every doc with status active or pending_confirm.
//   2) Prompts for confirmation: prints the count and asks you to type "WIPE".
//   3) For each doc, deletes the R2 blob, then marks the Firestore row deleted.
//   4) Clears the folder registry and login rate-limit records.

import { Timestamp } from "firebase-admin/firestore";
import readline from "node:readline";
import { docsCol, fromFirestore, getDb } from "@/lib/firestore";
import { deleteObject } from "@/lib/r2";
import { LOGIN_ATTEMPTS_COLLECTION } from "@/lib/rate-limit";

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await new Promise<string>((resolve) =>
      rl.question(prompt, resolve),
    );
    return ans.trim() === "WIPE";
  } finally {
    rl.close();
  }
}

async function clearCollection(name: string): Promise<number> {
  const db = getDb();
  const snap = await db.collection(name).get();
  if (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.size;
}

async function main() {
  // Wipe both live docs and abandoned auto-organize drafts (pending_confirm
  // rows the user never confirmed and whose blobs are still in R2).
  const snap = await docsCol()
    .where("status", "in", ["active", "pending_confirm"])
    .get();
  const docs = snap.docs.map((d) => fromFirestore(d.id, d.data()));
  if (docs.length === 0) {
    console.log("No active or pending docs. Nothing to wipe.");
    return;
  }

  console.log(`About to wipe ${docs.length} doc(s) (active + pending):`);
  for (const d of docs.slice(0, 20)) {
    console.log(`  • ${d.path} / ${d.title}`);
  }
  if (docs.length > 20) console.log(`  …and ${docs.length - 20} more.`);

  const ok = await confirm('\nType "WIPE" (in caps) to proceed: ');
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  let blobOk = 0;
  let blobErr = 0;
  const writer = getDb().batch();
  const now = Timestamp.now();

  for (const d of docs) {
    try {
      await deleteObject(d.storage_key);
      blobOk++;
    } catch (e) {
      blobErr++;
      console.warn(`  blob ${d.storage_key}: ${(e as Error).message}`);
    }
    writer.update(docsCol().doc(d.id), { status: "deleted", deleted_at: now });
  }

  await writer.commit();

  // Clear the persistent folder registry too, so emptied folders don't linger.
  const folders = await clearCollection("folders");
  const attempts = await clearCollection(LOGIN_ATTEMPTS_COLLECTION);

  console.log(
    `\nDone. Rows soft-deleted: ${docs.length}. Blobs deleted: ${blobOk}. ` +
      `Blob errors: ${blobErr}. Folder entries cleared: ${folders}. ` +
      `Login-attempt records cleared: ${attempts}.`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
