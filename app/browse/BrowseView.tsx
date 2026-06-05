import Link from "next/link";
import type { Doc } from "@/lib/types";
import type { FolderEntry } from "@/lib/folders";

interface Props {
  crumbs: { name: string; path: string }[];
  subfolders: FolderEntry[];
  docs: Doc[];
}

export default function BrowseView({ crumbs, subfolders, docs }: Props) {
  const empty = subfolders.length === 0 && docs.length === 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumb crumbs={crumbs} />

      {empty ? (
        <EmptyState />
      ) : (
        <div className="mt-4 space-y-6">
          {subfolders.length > 0 && (
            <section>
              <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Folders
              </h2>
              <ul className="mt-2 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {subfolders.map((f) => (
                  <li key={f.path}>
                    <Link
                      href={`/browse?path=${encodeURIComponent(f.path)}`}
                      className="flex items-center gap-3 px-4 py-3 active:bg-zinc-100 dark:active:bg-zinc-800"
                      style={{ minHeight: 56 }}
                    >
                      <FolderGlyph />
                      <span className="flex-1 truncate font-medium">{f.name}</span>
                      <span className="text-xs text-zinc-500">
                        {f.doc_count} {f.doc_count === 1 ? "item" : "items"}
                      </span>
                      <ChevronRight />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {docs.length > 0 && (
            <section>
              <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Documents
              </h2>
              <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/browse/d/${d.id}`}
                      className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
                      style={{ minHeight: 88 }}
                    >
                      <div className="flex items-start gap-3">
                        <FileGlyph mime={d.mime} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{d.title}</p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {d.owner ? `${d.owner} · ` : ""}
                            {d.doc_date ?? formatBytes(d.size_bytes)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Breadcrumb({ crumbs }: { crumbs: { name: string; path: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-zinc-600 dark:text-zinc-400">
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-400">/</span>}
          {i === crumbs.length - 1 ? (
            <span className="font-medium text-zinc-950 dark:text-zinc-50">{c.name}</span>
          ) : (
            <Link
              href={`/browse${c.path ? `?path=${encodeURIComponent(c.path)}` : ""}`}
              className="rounded px-1 py-0.5 active:bg-zinc-200 dark:active:bg-zinc-800"
            >
              {c.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nothing here yet. Tap <span className="font-medium">Upload</span> to add a document.
      </p>
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="text-amber-500">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function FileGlyph({ mime }: { mime: string }) {
  const isImage = mime.startsWith("image/");
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={isImage ? "text-emerald-500" : "text-sky-600"}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-zinc-400">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
