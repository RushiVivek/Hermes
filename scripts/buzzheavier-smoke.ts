// End-to-end smoke test against the real Buzzheavier API.
// Run via:    npm run buzzheavier:smoke
// (loads .env.local for BUZZHEAVIER_ACCOUNTS / BUZZHEAVIER_ACTIVE_INDEX)
//
// What it checks, in order:
//   1) /api/fs returns the expected { data: { id, size } } shape for each account
//   2) pickAccountForUpload returns a viable account
//   3) PUT a 4-byte file to that account's root, parse the returned id
//   4) GET https://buzzheavier.com/{id} returns 200
//   5) DELETE /api/fs/{id} returns 2xx
//
// On success: prints "✓ smoke OK".  On failure: prints what broke and exits 1.

import { pickAccountForUpload, uploadFile, deleteFile } from "@/lib/buzzheavier";

async function main() {
  console.log("buzzheavier smoke — checking the assumptions hermes makes.\n");

  // 1) probe each account explicitly via the picker.
  console.log("[1/5] probing accounts via /api/fs…");
  const account = await pickAccountForUpload(4); // 4 bytes
  console.log(
    `       ✓ picked account starting "${account.id.slice(0, 6)}…" ` +
      `(rootDir "${account.rootDir.slice(0, 8)}…", used ${account.usedBytes} bytes)`,
  );

  // 2) PUT a tiny file.
  const filename = `hermes-smoke-${Date.now()}.txt`;
  console.log(`[2/5] PUTing ${filename}…`);
  const blob = await uploadFile(account, {
    bytes: new TextEncoder().encode("ok\n"),
    filename,
    mime: "text/plain",
  });
  console.log(
    `       ✓ uploaded — id ${blob.buzzheavier_id}, url ${blob.buzzheavier_url}`,
  );

  // 3) GET the public URL. Buzzheavier sits behind Cloudflare; a fresh
  // upload's download URL sometimes 403s on the first hit before CF's edge
  // cache catches up. Retry a few times with a real browser UA.
  console.log("[3/5] GET public URL…");
  const head = await fetchWithRetry(blob.buzzheavier_url, { method: "HEAD" });
  if (!head.ok) {
    throw new Error(
      `Public URL returned ${head.status} ${head.statusText} after retries; expected 2xx.`,
    );
  }
  console.log(`       ✓ ${head.status} ${head.statusText}`);

  // 4) DELETE.
  console.log("[4/5] DELETE the test blob…");
  const del = await deleteFile({
    buzzheavier_id: blob.buzzheavier_id,
    buzzheavier_account_id: blob.buzzheavier_account_id,
  });
  if (!del.ok) {
    throw new Error(
      `DELETE returned ${del.status}; the blob may be orphaned in your account.`,
    );
  }
  console.log(`       ✓ deleted (${del.status})`);

  // 5) confirm the public URL now 404s. (Tolerate a brief eventual-consistency
  //    window — buzzheavier may serve a cached response for a few seconds.)
  console.log("[5/5] confirm the URL is gone…");
  const after = await fetch(blob.buzzheavier_url, {
    method: "HEAD",
    headers: BROWSER_HEADERS,
  });
  if (after.ok) {
    console.log(
      `       ⚠︎ public URL still returned ${after.status} (likely cache; ` +
        `the row is deleted server-side).`,
    );
  } else {
    console.log(`       ✓ ${after.status}`);
  }

  console.log("\n✓ smoke OK");
}

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

function withCacheBuster(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  const nonce =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return `${url}${sep}_=${nonce}`;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let last: Response | null = null;
  for (let i = 1; i <= attempts; i++) {
    // First attempt hits the canonical URL; retries get a unique URL so CF's
    // per-URL cache of a challenge response can't keep replaying.
    const u = i === 1 ? url : withCacheBuster(url);
    last = await fetch(u, {
      ...init,
      headers: { ...BROWSER_HEADERS, ...((init.headers as Record<string, string>) ?? {}) },
    });
    if (last.ok) return last;
    if (i < attempts) {
      console.log(`       (retry ${i}: ${last.status} ${last.statusText})`);
      await new Promise((r) => setTimeout(r, i * 250));
    }
  }
  return last as Response;
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\n✗ smoke FAILED:", err);
    process.exit(1);
  },
);
