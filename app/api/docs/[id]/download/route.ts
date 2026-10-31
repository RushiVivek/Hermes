import { NextResponse } from "next/server";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { signedDownloadUrl } from "@/lib/r2";
import { extFromMime, isAllowedMime } from "@/lib/mime";

export const runtime = "nodejs";

/** Check auth (via the proxy) + doc status, then redirect to a short-lived
 * signed R2 URL so the bytes go browser↔R2 directly (the bucket stays private).
 *
 * `?disposition=attachment` (default) forces a browser download dialog with
 * the original title as the filename. `?disposition=inline` lets the
 * browser open it in-place (useful for previewing PDFs / images) — but only
 * for the stored-type allowlist. Type and disposition are baked into the
 * signature, so the link can't be altered to serve something else. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dispositionParam = new URL(req.url).searchParams.get("disposition");

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
  if (doc.status !== "active") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const safe = isAllowedMime(doc.mime);
  const disposition = dispositionParam === "inline" && safe ? "inline" : "attachment";

  let url: string;
  try {
    url = await signedDownloadUrl(doc.storage_key, {
      contentType: safe ? doc.mime : "application/octet-stream",
      contentDisposition: contentDisposition(disposition, filenameFor(doc.title, doc.mime)),
    });
  } catch (e) {
    console.warn(`[hermes] R2 signing failed for ${doc.id}: ${(e as Error).message}`);
    return NextResponse.json({ error: "Couldn't fetch the file." }, { status: 502 });
  }

  // no-store: the signed URL expires, so a cached redirect would go stale.
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

function filenameFor(title: string, mime: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "document";
  // Only add an extension if title doesn't already have one.
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
  return base + extFromMime(mime);
}

/** RFC 5987 encoding for non-ASCII filenames. */
function contentDisposition(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  // ASCII-only fallback for legacy clients.
  const asciiSafe = filename.replace(/[^\x20-\x7e]/g, "_");
  const utf8 = encodeURIComponent(filename);
  return `${disposition}; filename="${asciiSafe}"; filename*=UTF-8''${utf8}`;
}
