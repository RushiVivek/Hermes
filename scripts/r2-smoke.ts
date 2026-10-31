// End-to-end R2 check: put → get → compare → signed-link download → delete
// one tiny object.
// Run via:    npm run r2:smoke
//
// First thing to run when uploads/downloads misbehave — it isolates "is it
// our code or is it the bucket/credentials?".

import { randomUUID } from "node:crypto";
import { deleteObject, getObjectBytes, putObject, signedDownloadUrl } from "@/lib/r2";

async function main() {
  const key = `smoke/${randomUUID()}`;
  const payload = new TextEncoder().encode(`hermes r2 smoke ${new Date().toISOString()}`);

  console.log(`put    ${key}`);
  await putObject(key, payload, "text/plain");

  console.log(`get    ${key}`);
  const back = await getObjectBytes(key);
  const same =
    back.length === payload.length && back.every((b, i) => b === payload[i]);
  if (!same) throw new Error("Downloaded bytes don't match what was uploaded.");

  // The path the download button uses: a signed link with forced headers.
  console.log(`signed ${key}`);
  const disposition = `attachment; filename="smoke.txt"`;
  const res = await fetch(
    await signedDownloadUrl(key, { contentType: "text/plain", contentDisposition: disposition }),
  );
  if (!res.ok) throw new Error(`Signed download link returned HTTP ${res.status}.`);
  if (res.headers.get("content-disposition") !== disposition) {
    throw new Error(
      `Signed link didn't apply Content-Disposition (got "${res.headers.get("content-disposition")}").`,
    );
  }
  await res.arrayBuffer();

  console.log(`delete ${key}`);
  await deleteObject(key);

  console.log("\nOK — R2 round-trip works.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\nR2 smoke test FAILED: ${(err as Error).message}`);
    process.exit(1);
  },
);
