/** Shown instantly while the folder's documents load from Firestore. Same
 * shape as BrowseView's list view so nothing jumps when it arrives. */
export default function BrowseLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4" aria-busy="true" aria-label="Loading documents">
      <div className="mt-1 h-8 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-11 w-44 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 last:border-0 dark:border-zinc-800"
            style={{ minHeight: 60 }}
          >
            <div className="h-6 w-6 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
