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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href={`/browse?path=${encodeURIComponent(doc.path)}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-400"
      >
        <span aria-hidden>←</span> Back to {doc.path.split("/").pop() || "All"}
      </Link>

      <h1 className="mt-3 text-xl font-semibold">{doc.title}</h1>

      <a
        href={`/api/docs/${doc.id}/download?disposition=inline`}
        target="_blank"
        rel="noreferrer"
        className="mt-4 block rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm font-medium active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
        style={{ minHeight: 88 }}
      >
        Open document
        <span className="block text-xs font-normal text-zinc-500">
          {doc.mime} · {formatBytes(doc.size_bytes)}
        </span>
      </a>

      <a
        href={`/api/docs/${doc.id}/download`}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:active:bg-zinc-800"
        style={{ minHeight: 36 }}
      >
        <DownloadIcon /> Download
      </a>

      <dl className="mt-6 space-y-3 text-sm">
        <Row label="Folder" value={doc.path} />
        <Row label="Type" value={doc.category} />
        {doc.owner && <Row label="Who it belongs to" value={doc.owner} />}
        {doc.doc_date && <Row label="Date on document" value={doc.doc_date} />}
        {doc.tags.length > 0 && <Row label="Tags" value={doc.tags.join(", ")} />}
        <Row label="Added" value={new Date(doc.uploaded_at).toLocaleDateString()} />
        {doc.uploaded_by && <Row label="Added from" value={doc.uploaded_by} />}
      </dl>

      <div className="mt-8">
        <DeleteButton docId={doc.id} parentPath={doc.path} title={doc.title} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 flex-none text-zinc-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}

