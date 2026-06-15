// Hard-wipe every active doc + its Buzzheavier blob.
// Run via:    npm run wipe
//
// Use cases:
//   - Clear seed data after first deploy.
//   - Reset the vault during dev.
//   - Recover from an aborted import.
//
// What it does, in order:
//   1) Lists every doc with status='active' (skips already-deleted rows).
//   2) Prompts for confirmation: prints the count and asks you to type "WIPE".
//   3) For each doc, awaits Buzzheavier DELETE (decrementing the per-account
//      used-bytes counter on success), then marks the Firestore row deleted.
//
// Seeded fixture docs live under buzzheavier_account_id="demo-account" which
// won't be in BUZZHEAVIER_ACCOUNTS. Their blob deletes will fail — that's
// expected; the row still gets soft-deleted.

import { Timestamp } from "firebase-admin/firestore";
import readline from "node:readline";
import { docsCol, fromFirestore, getDb } from "@/lib/firestore";
import { deleteFile } from "@/lib/buzzheavier";
import { adjustAccountUsedBytes } from "@/lib/account-usage";

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

async function main() {
  // Wipe both live docs and abandoned auto-organize drafts (pending_confirm
  // rows the user never confirmed and whose blobs are still on Buzzheavier).
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
  let rowOk = 0;
  const db = getDb();
  const writer = db.batch();
  const now = Timestamp.now();

  for (const d of docs) {
    try {
      const res = await deleteFile({
        buzzheavier_id: d.buzzheavier_id,
        buzzheavier_account_id: d.buzzheavier_account_id,
      });
      if (res.ok) {
        blobOk++;
        try {
          await adjustAccountUsedBytes(d.buzzheavier_account_id, -d.size_bytes);
        } catch {
          // Counter drift is recoverable on next probe.
        }
      } else {
        blobErr++;
        console.warn(
          `  blob ${d.buzzheavier_id} (acct "${d.buzzheavier_account_id.slice(0, 6)}…"): HTTP ${res.status}`,
        );
      }
    } catch (e) {
      blobErr++;
      console.warn(
        `  blob ${d.buzzheavier_id} (acct "${d.buzzheavier_account_id.slice(0, 6)}…"): ${(e as Error).message}`,
      );
    }
    writer.update(docsCol().doc(d.id), { status: "deleted", deleted_at: now });
    rowOk++;
  }

  await writer.commit();

  // Clear the persistent folder registry too, so emptied folders don't linger
  // after a wipe.
  const folderSnap = await db.collection("folders").get();
  if (!folderSnap.empty) {
    const fb = db.batch();
    folderSnap.docs.forEach((d) => fb.delete(d.ref));
    await fb.commit();
  }

  console.log(
    `\nDone. Rows soft-deleted: ${rowOk}. Blobs deleted: ${blobOk}. ` +
      `Blob errors: ${blobErr}. Folder entries cleared: ${folderSnap.size}.`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
