import { NextResponse } from "next/server";
import { docsCol, fromFirestore } from "@/lib/firestore";

export const runtime = "nodejs";

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

/** Stream the doc's Buzzheavier blob through hermes so the user never sees
 * the upstream URL.
 *
 * `?disposition=attachment` (default) forces a browser download dialog with
 * the original title as the filename. `?disposition=inline` lets the
 * browser open it in-place (useful for previewing PDFs / images). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dispositionParam = new URL(req.url).searchParams.get("disposition");
  const disposition = dispositionParam === "inline" ? "inline" : "attachment";

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

  // Cache-bust the upstream URL so Cloudflare's per-URL cache can't keep
  // replaying a stale 403/challenge for repeat downloads.
  const sep = doc.buzzheavier_url.includes("?") ? "&" : "?";
  const upstreamUrl = `${doc.buzzheavier_url}${sep}_=${Math.random().toString(36).slice(2, 10)}`;

  const upstream = await fetch(upstreamUrl, { headers: BROWSER_HEADERS });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  // Build a safe Content-Disposition filename from doc.title + extension
  // sniffed from mime type.
  const filename = filenameFor(doc.title, doc.mime);

  const headers = new Headers();
  headers.set("Content-Type", doc.mime || "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(disposition, filename));
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new Response(upstream.body, { status: 200, headers });
}

function filenameFor(title: string, mime: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "document";
  // Only add an extension if title doesn't already have one.
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) return base;
  const ext = extFromMime(mime);
  return ext ? `${base}.${ext}` : base;
}

function extFromMime(mime: string): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/webp": "webp",
    "image/gif": "gif",
    "text/plain": "txt",
  };
  return map[mime.split(";")[0].trim().toLowerCase()] ?? "";
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
