import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { ZipArchive, type Archiver } from "archiver";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { isUnderPath } from "@/lib/folders";
import type { Doc } from "@/lib/types";

export const runtime = "nodejs";

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

/**
 * GET /api/export[?path=Folder/Sub] — stream a ZIP of documents.
 *
 * - With `path`: every active doc in that folder and below.
 * - Without `path`: the whole vault.
 *
 * The archive mirrors the folder tree; each file is named by its doc title +
 * an extension sniffed from its mime type. Blobs are fetched from Buzzheavier
 * sequentially and piped into the archive, so memory stays flat regardless of
 * vault size (we're on a persistent Node server, not serverless).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawPath = (url.searchParams.get("path") ?? "").trim();
  // Normalize away leading/trailing slashes; empty = whole vault.
  const scope = rawPath.replace(/^\/+|\/+$/g, "");

  const snap = await docsCol().where("status", "==", "active").get();
  const docs = snap.docs
    .map((d) => fromFirestore(d.id, d.data()))
    .filter((d) => (scope ? isUnderPath(d.path, scope) : true));

  if (docs.length === 0) {
    return NextResponse.json(
      { error: scope ? `No documents in "${scope}".` : "The vault is empty." },
      { status: 404 },
    );
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (err: Error) => console.warn(`[export] archiver warning: ${err.message}`));
  // On a hard error, destroy the stream so the bridged web stream ends (the
  // client sees a failed download) instead of hanging. We can't change the
  // already-sent 200, so a clean failure is the best outcome.
  archive.on("error", (err: Error) => {
    console.error(`[export] archiver error: ${err.message}`);
    archive.destroy(err);
  });

  // Kick off appending in the background; archiver streams as it goes.
  void appendAll(archive, docs);

  // Bridge the Node Readable to a Web ReadableStream for the Response.
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  const zipName = scope
    ? `hermes-${scope.replace(/[^a-zA-Z0-9]+/g, "-")}.zip`
    : "hermes-vault.zip";

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function appendAll(archive: Archiver, docs: Doc[]) {
  const usedNames = new Map<string, number>(); // per-folder collision counter
  try {
    for (const doc of docs) {
      const entryPath = archiveEntryPath(doc, usedNames);
      let res: Response;
      try {
        res = await fetch(cacheBust(doc.buzzheavier_url), {
          headers: BROWSER_HEADERS,
        });
      } catch (e) {
        console.warn(`[export] fetch failed for ${doc.id}: ${(e as Error).message}`);
        continue; // skip this file rather than break the whole zip
      }
      if (!res.ok) {
        console.warn(`[export] ${doc.id} returned ${res.status}, skipping`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // Attach the drain listeners BEFORE append() — append() emits 'error'
      // synchronously on bad input, so the listeners must already be in place.
      await new Promise<void>((resolve) => {
        const done = () => {
          archive.off("entry", done);
          archive.off("error", done);
          archive.off("close", done);
          resolve();
        };
        archive.once("entry", done);
        archive.once("error", done);
        archive.once("close", done);
        // Wait for the appended entry to drain through compression before
        // fetching the next blob, so peak memory stays ~one file regardless of
        // vault size. 'error'/'close' also resolve so we never hang.
        archive.append(buf, { name: entryPath });
      });
      // If the archive errored/closed mid-stream, stop appending.
      if (archive.destroyed) return;
    }
    await archive.finalize();
  } catch (e) {
    // Don't re-finalize here: if we're in the catch the archive's 'error'
    // handler has already destroy()'d it, and finalize() on a destroyed
    // archive never settles. Just ensure it's torn down so the HTTP stream
    // ends and the client sees a failed (not hung) download.
    console.error(`[export] appendAll error: ${(e as Error).message}`);
    if (!archive.destroyed) archive.destroy();
  }
}

/** Build the in-archive path: mirror the folder tree, name by title + ext,
 * de-duplicating collisions within the same folder. */
function archiveEntryPath(doc: Doc, usedNames: Map<string, number>): string {
  const ext = extFromMime(doc.mime);
  // Guarantee a non-empty stem: a title that's all-whitespace or only
  // sanitized-away chars trims to "", which would make archiver emit an empty
  // entry name (ENTRYNAMEREQUIRED → errors the whole stream). Fall back to the
  // doc id so every entry has a real name.
  const cleaned = (doc.title || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const safeTitle = cleaned || `document-${doc.id}`;
  let base = ext && !safeTitle.toLowerCase().endsWith(ext) ? `${safeTitle}${ext}` : safeTitle;

  const folder = doc.path || "";
  const key = `${folder}/${base.toLowerCase()}`;
  const seen = usedNames.get(key) ?? 0;
  usedNames.set(key, seen + 1);
  if (seen > 0) {
    // "Title.pdf" → "Title (2).pdf"
    const dot = base.lastIndexOf(".");
    base =
      dot > 0
        ? `${base.slice(0, dot)} (${seen + 1})${base.slice(dot)}`
        : `${base} (${seen + 1})`;
  }
  return folder ? `${folder}/${base}` : base;
}

function extFromMime(mime: string): string {
  const m = (mime || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "text/plain": ".txt",
  };
  return map[m] ?? "";
}

function cacheBust(u: string): string {
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}_=${Math.random().toString(36).slice(2, 10)}`;
}
