/** Shown instantly while one document's details load. */
export default function DocLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" aria-busy="true" aria-label="Loading document">
      <div className="h-11 w-36 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-3 h-8 w-3/4 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-5 h-[104px] animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
        ))}
      </div>
    </div>
  );
}
