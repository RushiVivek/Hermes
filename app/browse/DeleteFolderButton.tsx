"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  path: string;
  itemCount: number;
}

export default function DeleteFolderButton({ path, itemCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (itemCount === 0) return;
    const lastSeg = path.split("/").pop() || path;
    const ok = window.confirm(
      `Delete the folder "${lastSeg}"?\n\n` +
        `This will permanently remove ${itemCount} ${itemCount === 1 ? "item" : "items"}` +
        ` (and any sub-folders inside). This cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/folders?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `Delete failed (${res.status})`);
        return;
      }
      // Navigate up one level after deleting.
      const parent = path.split("/").slice(0, -1).join("/");
      const url = parent
        ? `/browse?path=${encodeURIComponent(parent)}`
        : "/browse";
      router.push(url);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || itemCount === 0}
        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 active:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"
        style={{ minHeight: 44 }}
      >
        <TrashIcon /> {busy ? "Deleting…" : "Delete folder"}
      </button>
      {error && <p role="alert" className="mt-1 w-full text-sm text-red-700 dark:text-red-300">{error}</p>}
    </>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="m6 6 1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}
