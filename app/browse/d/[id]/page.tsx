import Link from "next/link";
import { notFound } from "next/navigation";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { formatBytes } from "@/lib/format";
import DeleteButton from "./DeleteButton";

export const dynamic = "force-dynamic";

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Firestore throws synchronously on invalid IDs like "." or "..". Scope the
  // try/catch to ref construction so transient .get() failures (network,
  // quota, auth) still surface as 500 instead of being silently 404'd.
  let ref: FirebaseFirestore.DocumentReference;
  try {
    ref = docsCol().doc(id);
  } catch {
    return notFound();
  }
  const snap = await ref.get();
  if (!snap.exists) return notFound();
  const doc = fromFirestore(snap.id, snap.data()!);
  if (doc.status !== "active") return notFound();

  const kind = fileKind(doc.mime);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href={`/browse?path=${encodeURIComponent(doc.path)}`}
        className="-ml-2 inline-flex items-center gap-1 rounded-lg px-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        style={{ minHeight: 44 }}
      >
        <BackIcon /> {doc.path.split("/").pop() || "All documents"}
      </Link>

      <h1 className="mt-2 break-words text-2xl font-semibold">{doc.title}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {kind} · {formatBytes(doc.size_bytes)}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a
          href={`/api/docs/${doc.id}/download?disposition=inline`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
          style={{ minHeight: 52 }}
        >
          <OpenIcon /> Open {kind === "Photo" ? "photo" : "document"}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <a
          href={`/api/docs/${doc.id}/download`}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 text-base font-medium transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          style={{ minHeight: 52 }}
        >
          <DownloadIcon /> Save a copy
        </a>
      </div>

      <dl className="mt-6 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <Row label="Folder" value={doc.path} />
        <Row label="Category" value={doc.category} />
        {doc.owner && <Row label="Belongs to" value={doc.owner} />}
        {doc.doc_date && <Row label="Date on document" value={formatDay(doc.doc_date)} />}
        {doc.tags.length > 0 && <Row label="Tags" value={doc.tags.join(", ")} />}
        <Row label="Added" value={formatDay(doc.uploaded_at)} />
        {doc.uploaded_by && <Row label="Added from" value={doc.uploaded_by} />}
      </dl>

      <div className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <DeleteButton docId={doc.id} parentPath={doc.path} title={doc.title} />
      </div>
    </div>
  );
}

/** Plain-language file kind for non-technical readers. */
function fileKind(mime: string): string {
  if (mime.startsWith("image/")) return "Photo";
  if (mime === "application/pdf") return "PDF";
  return "File";
}

/** "2023-05-30" or an ISO timestamp → "30 May 2023" (date only, no TZ shift). */
function formatDay(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="text-sm text-zinc-600 sm:w-40 sm:flex-none dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}
