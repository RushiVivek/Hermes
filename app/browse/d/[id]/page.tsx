import Link from "next/link";
import { notFound } from "next/navigation";
import { docsCol, fromFirestore } from "@/lib/firestore";
import DeleteButton from "./DeleteButton";

export const dynamic = "force-dynamic";

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const snap = await docsCol.doc(id).get();
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
        href={doc.buzzheavier_url}
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
